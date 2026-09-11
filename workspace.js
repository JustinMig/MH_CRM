import { NAV, CLIENT_TABS, esc, disconnectedRepository, todayKey, parseISO, dateText, isoDate, monthDays, longDate, timeLabel, hydrate, serializable } from './core.js';
import { clientSearchMarkup, clientResultsMarkup, clientResultContent, clientSortDirectionOptions, clientSortDescription } from './client-search.js';
import { Dialogs } from './dialogs.js';
import { shell, TOOLS, icon, empty, note, pending, saveFooter, options, input, dateInput, select, textArea, clientForm, calendarMarkup } from './views.js';

/** Repository injection is for the future isolated backend and local tests, never a legacy connection. */
export function createWorkspace(root, repository = disconnectedRepository) {
  if (!(root instanceof HTMLElement)) throw new TypeError('M&H CRM needs an application root.');
  const dialogs = new Dialogs();
  let campaignFeature = null, campaignModule = null;
  async function campaigns() {
    if (!repository.campaigns) throw new Error('Campaign storage is not connected.');
    if (!campaignModule) campaignModule = import('./campaigns-ui.js').then(({ createCampaignFeature }) => {
      campaignFeature = createCampaignFeature({ repository, dialogs, openClient, onCalendarChange: drawCalendar });
      return campaignFeature;
    }).catch(error => { campaignModule = null; throw error; });
    return campaignModule;
  }
  const now = new Date();
  const state = {
    route: 'dashboard', month: new Date(now.getFullYear(), now.getMonth(), 1, 12), events: [], calendarToken: 0,
    search: { query: '', product: '', agent: '', birthYear: '', sortBy: 'name', sortDirection: 'asc', applied: null, loading: false, rows: null, error: '', message: '', token: 0, cursor: null, nextCursor: null },
    destroyed: false
  };
  const connected = repository.connected === true;
  const agents = Array.isArray(repository.agents) ? repository.agents : [];
  const money = v => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '—';
  const info = connected ? '' : note(pending);

  function pageBody(route) {
    if (route === 'dashboard') return `<div id="calendar-host"></div><div class="metric-grid">${['Clients', 'Appointments', 'Notifications', 'Documents'].map(label => `<div class="metric-card"><span>${label}</span><strong>—</strong><small>${connected ? 'Summary not loaded' : 'Not connected'}</small></div>`).join('')}</div><section class="panel-card dark-card"><h2>Quick Actions</h2><div class="quick-actions"><button type="button" class="btn secondary" data-add-client>Client Information</button><a class="btn secondary" href="#/clients">Search Clients</a><button type="button" class="btn secondary" data-new-appointment>Set Appointment</button><a class="btn secondary" href="#/communications">Communications</a></div></section>`;
    if (route === 'campaigns') return '<div id="campaigns-host"><p class="subtle">Loading campaigns…</p></div>';
    if (route === 'clients') return clientSearchMarkup(state.search, agents);
    if (route === 'appointments') return '<div id="calendar-host"></div>';
    if (route === 'communications') return `<div class="panel-card dark-card"><h2>Communications</h2><div class="integration-grid">${['RingCentral Voice', 'Client Text Messages', 'Call Recordings'].map(x => `<div><h3>${x}</h3><span class="tag">Not connected</span></div>`).join('')}</div>${empty('No conversation selected', 'Calls, texts, and recordings are not connected to this framework.')}</div>`;
    if (route === 'notifications') return `<section class="panel-card dark-card">${empty('No notifications loaded', 'Form submissions and activity notifications require the new backend.')}</section>`;
    if (route === 'agents') return `<section class="panel-card dark-card"><h2>Roles &amp; Permissions</h2><p class="muted">Planned roles; no user accounts are created by this framework.</p><div class="integration-grid">${['Owner', 'Admin', 'Agent', 'Assistant'].map(role => `<div><h3>${role}</h3><span class="tag">Not configured</span></div>`).join('')}</div></section>`;
    return `<section class="panel-card dark-card"><h2>Standalone Environment</h2><dl class="settings-list"><dt>Site</dt><dd>MH.mayerig.com</dd><dt>Repository</dt><dd>JustinMig/MH_CRM</dd><dt>Hosting project</dt><dd>mh-crm</dd><dt>Database / authentication</dt><dd>${connected ? 'Repository connected; review server permissions separately' : 'Not connected'}</dd><dt>Document storage</dt><dd>Not connected</dd><dt>App Store</dt><dd>Native packaging, signing, and submission not configured</dd></dl><p class="muted">No database, document storage, client data, or credentials from Mayer CRM are used here.</p></section>`;
  }
  function render(route) {
    campaignFeature?.unmount();
    state.route = route;
    root.innerHTML = shell(route, connected, pageBody(route));
    root.querySelectorAll('[data-tool]').forEach(button => button.onclick = () => openTool(button.dataset.tool));
    root.querySelectorAll('[data-add-client]').forEach(button => button.onclick = () => openClient());
    root.querySelectorAll('[data-new-appointment]').forEach(button => button.onclick = () => openAppointment());
    const menu = root.querySelector('.menu-toggle'), sidebar = root.querySelector('.sidebar'), shade = root.querySelector('.sidebar-shade');
    const closeMenu = () => { sidebar.classList.remove('open'); shade.hidden = true; menu.setAttribute('aria-expanded', 'false'); };
    menu.onclick = () => { const open = !sidebar.classList.contains('open'); sidebar.classList.toggle('open', open); shade.hidden = !open; menu.setAttribute('aria-expanded', String(open)); };
    shade.onclick = closeMenu;
    root.querySelector('.nav').onclick = closeMenu;
    if (route === 'clients') bindSearch();
    if (route === 'campaigns') {
      const host = root.querySelector('#campaigns-host');
      campaigns().then(feature => { if (host.isConnected && !state.destroyed) feature.mount(host); }).catch(error => { if (host.isConnected) host.innerHTML = empty('Campaigns unavailable', error.message); });
    }
    if (root.querySelector('#calendar-host')) drawCalendar();
  }

  function bindSearch() {
    const form = root.querySelector('#client-search');
    for (const key of ['query', 'product', 'agent', 'birthYear']) {
      form.elements.namedItem(key).addEventListener('input', e => state.search[key] = e.target.value);
      form.elements.namedItem(key).addEventListener('change', e => state.search[key] = e.target.value);
    }
    const sortBy = form.elements.namedItem('sortBy');
    const direction = form.elements.namedItem('sortDirection');
    sortBy.onchange = () => {
      state.search.sortBy = sortBy.value;
      state.search.sortDirection = sortBy.value === 'created_at' ? 'desc' : 'asc';
      direction.innerHTML = clientSortDirectionOptions(state.search.sortBy, state.search.sortDirection);
      // Changing order alone must not populate the untouched Clients screen.
      if (state.search.applied) form.requestSubmit();
    };
    direction.onchange = () => {
      state.search.sortDirection = direction.value;
      if (state.search.applied) form.requestSubmit();
    };
    form.onsubmit = e => { e.preventDefault(); searchClients(false); };
    form.querySelector('[data-turn65]').onclick = () => {
      state.search.birthYear = String(new Date().getFullYear() - 65);
      form.elements.birthYear.value = state.search.birthYear;
      searchClients(false);
    };
    form.querySelector('[data-reset-search]').onclick = () => {
      state.search.token++;
      Object.assign(state.search, { query: '', product: '', agent: '', birthYear: '', sortBy: 'name', sortDirection: 'asc', applied: null, loading: false, rows: null, error: '', message: '', cursor: null, nextCursor: null });
      for (const key of ['query', 'product', 'agent', 'birthYear']) form.elements.namedItem(key).value = '';
      sortBy.value = 'name';
      direction.innerHTML = clientSortDirectionOptions('name', 'asc');
      drawResults();
      form.elements.query.focus();
    };
    drawResults();
  }
  async function searchClients(more = false) {
    const s = state.search;
    if (more && (s.loading || !s.nextCursor || !s.applied)) return;
    const criteria = more ? { ...s.applied } : { query: s.query.trim(), product: s.product, agent: s.agent, birthYear: s.birthYear, sortBy: s.sortBy, sortDirection: s.sortDirection };
    const token = ++s.token;
    const cursor = more ? s.nextCursor : null;
    if (!more) { s.rows = null; s.nextCursor = null; }
    s.error = ''; s.message = ''; s.loading = false;
    if (!(criteria.query || criteria.product || criteria.agent || criteria.birthYear)) { s.applied = null; s.message = 'Enter a search or select a filter. No full client list is loaded automatically.'; drawResults(); return; }
    if (criteria.birthYear && !/^\d{4}$/.test(criteria.birthYear)) { s.error = 'Enter a four-digit birth year.'; drawResults(); return; }
    if (!more) s.applied = criteria;
    s.loading = true; s.message = 'Searching…'; drawResults();
    try {
      const result = await repository.searchClients({ ...criteria, limit: 50, cursor });
      if (token !== s.token || state.destroyed) return;
      if (!result || !Array.isArray(result.rows)) throw new Error('Client search returned an invalid response.');
      const rows = more ? [...(s.rows || []), ...result.rows] : result.rows;
      s.rows = [...new Map(rows.map(row => [row.id, row])).values()];
      s.nextCursor = result.nextCursor || null;
      s.message = (s.rows.length ? `${s.rows.length} result${s.rows.length === 1 ? '' : 's'} displayed` : 'No matching clients found.') + ` • ${clientSortDescription(criteria.sortBy, criteria.sortDirection)}`;
    } catch (e) {
      if (token !== s.token || state.destroyed) return;
      s.error = connected ? e.message || 'Search failed. Please retry.' : 'Search is not connected to the new database yet. No clients were loaded from the original CRM.';
      s.message = '';
    } finally {
      if (token === s.token && !state.destroyed) {
        s.loading = false;
        if (state.route === 'clients') drawResults();
      }
    }
  }
  function drawResults() {
    const host = root.querySelector('#client-results');
    if (!host) return;
    host.setAttribute('aria-busy', String(state.search.loading));
    host.innerHTML = clientResultsMarkup(state.search);
    host.querySelectorAll('[data-client-id]').forEach(button => button.onclick = () => openClient(button.dataset.clientId));
    host.querySelector('[data-more]')?.addEventListener('click', () => searchClients(true));
    if (repository.campaigns) {
      const token = state.search.token;
      campaigns().then(feature => { if (host.isConnected && token === state.search.token && !state.destroyed) feature.enhanceSearch(host, state.search.rows || []); }).catch(() => {});
    }
  }
  function patchClient(saved) {
    campaignFeature?.refreshClient(saved);
    if (!state.search.rows) return;
    state.search.rows = state.search.rows.map(row => row.id === saved.id ? { ...row, ...saved } : row);
    const record = state.search.rows.find(row => row.id === saved.id);
    const row = root.querySelector(`#client-results [data-client-id="${CSS.escape(saved.id)}"]`);
    if (row && record) row.innerHTML = clientResultContent(record);
  }
  function wireTabs(node) {
    const buttons = Array.from(node.querySelectorAll('[data-tab]'));
    function choose(button) {
      buttons.forEach(b => { b.setAttribute('aria-selected', String(b === button)); b.tabIndex = b === button ? 0 : -1; });
      node.querySelectorAll('[data-panel]').forEach(panel => panel.hidden = panel.dataset.panel !== button.dataset.tab);
    }
    buttons.forEach((button, i) => {
      button.onclick = () => choose(button);
      button.onkeydown = e => {
        const index = e.key === 'ArrowRight' ? (i + 1) % buttons.length : e.key === 'ArrowLeft' ? (i + buttons.length - 1) % buttons.length : e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : -1;
        if (index < 0) return;
        e.preventDefault(); choose(buttons[index]); buttons[index].focus();
      };
    });
  }
  function openClient(id = null) {
    let record = {};
    const d = dialogs.open({ title: 'Client Information', hint: id ? 'Edit this client without leaving your search results' : 'New client • all sections in one window', icon: icon('client', true), kind: 'client-dialog', body: '<p class="subtle">Loading client information…</p>', footer: saveFooter('Save Client'), onSave: async form => {
      const saved = await repository.saveClient({ ...record, ...serializable(form) }, { expectedVersion: record.updated_at || null });
      if (!saved?.id) throw new Error('The save was not confirmed by the database. Your changes remain open.');
      record = saved;
      patchClient(saved);
    } });
    const mount = loaded => {
      if (!d.node.isConnected) return;
      record = loaded;
      d.node.querySelector('.modal-body').innerHTML = `${info}${clientForm(connected, agents)}`;
      const form = d.node.querySelector('form');
      hydrate(form, record);
      wireTabs(d.node);
      d.attachForm(form);
    };
    if (!id) mount({});
    else repository.getClient(id).then(loaded => {
      if (!loaded?.id) throw new Error('The client could not be found.');
      mount(loaded);
    }).catch(e => {
      if (!d.node.isConnected) return;
      d.node.querySelector('.modal-body').innerHTML = empty('Client unavailable', e.message || 'Please close this window and retry.');
      d.node.querySelector('[data-save]').disabled = true;
    });
    return d;
  }

  function drawCalendar() {
    const host = root.querySelector('#calendar-host');
    if (!host) return;
    host.innerHTML = calendarMarkup(state.month, state.events, connected, agents);
    host.querySelectorAll('[data-month]').forEach(button => button.onclick = () => {
      state.month = button.dataset.month === 'today' ? new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12) : new Date(state.month.getFullYear(), state.month.getMonth() + Number(button.dataset.month), 1, 12);
      drawCalendar();
    });
    host.querySelectorAll('[data-day]').forEach(button => button.onclick = () => openDay('day', button.dataset.day));
    host.querySelectorAll('[data-queue]').forEach(button => button.onclick = () => openDay(button.dataset.queue, todayKey()));
    host.querySelector('[data-new-appointment]').onclick = () => openAppointment();
    if (connected) loadEvents(host);
  }
  async function loadEvents(host) {
    const token = ++state.calendarToken;
    const days = monthDays(state.month.getFullYear(), state.month.getMonth());
    try {
      const events = await repository.listEvents({ start: isoDate(days[0]), end: isoDate(days.at(-1)), includeToday: true, includeReschedule: true });
      if (token !== state.calendarToken || !host.isConnected) return;
      if (!Array.isArray(events)) throw new Error('Calendar returned an invalid response.');
      state.events = events;
      // Do not call drawCalendar here, which would initiate another read.
      host.innerHTML = calendarMarkup(state.month, events, connected, agents);
      host.querySelectorAll('[data-month]').forEach(b => b.onclick = () => {
        state.month = b.dataset.month === 'today' ? new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12) : new Date(state.month.getFullYear(), state.month.getMonth() + Number(b.dataset.month), 1, 12); drawCalendar();
      });
      host.querySelectorAll('[data-day]').forEach(b => b.onclick = () => openDay('day', b.dataset.day));
      host.querySelectorAll('[data-queue]').forEach(b => b.onclick = () => openDay(b.dataset.queue, todayKey()));
      host.querySelector('[data-new-appointment]').onclick = () => openAppointment();
    } catch (e) {
      if (token === state.calendarToken && host.isConnected) host.querySelector('.calendar-status').textContent = e.message || 'Calendar could not load. Try another month or Today to retry.';
    }
  }
  function openDay(mode, key) {
    const title = mode === 'today' ? 'Today’s Appointments' : mode === 'reschedule' ? 'Reschedule' : longDate(key);
    const entries = state.events.filter(event => mode === 'reschedule' ? event.status === 'needs_reschedule' : event.event_date === key && event.status !== 'needs_reschedule' && (mode !== 'today' || event.status !== 'completed'));
    const d = dialogs.open({ title, hint: mode === 'today' ? longDate(key) : 'Calendar appointments and activities', icon: icon('appointments', true), kind: 'day-dialog', body: `${info}<div class="day-add"><button type="button" class="btn primary" data-day-add>+ ADD APPOINTMENT / ACTIVITY</button></div>${entries.length ? entries.map(e => `<details class="event-card"><summary><strong>${esc(e.title)}</strong><span>${esc(timeLabel(e.start_time))}</span></summary><div><p>${esc(e.notes || 'No notes')}</p><span class="subtle">${esc(e.status || 'scheduled')}</span></div></details>`).join('') : empty(connected ? 'Nothing scheduled' : 'No appointments loaded', connected ? 'Use Add Appointment / Activity to schedule this day.' : 'Scheduling and reschedule queues require the standalone backend.')}` });
    d.node.querySelector('[data-day-add]').onclick = () => openAppointment(key);
  }
  function openAppointment(key = todayKey()) {
    const timeOptions = [['', 'Select appointment time'], ...Array.from({ length: 48 }, (_, i) => {
      const t = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`; return [t, timeLabel(t)];
    })];
    const body = `${info}<div class="intro"><strong>Set Appointment</strong><p>Schedule an existing client or a new/non-client on the calendar.</p></div><form class="appointment-form" autocomplete="off" novalidate><div class="form-grid">${select('assigned_agent_id', 'Agent', [['', connected ? 'Select agent' : 'No agents connected'], ...agents.map(a => [a.id, a.full_name])], !connected)}${select('event_type', 'Type', ['Appointment', 'Activity'])}</div><div class="mode-picker" role="group" aria-label="Appointment person type"><button type="button" class="active" data-mode="existing" aria-pressed="true">EXISTING CLIENT</button><button type="button" data-mode="new" aria-pressed="false">NEW / NON-CLIENT</button></div><input type="hidden" name="person_type" value="existing"><input type="hidden" name="client_id" value=""><div data-existing><label class="field"><span>Client</span><input data-person-search placeholder="Type client name or phone" autocomplete="off"></label><div data-person-results class="lookup-results" aria-live="polite"></div><p data-selected-person class="subtle">No client selected</p></div><div data-new-person hidden><div class="form-grid">${input('person_name', 'New / Non-client Name')}${input('person_phone', 'Phone Number', { type: 'tel' })}</div></div><div class="form-grid">${input('title', 'Appointment / Activity Title', { span: true })}${dateInput('event_date', 'Appointment Date', true)}${select('start_time', 'Appointment Time', timeOptions)}</div>${textArea('notes', 'Notes (optional)', 'Purpose of appointment or anything to remember')}<p class="subtle">${connected ? 'The server must check availability before confirming a save.' : 'Availability cannot be checked until scheduling is connected.'}</p></form>`;
    const d = dialogs.open({ title: 'Appointments', hint: 'Set an appointment', icon: icon('appointments', true), kind: 'appointment-dialog', body, footer: saveFooter('Add to Calendar'), onSave: async form => {
      const value = serializable(form);
      if (value.person_type === 'existing' && !value.client_id) throw new Error('Select an existing client, or switch to New / Non-client.');
      if (value.person_type === 'new' && !value.person_name.trim()) throw new Error('Enter a name for this appointment.');
      if (!value.start_time) throw new Error('Select an appointment time.');
      const saved = await repository.saveEvent(value);
      if (!saved?.id) throw new Error('The calendar did not confirm this appointment. Nothing is marked saved.');
      // Saving the same draft again must update, not create a duplicate.
      form.elements.namedItem('event_id')?.remove();
      const hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = 'event_id'; hidden.value = saved.id; form.append(hidden);
      drawCalendar();
    } });
    const form = d.node.querySelector('form');
    form.elements.event_date.value = dateText(key);
    let token = 0, timer;
    form.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      form.elements.person_type.value = b.dataset.mode;
      form.querySelectorAll('[data-mode]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      form.querySelector('[data-existing]').hidden = b.dataset.mode !== 'existing';
      form.querySelector('[data-new-person]').hidden = b.dataset.mode !== 'new';
      form.dispatchEvent(new Event('change'));
    });
    form.querySelector('[data-person-search]').oninput = e => {
      clearTimeout(timer); const query = e.target.value.trim(), request = ++token;
      form.elements.client_id.value = '';
      form.querySelector('[data-selected-person]').textContent = 'No client selected';
      form.dispatchEvent(new Event('change'));
      const host = form.querySelector('[data-person-results]'); host.innerHTML = '';
      if (!query) return;
      timer = setTimeout(async () => {
        if (!d.node.isConnected) return;
        try {
          const result = await repository.searchClients({ query, limit: 12 });
          if (!d.node.isConnected || request !== token) return;
          host.innerHTML = result.rows.length ? result.rows.map(c => `<button type="button" data-person-id="${esc(c.id)}">${esc([c.first_name, c.last_name].filter(Boolean).join(' '))}<small>${esc(c.phone || '')}</small></button>`).join('') : '<p>No matches</p>';
          host.querySelectorAll('[data-person-id]').forEach(b => b.onclick = () => {
            form.elements.client_id.value = b.dataset.personId;
            form.querySelector('[data-selected-person]').textContent = `Selected: ${b.textContent}`;
            host.innerHTML = ''; form.dispatchEvent(new Event('change'));
          });
        } catch {
          if (d.node.isConnected && request === token) host.textContent = connected ? 'Client lookup failed. Please retry.' : 'Client lookup is not connected yet.';
        }
      }, 200);
    };
    d.attachForm(form);
    return d;
  }

  function openNotes() {
    const d = dialogs.open({ title: 'Notes', hint: 'Dashboard notes', icon: icon('notes', true), kind: 'notes-dialog', body: `${info}<div class="panel-heading"><div><h3>Dashboard Notes</h3><p class="subtle">Named notes, kept separate from client notes.</p></div><button type="button" class="btn primary" data-new-note>+ New Note</button></div><div class="mode-picker note-filters" role="group" aria-label="Note owner"><button type="button" class="active" data-owner="all" aria-pressed="true">All Notes</button><button type="button" data-owner="mine" aria-pressed="false">My Notes</button></div><form class="note-editor" autocomplete="off" hidden novalidate>${input('title', 'Note Name', { required: true })}${textArea('body', 'Note', 'Write a note…')}</form><div data-note-list>${empty('No notes loaded', connected ? 'Loading notes…' : 'Note storage is not connected.')}</div>`, footer: saveFooter('Save Note'), onSave: async form => {
      if (form.hidden) throw new Error('Choose New Note first.');
      if (!form.elements.body.value.trim()) throw new Error('Enter a note before saving.');
      const saved = await repository.saveNote(serializable(form));
      if (!saved?.id) throw new Error('Note save was not confirmed. Your text is still open.');
      let idField = form.elements.namedItem('id');
      if (!idField) { idField = document.createElement('input'); idField.type = 'hidden'; idField.name = 'id'; form.append(idField); }
      idField.value = saved.id;
      await loadNotes();
    } });
    const form = d.node.querySelector('form');
    d.attachForm(form);
    d.node.querySelector('[data-save]').disabled = true;
    d.node.querySelector('[data-new-note]').onclick = async () => {
      if (d.isDirty()) { d.error('Save the open note before starting another, or close and discard it.'); return; }
      form.reset(); form.elements.namedItem('id')?.remove(); form.hidden = false;
      d.node.querySelector('[data-save]').disabled = false; d.baseline(); form.elements.title.focus();
    };
    let owner = 'all', noteToken = 0;
    d.node.querySelectorAll('[data-owner]').forEach(b => b.onclick = () => {
      owner = b.dataset.owner;
      d.node.querySelectorAll('[data-owner]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      loadNotes();
    });
    async function loadNotes() {
      if (!connected) return;
      const request = ++noteToken;
      const host = d.node.querySelector('[data-note-list]');
      try {
        const notes = await repository.listNotes({ owner });
        if (request !== noteToken || !d.node.isConnected) return;
        if (!Array.isArray(notes)) throw new Error('Invalid note response');
        host.innerHTML = notes.length ? notes.map(n => `<details class="event-card"><summary><small>${esc(n.created_at ? new Date(n.created_at).toLocaleDateString('en-US') : '')}</small><strong>${esc(n.title)}</strong></summary><div><p class="preserve-lines">${esc(n.body)}</p></div></details>`).join('') : empty('No notes saved');
      } catch { if (host.isConnected && request === noteToken) host.innerHTML = empty('Notes could not load', 'Close and reopen Notes to retry.'); }
    }
    loadNotes();
  }
  function openContacts() {
    const d = dialogs.open({ title: 'Contacts', hint: 'Company contact directory', icon: icon('contacts', true), kind: 'contacts-dialog', body: `${info}<div class="panel-card"><h3>Company Contact Directory</h3><p class="subtle">Search company name, phone, fax, or email.</p><label class="field"><span>Find company</span><input data-contact-query autocomplete="off" placeholder="Search company contacts…"></label><div class="lookup-results" data-contact-results aria-live="polite"></div><div data-contact-details>${empty('Search for a company', 'No directory records have been imported into this standalone CRM.')}</div></div>` });
    let timer, request = 0;
    d.node.querySelector('[data-contact-query]').oninput = e => {
      clearTimeout(timer); const token = ++request, query = e.target.value.trim();
      const host = d.node.querySelector('[data-contact-results]'), detail = d.node.querySelector('[data-contact-details]');
      host.innerHTML = ''; detail.innerHTML = '';
      if (!query) { detail.innerHTML = empty('Search for a company'); return; }
      timer = setTimeout(async () => {
        if (!d.node.isConnected) return;
        try {
          const matches = await repository.searchContacts({ query, limit: 12 });
          if (token !== request || !d.node.isConnected) return;
          host.innerHTML = matches.length ? matches.map((c, i) => `<button type="button" data-contact="${i}"><strong>${esc(c.company)}</strong><small>${esc(c.phones?.[0] || c.emails?.[0] || '')}</small></button>`).join('') : '<p>No matching company</p>';
          host.querySelectorAll('[data-contact]').forEach(b => b.onclick = () => {
            const contact = matches[Number(b.dataset.contact)];
            d.node.querySelector('[data-contact-query]').value = contact.company;
            host.innerHTML = '';
            detail.innerHTML = `<h3>${esc(contact.company)}</h3><div class="contact-grid">${[['phones', 'Phone'], ['faxes', 'Fax'], ['emails', 'Email']].map(([key, label]) => `<section><h4>${label}</h4>${(contact[key] || []).map(v => `<p>${esc(v)}</p>`).join('') || '<p>—</p>'}</section>`).join('')}</div>${(contact.notes || []).map(text => `<p class="preserve-lines">${esc(text)}</p>`).join('')}`;
          });
        } catch { if (token === request && d.node.isConnected) host.textContent = connected ? 'The directory could not load. Please retry.' : 'The company directory has not been connected or imported yet.'; }
      }, 200);
    };
  }
  function openBuild() {
    const companies = ['Mutual of Omaha', 'American Amicable', 'Physicians Mutual', 'Corebridge Financial — SimpliNow Legacy'];
    const heights = Array.from({ length: 37 }, (_, i) => [String(i + 48), `${Math.floor((i + 48) / 12)}′ ${(i + 48) % 12}″`]);
    const d = dialogs.open({ title: 'Height & Weight', hint: 'Height & weight underwriting lookup', icon: icon('build', true), kind: 'build-dialog', body: `<div class="panel-card"><div class="panel-heading"><div><h3>Height &amp; Weight Underwriting Lookup</h3><p class="subtle">Select an insurance company, then a height.</p></div><button type="button" class="btn secondary" data-build-reset>Reset</button></div><div class="form-grid">${select('company', 'Company', [['', 'Select company'], ...companies])}${select('height', 'Height', [['', 'Choose company first'], ...heights], true)}</div><div data-build-result aria-live="polite">${empty('Choose a company to begin', 'Carrier chart tables have not been imported. No weight limits or eligibility decisions are invented.')}</div></div>` });
    const company = d.node.querySelector('[name="company"]'), height = d.node.querySelector('[name="height"]'), result = d.node.querySelector('[data-build-result]');
    let token = 0;
    company.onchange = () => { token++; height.disabled = !company.value; height.value = ''; height.options[0].text = company.value ? 'Select height' : 'Choose company first'; result.innerHTML = empty(company.value ? 'Select a height' : 'Choose a company to begin'); };
    height.onchange = async () => {
      const request = ++token;
      if (!height.value) { result.innerHTML = empty('Select a height'); return; }
      try {
        const chart = await repository.getBuildChart({ company: company.value, heightInches: Number(height.value) });
        if (request !== token || !d.node.isConnected) return;
        result.innerHTML = chart ? `<h3>${esc(company.value)}</h3><div class="contact-grid">${chart.values.map(v => `<section><h4>${esc(v.label)}</h4><strong>${esc(v.value)}</strong></section>`).join('')}</div><p class="subtle">${esc(chart.source)} • Confirm the current carrier guide before using.</p>` : empty('No chart row available');
      } catch { if (request === token && d.node.isConnected) result.innerHTML = empty('Chart data not connected', 'The lookup layout is ready. Import and verify carrier source tables before using underwriting limits.'); }
    };
    d.node.querySelector('[data-build-reset]').onclick = () => { company.value = ''; company.onchange(); };
  }
  function openCommissions() {
    const d = dialogs.open({ title: 'Commissions', hint: 'Life Insurance and Medicare dashboard data', icon: icon('commissions', true), kind: 'commissions-dialog', body: `${info}<div class="commission-view"><div class="commission-agent">${select('agent', 'Agent', [['', connected ? 'Select agent' : 'No agents connected'], ...agents.map(a => [a.id, a.full_name])], !connected)}</div><div class="mode-picker commission-types" role="group" aria-label="Commission type"><button type="button" class="active" data-commission="life" aria-pressed="true"><strong>Life Insurance</strong><small>Monthly &amp; yearly</small></button><button type="button" data-commission="medicare" aria-pressed="false"><strong>Medicare</strong><small>Book &amp; enrollment periods</small></button></div><div data-commission-body></div></div>` });
    let type = 'life', token = 0;
    const host = d.node.querySelector('[data-commission-body]');
    function panel(data = null) {
      host.innerHTML = type === 'life' ? `<section class="panel-card"><h3>Life Insurance Commissions</h3><div class="commission-totals"><article><span>Monthly Commission</span><strong>${money(data?.monthly)}</strong></article><article><span>Yearly Commission</span><strong>${money(data?.yearly)}</strong></article></div></section>` : `<section class="panel-card"><h3>Medicare Commissions</h3><div class="contact-grid"><section><h4>Current Medicare Book</h4><strong>${esc(data?.bookCount ?? '—')}</strong></section><section><h4>Monthly Renewals</h4><strong>${money(data?.monthlyRenewals)}</strong></section><section><h4>Annual Renewals</h4><strong>${money(data?.annualRenewals)}</strong></section></div><div class="commission-periods">${['AEP', 'OEP', 'SEP', 'T65 / IEP'].map(period => `<article><h4>${period}</h4><span>Commission</span><strong>${money(data?.periods?.[period])}</strong></article>`).join('')}</div></section>`;
      if (!data) host.insertAdjacentHTML('beforeend', '<p class="subtle">No commission records or rates are configured. Dashes mean unavailable, not zero earnings.</p>');
    }
    async function load() {
      const request = ++token;
      panel();
      if (!connected) return;
      try { const data = await repository.commissions({ type, agent: d.node.querySelector('[name="agent"]').value }); if (request === token && d.node.isConnected) panel(data); }
      catch { if (request === token && d.node.isConnected) host.insertAdjacentHTML('beforeend', '<div class="notice error">Commissions could not load. Select a type to retry.</div>'); }
    }
    d.node.querySelectorAll('[data-commission]').forEach(b => b.onclick = () => {
      type = b.dataset.commission;
      d.node.querySelectorAll('[data-commission]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      load();
    });
    d.node.querySelector('[name="agent"]').onchange = load;
    load();
  }
  function openTool(key) {
    ({ appointments: openAppointment, notes: openNotes, contacts: openContacts, build: openBuild, commissions: openCommissions })[key]?.();
  }
  let routing = false;
  async function changeRoute() {
    if (routing || state.destroyed) return;
    const requested = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const isLegacyClient = requested === 'client';
    const removedSection = ['medicare', 'life', 'retirement', 'documents'].includes(requested);
    const next = NAV.some(([id]) => id === requested) ? requested : (isLegacyClient || removedSection ? 'clients' : 'dashboard');
    if (dialogs.stack.length) {
      routing = true;
      history.replaceState(null, '', `#/${state.route}`);
      const closed = await dialogs.closeAll();
      routing = false;
      if (!closed) return;
    }
    history.replaceState(null, '', `#/${next}`);
    render(next);
    if (isLegacyClient) openClient();
  }
  const escapeMenu = e => {
    if (e.key === 'Escape' && !dialogs.stack.length) {
      root.querySelector('.sidebar')?.classList.remove('open');
      const shade = root.querySelector('.sidebar-shade'); if (shade) shade.hidden = true;
      root.querySelector('.menu-toggle')?.setAttribute('aria-expanded', 'false');
    }
  };
  window.addEventListener('hashchange', changeRoute);
  window.addEventListener('keydown', escapeMenu);
  changeRoute();
  return { destroy() { state.destroyed = true; campaignFeature?.destroy(); dialogs.destroy(); window.removeEventListener('hashchange', changeRoute); window.removeEventListener('keydown', escapeMenu); root.replaceChildren(); } };
}
