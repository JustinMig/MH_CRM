export function installAppointmentSingleAgent(root, repository) {
  const toISO = value => {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
  };
  const toDisplay = value => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
  };

  function enhance(form) {
    if (!form?.isConnected || form.dataset.singleAgentAppointment === 'true') return;
    form.dataset.singleAgentAppointment = 'true';

    // M&H is currently a single-agent setup. Remove the visible selector;
    // saveEvent automatically assigns the signed-in user when this value is absent.
    const agent = form.elements.namedItem('assigned_agent_id');
    if (agent) {
      const field = agent.closest('.field');
      if (field) field.remove();
      else agent.remove();
    }

    // Replace the appointment's manual date input with the device/browser
    // native calendar picker while preserving the CRM's existing save format.
    const rawDate = form.elements.namedItem('event_date');
    if (!rawDate || rawDate.dataset.nativeCalendar === 'true') return;
    rawDate.dataset.nativeCalendar = 'true';

    const initial = toISO(rawDate.value);
    const field = rawDate.closest('.field');
    rawDate.type = 'hidden';
    rawDate.hidden = true;
    rawDate.required = false;

    const picker = document.createElement('input');
    picker.type = 'date';
    picker.required = true;
    picker.value = initial;
    picker.className = 'appointment-native-date';
    picker.setAttribute('aria-label', 'Appointment Date');
    picker.setAttribute('name', 'appointment_date_picker');
    rawDate.insertAdjacentElement('afterend', picker);

    // Keep the original label around the new picker so it still reads
    // Appointment Date and retains the same layout.
    if (field) field.classList.add('appointment-date-field');

    const sync = () => {
      rawDate.value = toDisplay(picker.value);
      rawDate.dispatchEvent(new Event('input', { bubbles: true }));
      rawDate.dispatchEvent(new Event('change', { bubbles: true }));
    };
    picker.addEventListener('change', sync);
    picker.addEventListener('input', sync);
  }

  const scan = () => {
    // Dialogs are appended to document.body, not inside #app/root.
    document.querySelectorAll('form.appointment-form').forEach(form => {
      if (form.dataset.singleAgentAppointmentScheduled === 'true') return;
      form.dataset.singleAgentAppointmentScheduled = 'true';
      setTimeout(() => enhance(form), 0);
    });
  };

  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
}
