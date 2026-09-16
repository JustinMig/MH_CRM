const digits = (value, max) => String(value || '').replace(/\D/g, '').slice(0, max);
const nameAutoHandled = new WeakSet();

function formatSsn(value) {
  const d = digits(value, 9);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function formatPhone(value) {
  let d = String(value || '').replace(/\D/g, '');
  const hasCountryCode = d.length > 10 && d.startsWith('1');
  d = d.slice(0, hasCountryCode ? 11 : 10);

  if (hasCountryCode) {
    const local = d.slice(1);
    if (local.length <= 3) return `1-${local}`;
    if (local.length <= 6) return `1-${local.slice(0, 3)}-${local.slice(3)}`;
    return `1-${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }

  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

function isSsn(input) {
  return input instanceof HTMLInputElement && input.name === 'ssn';
}

function isPhone(input) {
  if (!(input instanceof HTMLInputElement)) return false;
  if (String(input.type).toLowerCase() === 'tel') return true;
  const name = String(input.name || '').toLowerCase();
  return /(^|_)(phone|phone_number)(_|$)/.test(name) || name.includes('verification_phone');
}

function isClientName(input) {
  return input instanceof HTMLInputElement &&
    (input.name === 'first_name' || input.name === 'last_name') &&
    !!input.closest('form.client-form, dialog.client-dialog');
}

function configure(input) {
  if (isSsn(input)) {
    input.inputMode = 'numeric';
    input.maxLength = 11;
    input.placeholder ||= '###-##-####';
    return;
  }
  if (isPhone(input)) {
    input.inputMode = 'tel';
    input.maxLength = 14;
    if (!input.placeholder || input.placeholder.includes('(')) input.placeholder = '###-###-####';
  }
}

function applyFormat(input) {
  if (!(input instanceof HTMLInputElement)) return;
  let formatted = null;
  if (isSsn(input)) formatted = formatSsn(input.value);
  else if (isPhone(input)) formatted = formatPhone(input.value);
  if (formatted === null || formatted === input.value) return;

  const cursorAtEnd = input.selectionStart == null || input.selectionStart === input.value.length;
  input.value = formatted;
  if (cursorAtEnd) {
    try { input.setSelectionRange(formatted.length, formatted.length); } catch {}
  }
}

function autoCapitalizeName(input) {
  if (!isClientName(input)) return;
  const value = input.value;
  if (!value) {
    nameAutoHandled.delete(input);
    return;
  }
  if (nameAutoHandled.has(input)) return;
  const firstIndex = value.search(/[A-Za-z]/);
  if (firstIndex < 0) return;
  const first = value[firstIndex];
  nameAutoHandled.add(input);
  if (first !== first.toLowerCase()) return;
  const formatted = value.slice(0, firstIndex) + first.toUpperCase() + value.slice(firstIndex + 1);
  const cursor = input.selectionStart;
  input.value = formatted;
  if (cursor != null) {
    try { input.setSelectionRange(cursor, cursor); } catch {}
  }
}

document.addEventListener('focusin', event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (isClientName(input)) {
    // Existing saved names are left exactly as stored. New blank entries are eligible for one-time capitalization.
    if (!input.value) nameAutoHandled.delete(input);
    else nameAutoHandled.add(input);
  }
  if (!isSsn(input) && !isPhone(input)) return;
  configure(input);
  applyFormat(input);
}, true);

document.addEventListener('input', event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (isClientName(input)) autoCapitalizeName(input);
  if (!isSsn(input) && !isPhone(input)) return;
  configure(input);
  applyFormat(input);
}, true);

document.addEventListener('paste', event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (!isSsn(input) && !isPhone(input) && !isClientName(input)) return;
  queueMicrotask(() => {
    if (isClientName(input)) autoCapitalizeName(input);
    if (isSsn(input) || isPhone(input)) {
      configure(input);
      applyFormat(input);
    }
  });
}, true);
