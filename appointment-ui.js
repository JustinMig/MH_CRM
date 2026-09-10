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

    // Current M&H setup has one agent. The repository assigns the signed-in
    // user automatically when this field is absent, so remove the selector.
    const agent = form.elements.namedItem('assigned_agent_id');
    if (agent) agent.closest('.field')?.remove();

    // Keep the CRM's existing MM/DD/YYYY field internally so its save/date
    // validation code stays unchanged, while showing a native calendar picker.
    const rawDate = form.elements.namedItem('event_date');
    if (!rawDate || rawDate.dataset.nativeCalendar === 'true') return;
    rawDate.dataset.nativeCalendar = 'true';

    const initial = toISO(rawDate.value);
    rawDate.type = 'hidden';
    rawDate.hidden = true;

    const picker = document.createElement('input');
    picker.type = 'date';
    picker.required = true;
    picker.value = initial;
    picker.className = 'appointment-native-date';
    picker.setAttribute('aria-label', 'Appointment Date');
    rawDate.insertAdjacentElement('afterend', picker);

    picker.addEventListener('change', () => {
      rawDate.value = toDisplay(picker.value);
      rawDate.dispatchEvent(new Event('input', { bubbles: true }));
      rawDate.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  const scan = () => {
    root.querySelectorAll('form.appointment-form').forEach(form => {
      if (form.dataset.singleAgentAppointmentScheduled === 'true') return;
      form.dataset.singleAgentAppointmentScheduled = 'true';
      // Let the appointment builder finish setting its default date and
      // attaching validation listeners before replacing the visible control.
      setTimeout(() => enhance(form), 0);
    });
  };

  scan();
  new MutationObserver(scan).observe(root, { childList: true, subtree: true });
}
