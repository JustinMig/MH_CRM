const markAndCollapse = scope => {
  const host = scope instanceof Element || scope instanceof Document ? scope : document;
  host.querySelectorAll?.('.client-dialog details.field-group:not([data-initial-collapse])').forEach(group => {
    group.open = false;
    group.dataset.initialCollapse = 'true';
  });
};

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    if (mutation.type !== 'childList' || !mutation.addedNodes.length) continue;
    mutation.addedNodes.forEach(node => {
      if (!(node instanceof Element)) return;
      if (node.matches('.client-dialog, .client-dialog *') || node.querySelector?.('.client-dialog')) {
        markAndCollapse(node.matches('.client-dialog') ? node : document);
      }
    });
  }
});

observer.observe(document.body, { childList: true, subtree: true });
markAndCollapse(document);
