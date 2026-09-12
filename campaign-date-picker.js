function manualToIso(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  const month = Number(match[1]), day = Number(match[2]), year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoToManual(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : '';
}

function centralToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function setManualValue(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function enhanceDialog(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('campaign-contact-dialog')) return;
  const form = dialog.querySelector('form.cmp-form');
  const manual = form?.elements.namedItem('event_date');
  if (!(manual instanceof HTMLInputElement) || manual.dataset.cmpCalendarSource === 'true') return;

  manual.dataset.cmpCalendarSource = 'true';
  manual.hidden = true;
  manual.setAttribute('aria-hidden', 'true');
  manual.tabIndex = -1;

  const picker = document.createElement('input');
  picker.type = 'date';
  picker.className = `${manual.className} cmp-calendar-date-picker`;
  picker.value = manualToIso(manual.value);
  picker.min = centralToday();
  picker.setAttribute('aria-label', 'Appointment or follow-up date');
  picker.autocomplete = 'off';
  manual.insertAdjacentElement('afterend', picker);

  picker.addEventListener('input', () => setManualValue(manual, isoToManual(picker.value)));
  picker.addEventListener('change', () => setManualValue(manual, isoToManual(picker.value)));

  manual.addEventListener('input', () => {
    const iso = manualToIso(manual.value);
    if (iso && picker.value !== iso) picker.value = iso;
  });
}

function enhanceScope(scope = document) {
  if (scope instanceof HTMLDialogElement) enhanceDialog(scope);
  scope.querySelectorAll?.('dialog.campaign-contact-dialog').forEach(enhanceDialog);
}

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('dialog.campaign-contact-dialog') || node.querySelector?.('dialog.campaign-contact-dialog')) {
        queueMicrotask(() => enhanceScope(node));
      }
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });
enhanceScope();
