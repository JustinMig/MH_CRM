import { Dialogs } from './dialogs.js';
import { esc, dateText } from './core.js';
import { mhRepository, supabase } from './supabase-repository.js';

const cache = new Map();
let pendingClientId = null;
const clean = v => v === '' || v === undefined || v === null ? null : v;
const money = v => v === '' || v === undefined || v === null ? null : Number(v);

const field = (name, label, value = '', extra = '') => `<label class="field"><span>${esc(label)}</span><input name="${name}" value="${esc(value)}" ${extra}></label>`;
const area = (name, label, value = '') => `<label class="field span-all"><span>${esc(label)}</span><textarea name="${name}" rows="4">${esc(value)}</textarea></label>`;
const select = (name, label, values, current = '') => `<label class="field"><span>${esc(label)}</span><select name="${name}">${values.map(([v,l]) => `<option value="${esc(v)}"${String(v)===String(current)?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
const dateField = (name, label, value = '') => `<label class="field"><span>${esc(label)}</span><input name="${name}" data-date inputmode="numeric" maxlength="10" placeholder="MM/DD/YYYY" value="${esc(dateText(value))}"></label>`;

function card(title, subtitle, body, index, kind, removable = true) {
  return `<details class="health-record-card health-${kind}" data-health-card data-kind="${kind}" data-index="${index}">
    <summary><span><strong data-health-title>${esc(title)}</strong><small>${esc(subtitle)}</small></span><b aria-hidden="true">⌄</b></summary>
    <div class="health-record-body form-grid">${body}${removable ? `<div class="health-record-actions span-all"><button type="button" class="btn danger" data-remove-health-record>Remove</button></div>` : ''}</div>
  </details>`;
}
function doctorMarkup(row = {}, i = 0) {
  const p = `doctor_${i}_`;
  const body = `<input type="hidden" name="${p}id" value="${esc(row.id || '')}">` +
    field(`${p}doctor_name`, 'Doctor Name', row.doctor_name || '') + field(`${p}specialty`, 'Specialty', row.specialty || '') +
    field(`${p}practice_name`, 'Practice / Facility', row.practice_name || '') + field(`${p}phone`, 'Phone', row.phone || '', 'type="tel"') +
    field(`${p}fax`, 'Fax', row.fax || '', 'type="tel"') + field(`${p}address`, 'Address', row.address || '') +
    field(`${p}city`, 'City', row.city || '') + field(`${p}state`, 'State', row.state || '') + field(`${p}zip_code`, 'ZIP Code', row.zip_code || '') +
    area(`${p}notes`, 'Doctor Notes', row.notes || '');
  return card(row.doctor_name || `Doctor ${i+1}`, row.specialty || 'Doctor information', body, i, 'doctor');
}
function medicationMarkup(row = {}, i = 0) {
  const p = `medication_${i}_`;
  const body = `<input type="hidden" name="${p}id" value="${esc(row.id || '')}">` +
    field(`${p}medication_name`, 'Medication', row.medication_name || '') + field(`${p}strength`, 'Strength', row.strength || '') +
    field(`${p}dosage`, 'Dosage', row.dosage || '') + field(`${p}frequency`, 'Frequency', row.frequency || '') +
    field(`${p}prescribing_doctor`, 'Prescribing Doctor', row.prescribing_doctor || '') + field(`${p}purpose`, 'Purpose / Condition', row.purpose || '') +
    select(`${p}status`, 'Status', [['active','Active'],['inactive','Inactive']], row.status || 'active') + area(`${p}notes`, 'Medication Notes', row.notes || '');
  return card(row.medication_name || `Medication ${i+1}`, [row.strength,row.frequency].filter(Boolean).join(' • ') || 'Medication information', body, i, 'medication');
}
function indemnityMarkup(row = {}, i = 0) {
  const p = `indemnity_${i}_`;
  const body = `<input type="hidden" name="${p}id" value="${esc(row.id || '')}">` +
    field(`${p}carrier`, 'Carrier', row.carrier || '') + field(`${p}plan_name`, 'Plan Name', row.plan_name || '') +
    field(`${p}policy_number`, 'Policy Number', row.policy_number || '') + field(`${p}member_id`, 'Member ID', row.member_id || '') +
    dateField(`${p}effective_date`, 'Effective Date', row.effective_date || '') + field(`${p}premium`, 'Monthly Premium', row.premium ?? '', 'type="number" min="0" step="0.01"') +
    field(`${p}admission_benefit`, 'Hospital Admission Benefit', row.admission_benefit ?? '', 'type="number" min="0" step="0.01"') +
    field(`${p}daily_benefit`, 'Daily Hospital Benefit', row.daily_benefit ?? '', 'type="number" min="0" step="0.01"') +
    field(`${p}benefit_days`, 'Benefit Days', row.benefit_days ?? '', 'type="number" min="0" step="1"') +
    select(`${p}status`, 'Status', [['active','Active'],['inactive','Inactive']], row.status || 'active') + area(`${p}notes`, 'Hospital Indemnity Notes', row.notes || '');
  return card(row.carrier || row.plan_name || `Hospital Indemnity Plan ${i+1}`, row.policy_number ? `Policy ${row.policy_number}` : 'Hospital indemnity plan', body, i, 'indemnity');
}
function panelMarkup(kind, rows) {
  const configs = {
    doctors: { title:'Doctors', copy:'Keep each doctor and office location as a separate record.', add:'+ Add Doctor', renderer:doctorMarkup },
    medications: { title:'Medications', copy:'Keep each current or inactive medication as its own record.', add:'+ Add Medication', renderer:medicationMarkup },
    hospital_indemnity: { title:'Hospital Indemnity Plans', copy:'Add each hospital indemnity policy separately.', add:'+ Add Plan', renderer:indemnityMarkup }
  };
  const c = configs[kind], list = rows || [];
  return `<div class="health-tab-toolbar"><div><h3>${c.title}</h3><p>${c.copy}</p></div><button type="button" class="btn primary" data-add-health-record="${kind}">${c.add}</button></div>
    <div class="health-record-list" data-health-list="${kind}">${list.map((row,i)=>c.renderer(row,i)).join('')}</div>
    <div class="health-tab-empty" data-health-empty="${kind}"${list.length?' hidden':''}>No ${kind === 'hospital_indemnity' ? 'hospital indemnity plans' : kind} saved yet. Use the Add button above.</div>`;
}
function render(form, data = {}) {
  const doctors = form.querySelector('[data-panel="doctors"]');
  const medications = form.querySelector('[data-panel="medications"]');
  const indemnity = form.querySelector('[data-panel="hospital_indemnity"]');
  if (doctors) doctors.innerHTML = panelMarkup('doctors', data.doctors || []);
  if (medications) medications.innerHTML = panelMarkup('medications', data.medications || []);
  if (indemnity) indemnity.innerHTML = panelMarkup('hospital_indemnity', data.hospital_indemnity || []);
  bind(form);
}
function refreshEmpty(panel, kind) {
  const list = panel.querySelector(`[data-health-list="${kind}"]`), empty = panel.querySelector(`[data-health-empty="${kind}"]`);
  if (empty) empty.hidden = !!list?.children.length;
}
function bind(form) {
  if (form.dataset.healthTabsBound === 'true') return;
  form.dataset.healthTabsBound = 'true';
  form.addEventListener('click', event => {
    const add = event.target.closest?.('[data-add-health-record]');
    if (add) {
      const kind = add.dataset.addHealthRecord;
      const panel = form.querySelector(`[data-panel="${kind}"]`), list = panel?.querySelector(`[data-health-list="${kind}"]`);
      if (!list) return;
      const indexes = [...list.querySelectorAll('[data-health-card]')].map(x=>Number(x.dataset.index||0));
      const index = indexes.length ? Math.max(...indexes)+1 : 0;
      const markup = kind === 'doctors' ? doctorMarkup({}, index) : kind === 'medications' ? medicationMarkup({}, index) : indemnityMarkup({}, index);
      list.insertAdjacentHTML('beforeend', markup);
      const newCard = list.lastElementChild; newCard.open = true; refreshEmpty(panel, kind);
      form.dispatchEvent(new Event('input',{bubbles:true})); newCard.querySelector('input,select,textarea')?.focus(); return;
    }
    const remove = event.target.closest?.('[data-remove-health-record]');
    if (remove) {
      const card = remove.closest('[data-health-card]'), panel = card?.closest('[data-panel]'), kind = panel?.dataset.panel;
      card?.remove(); if (panel && kind) refreshEmpty(panel, kind); form.dispatchEvent(new Event('input',{bubbles:true}));
    }
  });
  form.addEventListener('input', event => {
    const card = event.target.closest?.('[data-health-card]'); if (!card) return;
    const kind = card.dataset.kind; let title = '';
    if (kind === 'doctor') title = card.querySelector('input[name$="_doctor_name"]')?.value.trim() || `Doctor ${Number(card.dataset.index)+1}`;
    if (kind === 'medication') title = card.querySelector('input[name$="_medication_name"]')?.value.trim() || `Medication ${Number(card.dataset.index)+1}`;
    if (kind === 'indemnity') title = card.querySelector('input[name$="_carrier"]')?.value.trim() || card.querySelector('input[name$="_plan_name"]')?.value.trim() || `Hospital Indemnity Plan ${Number(card.dataset.index)+1}`;
    card.querySelector('[data-health-title]')?.replaceChildren(document.createTextNode(title));
  });
}
function parseRows(record, prefix, keys) {
  const indexes = new Set();
  Object.keys(record || {}).forEach(key => { const m = new RegExp(`^${prefix}_(\\d+)_`).exec(key); if (m) indexes.add(Number(m[1])); });
  return [...indexes].sort((a,b)=>a-b).map(i => { const out = {}; keys.forEach(key => out[key] = record[`${prefix}_${i}_${key}`] ?? ''); return out; });
}
const meaningful = row => Object.entries(row).some(([k,v]) => k !== 'id' && k !== 'status' && String(v ?? '').trim() !== '');
async function syncTable(table, clientId, rows, mapper) {
  const { data: existing, error: loadError } = await supabase.from(table).select('id').eq('client_id',clientId);
  if (loadError) throw loadError;
  const keep = [], savedRows = [];
  for (const row of rows) {
    if (!meaningful(row)) continue;
    const payload = { ...mapper(row), client_id:clientId, updated_at:new Date().toISOString() };
    if (row.id) {
      const { data, error } = await supabase.from(table).update(payload).eq('id',row.id).eq('client_id',clientId).select('*').maybeSingle();
      if (error) throw error;
      if (data?.id) { keep.push(data.id); savedRows.push(data); }
    } else {
      const { data, error } = await supabase.from(table).insert(payload).select('*').single();
      if (error) throw error;
      keep.push(data.id); savedRows.push(data);
    }
  }
  const removed = (existing || []).map(x=>x.id).filter(id=>!keep.includes(id));
  if (removed.length) { const { error } = await supabase.from(table).delete().eq('client_id',clientId).in('id',removed); if (error) throw error; }
  return savedRows;
}
const doctorKeys = ['id','doctor_name','specialty','practice_name','phone','fax','address','city','state','zip_code','notes'];
const medicationKeys = ['id','medication_name','strength','dosage','frequency','prescribing_doctor','purpose','notes','status'];
const indemnityKeys = ['id','carrier','plan_name','policy_number','member_id','effective_date','premium','admission_benefit','daily_benefit','benefit_days','notes','status'];

const baseGet = mhRepository.getClient.bind(mhRepository);
mhRepository.getClient = async function getClientWithHealthTabs(id) {
  const base = await baseGet(id); if (!base) return base;
  const [d,m,h] = await Promise.all([
    supabase.from('client_doctors').select('*').eq('client_id',id).order('created_at'),
    supabase.from('client_medications').select('*').eq('client_id',id).order('created_at'),
    supabase.from('hospital_indemnity_plans').select('*').eq('client_id',id).order('created_at')
  ]);
  if (d.error) throw d.error; if (m.error) throw m.error; if (h.error) throw h.error;
  const extra = { doctors:d.data||[], medications:m.data||[], hospital_indemnity:h.data||[] };
  cache.set(id, extra);
  return { ...base, _doctors:extra.doctors, _medications:extra.medications, _hospital_indemnity:extra.hospital_indemnity };
};

const baseSave = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function saveClientWithHealthTabs(record, ...args) {
  const doctors = parseRows(record,'doctor',doctorKeys), medications = parseRows(record,'medication',medicationKeys), indemnity = parseRows(record,'indemnity',indemnityKeys);
  const saved = await baseSave(record,...args); if (!saved?.id) return saved;
  const [savedDoctors,savedMedications,savedIndemnity] = await Promise.all([
    syncTable('client_doctors',saved.id,doctors,row=>({ doctor_name:String(row.doctor_name||'').trim(), specialty:clean(row.specialty), practice_name:clean(row.practice_name), phone:clean(row.phone), fax:clean(row.fax), address:clean(row.address), city:clean(row.city), state:clean(row.state), zip_code:clean(row.zip_code), notes:clean(row.notes) })),
    syncTable('client_medications',saved.id,medications,row=>({ medication_name:String(row.medication_name||'').trim(), strength:clean(row.strength), dosage:clean(row.dosage), frequency:clean(row.frequency), prescribing_doctor:clean(row.prescribing_doctor), purpose:clean(row.purpose), notes:clean(row.notes), status:row.status||'active' })),
    syncTable('hospital_indemnity_plans',saved.id,indemnity,row=>({ carrier:clean(row.carrier), plan_name:clean(row.plan_name), policy_number:clean(row.policy_number), member_id:clean(row.member_id), effective_date:clean(row.effective_date), premium:money(row.premium), admission_benefit:money(row.admission_benefit), daily_benefit:money(row.daily_benefit), benefit_days:row.benefit_days===''?null:Number(row.benefit_days), notes:clean(row.notes), status:row.status||'active' }))
  ]);
  const extra = { doctors:savedDoctors, medications:savedMedications, hospital_indemnity:savedIndemnity };
  cache.set(saved.id, extra);
  return { ...saved, _doctors:savedDoctors, _medications:savedMedications, _hospital_indemnity:savedIndemnity };
};

document.addEventListener('click', event => {
  const existing = event.target.closest?.('[data-client-id]'), add = event.target.closest?.('[data-add-client]');
  if (existing) pendingClientId = existing.dataset.clientId || null; else if (add) pendingClientId = null;
}, true);
const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function patchedHealthTabsOpen(options = {}) {
  const clientId = options.kind === 'client-dialog' ? pendingClientId : null;
  if (options.kind === 'client-dialog') pendingClientId = null;
  const controller = originalOpen.call(this, options); if (options.kind !== 'client-dialog') return controller;
  const previousAttach = controller.attachForm.bind(controller);
  controller.attachForm = form => { const extra = clientId ? (cache.get(clientId) || {}) : {}; render(form, extra); previousAttach(form); };
  return controller;
};
