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
    #campaigns-host{min-height:190px}
    #campaigns-host .cmp-campaign-grid{
      grid-template-columns:repeat(auto-fill,minmax(220px,260px));
      grid-auto-rows:132px;
      align-items:stretch;
      gap:10px;
      min-height:132px;
      justify-content:start;
    }
    #campaigns-host .cmp-campaign-card{
      box-sizing:border-box;
      width:100%;
      height:132px;
      min-height:132px;
      max-height:132px;
      padding:12px 14px;
      gap:6px;
      overflow:hidden;
      transition:border-color .12s ease,background-color .12s ease,box-shadow .12s ease,opacity .1s ease;
      contain:layout paint;
    }
    #campaigns-host .cmp-campaign-card>strong{
      font-size:15px;
      line-height:1.2;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    #campaigns-host .cmp-campaign-card>span:not(.cmp-kicker):not(.cmp-card-foot){
      font-size:11px;
      line-height:1.3;
      display:-webkit-box;
      -webkit-line-clamp:2;
      -webkit-box-orient:vertical;
      overflow:hidden;
    }
    #campaigns-host .cmp-campaign-card .cmp-kicker{font-size:9px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #campaigns-host .cmp-card-foot{padding-top:7px;font-size:10px;line-height:1.2;white-space:nowrap;overflow:hidden}
    #campaigns-host.cmp-is-refreshing .cmp-campaign-grid{opacity:.84}
    #campaigns-host.cmp-is-refreshing .cmp-empty{display:none}
    @media(max-width:620px){
      #campaigns-host{min-height:168px}
      #campaigns-host .cmp-campaign-grid{grid-template-columns:1fr;grid-auto-rows:124px;min-height:124px;gap:8px}
      #campaigns-host .cmp-campaign-card{height:124px;min-height:124px;max-height:124px;padding:10px 12px}
    }
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
