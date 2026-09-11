import { Dialogs } from './dialogs.js';
import { mhRepository, supabase } from './supabase-repository.js';

const cache = new Map();
let pendingClientId = null;

const cleanInt = value => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isInteger(n) ? n : null;
};

const cleanBool = value => {
  if (value === true || value === 'true' || value === 'yes') return true;
  if (value === false || value === 'false' || value === 'no') return false;
  return null;
};

function markup(values = {}) {
  const smoker = values.smoker == null ? '' : String(values.smoker);
  const veteran = values.veteran == null ? '' : String(values.veteran);
  return `<div class="personal-underwriting-fields span-all" data-personal-underwriting>
    <div class="personal-underwriting-title span-all"><strong>Height, Weight & Status</strong></div>
    <label class="field"><span>Height (Feet)</span><input name="height_feet" type="number" min="3" max="8" step="1" inputmode="numeric" value="${values.height_feet ?? ''}" placeholder="Feet"></label>
    <label class="field"><span>Height (Inches)</span><input name="height_inches" type="number" min="0" max="11" step="1" inputmode="numeric" value="${values.height_inches ?? ''}" placeholder="Inches"></label>
    <label class="field"><span>Weight (lbs)</span><input name="weight_lbs" type="number" min="40" max="1000" step="1" inputmode="numeric" value="${values.weight_lbs ?? ''}" placeholder="Weight"></label>
    <label class="field"><span>Smoker</span><select name="smoker"><option value=""${smoker === '' ? ' selected' : ''}>Select…</option><option value="true"${smoker === 'true' ? ' selected' : ''}>Yes</option><option value="false"${smoker === 'false' ? ' selected' : ''}>No</option></select></label>
    <label class="field"><span>Veteran</span><select name="veteran"><option value=""${veteran === '' ? ' selected' : ''}>Select…</option><option value="true"${veteran === 'true' ? ' selected' : ''}>Yes</option><option value="false"${veteran === 'false' ? ' selected' : ''}>No</option></select></label>
  </div>`;
}

function installFields(form, values = {}) {
  if (!form || form.querySelector('[data-personal-underwriting]')) return;
  const personal = form.querySelector('[data-panel="information"] details.field-group');
  const grid = personal?.querySelector(':scope > .form-grid');
  if (!grid) return;
  const products = grid.querySelector('.product-choices');
  if (products) products.insertAdjacentHTML('beforebegin', markup(values));
  else grid.insertAdjacentHTML('beforeend', markup(values));
}

const baseGetClient = mhRepository.getClient.bind(mhRepository);
mhRepository.getClient = async function getClientWithPersonalUnderwriting(id) {
  const record = await baseGetClient(id);
  if (record?.id) cache.set(record.id, {
    height_feet: record.height_feet ?? null,
    height_inches: record.height_inches ?? null,
    weight_lbs: record.weight_lbs ?? null,
    smoker: record.smoker ?? null,
    veteran: record.veteran ?? null
  });
  return record;
};

const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function saveClientWithPersonalUnderwriting(record, ...args) {
  const values = {
    height_feet: cleanInt(record.height_feet),
    height_inches: cleanInt(record.height_inches),
    weight_lbs: cleanInt(record.weight_lbs),
    smoker: cleanBool(record.smoker),
    veteran: cleanBool(record.veteran)
  };
  const saved = await baseSaveClient(record, ...args);
  if (!saved?.id) return saved;
  const { data, error } = await supabase.from('clients').update(values).eq('id', saved.id).select('height_feet,height_inches,weight_lbs,smoker,veteran,updated_at').single();
  if (error) throw error;
  cache.set(saved.id, values);
  return { ...saved, ...data };
};

document.addEventListener('click', event => {
  const existing = event.target.closest?.('[data-client-id]');
  const add = event.target.closest?.('[data-add-client]');
  if (existing) pendingClientId = existing.dataset.clientId || null;
  else if (add) pendingClientId = null;
}, true);

const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function patchedPersonalUnderwritingOpen(options = {}) {
  const clientId = options.kind === 'client-dialog' ? pendingClientId : null;
  if (options.kind === 'client-dialog') pendingClientId = null;
  const controller = originalOpen.call(this, options);
  if (options.kind !== 'client-dialog') return controller;
  const previousAttach = controller.attachForm.bind(controller);
  controller.attachForm = form => {
    installFields(form, clientId ? (cache.get(clientId) || {}) : {});
    previousAttach(form);
  };
  return controller;
};
