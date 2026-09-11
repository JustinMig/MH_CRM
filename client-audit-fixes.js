import { Dialogs } from './dialogs.js';
import { wireDates } from './core.js';
import { mhRepository, supabase } from './supabase-repository.js';

let pendingClientId = null;
const protectedNames = {
  banking: new Set(['banking_payment_method','banking_bank_name','banking_routing_number','banking_account_number','banking_card_number','banking_card_expiration','banking_card_notes','banking_cvv']),
  credentials: new Set(['medicare_gov_username','medicare_gov_password','medicare_gov_verification_type','medicare_gov_verification_phone','medicare_gov_verification_email','medicare_gov_security_answer']),
  sensitive: new Set(['ssn','medicare_number','medicaid_number'])
};

function currentClientForm() {
  return [...document.querySelectorAll('dialog.client-dialog form.client-form')].reverse().find(form => form.isConnected) || null;
}

function ensureHiddenClientId(form, id) {
  if (!form || !id) return;
  let input = form.elements.namedItem('id');
  if (!(input instanceof HTMLInputElement)) {
    input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'id';
    form.append(input);
  }
  input.value = id;
  const dialog = form.closest('dialog.client-dialog');
  if (dialog) dialog.dataset.clientId = id;
  form.dataset.auditExistingClient = 'true';
}

function queueMarker(form) {
  let marker = form.querySelector('[data-audit-pharmacy-queue-marker]');
  if (!marker) {
    marker = document.createElement('input');
    marker.type = 'hidden';
    marker.name = '_pharmacy_pending_uploads';
    marker.dataset.auditPharmacyQueueMarker = 'true';
    form.append(marker);
  }
  return marker;
}

function markProtectedDirty(form, name) {
  if (!name) return;
  if (protectedNames.banking.has(name) && name !== 'banking_cvv') form.dataset.auditBankingDirty = 'true';
  if (protectedNames.credentials.has(name)) form.dataset.auditCredentialsDirty = 'true';
  if (protectedNames.sensitive.has(name)) form.dataset.auditSensitiveDirty = 'true';
}

document.addEventListener('click', event => {
  const existing = event.target.closest?.('[data-client-id]');
  const add = event.target.closest?.('[data-add-client]');
  if (existing) pendingClientId = existing.dataset.clientId || null;
  else if (add) pendingClientId = null;

  if (event.target.closest?.('[data-add-health-record]')) {
    queueMicrotask(() => {
      const form = currentClientForm();
      if (form) wireDates(form);
    });
  }

  if (event.target.closest?.('[data-pharmacy-queued-remove]')) {
    queueMicrotask(() => {
      const form = currentClientForm();
      if (!form) return;
      const marker = queueMarker(form);
      const remaining = form.querySelectorAll('[data-pharmacy-queued-id]').length;
      marker.value = remaining ? `queued:${remaining}` : '';
      marker.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}, true);

document.addEventListener('change', event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches('[data-pharmacy-files],[data-pharmacy-camera]')) return;
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const form = input.closest('form.client-form');
  if (!form) return;
  const marker = queueMarker(form);
  marker.value = `queued:${Date.now()}:${files.map(file => `${file.name}:${file.size}:${file.lastModified}`).join('|')}`;
  marker.dispatchEvent(new Event('input', { bubbles: true }));
}, true);

const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function auditSafeOpen(options = {}) {
  const clientId = options.kind === 'client-dialog' ? pendingClientId : null;
  if (options.kind === 'client-dialog') pendingClientId = null;
  const controller = originalOpen.call(this, options);
  if (options.kind !== 'client-dialog') return controller;

  const previousAttach = controller.attachForm.bind(controller);
  controller.attachForm = form => {
    form.dataset.auditExistingClient = clientId ? 'true' : 'false';
    form.addEventListener('input', event => markProtectedDirty(form, event.target?.name));
    form.addEventListener('change', event => markProtectedDirty(form, event.target?.name));
    previousAttach(form);
  };
  return controller;
};

const originalInvoke = supabase.functions.invoke.bind(supabase.functions);
supabase.functions.invoke = async function auditSafeInvoke(functionName, options = {}) {
  const body = options?.body || {};
  if (body?.action === 'save' && ['client-banking','medicare-gov-credentials','client-sensitive'].includes(functionName)) {
    const form = currentClientForm();
    const existing = form?.dataset.auditExistingClient === 'true';
    if (existing && form) {
      const dirty = functionName === 'client-banking'
        ? form.dataset.auditBankingDirty === 'true'
        : functionName === 'medicare-gov-credentials'
          ? form.dataset.auditCredentialsDirty === 'true'
          : form.dataset.auditSensitiveDirty === 'true';
      if (!dirty) return { data: { success: true, skipped_unchanged: true }, error: null };
    }
  }
  return originalInvoke(functionName, options);
};

async function hydrateHealthIds(form, clientId) {
  if (!form || !clientId) return;
  const configs = [
    ['doctors','client_doctors'],
    ['medications','client_medications'],
    ['hospital_indemnity','hospital_indemnity_plans']
  ];
  for (const [panelName, table] of configs) {
    const cards = [...form.querySelectorAll(`[data-panel="${panelName}"] [data-health-card]`)];
    const blankCards = cards.filter(card => !String(card.querySelector('input[name$="_id"]')?.value || '').trim());
    if (!blankCards.length) continue;
    const existingIds = new Set(cards.map(card => String(card.querySelector('input[name$="_id"]')?.value || '').trim()).filter(Boolean));
    const { data, error } = await supabase.from(table).select('id,created_at').eq('client_id', clientId).order('created_at', { ascending: true });
    if (error) continue;
    const available = (data || []).filter(row => !existingIds.has(row.id));
    blankCards.forEach((card, index) => {
      const id = available[index]?.id;
      const input = card.querySelector('input[name$="_id"]');
      if (id && input) input.value = id;
    });
  }
}

const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function auditSafeSaveClient(record, ...args) {
  try {
    const saved = await baseSaveClient(record, ...args);
    if (saved?.id) {
      const form = currentClientForm();
      ensureHiddenClientId(form, saved.id);
      await hydrateHealthIds(form, saved.id);
      if (form) {
        const marker = form.querySelector('[data-audit-pharmacy-queue-marker]');
        if (marker && !form.querySelector('[data-pharmacy-queued-id]')) marker.value = '';
        form.dataset.auditBankingDirty = 'false';
        form.dataset.auditCredentialsDirty = 'false';
        form.dataset.auditSensitiveDirty = 'false';
      }
    }
    return saved;
  } catch (error) {
    const id = mhRepository.lastSavedClientId;
    if (id) {
      const form = currentClientForm();
      ensureHiddenClientId(form, id);
      if (form) await hydrateHealthIds(form, id);
      const original = error instanceof Error ? error.message : 'Save failed.';
      throw new Error(`${original} The client record already has ID ${id.slice(0, 8)}…; Retry will continue this same client instead of creating a duplicate.`);
    }
    throw error;
  }
};
