export function installDashboardCleanup(root) {
  const clean = () => {
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    if (hash !== 'dashboard') return;
    root.querySelector('.metric-grid')?.remove();
    root.querySelectorAll('.panel-card.dark-card').forEach(section => {
      if (section.querySelector('h2')?.textContent?.trim() === 'Quick Actions') section.remove();
    });
  };
  const observer = new MutationObserver(clean);
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('hashchange', clean);
  clean();
  return () => { observer.disconnect(); window.removeEventListener('hashchange', clean); };
}
