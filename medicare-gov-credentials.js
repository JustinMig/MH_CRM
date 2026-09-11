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

async function invokeSecureFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || {};
}

const credentialRequest = body => invokeSecureFunction('medicare-gov-credentials', body);
const sensitiveRequest = body => invokeSecureFunction('client-sensitive', body);

function setValue(form, name, value) {
  const field = form.elements.namedItem(name);
  if (field) field.value = value == null ? '' : String(value);
}

function applyCredentials(form, c) {
  if (!c) return false;
  setValue(form, 'medicare_gov_username', c.username);
  setValue(form, 'medicare_gov_password', c.password);
  setValue(form, 'medicare_gov_verification_type', c.verification_type);
  setValue(form, 'medicare_gov_security_answer', c.security_answer);
  if (c.verification_type === 'text') setValue(form, 'medicare_gov_verification_phone', c.verification_destination);
  if (c.verification_type === 'email') setValue(form, 'medicare_gov_verification_email', c.verification_destination);
  setVerificationVisibility(form, false);
  return true;
}

function applySensitive(form, sensitive) {
  if (!sensitive) return false;
  setValue(form, 'ssn', sensitive.ssn);
  setValue(form, 'medicare_number', sensitive.medicare_number);
  setValue(form, 'medicaid_number', sensitive.medicaid_number);
  return true;
}

async function loadSecureClientData(form, clientId) {
  setCredentialStatus(form, 'Loading encrypted client information…');
  const [credentialsResult, sensitiveResult] = await Promise.allSettled([
    credentialRequest({ action: 'get', client_id: clientId }),
    sensitiveRequest({ action: 'get', client_id: clientId }),
  ]);

  let credentialsLoaded = false;
  let sensitiveLoaded = false;
  const errors = [];

  if (credentialsResult.status === 'fulfilled') credentialsLoaded = applyCredentials(form, credentialsResult.value.credentials || null);
  else errors.push(credentialsResult.reason?.message || 'Medicare.gov credentials could not be loaded.');

  if (sensitiveResult.status === 'fulfilled') sensitiveLoaded = applySensitive(form, sensitiveResult.value.sensitive || null);
  else errors.push(sensitiveResult.reason?.message || 'Sensitive client identifiers could not be loaded.');

  if (errors.length) {
    setCredentialStatus(form, errors.join(' '), true);
  } else if (credentialsLoaded || sensitiveLoaded) {
    setCredentialStatus(form, 'Encrypted client identifiers and Medicare.gov credentials loaded securely.');
  } else {
    setCredentialStatus(form, 'No encrypted Medicare.gov credentials are saved for this client.');
  }
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

function sensitiveFromRecord(record = {}) {
  return {
    ssn: String(record.ssn || '').trim(),
    medicare_number: String(record.medicare_number || '').trim(),
    medicaid_number: String(record.medicaid_number || '').trim(),
  };
}

function hasCredentialData(c) {
  return !!(c.username || c.password || c.verification_type || c.verification_destination || c.security_answer);
}

function hasSensitiveData(s) {
  return !!(s.ssn || s.medicare_number || s.medicaid_number);
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
    loadSecureClientData(form, dialogClientId)
      .catch(error => setCredentialStatus(form, error?.message || 'Unable to load encrypted client information.', true))
      .finally(() => {
        previousAttachForm(form);
        form.inert = false;
        controller.node.querySelectorAll('[data-save]').forEach(button => button.disabled = false);
      });
  };
  return controller;
};

const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function saveClientWithSecureData(record, ...args) {
  const credentials = credentialsFromRecord(record);
  const sensitive = sensitiveFromRecord(record);
  const saved = await baseSaveClient(record, ...args);
  if (!saved?.id) return saved;

  const tasks = [];
  const labels = [];
  if (record?.id || hasCredentialData(credentials)) {
    tasks.push(credentialRequest({ action: 'save', client_id: saved.id, credentials }));
    labels.push('Medicare.gov credentials');
  }
  if (record?.id || hasSensitiveData(sensitive)) {
    tasks.push(sensitiveRequest({ action: 'save', client_id: saved.id, sensitive }));
    labels.push('sensitive identifiers');
  }
  if (!tasks.length) return saved;

  const results = await Promise.allSettled(tasks);
  const failures = results
    .map((result, index) => result.status === 'rejected' ? `${labels[index]}: ${result.reason?.message || 'save failed'}` : '')
    .filter(Boolean);

  const dialog = Array.from(document.querySelectorAll('dialog.client-dialog')).at(-1);
  const form = dialog?.querySelector('form.client-form');
  if (failures.length) {
    if (form) setCredentialStatus(form, failures.join(' '), true);
    throw new Error(`Client information saved, but protected data needs to be retried: ${failures.join(' ')}`);
  }

  if (form) setCredentialStatus(form, 'Sensitive identifiers and Medicare.gov credentials saved with encrypted secure storage.');
  return saved;
};
