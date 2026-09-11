import { Dialogs } from './dialogs.js';
import { mhRepository } from './supabase-repository.js';

const STANDARD_CARRIERS = new Set([
  'American Amicable',
  'Mutual of Omaha',
  'Physicians Mutual',
  'CiCa/Citizen',
  'CoreBridge',
  'Gerber',
  'TransAmerica',
  'Aflac'
]);

function otherFieldName(select) {
  return select.name.replace(/carrier$/, 'carrier_other');
}

function updateCardTitle(card) {
  const select = card.querySelector('select[name$="_carrier"]');
  if (!select) return;
  const other = card.querySelector(`[name="${CSS.escape(otherFieldName(select))}"]`);
  const carrier = select.value === 'Other' ? String(other?.value || '').trim() : String(select.value || '').trim();
  if (carrier) card.querySelector('[data-policy-title]')?.replaceChildren(document.createTextNode(carrier));
}

function syncOtherField(card) {
  const select = card.querySelector('select[name$="_carrier"]');
  if (!select) return;
  const field = card.querySelector('[data-other-carrier-field]');
  const input = field?.querySelector('input');
  const show = select.value === 'Other';
  if (field) field.style.display = show ? '' : 'none';
  if (input) input.required = show;
  updateCardTitle(card);
}

function enhanceCard(card) {
  if (!(card instanceof HTMLElement)) return;
  const select = card.querySelector('select[name$="_carrier"]');
  if (!select || select.dataset.otherCarrierReady === 'true') return;

  const current = String(select.value || '').trim();
  const customCarrier = current && current !== 'Other' && !STANDARD_CARRIERS.has(current) ? current : '';

  if (!Array.from(select.options).some(option => option.value === 'Other')) {
    const option = document.createElement('option');
    option.value = 'Other';
    option.textContent = 'Other';
    select.append(option);
  }

  const carrierLabel = select.closest('label.field');
  if (!carrierLabel) return;

  const label = document.createElement('label');
  label.className = 'field';
  label.dataset.otherCarrierField = 'true';
  label.style.display = 'none';
  label.innerHTML = `<span>Carrier Name</span><input name="${otherFieldName(select)}" autocomplete="off" placeholder="Enter carrier name">`;
  carrierLabel.insertAdjacentElement('afterend', label);

  const input = label.querySelector('input');
  if (customCarrier) {
    select.value = 'Other';
    input.value = customCarrier;
  }

  select.dataset.otherCarrierReady = 'true';
  select.addEventListener('change', () => syncOtherField(card));
  input.addEventListener('input', () => updateCardTitle(card));
  syncOtherField(card);
}

function enhanceForm(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const panel = form.querySelector('[data-panel="life"]');
  if (!panel) return;

  panel.querySelectorAll('[data-life-policy-card]').forEach(enhanceCard);

  if (panel.dataset.otherCarrierPanelReady !== 'true') {
    panel.dataset.otherCarrierPanelReady = 'true';
    panel.addEventListener('click', event => {
      if (!event.target.closest?.('[data-add-life-policy]')) return;
      queueMicrotask(() => panel.querySelectorAll('[data-life-policy-card]').forEach(enhanceCard));
    });
  }
}

const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function patchedOtherLifeCarrierOpen(options = {}) {
  const controller = originalOpen.call(this, options);
  if (options.kind !== 'client-dialog') return controller;

  const previousAttachForm = controller.attachForm.bind(controller);
  controller.attachForm = form => {
    previousAttachForm(form);
    enhanceForm(form);
    controller.baseline();
  };
  return controller;
};

const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function saveClientWithOtherLifeCarrier(record, ...args) {
  const next = { ...record };

  Object.keys(next).forEach(key => {
    if (!/^life_policy_\d+_carrier$/.test(key)) return;
    const otherKey = key.replace(/carrier$/, 'carrier_other');
    if (String(next[key] || '') === 'Other') next[key] = String(next[otherKey] || '').trim();
    delete next[otherKey];
  });

  const saved = await baseSaveClient(next, ...args);
  const dialog = Array.from(document.querySelectorAll('dialog.client-dialog')).at(-1);
  const form = dialog?.querySelector('form.client-form');
  if (form) enhanceForm(form);
  return saved;
};
