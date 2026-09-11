import { installCarrierVault } from './carriers-ui.js';

const root = document.querySelector('#app');
if (root) {
  installCarrierVault(root);

  const currentRoute = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
  const sync = () => {
    const nav = root.querySelector('.nav');
    if (nav && !nav.querySelector('a[href="#/carriers"]')) {
      const link = document.createElement('a');
      link.href = '#/carriers';
      link.textContent = 'Carriers';
      const admin = nav.querySelector('a[href="#/agents"]');
      nav.insertBefore(link, admin || null);
    }
    const carrierLink = nav?.querySelector('a[href="#/carriers"]');
    if (carrierLink) {
      const active = currentRoute() === 'carriers';
      carrierLink.classList.toggle('active', active);
      if (active) carrierLink.setAttribute('aria-current', 'page');
      else carrierLink.removeAttribute('aria-current');
    }
    if (currentRoute() === 'carriers') {
      const h1 = root.querySelector('.content > .page-heading h1');
      if (h1) h1.textContent = 'Carriers';
      root.querySelectorAll('.nav a:not([href="#/carriers"])').forEach(a => {
        a.classList.remove('active');
        a.removeAttribute('aria-current');
      });
    }
  };

  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('hashchange', sync);
  sync();
}
