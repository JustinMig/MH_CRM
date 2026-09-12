function formatLeadDob(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0,2)}/${digits.slice(2)}`;
  return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
}

function bindLeadDob(root = document) {
  root.querySelectorAll?.('.lead-editor-form input[name="date_of_birth"]').forEach(input => {
    if (input.dataset.dobAutoSlash === 'true') return;
    input.dataset.dobAutoSlash = 'true';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('maxlength', '10');
    input.setAttribute('placeholder', 'MM/DD/YYYY');
    input.addEventListener('input', () => {
      const formatted = formatLeadDob(input.value);
      if (input.value !== formatted) input.value = formatted;
    });
  });
}

const app = document.getElementById('app');
if (app) {
  bindLeadDob(app);
  new MutationObserver(mutations => {
    const relevant = mutations.some(m => [...m.addedNodes].some(node =>
      node instanceof Element && (
        node.matches?.('.lead-editor-form, input[name="date_of_birth"]') ||
        node.querySelector?.('.lead-editor-form input[name="date_of_birth"]')
      )
    ));
    if (relevant) queueMicrotask(() => bindLeadDob(app));
  }).observe(app, { childList: true, subtree: true });
}

export { formatLeadDob };
