export function installFastNavigation(root) {
  if (!(root instanceof HTMLElement) || root.dataset.fastNavigationInstalled === 'true') return;

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!descriptor?.get || !descriptor?.set) return;

  Object.defineProperty(root, 'innerHTML', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() { return descriptor.get.call(this); },
    set(value) {
      const markup = String(value ?? '');
      const currentShell = this.querySelector(':scope > .shell');

      // The workspace router historically rebuilt the entire application shell
      // for every hash route. Preserve the stable chrome (sidebar/top bar/tools)
      // and only swap the page content once the authenticated shell exists.
      if (currentShell && markup.startsWith('<div class="shell">')) {
        const template = document.createElement('template');
        template.innerHTML = markup;
        const nextShell = template.content.querySelector('.shell');
        const nextContent = nextShell?.querySelector('.content');
        const currentContent = currentShell.querySelector('.content');

        if (nextContent && currentContent) {
          currentContent.replaceChildren(...Array.from(nextContent.childNodes));

          const nextLinks = new Map(
            Array.from(nextShell.querySelectorAll('.nav a[href]')).map(link => [link.getAttribute('href'), link])
          );
          currentShell.querySelectorAll('.nav a[href]').forEach(link => {
            const next = nextLinks.get(link.getAttribute('href'));
            const active = Boolean(next?.classList.contains('active'));
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
          });

          // Close mobile navigation immediately after a route switch.
          currentShell.querySelector('.sidebar')?.classList.remove('open');
          const shade = currentShell.querySelector('.sidebar-shade');
          if (shade) shade.hidden = true;
          currentShell.querySelector('.menu-toggle')?.setAttribute('aria-expanded', 'false');
          return;
        }
      }

      descriptor.set.call(this, markup);
    }
  });

  root.dataset.fastNavigationInstalled = 'true';
}
