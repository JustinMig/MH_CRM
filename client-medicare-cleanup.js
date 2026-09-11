import { mhRepository, supabase } from './supabase-repository.js';

const CARRIERS = ['Aetna', 'Humana', 'Cigna/Healthspring', 'Devoted', 'United Health Care'];
const PLAN_TYPES = ['Supplement', 'Medicare Advantage'];
const planTypeByClient = new Map();
let pendingClientId = null;

const baseGetClient = mhRepository.getClient.bind(mhRepository);
const baseSaveClient = mhRepository.saveClient.bind(mhRepository);

async function getLatestHealthPlan(clientId) {
  const { data, error } = await supabase
    .from('health_plans')
    .select('id,plan_type')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

mhRepository.getClient = async function (id) {
  const record = await baseGetClient(id);
  if (!record) return record;

  const [{ data: medicare, error: medicareError }, health] = await Promise.all([
    supabase.from('medicare_details').select('medicaid_number').eq('client_id', id).maybeSingle(),
    getLatestHealthPlan(id)
  ]);
  if (medicareError) throw medicareError;

  return {
    ...record,
    medicaid_number: medicare?.medicaid_number || '',
    health_plan_type: health?.plan_type || ''
  };
};

mhRepository.saveClient = async function (record, ...args) {
  const originalId = record?.id || '';
  const planKey = originalId || '__new__';
  const selectedPlanType = planTypeByClient.has(planKey)
    ? planTypeByClient.get(planKey)
    : (record?.health_plan_type || '');

  const saved = await baseSaveClient(record, ...args);
  if (!saved?.id) return saved;

  const medicaidNumber = String(record?.medicaid_number || '').trim() || null;
  const { error: medicaidError } = await supabase
    .from('medicare_details')
    .update({ medicaid_number: medicaidNumber })
    .eq('client_id', saved.id);
  if (medicaidError) throw medicaidError;

  const hasHealthData = !!(
    record?.health_carrier || record?.health_plan_id || record?.health_member_id ||
    record?.health_effective_date || record?.health_premium || selectedPlanType
  );

  if (hasHealthData) {
    const latest = await getLatestHealthPlan(saved.id);
    if (latest?.id) {
      const { error } = await supabase
        .from('health_plans')
        .update({ plan_type: selectedPlanType || null })
        .eq('id', latest.id)
        .eq('client_id', saved.id);
      if (error) throw error;
    } else {
      const premium = record?.health_premium === '' || record?.health_premium == null
        ? null
        : Number(record.health_premium);
      const { error } = await supabase.from('health_plans').insert({
        client_id: saved.id,
        carrier: String(record?.health_carrier || '').trim() || null,
        plan_id: String(record?.health_plan_id || '').trim() || null,
        member_id: String(record?.health_member_id || '').trim() || null,
        plan_type: selectedPlanType || null,
        effective_date: record?.health_effective_date || null,
        premium: Number.isFinite(premium) ? premium : null,
        status: 'active'
      });
      if (error) throw error;
    }
  }

  if (!originalId) {
    planTypeByClient.delete('__new__');
    planTypeByClient.set(saved.id, selectedPlanType || '');
  }

  return this.getClient(saved.id);
};

function makeOptions(values, current = '') {
  const all = [...values];
  if (current && !all.includes(current)) all.unshift(current);
  return '<option value="">Select…</option>' + all.map(value => {
    const selected = value === current ? ' selected' : '';
    const label = values.includes(value) ? value : `${value} (Existing)`;
    return `<option value="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"${selected}>${label}</option>`;
  }).join('');
}

async function enhanceDialog(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('client-dialog')) return;
  if (dialog.dataset.medicareCleanup === 'true') return;

  const panel = dialog.querySelector('[data-panel="medicare"]');
  const medicaidNumber = panel?.querySelector('[name="medicaid_number"]')?.closest('label');
  const medicaidLevel = panel?.querySelector('[name="medicaid_level"]')?.closest('label');
  const healthCarrierInput = panel?.querySelector('[name="health_carrier"]');
  if (!panel || !medicaidNumber || !medicaidLevel || !healthCarrierInput) return;

  dialog.dataset.medicareCleanup = 'true';
  const clientId = dialog.dataset.clientId || pendingClientId || '';
  if (clientId) dialog.dataset.clientId = clientId;

  const medicareGroup = medicaidNumber.closest('details.field-group');
  if (medicareGroup && !panel.querySelector('[data-medicaid-group]')) {
    const medicaidGroup = document.createElement('details');
    medicaidGroup.className = 'field-group';
    medicaidGroup.dataset.medicaidGroup = 'true';
    medicaidGroup.innerHTML = '<summary>Medicaid Information</summary><div class="form-grid"></div>';
    medicaidGroup.open = false;
    medicaidGroup.querySelector('.form-grid').append(medicaidNumber, medicaidLevel);
    const medicareGovGroup = panel.querySelector('[data-medicare-gov-credentials-group]');
    (medicareGovGroup || medicareGroup).insertAdjacentElement('afterend', medicaidGroup);
  }

  const currentCarrier = healthCarrierInput.value || '';
  const carrierSelect = document.createElement('select');
  carrierSelect.name = 'health_carrier';
  carrierSelect.innerHTML = makeOptions(CARRIERS, currentCarrier);
  healthCarrierInput.replaceWith(carrierSelect);

  const carrierLabel = carrierSelect.closest('label');
  const healthGroup = carrierLabel?.closest('details.field-group');
  if (healthGroup && !healthGroup.querySelector('[data-health-plan-type]')) {
    const typeLabel = document.createElement('label');
    typeLabel.className = 'field';
    typeLabel.innerHTML = `<span>Type of Plan</span><select data-health-plan-type>${makeOptions(PLAN_TYPES)}</select>`;
    carrierLabel.insertAdjacentElement('afterend', typeLabel);

    const typeSelect = typeLabel.querySelector('[data-health-plan-type]');
    const key = clientId || '__new__';
    let initial = '';
    if (clientId) {
      try {
        const health = await getLatestHealthPlan(clientId);
        initial = health?.plan_type || '';
      } catch (error) {
        console.warn('Unable to load health plan type', error);
      }
    }
    if (initial && !PLAN_TYPES.includes(initial)) {
      typeSelect.insertAdjacentHTML('beforeend', `<option value="${initial.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${initial} (Existing)</option>`);
    }
    typeSelect.value = initial;
    planTypeByClient.set(key, initial);
    typeSelect.addEventListener('change', () => planTypeByClient.set(key, typeSelect.value));
  }
}

document.addEventListener('click', event => {
  const existing = event.target.closest?.('[data-client-id]');
  const add = event.target.closest?.('[data-add-client]');
  if (existing) pendingClientId = existing.dataset.clientId || null;
  else if (add) pendingClientId = null;
}, true);

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const dialog = node.matches?.('dialog.client-dialog') ? node : node.closest?.('dialog.client-dialog');
      if (dialog) queueMicrotask(() => enhanceDialog(dialog));
      node.querySelectorAll?.('dialog.client-dialog').forEach(d => queueMicrotask(() => enhanceDialog(d)));
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('dialog.client-dialog').forEach(dialog => enhanceDialog(dialog));
