const root = document.querySelector('#app');

function moveAddClientToTop() {
  if (!root) return;
  const quickTools = root.querySelector('.quick-tools');
  const pageButton = root.querySelector('.page-heading [data-add-client]');
  if (!quickTools || !pageButton) return;

  const existing = quickTools.querySelector('[data-add-client]');
  if (existing && existing !== pageButton) {
    pageButton.remove();
    return;
  }

  pageButton.className = 'quick-tool';
  pageButton.title = 'Add Client';
  pageButton.setAttribute('aria-label', 'Add Client');
  pageButton.setAttribute('aria-haspopup', 'dialog');
  pageButton.innerHTML = '<span class="tool-icon tool-client"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 13.2-6.1M19 14v6M16 17h6"/></svg></span><strong>Client</strong>';
  quickTools.insertBefore(pageButton, quickTools.firstChild);
}

if (root) {
  const observer = new MutationObserver(() => queueMicrotask(moveAddClientToTop));
  observer.observe(root, { childList: true, subtree: true });
  moveAddClientToTop();
}
