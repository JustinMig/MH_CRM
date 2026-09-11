import { Dialogs } from './dialogs.js';
import { mhRepository, supabase } from './supabase-repository.js';

let pendingClientId = null;

function groupBySummary(panel, title) {
  return Array.from(panel.querySelectorAll('details.field-group'))
    .find(group => group.querySelector(':scope > summary')?.textContent.trim() === title) || null;
}

function moveSocialIntoPersonal(form) {
  const information = form.querySelector('[data-panel="information"]');
  if (!information) return;
  const personal = groupBySummary(information, 'Personal & Contact Information');
  const ssn = form.elements.namedItem('ssn');
  const ssnField = ssn?.closest?.('label.field');
  if (!personal || !ssnField) return;
  const grid = personal.querySelector(':scope > .form-grid');
  if (!grid || ssnField.parentElement === grid) return;
  const phoneField = form.elements.namedItem('phone')?.closest?.('label.field');
  if (phoneField?.parentElement === grid) phoneField.insertAdjacentElement('afterend', ssnField);
  else grid.append(ssnField);
}

function credentialMarkup() {
  return `<section class="medicare-gov-credentials span-all" data-medicare-gov-credentials>
    <div class="medicare-gov-heading">
      <div><strong>Medicare.gov Login Credentials</strong><span>Encrypted secure storage</span></div>
      <span class="secure-badge" aria-label="Stored encrypted">SECURE</span>
    </div>
    <div class="medicare-gov-grid">
      <label class="field"><span>Username</span><input name="medicare_gov_username" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <label class="field"><span>Password</span><input name="medicare_gov_password" type="password" autocomplete="new-password"></label>
      <label class="field"><span>Verification Type</span><select name="medicare_gov_verification_type"><option value="">Select…</option><option value="text">Text</option><option value="email">Email</option></select></label>
      <label class="field" data-verification-field="text" hidden><span>Verification Phone Number</span><input name="medicare_gov_verification_phone" type="tel" placeholder="(###) ###-####"></label>
      <label class="field" data-verification-field="email" hidden><span>Verification Email</span><input name="medicare_gov_verification_email" type="email" inputmode="email"></label>
      <label class="field span-all"><span>Security Answer</span><input name="medicare_gov_security_answer" type="password" autocomplete="new-password"></label>
    </div>
    <div class="medicare-gov-status" data-medicare-gov-status role="status" aria-live="polite">Credentials are encrypted when saved.</div>
  </section>`;
}

