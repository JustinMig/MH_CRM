const LIFE_CARRIERS = [
  'American Amicable',
  'Mutual of Omaha',
  'Physicians Mutual',
  'CiCa/Citizen',
  'CoreBridge',
  'Gerber',
  'TransAmerica',
  'Aflac'
];

function replaceLifeCarrierField(scope = document) {
  scope.querySelectorAll?.('dialog.client-dialog input[name="life_carrier"]').forEach(input => {
    if (input.dataset.carrierDropdownReady === 'true') return;

    const current = String(input.value || '').trim();
    const select = document.createElement('select');
    select.name = 'life_carrier';
    select.dataset.carrierDropdownReady = 'true';
    select.setAttribute('aria-label', 'Life Insurance Carrier');

    const choices = ['', ...LIFE_CARRIERS];
    if (current && !LIFE_CARRIERS.includes(current)) choices.push(current);

    choices.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value || 'Select…';
      if (value === current) option.selected = true;
      select.append(option);
    });

    input.replaceWith(select);
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const observer = new MutationObserver(mutations => {
  const scopes = new Set();
  for (const mutation of mutations) {
    if (mutation.target instanceof Element) {
      const dialog = mutation.target.closest?.('dialog.client-dialog');
      if (dialog) scopes.add(dialog);
    }
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const dialog = node.matches?.('dialog.client-dialog') ? node : node.closest?.('dialog.client-dialog');
      if (dialog) scopes.add(dialog);
      node.querySelectorAll?.('dialog.client-dialog').forEach(item => scopes.add(item));
    }
  }
  scopes.forEach(replaceLifeCarrierField);
});

observer.observe(document.body, { childList: true, subtree: true });
replaceLifeCarrierField();
