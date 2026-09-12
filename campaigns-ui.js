import { esc, dateText, dateISO, timeLabel } from './core.js';
import { RETURN_TO_STEP_ONE, campaignUpdateOptions, openReturnToStepOne } from './campaign-return-step-one.js';
import { CONTACT_OUTCOMES, CAMPAIGN_TOPICS, fullName, outcomeLabel, isScheduledOutcome, campaignToday, campaignTimestamp, appointmentSlots, slotIsBooked } from './campaigns-model.js';

const options = (rows, selected = '') => rows.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('');
const locationText = row => [row.county, row.state?.toUpperCase()].filter(Boolean).join(', ') || 'Location not entered';
const field = (name, label, value = '', extra = '') => `<label class="field"><span>${esc(label)}</span><input name="${name}" value="${esc(value)}" ${extra}></label>`;
const footer = label => `<span class="dirty-state" data-dirty aria-live="polite">No changes</span><div class="footer-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button type="button" class="btn primary" data-save="close">${esc(label)}</button></div>`;
const empty = text => `<div class="cmp-empty">${esc(text)}</div>`;
const stat = (label, count) => `<div><strong>${Number(count || 0)}</strong><span>${esc(label)}</span></div>`;
const phone = value => {
  const raw = String(value || '').trim(), digits = raw.replace(/\D/g, '');
  return /^[\d\s()+.-]+$/.test(raw) && digits.length === 10 ? `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}` : raw || 'Phone not entered';
};
const problem = error => error?.message || 'This action could not finish. Please retry.';

