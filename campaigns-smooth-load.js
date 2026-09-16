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
    #campaigns-host{min-height:150px}
    #campaigns-host .cmp-campaign-grid{
      grid-template-columns:repeat(auto-fill,minmax(190px,240px));
      grid-auto-rows:108px;
      align-items:stretch;
      gap:12px;
      min-height:108px;
      justify-content:start;
    }
    #campaigns-host .cmp-campaign-card{
      box-sizing:border-box;
      width:100%;
      height:108px;
      min-height:108px;
      max-height:108px;
      padding:12px 14px;
      gap:5px;
      overflow:hidden;
      border:1px solid var(--line,#213a4d);
      border-radius:14px;
      background:#102331;
      color:#edf4f8;
      box-shadow:none;
      transition:border-color .12s ease,background-color .12s ease,transform .12s ease,opacity .1s ease;
      contain:layout paint;
    }
    #campaigns-host .cmp-campaign-card:hover{
      background:#142a39;
      border-color:#365168;
      transform:translateY(-1px);
    }
    #campaigns-host .cmp-campaign-card>strong{
      font-size:16px;
      line-height:1.15;
      color:#fff;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    #campaigns-host .cmp-campaign-card>span:not(.cmp-kicker):not(.cmp-card-foot){
      display:none;
    }
    #campaigns-host .cmp-campaign-card .cmp-kicker{
      font-size:9px;
      line-height:1.15;
      color:#9aafbe;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    #campaigns-host .cmp-card-foot{
      margin-top:auto;
      padding-top:6px;
      border-top:1px solid #213a4d;
      color:#b8c7d1;
      font-size:10px;
      line-height:1.15;
      white-space:nowrap;
      overflow:hidden;
    }
    #campaigns-host.cmp-is-refreshing .cmp-campaign-grid{opacity:.86}
    #campaigns-host.cmp-is-refreshing .cmp-empty{display:none}
    @media(max-width:620px){
      #campaigns-host{min-height:136px}
      #campaigns-host .cmp-campaign-grid{grid-template-columns:1fr;grid-auto-rows:100px;min-height:100px;gap:8px}
      #campaigns-host .cmp-campaign-card{height:100px;min-height:100px;max-height:100px;padding:11px 12px}
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
