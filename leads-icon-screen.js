import { Dialogs } from './dialogs.js';
import { mhRepository, supabase } from './supabase-repository.js';

const dialogs = new Dialogs();
const BUCKET = 'mh-client-documents';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
let currentLeadDialog = null;

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
const normalizePhoneDigits = value => String(value || '').replace(/\D/g, '').slice(-10);
const formatPhone = value => {
  const d = normalizePhoneDigits(value);
  if (d.length !== 10) return String(value || '');
  return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
};
const formatDate = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : '';
};
const parseManualDate = value => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let year, month, day;
  if (slash) { month = Number(slash[1]); day = Number(slash[2]); year = Number(slash[3]); }
  else if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
  else throw new Error('Enter Date of Birth as MM/DD/YYYY.');
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('Enter a valid Date of Birth.');
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
};
const safeFileName = name => String(name || 'lead-file').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,120) || 'lead-file';
const productTags = lead => [lead.is_medicare && 'Medicare', lead.is_life && 'Life', lead.is_retirement && 'Retirement'].filter(Boolean);

async function listLeads() {
  const { data, error } = await supabase.from('workspace_leads').select('*').order('created_at', { ascending:false });
  if (error) throw error;
  return data || [];
}

async function saveLead(payload) {
  const userId = mhRepository.user?.id;
  if (!userId) throw new Error('Your M&H session is not available.');
  const body = {
    assigned_agent_id: payload.assigned_agent_id || userId,
    created_by: payload.created_by || userId,
    first_name: String(payload.first_name || '').trim(),
    last_name: String(payload.last_name || '').trim(),
    date_of_birth: payload.date_of_birth || null,
    phone: normalizePhoneDigits(payload.phone) || null,
    product_type: payload.product_type,
    is_medicare: !!payload.is_medicare,
    is_life: !!payload.is_life,
    is_retirement: !!payload.is_retirement,
    notes: String(payload.notes || '').trim() || null,
    status: payload.status || 'lead'
  };
  if (!body.first_name || !body.last_name) throw new Error('First and last name are required.');
  if (!body.is_medicare && !body.is_life && !body.is_retirement) throw new Error('Choose at least one product.');
  if (payload.id) {
    const { data, error } = await supabase.from('workspace_leads').update(body).eq('id', payload.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from('workspace_leads').insert(body).select().single();
  if (error) throw error;
  return data;
}

async function uploadLeadFile(lead, file) {
  if (!file) return lead;
  if (file.size > MAX_FILE_BYTES) throw new Error('Lead files must be 10 MB or smaller.');
  const allowed = ['image/jpeg','image/png','image/heic','image/heif','application/pdf'];
  if (file.type && !allowed.includes(file.type)) throw new Error('Use JPG, PNG, HEIC/HEIF, or PDF for lead files.');
  const fileName = safeFileName(file.name);
  const path = `leads/${lead.id}/${crypto.randomUUID()}-${fileName}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType:file.type || 'application/octet-stream', upsert:false });
  if (uploadError) throw uploadError;
  const { data, error } = await supabase.from('workspace_leads').update({
    photo_storage_path:path,
    photo_file_name:fileName,
    photo_mime_type:file.type || 'application/octet-stream',
    photo_uploaded_at:new Date().toISOString()
  }).eq('id', lead.id).select().single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  if (lead.photo_storage_path && lead.photo_storage_path !== path) await supabase.storage.from(BUCKET).remove([lead.photo_storage_path]);
  return data;
}

async function deleteLead(lead) {
  const { error } = await supabase.from('workspace_leads').delete().eq('id', lead.id);
  if (error) throw error;
  if (lead.photo_storage_path && lead.status !== 'converted') await supabase.storage.from(BUCKET).remove([lead.photo_storage_path]);
}

async function openLeadFile(lead) {
  if (!lead.photo_storage_path) throw new Error('No M&H lead file is attached to this lead.');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(lead.photo_storage_path, 600);
  if (error || !data?.signedUrl) throw error || new Error('Unable to open the lead file.');
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

async function findExistingClient(lead) {
  const first = String(lead.first_name || '').trim();
  const last = String(lead.last_name || '').trim();
  const { data, error } = await supabase.from('clients').select('id,first_name,last_name,date_of_birth,phone,products,notes').ilike('first_name', first).ilike('last_name', last).limit(25);
  if (error) throw error;
  const phone = normalizePhoneDigits(lead.phone);
  const rows = data || [];
  if (lead.date_of_birth) {
    const match = rows.find(row => String(row.date_of_birth || '') === String(lead.date_of_birth));
    if (match) return match;
  }
  if (phone.length === 10) {
    const match = rows.find(row => normalizePhoneDigits(row.phone) === phone);
    if (match) return match;
  }
  return null;
}

async function attachLeadFileToClient(lead, clientId) {
  if (!lead.photo_storage_path) return;
  const { data: existing, error: findError } = await supabase.from('documents').select('id').eq('client_id', clientId).eq('storage_path', lead.photo_storage_path).limit(1);
  if (findError) throw findError;
  if (existing?.length) return;
  const { error } = await supabase.from('documents').insert({
    client_id:clientId,
    uploaded_by:mhRepository.user?.id || null,
    category:'lead_photo',
    file_name:lead.photo_file_name || 'lead-file',
    storage_path:lead.photo_storage_path,
    mime_type:lead.photo_mime_type || null,
    document_date:new Date().toISOString().slice(0,10),
    notes:'Transferred from M&H lead on conversion.'
  });
  if (error) throw error;
}

async function convertLead(lead) {
  if (lead.status === 'converted' && lead.client_id) return lead.client_id;
  const existing = await findExistingClient(lead);
  const products = productTags(lead).map(value => value.toLowerCase());
  let clientId;
  if (existing) {
    const merged = [...new Set([...(existing.products || []), ...products])];
    const updates = { products:merged, updated_at:new Date().toISOString() };
    if (!existing.date_of_birth && lead.date_of_birth) updates.date_of_birth = lead.date_of_birth;
    if (!existing.phone && lead.phone) updates.phone = lead.phone;
    const { data, error } = await supabase.from('clients').update(updates).eq('id', existing.id).select('id').single();
    if (error) throw error;
    clientId = data.id;
  } else {
    const { data, error } = await supabase.from('clients').insert({
      assigned_agent_id:lead.assigned_agent_id || mhRepository.user?.id || null,
      first_name:lead.first_name,
      last_name:lead.last_name,
      date_of_birth:lead.date_of_birth || null,
      phone:normalizePhoneDigits(lead.phone) || null,
      products,
      status:'active',
      notes:lead.notes || null
    }).select('id').single();
    if (error) throw error;
    clientId = data.id;
  }
  await attachLeadFileToClient(lead, clientId);
  const { error } = await supabase.from('workspace_leads').update({ status:'converted', client_id:clientId, converted_at:new Date().toISOString() }).eq('id', lead.id);
  if (error) throw error;
  return clientId;
}

function openClientFile(clientId, lead) {
  currentLeadDialog?.finish?.();
  location.hash = '#/clients';
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    const form = document.querySelector('#client-search');
    if (form && !form.dataset.leadOpenSearch) {
      form.dataset.leadOpenSearch = 'true';
      const input = form.elements.namedItem('query');
      if (input) {
        input.value = `${lead.first_name} ${lead.last_name}`;
        input.dispatchEvent(new Event('input', { bubbles:true }));
        form.requestSubmit();
      }
    }
    const row = document.querySelector(`[data-client-id="${CSS.escape(clientId)}"]`);
    if (row) { clearInterval(timer); row.click(); }
    else if (tries > 25) clearInterval(timer);
  }, 120);
}

function editorMarkup(lead = {}) {
  const medicare = !!lead.is_medicare, life = !!lead.is_life, retirement = !!lead.is_retirement;
  return `<form class="lead-editor-form" autocomplete="off">
    <div class="lead-editor-grid">
      <label class="field"><span>First Name *</span><input name="first_name" value="${esc(lead.first_name || '')}" required autofocus></label>
      <label class="field"><span>Last Name *</span><input name="last_name" value="${esc(lead.last_name || '')}" required></label>
      <label class="field"><span>Date of Birth</span><input name="date_of_birth" value="${esc(formatDate(lead.date_of_birth))}" placeholder="MM/DD/YYYY" inputmode="numeric" maxlength="10"></label>
      <label class="field"><span>Phone</span><input name="phone" value="${esc(formatPhone(lead.phone))}" inputmode="tel" placeholder="662-555-1234"></label>
    </div>
    <fieldset class="lead-products"><legend>Products *</legend>
      <label><input type="checkbox" name="is_medicare" ${medicare?'checked':''}> Medicare</label>
      <label><input type="checkbox" name="is_life" ${life?'checked':''}> Life Insurance</label>
      <label><input type="checkbox" name="is_retirement" ${retirement?'checked':''}> Retirement</label>
    </fieldset>
    <label class="field"><span>Notes</span><textarea name="notes" rows="5">${esc(lead.notes || '')}</textarea></label>
    <label class="field"><span>Lead File / Photo</span><input name="lead_file" type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf,.pdf"><small>JPG, PNG, HEIC/HEIF or PDF · up to 10 MB.</small></label>
    ${lead.source_system === 'mayer' && lead.source_photo_storage_path && !lead.photo_storage_path ? '<p class="lead-source-note">This imported lead had a file in Mayer CRM. The Mayer original was left untouched.</p>' : ''}
  </form>`;
}

function openLeadEditor(lead, refresh) {
  const isEdit = !!lead?.id;
  const editor = dialogs.open({
    title:isEdit ? 'Edit Lead' : 'New Lead',
    hint:isEdit ? 'Update this M&H lead' : 'Fast lead intake',
    kind:'lead-editor-dialog',
    body:editorMarkup(lead || {}),
    footer:'<span class="dirty-state" data-dirty>No changes</span><div class="footer-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button type="button" class="btn primary" data-save="close">Save Lead</button></div>',
    onSave:async form => {
      const values = new FormData(form);
      const flags = {
        is_medicare:values.get('is_medicare') === 'on',
        is_life:values.get('is_life') === 'on',
        is_retirement:values.get('is_retirement') === 'on'
      };
      const payload = {
        ...(lead || {}),
        first_name:values.get('first_name'),
        last_name:values.get('last_name'),
        date_of_birth:parseManualDate(values.get('date_of_birth')),
        phone:values.get('phone'),
        notes:values.get('notes'),
        ...flags,
        product_type:flags.is_medicare ? 'medicare' : flags.is_life ? 'life' : flags.is_retirement ? 'retirement' : ''
      };
      let saved = await saveLead(payload);
      const file = values.get('lead_file');
      if (file instanceof File && file.size) saved = await uploadLeadFile(saved, file);
      await refresh();
      return saved;
    }
  });
  const form = editor.node.querySelector('form');
  editor.attachForm(form);
  const phone = form.elements.namedItem('phone');
  phone?.addEventListener('input', () => { phone.value = formatPhone(phone.value); });
}

function leadCard(lead) {
  const tags = productTags(lead).map(tag => `<span>${esc(tag)}</span>`).join('');
  const hasMayerOnlyFile = lead.source_system === 'mayer' && lead.source_photo_storage_path && !lead.photo_storage_path;
  return `<article class="lead-card" data-lead-card="${esc(lead.id)}">
    <div class="lead-card-main"><div><strong>${esc(lead.first_name)} ${esc(lead.last_name)}</strong><small>${lead.phone ? esc(formatPhone(lead.phone)) : 'No phone'}${lead.date_of_birth ? ` · DOB ${esc(formatDate(lead.date_of_birth))}` : ''}</small></div><div class="lead-tags">${tags}</div></div>
    ${lead.notes ? `<p>${esc(lead.notes)}</p>` : ''}
    <div class="lead-card-meta"><span>${lead.status === 'converted' ? 'Converted' : 'Active Lead'}</span>${hasMayerOnlyFile ? '<span>Original file remains in Mayer</span>' : lead.photo_storage_path ? '<span>File attached</span>' : ''}</div>
    <div class="lead-actions">
      ${lead.phone ? `<a class="btn secondary lead-small" href="tel:${esc(normalizePhoneDigits(lead.phone))}">Call</a>` : ''}
      ${lead.photo_storage_path ? '<button type="button" class="btn secondary lead-small" data-lead-file>Open File</button>' : ''}
      <button type="button" class="btn secondary lead-small" data-lead-edit>Edit</button>
      ${lead.status === 'converted' && lead.client_id ? '<button type="button" class="btn primary lead-small" data-lead-client>Open Client</button>' : '<button type="button" class="btn primary lead-small" data-lead-convert>Convert to Client</button>'}
      ${lead.status === 'lead' ? '<button type="button" class="btn danger lead-small" data-lead-delete>Delete</button>' : ''}
    </div>
  </article>`;
}

function leadsShell() {
  return `<div class="lead-manager" data-lead-manager>
    <div class="lead-head"><div><h3>Leads</h3><p>Fast lead entry, follow-up and conversion.</p></div><button type="button" class="btn primary" data-new-lead>+ New Lead</button></div>
    <div class="lead-summary" data-lead-summary></div>
    <div class="lead-toolbar"><label class="field"><span>Search Leads</span><input data-lead-search placeholder="Name, phone or notes"></label><label class="field"><span>Status</span><select data-lead-status><option value="lead">Active Leads</option><option value="converted">Converted</option><option value="all">All Leads</option></select></label></div>
    <div class="lead-state" data-lead-state>Loading leads…</div>
    <div class="lead-list" data-lead-list></div>
  </div>`;
}

function openLeadsScreen() {
  const dialog = dialogs.open({ title:'Leads', hint:'M&H Insurance Group lead management', kind:'leads-dialog', body:leadsShell() });
  currentLeadDialog = dialog;
  const root = dialog.node.querySelector('[data-lead-manager]');
  const list = root.querySelector('[data-lead-list]');
  const state = root.querySelector('[data-lead-state]');
  const search = root.querySelector('[data-lead-search]');
  const status = root.querySelector('[data-lead-status]');
  const summary = root.querySelector('[data-lead-summary]');
  let rows = [];

  function draw() {
    const q = search.value.trim().toLowerCase();
    const mode = status.value;
    const visible = rows.filter(lead => (mode === 'all' || lead.status === mode)).filter(lead => !q || `${lead.first_name} ${lead.last_name} ${lead.phone || ''} ${lead.notes || ''}`.toLowerCase().includes(q));
    const active = rows.filter(lead => lead.status === 'lead');
    summary.innerHTML = `<article><strong>${active.length}</strong><span>Active</span></article><article><strong>${active.filter(x=>x.is_medicare).length}</strong><span>Medicare</span></article><article><strong>${active.filter(x=>x.is_life).length}</strong><span>Life</span></article><article><strong>${active.filter(x=>x.is_retirement).length}</strong><span>Retirement</span></article>`;
    list.innerHTML = visible.length ? visible.map(leadCard).join('') : '<div class="lead-empty">No leads match this view.</div>';
    state.hidden = true;
    list.querySelectorAll('[data-lead-card]').forEach(card => {
      const lead = rows.find(item => item.id === card.dataset.leadCard);
      card.querySelector('[data-lead-edit]')?.addEventListener('click', () => openLeadEditor(lead, load));
      card.querySelector('[data-lead-file]')?.addEventListener('click', async () => { try { await openLeadFile(lead); } catch (error) { alert(error?.message || 'Unable to open lead file.'); } });
      card.querySelector('[data-lead-client]')?.addEventListener('click', () => openClientFile(lead.client_id, lead));
      card.querySelector('[data-lead-convert]')?.addEventListener('click', async () => {
        if (!confirm(`Convert ${lead.first_name} ${lead.last_name} to a client?`)) return;
        try { const clientId = await convertLead(lead); await load(); openClientFile(clientId, lead); }
        catch (error) { alert(error?.message || 'Unable to convert lead.'); }
      });
      card.querySelector('[data-lead-delete]')?.addEventListener('click', async () => {
        if (!confirm(`Delete lead ${lead.first_name} ${lead.last_name}?`)) return;
        try { await deleteLead(lead); await load(); }
        catch (error) { alert(error?.message || 'Unable to delete lead.'); }
      });
    });
  }

  async function load() {
    state.hidden = false; state.textContent = 'Loading leads…'; list.innerHTML = '';
    try { rows = await listLeads(); draw(); }
    catch (error) { state.hidden = false; state.textContent = error?.message || 'Leads could not load.'; }
  }

  root.querySelector('[data-new-lead]').onclick = () => openLeadEditor(null, load);
  search.oninput = draw;
  status.onchange = draw;
  load();
}

function installLeadsButton(scope = document) {
  const tools = scope.querySelector?.('.quick-tools');
  if (!tools || tools.querySelector('[data-tool="leads"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quick-tool';
  button.dataset.tool = 'leads';
  button.title = 'Open lead management';
  button.setAttribute('aria-label', 'Leads');
  button.setAttribute('aria-haspopup', 'dialog');
  button.innerHTML = '<span class="tool-icon tool-leads"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.4-4 2.3-6 5.5-6s5.1 2 5.5 6M16 5.5h5M18.5 3v5M16.5 13.5h4M18.5 11.5v4"/></svg></span><strong>Leads</strong>';
  const commissions = tools.querySelector('[data-tool="commissions"]');
  if (commissions) tools.insertBefore(button, commissions);
  else tools.append(button);
}

const app = document.getElementById('app');
if (app) {
  installLeadsButton(app);
  new MutationObserver(mutations => {
    if (mutations.some(mutation => [...mutation.addedNodes].some(node => node instanceof Element && (node.matches?.('.quick-tools') || node.querySelector?.('.quick-tools'))))) installLeadsButton(app);
  }).observe(app, { childList:true, subtree:true });
  app.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-tool="leads"]');
    if (!button || !app.contains(button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openLeadsScreen();
  }, true);
}