/** Uses the workspace's existing dialog stack and canonical client-record opener. */
export function createCampaignFeature({ repository, dialogs, openClient, onCalendarChange = () => {} }) {
  const api = repository.campaigns;
  const state = { host: null, campaign: null, campaignId: null, list: [], listCursor: null, listStatus: 'active', members: [], cursor: null, token: 0, loading: false, filter: 'all', query: '', sort: 'name', direction: 'asc', message: '', error: '' };
  const selection = new Map();
  let selectionMode = false, searchHost = null, searchRows = [];
  const agents = () => (repository.agents || []).filter(a => a.active !== false);
  const userId = () => repository.user?.id || '';
  const admin = () => ['owner', 'admin'].includes(repository.profile?.role);
  const live = () => !!state.host?.isConnected;
  const announce = (text, error = false) => { state.message = error ? '' : text; state.error = error ? text : ''; if (live()) render(); };
  function notice() { return state.error ? `<p class="cmp-notice is-error" role="alert">${esc(state.error)}</p>` : state.message ? `<p class="cmp-notice" role="status">${esc(state.message)}</p>` : ''; }
  function campaignCard(c) {
    return `<button type="button" class="cmp-campaign-card" data-cmp-open="${esc(c.id)}"><span class="cmp-kicker">${esc(CAMPAIGN_TOPICS.find(([key]) => key === c.topic)?.[1] || c.topic)} · ${esc(c.status)}</span><strong>${esc(c.name)}</strong><span>${esc(c.description || 'One Contact stage. Select clients and record the result.')}</span><span class="cmp-card-foot">${Number(c.total_count || 0)} clients · ${Number(c.contacted_count || 0)} contacted <b aria-hidden="true">›</b></span></button>`;
  }
  function memberCard(row) {
    const deceased = row.client_status === 'deceased';
    const locked = deceased || state.campaign?.status !== 'active';
    const next = row.next_event_date ? `${dateText(row.next_event_date)}${row.next_event_time ? ` · ${timeLabel(row.next_event_time.slice(0,5))}` : ''} · ${row.next_event_status || 'scheduled'}` : 'No appointment / follow-up set';
    return `<article class="cmp-member" data-cmp-member="${esc(row.id)}">
      <div class="cmp-person"><strong>${esc(fullName(row))}</strong><span>${esc(phone(row.phone))}</span><small>${esc(locationText(row))}</small><small>${esc(deceased ? 'Deceased — contact disabled' : (row.products || []).map(p => String(p).replaceAll('_',' ')).join(' · '))}</small></div>
      <div class="cmp-status"><span class="cmp-badge ${deceased ? 'is-deceased' : `is-${esc(row.contact_status)}`}">${esc(deceased ? 'Deceased' : outcomeLabel(row.contact_status))}</span><small>${Number(row.attempt_count || 0)} contact update${row.attempt_count === 1 ? '' : 's'}</small></div>
      <div class="cmp-activity"><small>Last contact: ${esc(campaignTimestamp(row.last_contacted_at))}</small><span>${esc(next)}</span>${row.next_action ? `<small>${esc(row.next_action)}</small>` : ''}${row.last_note ? `<p>${esc(row.last_note)}</p>` : ''}</div>
      <div class="cmp-actions"><button type="button" class="btn secondary" data-client-id="${esc(row.client_id)}">Open Client</button><label class="cmp-update-select"><span class="cmp-sr-only">Spoke / Update — ${esc(fullName(row))}</span><select data-cmp-update="${esc(row.id)}"${locked ? ' disabled' : ''}><option value="">Spoke / Update</option>${options(campaignUpdateOptions(row))}</select></label></div>
    </article>`;
  }
  function render() {
    if (!live()) return;
    const h = state.host;
    h.className = 'campaigns-root';
    if (!state.campaignId) {
      h.innerHTML = `<header class="cmp-titlebar"><div><h2>Campaigns</h2><p>Choose your clients. Make contact. Keep the next step on your calendar.</p></div><button type="button" class="btn primary" data-cmp-new>+ New Campaign</button></header><div class="cmp-list-filter"><label class="field"><span>Show campaigns</span><select data-cmp-list-status>${options([['active','Active'],['archived','Archived'],['all','All campaigns']],state.listStatus)}</select></label></div>${notice()}<div class="cmp-campaign-grid">${state.list.map(campaignCard).join('')}</div>${state.loading ? empty('Loading campaigns…') : !state.list.length ? empty('No campaigns here yet. Create a campaign, then choose clients to add.') : ''}${state.listCursor ? '<button type="button" class="btn secondary" data-cmp-more-campaigns>Load more campaigns</button>' : ''}`;
      h.querySelector('[data-cmp-new]').onclick = () => editCampaign();
      h.querySelector('[data-cmp-list-status]').onchange = event => { state.listStatus = event.target.value; void loadList(); };
      h.querySelectorAll('[data-cmp-open]').forEach(b => b.onclick = () => { state.campaignId = b.dataset.cmpOpen; state.filter = 'all'; state.query = ''; state.message = ''; void loadDetail(); });
      h.querySelector('[data-cmp-more-campaigns]')?.addEventListener('click', () => loadList(true));
      return;
    }
    const c = state.campaign;
    h.innerHTML = `<header class="cmp-titlebar"><div><button type="button" class="cmp-back" data-cmp-back>‹ All Campaigns</button><h2>${esc(c?.name || 'Campaign')}</h2><p>${esc(c?.agent_name || '')}${c?.created_at ? ` · Added ${esc(campaignTimestamp(c.created_at))}` : ''}</p></div><div class="cmp-heading-actions"><button type="button" class="btn secondary" data-cmp-edit${!c ? ' disabled' : ''}>Campaign Settings</button><button type="button" class="btn primary" data-cmp-add${!c || c.status !== 'active' ? ' disabled' : ''}>+ Add Clients</button></div></header>
      ${c?.status === 'archived' ? '<p class="cmp-notice">This campaign is archived. Its clients and history are retained. Reopen it in Campaign Settings to record updates.</p>' : ''}
      <div class="cmp-stats">${stat('Clients',c?.total_count)}${stat('Contacted',c?.contacted_count)}${stat('Appointments',c?.appointment_count)}${stat('Follow Ups',c?.follow_up_count)}${stat('Declined',c?.declined_count)}</div>
      <div class="cmp-stage"><span>1</span><div><strong>Contact</strong><small>Open the client record or use Spoke / Update. No extra workflow stages.</small></div></div>
      <form class="cmp-member-filters"><label class="field"><span>Find campaign client</span><input name="query" value="${esc(state.query)}" placeholder="Name, phone, county, or state"></label><label class="field"><span>Contact result</span><select name="status">${options([['all','All clients'],['not_contacted','Not Contacted'],...CONTACT_OUTCOMES],state.filter)}</select></label><label class="field"><span>Sort by</span><select name="sort">${options([['name','Client Name'],['state','State'],['county','County'],['added','Date Added'],['activity','Last Contact'],['due','Appointment / Follow Up']],state.sort)}</select></label><label class="field"><span>Order</span><select name="direction">${options([['asc','Ascending / Oldest'],['desc','Descending / Newest']],state.direction)}</select></label><button class="btn secondary" type="submit">Search</button></form>
      ${notice()}<div class="cmp-members" aria-busy="${state.loading}">${state.members.map(memberCard).join('')}${state.loading ? empty('Loading campaign clients…') : !state.members.length ? empty('No matching clients. Use Add Clients to choose clients for this campaign.') : ''}</div><div class="cmp-results-foot"><span>${state.members.length} displayed</span>${state.cursor ? `<button type="button" class="btn secondary" data-cmp-more${state.loading ? ' disabled' : ''}>Load more</button>` : ''}</div>`;
    h.querySelector('[data-cmp-back]').onclick = () => { state.campaignId = null; state.campaign = null; state.message = ''; void loadList(); };
    h.querySelector('[data-cmp-edit]').onclick = () => editCampaign(c);
    h.querySelector('[data-cmp-add]').onclick = () => pickClients(c);
    const filter = h.querySelector('.cmp-member-filters');
    filter.onsubmit = event => { event.preventDefault(); const v = new FormData(filter); state.query = String(v.get('query') || ''); state.filter = String(v.get('status')); state.sort = String(v.get('sort')); state.direction = String(v.get('direction')); void loadDetail(); };
    filter.querySelectorAll('select').forEach(el => el.onchange = () => filter.requestSubmit());
    h.querySelectorAll('[data-client-id]').forEach(b => b.onclick = () => openClient(b.dataset.clientId));
    h.querySelectorAll('[data-cmp-update]').forEach(el => el.onchange = () => { const row = state.members.find(r => r.id === el.dataset.cmpUpdate); const outcome = el.value; el.value = ''; if (row && outcome) contactDialog(row, outcome); });
    h.querySelector('[data-cmp-more]')?.addEventListener('click', () => loadDetail(true));
  }
  async function loadList(more = false) {
    if (more && state.loading) return;
    const token = ++state.token; state.loading = true; state.error = '';
    if (!more) { state.list = []; state.listCursor = null; }
    render();
    try { const result = await api.list({ status: state.listStatus, cursor: more ? state.listCursor : null }); if (token !== state.token) return; state.list = more ? [...state.list,...result.rows] : result.rows; state.listCursor = result.nextCursor; }
    catch(error) { if(token === state.token) state.error = problem(error); }
    finally { if(token === state.token) { state.loading = false; render(); } }
  }
  async function loadDetail(more = false) {
    if (!state.campaignId || (more && state.loading)) return;
    const id = state.campaignId, token = ++state.token; state.loading = true; state.error = '';
    if (state.campaign?.id !== id) state.campaign = null;
    if (!more) { state.members = []; state.cursor = null; }
    render();
    try {
      const [c,result] = await Promise.all([api.get(id),api.members(id,{ status:state.filter,query:state.query,sort:state.sort,direction:state.direction,cursor:more ? state.cursor : null })]);
      if (token !== state.token || id !== state.campaignId) return;
      state.campaign = c; state.members = [...new Map((more ? [...state.members,...result.rows] : result.rows).map(r=>[r.id,r])).values()]; state.cursor = result.nextCursor;
    } catch(error) { if(token === state.token) state.error = problem(error); }
    finally { if(token === state.token) { state.loading = false; render(); } }
  }
  function editCampaign(existing = null) {
    const id = existing?.id || crypto.randomUUID();
    const allowedAgents = admin() ? agents() : agents().filter(a=>a.id===userId());
    const d = dialogs.open({ title: existing ? 'Campaign Settings' : 'New Campaign', kind:'campaign-dialog', body:`<form class="cmp-form" novalidate>${field('name','Campaign Name',existing?.name || '', 'required maxlength="120" placeholder="Example: Annual Medicare Reviews"')}<div class="cmp-form-grid"><label class="field"><span>Topic</span><select name="topic">${options(CAMPAIGN_TOPICS,existing?.topic || 'general')}</select></label><label class="field"><span>Assigned Agent</span><select name="assigned_agent_id"${existing ? ' disabled' : ''}>${options(allowedAgents.map(a=>[a.id,a.full_name]),existing?.assigned_agent_id || userId())}</select></label></div><label class="field"><span>Campaign Notes</span><textarea name="description" maxlength="4000" rows="3">${esc(existing?.description || '')}</textarea></label>${existing ? `<label class="field"><span>Status</span><select name="status">${options([['active','Active'],['archived','Archived']],existing.status)}</select></label><p class="cmp-help">Archiving keeps client records, appointments, and contact history. It does not cancel existing calendar entries.</p>` : '<p class="cmp-help">Every campaign has one Contact stage. Add clients after creating the campaign.</p>'}</form>`, footer:footer(existing ? 'Save Campaign' : 'Create Campaign'), onSave:async form=>{
      const v=Object.fromEntries(new FormData(form));
      await api.save({ ...v,id },userId());
      if(existing && v.status !== existing.status) await api.setStatus(id,v.status);
      state.campaignId=id; state.message=existing?'Campaign saved.':'Campaign created. Choose Add Clients to build your list.';
      void loadDetail();
    }});
    d.attachForm(d.node.querySelector('form'));
  }
  function pickClients(campaign) {
    const picked = new Map(), already = new Set(); let rows=[],cursor=null,queryToken=0,busy=false,applied=null;
    const d = dialogs.open({title:`Add Clients — ${campaign.name}`,hint:'Selections stay checked across searches and pages. Existing members are not added twice.',kind:'campaign-dialog campaign-picker',body:`<form class="cmp-picker-search"><div class="cmp-form-grid">${field('query','Name, Phone, County, or State','','placeholder="Search clients…"')}<label class="field"><span>Product</span><select name="product">${options([['','All Products'],['medicare','Medicare'],['life','Life'],['retirement','Retirement']])}</select></label><label class="field"><span>Sort by</span><select name="sortBy">${options([['name','Client Name'],['state','State'],['county','County'],['created_at','Date Added']])}</select></label><label class="field"><span>Order</span><select name="sortDirection">${options([['asc','Ascending / Oldest'],['desc','Descending / Newest']])}</select></label></div><button type="submit" class="btn secondary">Search Clients</button></form><div class="cmp-picker-tools"><label><input type="checkbox" data-cmp-pick-page> Select displayed clients</label><span data-cmp-picked-count>0 selected</span></div><div data-cmp-picker-results>${empty('Search to choose clients. No clients are added automatically.')}</div><p class="cmp-help" data-cmp-picker-status role="status"></p><form class="cmp-picker-save"><input type="hidden" name="selected_clients" value=""></form>`,footer:footer('Add Selected Clients'),onSave:async()=>{
      if(!picked.size) throw new Error('Select at least one client.');
      const count=await api.addClients(campaign.id,[...picked.keys()],userId());
      state.message=`${count} client${count===1?'':'s'} added. Already-added clients are kept only once.`;
      void loadDetail();
    }});
    const search=d.node.querySelector('.cmp-picker-search'),host=d.node.querySelector('[data-cmp-picker-results]'),status=d.node.querySelector('[data-cmp-picker-status]');
    const marker=d.node.querySelector('[name="selected_clients"]');
    function sync(){ marker.value=[...picked.keys()].sort().join(',');marker.dispatchEvent(new Event('input',{bubbles:true}));d.node.querySelector('[data-cmp-picked-count]').textContent=`${picked.size} selected`;const eligible=rows.filter(r=>r.status!=='deceased'&&!already.has(r.id));const checked=eligible.filter(r=>picked.has(r.id)).length;const page=d.node.querySelector('[data-cmp-pick-page]');page.checked=eligible.length>0&&checked===eligible.length;page.indeterminate=checked>0&&checked<eligible.length; }
    function draw(){host.innerHTML=rows.map(r=>{const exists=already.has(r.id),disabled=exists||r.status==='deceased';return `<label class="cmp-pick-row"><input type="checkbox" data-cmp-pick="${esc(r.id)}"${picked.has(r.id)||exists?' checked':''}${disabled?' disabled':''}><span><strong>${esc(fullName(r))}</strong><span>${esc(phone(r.phone))} · ${esc(locationText(r))}</span>${disabled?`<small>${exists?'Already in this campaign':'Deceased — not available for contact campaigns'}</small>`:''}</span></label>`;}).join('')||empty('No matching clients.');if(cursor)host.insertAdjacentHTML('beforeend',`<button type="button" class="btn secondary" data-cmp-picker-more${busy?' disabled':''}>Load more</button>`);host.querySelectorAll('[data-cmp-pick]').forEach(el=>el.onchange=()=>{const r=rows.find(x=>x.id===el.dataset.cmpPick);if(el.checked&&picked.size>=500){el.checked=false;status.textContent='Add this batch before selecting more than 500 clients.';return;}if(el.checked)picked.set(r.id,r);else picked.delete(r.id);sync();});host.querySelector('[data-cmp-picker-more]')?.addEventListener('click',()=>find(true));sync();}
    async function find(more=false){if(more&&busy)return;const token=++queryToken;busy=true;status.textContent='Searching clients…';if(!more){applied=Object.fromEntries(new FormData(search));rows=[];cursor=null;}
      try {const result=await repository.searchClients({...applied,limit:50,cursor:more?cursor:null});const existing=await api.existingClients(campaign.id,result.rows.map(r=>r.id));if(token!==queryToken||!d.node.isConnected)return;existing.forEach(r=>already.add(r.client_id));rows=[...new Map((more?[...rows,...result.rows]:result.rows).map(r=>[r.id,r])).values()];cursor=result.nextCursor;status.textContent=`${rows.length} displayed. ${picked.size} selected across searches.`;}
      catch(error){if(token===queryToken&&d.node.isConnected)status.textContent=problem(error);}
      finally{if(token===queryToken){busy=false;if(d.node.isConnected)draw();}}
    }
    search.onsubmit=e=>{e.preventDefault();void find();};search.querySelectorAll('select').forEach(el=>el.onchange=()=>{if(applied)void find();});
    d.node.querySelector('[data-cmp-pick-page]').onchange=e=>{for(const r of rows){if(r.status==='deceased'||already.has(r.id))continue;if(e.target.checked&&picked.size<500)picked.set(r.id,r);else if(!e.target.checked)picked.delete(r.id);}draw();};
    d.attachForm(d.node.querySelector('.cmp-picker-save'));
  }
  function contactDialog(row, initialOutcome) {
    if (initialOutcome === RETURN_TO_STEP_ONE) {
      return openReturnToStepOne({ row, dialogs, api, onSaved: () => {
        state.filter = 'all';
        state.message = `${fullName(row)} returned to Step 1 / Total Clients. History and calendar items were kept.`;
        document.dispatchEvent(new CustomEvent('cmp:returned-to-step-one'));
        void loadDetail();
      } });
    }
    const campaign=state.campaign, operationId=crypto.randomUUID(); let blocks=[],availabilityToken=0,checking=false,available=false,timer=null,historyLoaded=false;
    const availableAgents=admin()?agents():agents().filter(a=>a.id===userId()||a.id===campaign.assigned_agent_id);
    const d=dialogs.open({title:'Spoke / Update',hint:fullName(row),kind:'campaign-dialog campaign-contact-dialog',body:`<form class="cmp-form" novalidate><label class="field"><span>Contact Result</span><select name="outcome">${options(CONTACT_OUTCOMES,initialOutcome)}</select></label><div class="cmp-selected-client"><strong>${esc(fullName(row))}</strong><span>${esc(phone(row.phone))} · ${esc(locationText(row))}</span><small>Existing client · ${esc(campaign.name)}</small></div><fieldset class="cmp-schedule" data-cmp-schedule><legend data-cmp-schedule-title>Set Appointment</legend><label class="field cmp-agent"><span>Agent Calendar</span><select name="agent_id">${options(availableAgents.map(a=>[a.id,a.full_name]),campaign.assigned_agent_id)}</select></label><div class="cmp-form-grid">${field('event_date','Date',dateText(campaignToday()),'data-date inputmode="numeric" maxlength="10" placeholder="MM/DD/YYYY" required')}<label class="field"><span>Time</span><select name="start_time" required><option value="">Choose a date first</option></select></label><label class="field"><span>Duration</span><select name="duration">${options([[15,'15 minutes'],[30,'30 minutes'],[45,'45 minutes'],[60,'1 hour'],[90,'1½ hours'],[120,'2 hours']],30)}</select></label>${field('next_action','Next Action / More Information Needed','','maxlength="500" placeholder="What needs to be discussed or collected?"')}</div>${row.next_event_id&&row.next_event_status==='scheduled'?`<label class="cmp-replace"><input type="checkbox" name="replace_event"> Replace the previous scheduled item (${esc(dateText(row.next_event_date))} ${esc(timeLabel(String(row.next_event_time||'').slice(0,5)))})</label>`:''}<div class="cmp-availability" data-cmp-availability role="status">Checking calendar…</div><button type="button" class="cmp-back" data-cmp-retry>Recheck availability</button><p class="cmp-help">Times are Central Time. Available start times: 8:00 AM–8:00 PM. Booked times are disabled.</p></fieldset><label class="field"><span>Notes</span><textarea name="note" rows="4" maxlength="4000" placeholder="Conversation notes, purpose of appointment, or what to follow up on"></textarea></label><p class="cmp-help" data-cmp-save-help></p></form><details class="cmp-history"><summary>Previous Contact Updates</summary><div data-cmp-history>${empty('Open to view the latest 30 updates.')}</div></details>`,footer:footer(isScheduledOutcome(initialOutcome)?'Save & Add to Calendar':'Save Contact Update'),onSave:async form=>{
      const v=Object.fromEntries(new FormData(form)), scheduled=isScheduledOutcome(v.outcome);
      if(scheduled){if(checking||!available)throw new Error('Check calendar availability before saving.');if(!dateISO(v.event_date)||!v.start_time)throw new Error('Choose a valid date and available time.');if(slotIsBooked(v.start_time,Number(v.duration),blocks,v.replace_event?row.next_event_id:''))throw new Error('That time is booked. Choose another time.');}
      const result=await api.recordContact({p_member_id:row.id,p_operation_id:operationId,p_expected_version:row.version,p_outcome:v.outcome,p_note:v.note||'',p_next_action:scheduled?v.next_action||'':'',p_event_date:scheduled?dateISO(v.event_date):null,p_start_time:scheduled?v.start_time:null,p_duration_minutes:scheduled?Number(v.duration):30,p_agent_id:scheduled?v.agent_id:null,p_replace_event:scheduled&&v.replace_event==='on'});
      if(!result?.saved)throw new Error('The contact update was not confirmed. Your notes remain open.');
      state.message=scheduled?'Contact result and calendar entry saved.':'Contact result saved.';
      if(result.event_id)onCalendarChange();
      void loadDetail();
    }});
    const form=d.node.querySelector('form'), schedule=form.querySelector('[data-cmp-schedule]'),date=form.elements.event_date,time=form.elements.start_time,duration=form.elements.duration,agent=form.elements.agent_id,replace=form.elements.replace_event;
    const availability=form.querySelector('[data-cmp-availability]');
    function drawTimes(){const old=time.value,excluded=replace?.checked?row.next_event_id:'';time.innerHTML='<option value="">Select an available time</option>'+appointmentSlots().map(t=>{const booked=slotIsBooked(t,Number(duration.value),blocks,excluded);return `<option value="${t}"${booked?' disabled':''}>${timeLabel(t)}${booked?' — BOOKED':''}</option>`;}).join('');if(old&&!slotIsBooked(old,Number(duration.value),blocks,excluded))time.value=old;time.disabled=checking||!available;}
    async function checkAvailability(){clearTimeout(timer);const token=++availabilityToken;available=false;checking=false;time.disabled=true;const day=dateISO(date.value);if(!isScheduledOutcome(form.elements.outcome.value))return;if(!day||!agent.value){availability.textContent='Enter a valid date and choose an agent.';return;}if(day<campaignToday()){availability.textContent='Choose today or a future date.';return;}checking=true;availability.textContent='Checking the agent calendar…';
      try{const rows=await api.availability(agent.value,day);if(token!==availabilityToken||!d.node.isConnected)return;blocks=rows;available=true;availability.textContent=rows.length?`${rows.length} calendar item${rows.length===1?'':'s'} scheduled. Unavailable times are marked BOOKED.`:'No times are booked on this date.';}
      catch(error){if(token===availabilityToken&&d.node.isConnected)availability.textContent=`Availability could not load: ${problem(error)}`;}
      finally{if(token===availabilityToken){checking=false;if(d.node.isConnected)drawTimes();}}
    }
    function switchOutcome(){const scheduled=isScheduledOutcome(form.elements.outcome.value);schedule.hidden=!scheduled;schedule.disabled=!scheduled;form.querySelector('[data-cmp-schedule-title]').textContent=form.elements.outcome.value==='follow_up'?'Set Follow Up / More Info Needed':'Set Appointment';d.node.querySelector('[data-save]').textContent=scheduled?'Save & Add to Calendar':'Save Contact Update';form.querySelector('[data-cmp-save-help]').textContent=scheduled?'Saves the contact result and calendar entry together. Cancelling this window saves neither.':'Records this contact attempt. Existing appointments and follow-ups are not cancelled.';if(scheduled)void checkAvailability();else{availabilityToken++;clearTimeout(timer);checking=false;available=false;}}
    form.elements.outcome.onchange=switchOutcome;
    date.addEventListener('input',()=>{availabilityToken++;available=false;time.disabled=true;clearTimeout(timer);timer=setTimeout(checkAvailability,250);});date.addEventListener('change',checkAvailability);agent.onchange=checkAvailability;duration.onchange=drawTimes;if(replace)replace.onchange=drawTimes;form.querySelector('[data-cmp-retry]').onclick=checkAvailability;
    const history=d.node.querySelector('.cmp-history');history.addEventListener('toggle',async()=>{if(!history.open||historyLoaded)return;historyLoaded=true;const host=history.querySelector('[data-cmp-history]');host.innerHTML=empty('Loading contact history…');try{const rows=await api.history(row.id);if(host.isConnected)host.innerHTML=rows.map(entry=>`<article><strong>${esc(outcomeLabel(entry.outcome))}</strong><small>${esc(campaignTimestamp(entry.created_at))}</small><p>${esc(entry.note||'No note entered')}</p>${entry.next_action?`<p>${esc(entry.next_action)}</p>`:''}</article>`).join('')||empty('No previous contact updates.');}catch(error){historyLoaded=false;if(host.isConnected)host.textContent=problem(error);}});
    switchOutcome();d.attachForm(form);
    d.node.addEventListener('close',()=>{availabilityToken++;clearTimeout(timer);},{once:true});
  }
  function chooseCampaignForSelection() {
    if(!selection.size)return;
    const clients=[...selection.values()];const newId=crypto.randomUUID();let campaigns=[],cursor=null,busy=false;
    const d=dialogs.open({title:'Add Selected Clients to a Campaign',hint:`${clients.length} selected client${clients.length===1?'':'s'}`,kind:'campaign-dialog',body:`<form class="cmp-form" novalidate><label class="field"><span>Campaign</span><select name="campaign_id" required><option value="">Loading campaigns…</option></select></label><button type="button" class="cmp-back" data-cmp-chooser-more hidden>Load more campaigns</button><div data-cmp-new-name hidden>${field('new_name','New Campaign Name','','maxlength="120"')}</div><details class="cmp-history"><summary>Review selected clients</summary><div>${clients.map(c=>`<p>${esc(fullName(c))} · ${esc(locationText(c))}</p>`).join('')}</div></details><p class="cmp-help" data-cmp-chooser-status role="status"></p></form>`,footer:footer('Add to Campaign'),onSave:async form=>{const v=Object.fromEntries(new FormData(form));let id=v.campaign_id;if(id==='__new__'){const c=await api.save({id:newId,name:v.new_name,topic:'general',assigned_agent_id:userId()},userId());id=c.id;}if(!id)throw new Error('Choose a campaign.');const count=await api.addClients(id,clients.map(c=>c.id),userId());selection.clear();state.campaignId=id;state.message=`${count} clients added to the campaign.`;if(searchHost?.isConnected)enhanceSearch(searchHost,searchRows);}});
    const form=d.node.querySelector('form'),select=form.elements.campaign_id,name=form.querySelector('[data-cmp-new-name]'),more=form.querySelector('[data-cmp-chooser-more]'),status=form.querySelector('[data-cmp-chooser-status]');
    select.onchange=()=>{name.hidden=select.value!=='__new__';form.elements.new_name.required=!name.hidden;};
    async function load(){if(busy)return;busy=true;status.textContent='Loading active campaigns…';try{const result=await api.list({status:'active',cursor});if(!d.node.isConnected)return;campaigns.push(...result.rows);cursor=result.nextCursor;const value=select.value;select.innerHTML=options([['','Choose a campaign'],['__new__','+ Create a new campaign'],...campaigns.map(c=>[c.id,c.name])],value);more.hidden=!cursor;status.textContent='Existing campaign members will not be duplicated.';}catch(error){status.textContent=problem(error);select.innerHTML=options([['','Choose a campaign'],['__new__','+ Create a new campaign']]);}finally{busy=false;}}
    more.onclick=load;d.attachForm(form);void load();
  }
  function enhanceSearch(host, rows=[]) {
    if(!host?.isConnected)return;searchHost=host;searchRows=rows;
    host.querySelector('[data-cmp-selectionbar]')?.remove();
    for(const wrapper of host.querySelectorAll('.cmp-search-select-row')){const button=wrapper.querySelector('[data-client-id]');if(button)wrapper.replaceWith(button);}
    if(!rows.length&&!selection.size)return;
    const bar=document.createElement('div');bar.className='cmp-selectionbar';bar.dataset.cmpSelectionbar='true';
    bar.innerHTML=selectionMode?`<span>${selection.size} selected across searches</span><button type="button" class="btn primary" data-cmp-assign${!selection.size?' disabled':''}>Add to Campaign</button><button type="button" class="btn secondary" data-cmp-clear-selection>Clear Selection</button><button type="button" class="cmp-back" data-cmp-exit-selection>Done Selecting</button>`:'<button type="button" class="btn secondary" data-cmp-start-selection>Select Clients for Campaign</button>';
    host.prepend(bar);
    bar.querySelector('[data-cmp-start-selection]')?.addEventListener('click',()=>{selectionMode=true;enhanceSearch(host,rows);});bar.querySelector('[data-cmp-assign]')?.addEventListener('click',chooseCampaignForSelection);bar.querySelector('[data-cmp-clear-selection]')?.addEventListener('click',()=>{selection.clear();enhanceSearch(host,rows);});bar.querySelector('[data-cmp-exit-selection]')?.addEventListener('click',()=>{selectionMode=false;selection.clear();enhanceSearch(host,rows);});
    if(!selectionMode)return;
    host.querySelectorAll('button.client-result[data-client-id]').forEach(button=>{const row=rows.find(r=>r.id===button.dataset.clientId);if(!row)return;const wrapper=document.createElement('div');wrapper.className='cmp-search-select-row';const label=document.createElement('label');label.className='cmp-search-checkbox';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selection.has(row.id);checkbox.disabled=row.status==='deceased';checkbox.setAttribute('aria-label',`Select ${fullName(row)} for a campaign`);label.append(checkbox);button.before(wrapper);wrapper.append(label,button);checkbox.onchange=()=>{if(checkbox.checked&&selection.size>=500){checkbox.checked=false;return;}if(checkbox.checked)selection.set(row.id,row);else selection.delete(row.id);bar.querySelector('span').textContent=`${selection.size} selected across searches`;bar.querySelector('[data-cmp-assign]').disabled=!selection.size;};});
  }
  return {
    mount(host) { state.host=host;if(state.campaignId)void loadDetail();else void loadList(); },
    unmount() { state.token++;state.loading=false;state.host=null; },
    enhanceSearch,
    refreshClient(client) { state.members=state.members.map(row=>row.client_id===client.id?{...row,first_name:client.first_name,last_name:client.last_name,phone:client.phone,county:client.county,state:client.state,products:client.products,client_status:client.status}:row);if(selection.has(client.id)){if(client.status==='deceased')selection.delete(client.id);else selection.set(client.id,client);}if(live())render(); },
    destroy() {state.token++;state.host=null;selection.clear();searchHost=null;}
  };
}
