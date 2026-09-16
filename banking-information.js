import { Dialogs } from './dialogs.js';
import { mhRepository, supabase } from './supabase-repository.js';

let pendingClientId = null;

function beginBackgroundLoad(form, controller) {
  const count = Number(form.dataset.clientBackgroundLoads || '0') + 1;
  form.dataset.clientBackgroundLoads = String(count);
  controller.node.querySelectorAll('[data-save]').forEach(button => button.disabled = true);
}

function endBackgroundLoad(form, controller) {
  const count = Math.max(0, Number(form.dataset.clientBackgroundLoads || '0') - 1);
  if (count) form.dataset.clientBackgroundLoads = String(count);
  else {
    delete form.dataset.clientBackgroundLoads;
    controller.node.querySelectorAll('[data-save]').forEach(button => button.disabled = false);
  }
  controller.baseline?.();
}

function bySummary(panel, title) {
  return Array.from(panel.querySelectorAll('details.field-group'))
    .find(group => group.querySelector(':scope > summary')?.textContent.trim() === title) || null;
}

function accountMethodPanel(method, label) {
  return `<section class="banking-method-panel span-all" data-banking-panel="${method}" hidden>
    <div class="banking-panel-grid">
      <label class="field span-all"><span>Account Name</span><input name="banking_${method}_account_name" autocomplete="off"></label>
      <label class="field"><span>Routing Number</span><input name="banking_${method}_routing_number" inputmode="numeric" autocomplete="off" maxlength="12"></label>
      <label class="field"><span>Account Number</span><input name="banking_${method}_account_number" autocomplete="off" maxlength="64"></label>
      <label class="field span-all"><span>Notes</span><textarea name="banking_${method}_notes" rows="4" maxlength="4000" placeholder="Enter notes about this ${label} payment method..."></textarea></label>
    </div>
  </section>`;
}

function markup() {
  return `<details class="field-group client-banking-group" data-client-banking-group>
    <summary>Banking Information</summary>
    <div class="form-grid">
      <label class="field span-all banking-method-field">
        <span>Payment Method</span>
        <select name="banking_payment_method">
          <option value="">Select…</option>
          <option value="bank">Bank</option>
          <option value="card">Credit/Debit</option>
          <option value="cashapp">CashApp</option>
          <option value="chime">Chime</option>
          <option value="other">Other</option>
          <option value="direct_express">Direct Express</option>
          <option value="mail_in">Direct Notice / Mail In</option>
        </select>
      </label>

      <section class="banking-method-panel span-all" data-banking-panel="bank" hidden>
        <div class="banking-panel-grid">
          <label class="field"><span>Bank Name</span><input name="banking_bank_name" autocomplete="off"></label>
          <label class="field"><span>Routing Number</span><input name="banking_routing_number" inputmode="numeric" autocomplete="off" maxlength="12"></label>
          <label class="field span-all"><span>Account Number</span><input name="banking_account_number" inputmode="numeric" autocomplete="off" maxlength="34"></label>
        </div>
      </section>

      <section class="banking-method-panel span-all" data-banking-panel="card" hidden>
        <div class="banking-panel-grid">
          <label class="field span-all"><span>Card Number</span><input name="banking_card_number" inputmode="numeric" autocomplete="off" maxlength="23"></label>
          <label class="field"><span>CVV <small>(not saved)</small></span><input name="banking_cvv" inputmode="numeric" autocomplete="off" maxlength="4"></label>
          <label class="field"><span>Expiration Date</span><input name="banking_card_expiration" inputmode="numeric" autocomplete="off" placeholder="MM/YY" maxlength="7"></label>
          <label class="field span-all banking-card-notes-field"><span>Card Notes</span><textarea name="banking_card_notes" rows="4" maxlength="4000" placeholder="Enter notes about this card or payment method..."></textarea></label>
        </div>
        <p class="banking-cvv-note">For card security, CVV stays visible while you are entering it but is never stored in the CRM.</p>
      </section>

      ${accountMethodPanel('cashapp', 'CashApp')}
      ${accountMethodPanel('chime', 'Chime')}
      ${accountMethodPanel('other', 'Other')}

      <section class="banking-method-panel span-all" data-banking-panel="direct_express" hidden>
        <div class="banking-panel-grid">
          <label class="field span-all"><span>Card Number</span><input name="banking_direct_express_card_number" inputmode="numeric" autocomplete="off" maxlength="23"></label>
          <label class="field"><span>Expiration Date</span><input name="banking_direct_express_expiration" inputmode="numeric" autocomplete="off" placeholder="MM/YY" maxlength="7"></label>
          <label class="field span-all"><span>Notes</span><textarea name="banking_direct_express_notes" rows="4" maxlength="4000" placeholder="Enter notes about this Direct Express card..."></textarea></label>
        </div>
      </section>

      <section class="banking-method-panel banking-mail-panel span-all" data-banking-panel="mail_in" hidden>
        <strong>Customer is mailing in their payment each month.</strong>
      </section>

      <div class="banking-status span-all" data-banking-status role="status" aria-live="polite">Banking information is stored encrypted when saved.</div>
    </div>
  </details>`;
}

