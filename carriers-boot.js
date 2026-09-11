import { installCarrierVault } from './carriers-ui.js';

const root = document.querySelector('#app');
if (root) {
  const currentRoute = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
  let mounting = false;

  const sync = () => {
    const nav = root.querySelector('.nav');
    const carrierLink = nav?.querySelector('a[href="#/carriers"]');
    if (carrierLink) {
      const active = currentRoute() === 'carriers';
      carrierLink.classList.toggle('active', active);
      if (active) carrierLink.setAttribute('aria-current', 'page');
      else carrierLink.removeAttribute('aria-current');
    }

    if (currentRoute() !== 'carriers') return;

    const h1 = root.querySelector('.content > .page-heading h1');
    if (h1) h1.textContent = 'Carriers';
    root.querySelectorAll('.nav a:not([href="#/carriers"])').forEach(a => {
      a.classList.remove('active');
      a.removeAttribute('aria-current');
    });

    if (!mounting && !root.querySelector('.carrier-vault')) {
      mounting = true;
      const cleanup = installCarrierVault(root);
      cleanup();
      queueMicrotask(() => { mounting = false; });
    }
  };

  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('hashchange', sync);
  sync();
}
