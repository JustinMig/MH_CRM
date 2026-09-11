/* Keep the dashboard month calendar fully inside the visible screen.
   This does not affect the standalone Appointments/calendar view. */
(() => {
  const app = document.querySelector('#app');
  if (!app) return;

  let frame = 0;
  let observedHost = null;
  let hostObserver = null;

  function visibleHeight() {
    const visual = window.visualViewport?.height;
    return Number.isFinite(visual) && visual > 0 ? Math.min(window.innerHeight, visual) : window.innerHeight;
  }

  function findDashboardHost() {
    const hosts = app.querySelectorAll('#calendar-host');
    for (const host of hosts) {
      if (host.nextElementSibling?.classList.contains('metric-grid')) return host;
    }
    return null;
  }

  function fitNow() {
    frame = 0;
    const host = findDashboardHost();

    if (!host) {
      observedHost = null;
      hostObserver?.disconnect();
      hostObserver = null;
      return;
    }

    host.classList.add('dashboard-calendar-host');
    const content = host.closest('.content');
    content?.classList.add('dashboard-fit-content');

    const contentStyle = content ? getComputedStyle(content) : null;
    const bottomPadding = contentStyle ? parseFloat(contentStyle.paddingBottom) || 0 : 0;
    const pageTop = host.getBoundingClientRect().top + window.scrollY;
    const available = Math.max(1, Math.floor(visibleHeight() - pageTop - bottomPadding - 1));
    host.style.setProperty('--dashboard-calendar-fit-height', `${available}px`);

    if (host !== observedHost && 'ResizeObserver' in window) {
      hostObserver?.disconnect();
      observedHost = host;
      hostObserver = new ResizeObserver(scheduleFit);
      const header = app.querySelector('.top');
      const heading = content?.querySelector(':scope > .page-heading');
      const banner = content?.querySelector(':scope > .framework-banner');
      if (header) hostObserver.observe(header);
      if (heading) hostObserver.observe(heading);
      if (banner) hostObserver.observe(banner);
    }
  }

  function scheduleFit() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fitNow);
  }

  new MutationObserver(scheduleFit).observe(app, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleFit, { passive: true });
  window.addEventListener('orientationchange', scheduleFit, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleFit, { passive: true });

  scheduleFit();
})();
