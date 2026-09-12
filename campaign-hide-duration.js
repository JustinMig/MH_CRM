function removeDuration(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('campaign-contact-dialog')) return;
  const duration = dialog.querySelector('select[name="duration"]');
  if (!duration || duration.dataset.cmpDurationHidden === 'true') return;
  duration.dataset.cmpDurationHidden = 'true';
  duration.value = '30';
  const label = duration.closest('label.field');
  if (label) label.remove();
}

function enhance(scope = document) {
  if (scope instanceof HTMLDialogElement) removeDuration(scope);
  scope.querySelectorAll?.('dialog.campaign-contact-dialog').forEach(removeDuration);
}

new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('dialog.campaign-contact-dialog') || node.querySelector?.('dialog.campaign-contact-dialog')) {
        queueMicrotask(() => enhance(node));
      }
    }
  }
}).observe(document.body, { childList: true, subtree: true });

enhance();
