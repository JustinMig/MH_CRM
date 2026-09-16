// Keeps the Campaigns overview visually stable while campaign data refreshes.
// The campaign feature may briefly replace cards with a loading state; this layer
// preserves the last rendered cards until the refreshed cards are ready.
(() => {
  const HOST = '#campaigns-host';
  let cachedGrid = '';
  let cachedStatus = '';
  let restoring = false;

  function isOverview(host) {
    return !!host?.querySelector('.cmp-titlebar h2') && host.querySelector('.cmp-titlebar h2')?.textContent?.trim() === 'Campaigns';
  }

  function snapshot(host) {
    if (!isOverview(host)) return;
    const grid = host.querySelector('.cmp-campaign-grid');
    if (grid && grid.children.length) {
      cachedGrid = grid.innerHTML;
      cachedStatus = host.querySelector('[data-cmp-list-status]')?.value || '';
    }
  }

  function stabilize(host) {
    if (!host || restoring || !isOverview(host)) return;
    const grid = host.querySelector('.cmp-campaign-grid');
    if (!grid) return;

    if (grid.children.length) {
      snapshot(host);
      host.classList.remove('cmp-is-refreshing');
      return;
    }

    const loading = Array.from(host.querySelectorAll('.cmp-empty')).some(node => /loading campaigns/i.test(node.textContent || ''));
    const status = host.querySelector('[data-cmp-list-status]')?.value || '';
    if (!loading || !cachedGrid || (cachedStatus && status && cachedStatus !== status)) return;

    restoring = true;
    grid.innerHTML = cachedGrid;
    grid.setAttribute('aria-busy', 'true');
    host.classList.add('cmp-is-refreshing');
    requestAnimationFrame(() => { restoring = false; });
  }

  const style = document.createElement('style');
  style.id = 'campaigns-smooth-load-style';
  style.textContent = `
    #campaigns-host{min-height:260px}
    #campaigns-host .cmp-campaign-grid{align-items:stretch;grid-auto-rows:1fr;min-height:188px}
    #campaigns-host .cmp-campaign-card{box-sizing:border-box;min-height:188px;height:100%;transition:border-color .14s ease,background-color .14s ease,box-shadow .14s ease,opacity .12s ease;contain:layout paint}
    #campaigns-host.cmp-is-refreshing .cmp-campaign-grid{opacity:.82}
    #campaigns-host.cmp-is-refreshing .cmp-empty{display:none}
    @media(max-width:620px){#campaigns-host .cmp-campaign-grid{min-height:174px}#campaigns-host .cmp-campaign-card{min-height:174px}}
  `;
  document.head.append(style);

  const observer = new MutationObserver(records => {
    const touched = records.some(record => record.target?.closest?.(HOST) || record.target?.matches?.(HOST));
    if (!touched) return;
    const host = document.querySelector(HOST);
    if (host) stabilize(host);
  });
  observer.observe(document.body, { childList:true, subtree:true });

  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith('#/campaigns')) return;
    requestAnimationFrame(() => {
      const host = document.querySelector(HOST);
      if (host) stabilize(host);
    });
  });
})();
