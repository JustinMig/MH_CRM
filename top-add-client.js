const root = document.querySelector('#app');

function openNewClient() {
  // Use the workspace's own legacy client route. workspace.js intentionally
  // converts #/client to the Clients screen and then opens a fresh client dialog.
  if (location.hash === '#/client') {
    // Force a hashchange even if the user somehow clicks while already on this route.
    history.replaceState(null, '', '#/clients');
  }
  location.hash = '#/client';
}

function ensureTopAddClient() {
  if (!root) return;
  const quickTools = root.querySelector('.quick-tools');
  if (!quickTools) return;
  if (quickTools.querySelector('[data-top-new-client]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quick-tool';
  button.dataset.topNewClient = 'true';
  button.title = 'New Client';
  button.setAttribute('aria-label', 'New Client');
  button.setAttribute('aria-haspopup', 'dialog');
  button.innerHTML = '<span class="tool-icon tool-client"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 13.2-6.1M19 14v6M16 17h6"/></svg></span><strong>New Client</strong>';
  button.addEventListener('click', openNewClient);
  quickTools.insertBefore(button, quickTools.firstChild);
}

if (root) {
  const observer = new MutationObserver(() => queueMicrotask(ensureTopAddClient));
  observer.observe(root, { childList: true, subtree: true });
  ensureTopAddClient();
}