function showMethod(form) {
  const method = String(form.elements.namedItem('banking_payment_method')?.value || '');
  form.querySelectorAll('[data-banking-panel]').forEach(panel => {
    panel.hidden = panel.dataset.bankingPanel !== method;
  });
}

function formatCard(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 19);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiration(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function digitsOnly(input, max = 12) {
  if (!input) return;
  input.addEventListener('input', () => {
    input.value = String(input.value || '').replace(/\D/g, '').slice(0, max);
  });
}

function wireCard(input) {
  input?.addEventListener('input', () => {
    const next = formatCard(input.value);
    if (input.value !== next) input.value = next;
  });
}

function wireExpiration(input) {
  input?.addEventListener('input', () => {
    const next = formatExpiration(input.value);
    if (input.value !== next) input.value = next;
  });
}

function enhance(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const panel = form.querySelector('[data-panel="information"]');
  if (!panel || form.querySelector('[data-client-banking-group]')) return;

  const holder = document.createElement('div');
  holder.innerHTML = markup();
  const group = holder.firstElementChild;
  const identification = bySummary(panel, 'Identification');
  const personal = bySummary(panel, 'Personal & Contact Information');
  if (identification) identification.insertAdjacentElement('afterend', group);
  else if (personal) personal.insertAdjacentElement('afterend', group);
  else panel.append(group);

  const method = form.elements.namedItem('banking_payment_method');
  method?.addEventListener('change', () => showMethod(form));

  wireCard(form.elements.namedItem('banking_card_number'));
  wireExpiration(form.elements.namedItem('banking_card_expiration'));
  wireCard(form.elements.namedItem('banking_direct_express_card_number'));
  wireExpiration(form.elements.namedItem('banking_direct_express_expiration'));

  const cvv = form.elements.namedItem('banking_cvv');
  cvv?.addEventListener('input', () => {
    cvv.value = String(cvv.value || '').replace(/\D/g, '').slice(0, 4);
  });

  digitsOnly(form.elements.namedItem('banking_routing_number'));
  digitsOnly(form.elements.namedItem('banking_cashapp_routing_number'));
  digitsOnly(form.elements.namedItem('banking_chime_routing_number'));
  digitsOnly(form.elements.namedItem('banking_other_routing_number'));

  showMethod(form);
}

function status(form, text, error = false) {
  const node = form.querySelector('[data-banking-status]');
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('error', error);
}

async function request(body) {
  const { data, error } = await supabase.functions.invoke('client-banking', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || {};
}

function set(form, name, value) {
  const field = form.elements.namedItem(name);
  if (field) field.value = value == null ? '' : String(value);
}

function apply(form, banking) {
  if (!banking) {
    status(form, 'No banking information is saved for this client.');
    return;
  }
  const method = String(banking.payment_method || '');
  set(form, 'banking_payment_method', method);
  set(form, 'banking_bank_name', banking.bank_name);
  set(form, 'banking_routing_number', banking.routing_number);
  set(form, 'banking_account_number', banking.account_number);
  set(form, 'banking_card_number', method === 'card' ? formatCard(banking.card_number) : '');
  set(form, 'banking_card_expiration', method === 'card' ? banking.card_expiration : '');
  set(form, 'banking_card_notes', method === 'card' ? banking.card_notes : '');
  set(form, 'banking_cvv', '');

  for (const accountMethod of ['cashapp','chime','other']) {
    set(form, `banking_${accountMethod}_account_name`, method === accountMethod ? banking.account_name : '');
    set(form, `banking_${accountMethod}_routing_number`, method === accountMethod ? banking.routing_number : '');
    set(form, `banking_${accountMethod}_account_number`, method === accountMethod ? banking.account_number : '');
    set(form, `banking_${accountMethod}_notes`, method === accountMethod ? banking.payment_notes : '');
  }

  set(form, 'banking_direct_express_card_number', method === 'direct_express' ? formatCard(banking.card_number) : '');
  set(form, 'banking_direct_express_expiration', method === 'direct_express' ? banking.card_expiration : '');
  set(form, 'banking_direct_express_notes', method === 'direct_express' ? banking.card_notes : '');

  showMethod(form);
  status(form, 'Encrypted banking information loaded securely. CVV is never stored.');
}

async function load(form, clientId) {
  status(form, 'Loading encrypted banking information…');
  const data = await request({ action: 'get', client_id: clientId });
  apply(form, data.banking || null);
}

function fromRecord(record = {}) {
  const method = String(record.banking_payment_method || '').toLowerCase();
  const accountPrefix = ['cashapp','chime','other'].includes(method) ? `banking_${method}_` : '';
  return {
    payment_method: method,
    bank_name: String(record.banking_bank_name || '').trim(),
    account_name: accountPrefix ? String(record[`${accountPrefix}account_name`] || '').trim() : '',
    routing_number: String(accountPrefix ? record[`${accountPrefix}routing_number`] : record.banking_routing_number || '').replace(/\D/g, ''),
    account_number: String(accountPrefix ? record[`${accountPrefix}account_number`] : record.banking_account_number || '').replace(/[^0-9A-Za-z]/g, ''),
    payment_notes: accountPrefix ? String(record[`${accountPrefix}notes`] || '').slice(0, 4000) : '',
    card_number: String(method === 'direct_express' ? record.banking_direct_express_card_number : record.banking_card_number || '').replace(/\D/g, ''),
    card_expiration: String(method === 'direct_express' ? record.banking_direct_express_expiration : record.banking_card_expiration || '').trim(),
    card_notes: String(method === 'direct_express' ? record.banking_direct_express_notes : record.banking_card_notes || '').slice(0, 4000),
  };
}

function hasData(data) {
  return !!(data.payment_method || data.bank_name || data.account_name || data.routing_number || data.account_number || data.payment_notes || data.card_number || data.card_expiration || data.card_notes);
}

document.addEventListener('click', event => {
  const existing = event.target.closest?.('[data-client-id]');
  const add = event.target.closest?.('[data-add-client]');
  if (existing) pendingClientId = existing.dataset.clientId || null;
  else if (add) pendingClientId = null;
}, true);

const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function patchedBankingOpen(options = {}) {
  const dialogClientId = options.kind === 'client-dialog' ? pendingClientId : null;
  if (options.kind === 'client-dialog') pendingClientId = null;
  const controller = originalOpen.call(this, options);
  if (options.kind !== 'client-dialog') return controller;

  const previousAttachForm = controller.attachForm.bind(controller);
  controller.attachForm = form => {
    enhance(form);
    previousAttachForm(form);
    if (!dialogClientId) return;

    beginBackgroundLoad(form, controller);
    load(form, dialogClientId)
      .catch(error => status(form, error?.message || 'Unable to load banking information.', true))
      .finally(() => endBackgroundLoad(form, controller));
  };
  return controller;
};

const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function saveClientWithBanking(record, ...args) {
  const banking = fromRecord(record);
  const saved = await baseSaveClient(record, ...args);
  if (!saved?.id) return saved;

  if (!record?.id && !hasData(banking)) return saved;

  try {
    await request({ action: 'save', client_id: saved.id, banking });
    const dialog = Array.from(document.querySelectorAll('dialog.client-dialog')).at(-1);
    const form = dialog?.querySelector('form.client-form');
    if (form) status(form, 'Banking information saved with encrypted secure storage. CVV was not stored.');
  } catch (error) {
    throw new Error(`Client information saved, but banking information needs to be retried: ${error?.message || 'Please retry.'}`);
  }

  return saved;
};