function setVerificationVisibility(form, clearInactive = false) {
  const type = String(form.elements.namedItem('medicare_gov_verification_type')?.value || '');
  const phoneField = form.querySelector('[data-verification-field="text"]');
  const emailField = form.querySelector('[data-verification-field="email"]');
  if (phoneField) phoneField.hidden = type !== 'text';
  if (emailField) emailField.hidden = type !== 'email';
  if (clearInactive) {
    if (type === 'text') {
      const email = form.elements.namedItem('medicare_gov_verification_email');
      if (email?.value) { email.value = ''; email.dispatchEvent(new Event('input', { bubbles: true })); }
    } else if (type === 'email') {
      const phone = form.elements.namedItem('medicare_gov_verification_phone');
      if (phone?.value) { phone.value = ''; phone.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  }
}

function enhanceCredentialForm(form) {
  if (!(form instanceof HTMLFormElement)) return;
  moveSocialIntoPersonal(form);
  if (form.querySelector('[data-medicare-gov-credentials]')) return;
  const panel = form.querySelector('[data-panel="medicare"]');
  const medicare = panel ? groupBySummary(panel, 'Medicare Information') : null;
  const grid = medicare?.querySelector(':scope > .form-grid');
  if (!grid) return;
  const holder = document.createElement('div');
  holder.innerHTML = credentialMarkup();
  grid.append(holder.firstElementChild);
  const type = form.elements.namedItem('medicare_gov_verification_type');
  type?.addEventListener('change', () => setVerificationVisibility(form, true));
  setVerificationVisibility(form, false);
}

function setCredentialStatus(form, text, error = false) {
  const status = form.querySelector('[data-medicare-gov-status]');
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('error', error);
}

async function credentialRequest(body) {
  const { data, error } = await supabase.functions.invoke('medicare-gov-credentials', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || {};
}

async function loadCredentials(form, clientId) {
  setCredentialStatus(form, 'Loading encrypted Medicare.gov credentials…');
  const data = await credentialRequest({ action: 'get', client_id: clientId });
  const c = data.credentials || null;
  if (!c) {
    setCredentialStatus(form, 'No Medicare.gov credentials saved for this client.');
    return;
  }
  const set = (name, value) => {
    const field = form.elements.namedItem(name);
    if (field) field.value = value == null ? '' : String(value);
  };
  set('medicare_gov_username', c.username);
  set('medicare_gov_password', c.password);
  set('medicare_gov_verification_type', c.verification_type);
  set('medicare_gov_security_answer', c.security_answer);
  if (c.verification_type === 'text') set('medicare_gov_verification_phone', c.verification_destination);
  if (c.verification_type === 'email') set('medicare_gov_verification_email', c.verification_destination);
  setVerificationVisibility(form, false);
  setCredentialStatus(form, 'Encrypted Medicare.gov credentials loaded securely.');
}

function credentialsFromRecord(record = {}) {
  const type = String(record.medicare_gov_verification_type || '').toLowerCase();
  const destination = type === 'text'
    ? String(record.medicare_gov_verification_phone || '').trim()
    : type === 'email'
      ? String(record.medicare_gov_verification_email || '').trim()
      : '';
  return {
    username: String(record.medicare_gov_username || '').trim(),
    password: String(record.medicare_gov_password || ''),
    verification_type: type,
    verification_destination: destination,
    security_answer: String(record.medicare_gov_security_answer || ''),
  };
}

function hasCredentialData(c) {
  return !!(c.username || c.password || c.verification_type || c.verification_destination || c.security_answer);
}

document.addEventListener('click', event => {
  const existing = event.target.closest?.('[data-client-id]');
  const add = event.target.closest?.('[data-add-client]');
  if (existing) pendingClientId = existing.dataset.clientId || null;
  else if (add) pendingClientId = null;
}, true);

const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function patchedMedicareCredentialsOpen(options = {}) {
  const dialogClientId = options.kind === 'client-dialog' ? pendingClientId : null;
  if (options.kind === 'client-dialog') pendingClientId = null;
  const controller = originalOpen.call(this, options);
  if (options.kind !== 'client-dialog') return controller;

  const previousAttachForm = controller.attachForm.bind(controller);
  controller.attachForm = form => {
    enhanceCredentialForm(form);
    if (!dialogClientId) {
      previousAttachForm(form);
      return;
    }

    form.inert = true;
    controller.node.querySelectorAll('[data-save]').forEach(button => button.disabled = true);
    loadCredentials(form, dialogClientId)
      .catch(error => setCredentialStatus(form, error?.message || 'Unable to load Medicare.gov credentials.', true))
      .finally(() => {
        previousAttachForm(form);
        form.inert = false;
        controller.node.querySelectorAll('[data-save]').forEach(button => button.disabled = false);
      });
  };
  return controller;
};

const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function saveClientWithMedicareCredentials(record, ...args) {
  const credentials = credentialsFromRecord(record);
  const saved = await baseSaveClient(record, ...args);
  if (!saved?.id || !hasCredentialData(credentials)) return saved;
  try {
    await credentialRequest({ action: 'save', client_id: saved.id, credentials });
    const dialog = Array.from(document.querySelectorAll('dialog.client-dialog')).at(-1);
    const form = dialog?.querySelector('form.client-form');
    if (form) setCredentialStatus(form, 'Medicare.gov credentials saved with encrypted secure storage.');
  } catch (error) {
    throw new Error(`Client information saved, but the Medicare.gov credentials were not saved securely: ${error?.message || 'Please retry.'}`);
  }
  return saved;
};
