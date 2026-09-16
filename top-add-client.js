const root = document.querySelector('#app');
let openClientHandler = null;

function sourceButton() {
  if (!root) return null;
  return Array.from(root.querySelectorAll('[data-add-client]'))
    .find(button => !button.closest('.quick-tools') && !button.hasAttribute('data-top-new-client')) || null;
}

function rememberOpenClient() {
  const source = sourceButton();
  if (source && typeof source.onclick === 'function') openClientHandler = source.onclick;
  return source;
}

function openNewClient(event) {
  const source = rememberOpenClient();
  if (openClientHandler) {
    openClientHandler.call(source || event.currentTarget, event);
    return;
  }

  // Rare fallback: if the CRM opened directly on a screen with no Add Client control,
  // go to Dashboard once, then use the workspace's normal New Client action.
  if (location.hash !== '#/dashboard') location.hash = '#/dashboard';
  setTimeout(() => {
    const dashboardSource = rememberOpenClient();
    if (dashboardSource) dashboardSource.click();
  }, 0);
}

function ensureTopAddClient() {
  if (!root) return;
  rememberOpenClient();
  const quickTools = root.querySelector('.quick-tools');
  if (!quickTools) return;
  if (quickTools.querySelector('[data-top-new-client]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quick-tool';
  button.dataset.topNewClient = 'true';
  button.dataset.addClient = '';
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
