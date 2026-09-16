document.addEventListener('input', event => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement) || field.name !== 'license_number') return;
  const form = field.closest('form.client-form');
  if (form) form.dataset.auditSensitiveDirty = 'true';
}, true);

document.addEventListener('change', event => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement) || field.name !== 'license_number') return;
  const form = field.closest('form.client-form');
  if (form) form.dataset.auditSensitiveDirty = 'true';
}, true);
