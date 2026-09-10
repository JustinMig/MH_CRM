export function installPullToRefresh() {
  const isiPhone = /iPhone/i.test(navigator.userAgent);
  if (!isiPhone || !('ontouchstart' in window)) return;

  const indicator = document.createElement('div');
  indicator.className = 'mh-pull-refresh';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.innerHTML = '<span class="mh-pull-refresh-spinner">↻</span><strong>Pull to refresh</strong>';
  document.body.append(indicator);

  let startY = 0;
  let pulling = false;
  let ready = false;
  let active = false;
  const threshold = 78;
  const maxPull = 118;

  const atTop = () => window.scrollY <= 0 && !document.querySelector('dialog[open]');

  window.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || !atTop()) return;
    startY = event.touches[0].clientY;
    pulling = true;
    ready = false;
  }, { passive: true });

  window.addEventListener('touchmove', event => {
    if (!pulling || active || event.touches.length !== 1) return;
    const distance = event.touches[0].clientY - startY;
    if (distance <= 0 || !atTop()) {
      pulling = false;
      indicator.classList.remove('show', 'ready');
      indicator.style.setProperty('--pull', '0px');
      return;
    }

    const pull = Math.min(maxPull, distance * 0.58);
    ready = distance >= threshold;
    indicator.classList.add('show');
    indicator.classList.toggle('ready', ready);
    indicator.querySelector('strong').textContent = ready ? 'Release to refresh' : 'Pull to refresh';
    indicator.style.setProperty('--pull', `${pull}px`);
  }, { passive: true });

  const finish = () => {
    if (!pulling || active) return;
    pulling = false;
    if (!ready) {
      indicator.classList.remove('show', 'ready');
      indicator.style.setProperty('--pull', '0px');
      return;
    }
    active = true;
    indicator.classList.add('refreshing');
    indicator.querySelector('strong').textContent = 'Refreshing…';
    indicator.style.setProperty('--pull', '58px');
    window.setTimeout(() => location.reload(), 180);
  };

  window.addEventListener('touchend', finish, { passive: true });
  window.addEventListener('touchcancel', () => {
    pulling = false;
    ready = false;
    indicator.classList.remove('show', 'ready');
    indicator.style.setProperty('--pull', '0px');
  }, { passive: true });

  const style = document.createElement('style');
  style.textContent = `
    .mh-pull-refresh{position:fixed;z-index:5000;left:50%;top:calc(env(safe-area-inset-top) + 8px);transform:translate(-50%,calc(-68px + var(--pull,0px)));display:flex;align-items:center;gap:8px;min-height:42px;padding:8px 13px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:rgba(9,23,34,.94);color:#edf4f8;box-shadow:0 8px 24px rgba(0,0,0,.22);opacity:0;pointer-events:none;transition:opacity .12s ease,transform .12s ease;font:inherit}
    .mh-pull-refresh.show{opacity:1}.mh-pull-refresh.ready{background:rgba(16,44,62,.97)}
    .mh-pull-refresh strong{font-size:12px;white-space:nowrap}.mh-pull-refresh-spinner{font-size:20px;line-height:1;transition:transform .18s ease}
    .mh-pull-refresh.ready .mh-pull-refresh-spinner{transform:rotate(180deg)}
    .mh-pull-refresh.refreshing .mh-pull-refresh-spinner{animation:mh-spin .7s linear infinite}
    @keyframes mh-spin{to{transform:rotate(360deg)}}
  `;
  document.head.append(style);
}
