import { esc, snapshot, stable, wireDates } from './core.js';

/** One modal stack, including confirmation dialogs. Keeps the underlying page and scroll intact. */
export class Dialogs {
  constructor() {
    this.stack = [];
    this.sequence = 0;
    this.beforeUnload = e => {
      if (this.stack.some(item => item.isDirty())) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', this.beforeUnload);
  }
  open({ title, hint = '', icon = '', kind = '', body = '', footer = '', onSave = null }) {
    const manager = this;
    const node = document.createElement('dialog');
    const id = `mh-dialog-${++this.sequence}`;
    const invoker = document.activeElement;
    const returnAttribute = ['data-tool', 'data-client-id', 'data-day', 'data-add-client', 'data-new-appointment'].find(key => invoker?.hasAttribute?.(key));
    const returnSelector = returnAttribute ? `[${returnAttribute}="${CSS.escape(invoker.getAttribute(returnAttribute))}"]` : null;
    node.className = `workspace-dialog ${kind}`;
    node.setAttribute('aria-labelledby', `${id}-title`);
    node.setAttribute('aria-modal', 'true');
    node.innerHTML = `<div class="modal-frame"><header class="modal-head"><div class="modal-title">${icon}<div><h2 id="${id}-title" tabindex="-1">${esc(title)}</h2>${hint ? `<p>${esc(hint)}</p>` : ''}</div></div><button type="button" class="modal-close" data-close aria-label="Close ${esc(title)}">×</button></header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}<div class="modal-error" role="alert" tabindex="-1" hidden></div></div>`;
    document.body.append(node);
    let baseline = '', form = null, busy = false, confirming = false, closed = false, pointerOutside = false;
    const controller = {
      node,
      onSave,
      isDirty: () => !!form && baseline !== stable(snapshot(form)),
      attachForm(next) {
        form = next;
        wireDates(form);
        baseline = stable(snapshot(form));
        form.addEventListener('submit', e => { e.preventDefault(); controller.save(false); });
        form.addEventListener('input', updateDirty);
        form.addEventListener('change', updateDirty);
        updateDirty();
      },
      baseline() { if (form) baseline = stable(snapshot(form)); updateDirty(); },
      error(message) {
        const box = node.querySelector('.modal-error');
        box.textContent = message;
        box.hidden = !message;
        if (message) box.focus({ preventScroll: true });
      },
      async save(closeAfter = false) {
        if (busy || closed) return false;
        if (!controller.onSave) return false;
        const invalid = form && Array.from(form.elements).find(el => el.willValidate && !el.checkValidity());
        if (invalid) {
          const panel = invalid.closest('[data-panel]');
          if (panel) node.querySelector(`[data-tab="${panel.dataset.panel}"]`)?.click();
          const detail = invalid.closest('details');
          if (detail) detail.open = true;
          invalid.reportValidity();
          invalid.focus();
          return false;
        }
        busy = true;
        controller.error('');
        if (form) form.inert = true;
        node.querySelectorAll('[data-save], [data-close]').forEach(b => b.disabled = true);
        node.setAttribute('aria-busy', 'true');
        try {
          await controller.onSave(form);
          controller.baseline();
          if (closeAfter) controller.finish();
          else node.querySelector('[data-dirty]')?.replaceChildren(document.createTextNode('Saved'));
          return true;
        } catch (error) {
          controller.error(error instanceof Error ? error.message : 'Save failed. Your changes remain open.');
          return false;
        } finally {
          busy = false;
          if (form) form.inert = false;
          node.removeAttribute('aria-busy');
          node.querySelectorAll('[data-save], [data-close]').forEach(b => b.disabled = false);
        }
      },
      async requestClose() {
        if (busy || confirming || closed) return false;
        if (!controller.isDirty()) { controller.finish(); return true; }
        confirming = true;
        const choice = await manager.confirm();
        confirming = false;
        if (choice === 'discard') { controller.finish(); return true; }
        if (choice === 'save') return controller.save(true);
        return false;
      },
      finish() {
        if (closed) return;
        closed = true;
        node.close();
        node.remove();
        manager.stack = manager.stack.filter(item => item !== controller);
        if (!manager.stack.length) manager.unlock();
        const target = invoker instanceof HTMLElement && invoker.isConnected ? invoker : returnSelector ? document.querySelector(returnSelector) : null;
        target?.focus({ preventScroll: true });
      }
    };
    function updateDirty() {
      const badge = node.querySelector('[data-dirty]');
      if (badge) badge.textContent = controller.isDirty() ? 'Unsaved changes' : 'No changes';
    }
    if (!this.stack.length) this.lock();
    this.stack.push(controller);
    node.addEventListener('cancel', e => { e.preventDefault(); controller.requestClose(); });
    node.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(node.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')).filter(el =>
        el.tabIndex >= 0 && !el.disabled && !el.closest('[inert]') && el.getClientRects().length > 0
      );
      if (!focusable.length) { e.preventDefault(); return; }
      const first = focusable[0], last = focusable.at(-1), current = document.activeElement;
      if (e.shiftKey && (current === first || !focusable.includes(current))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus(); }
    });
    const outside = e => {
      const r = node.getBoundingClientRect();
      return e.target === node && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
    };
    node.addEventListener('pointerdown', e => pointerOutside = outside(e));
    node.addEventListener('pointerup', e => { if (pointerOutside && outside(e)) controller.requestClose(); pointerOutside = false; });
    node.querySelectorAll('[data-close]').forEach(b => b.onclick = () => controller.requestClose());
    node.querySelectorAll('[data-save]').forEach(b => b.onclick = () => controller.save(b.dataset.save === 'close'));
    node.showModal();
    node.querySelector('h2').focus({ preventScroll: true });
    return controller;
  }
  confirm() {
    return new Promise(resolve => {
      const c = this.open({
        title: 'Save your changes?', kind: 'confirm-dialog',
        body: '<p>You have changed information in this window. Would you like to save before closing?</p><p class="subtle">Discard Changes cannot be undone. Keep Editing leaves everything as it is.</p>',
        footer: '<button type="button" class="btn secondary" data-choice="keep" autofocus>Keep Editing</button><button type="button" class="btn danger" data-choice="discard">Discard Changes</button><button type="button" class="btn primary" data-choice="save">Save &amp; Close</button>'
      });
      c.node.setAttribute('role', 'alertdialog');
      let settled = false;
      const choose = value => { if (settled) return; settled = true; c.finish(); resolve(value); };
      c.requestClose = async () => { choose('keep'); return false; };
      c.node.querySelectorAll('[data-choice]').forEach(b => b.onclick = () => choose(b.dataset.choice));
      c.node.querySelector('[data-choice="keep"]').focus();
    });
  }
  async closeAll() {
    while (this.stack.length) if (!await this.stack.at(-1).requestClose()) return false;
    return true;
  }
  lock() {
    this.scroll = { x: window.scrollX, y: window.scrollY, style: document.body.getAttribute('style') };
    Object.assign(document.body.style, { position: 'fixed', top: `-${this.scroll.y}px`, left: '0', width: '100%', overflow: 'hidden' });
  }
  unlock() {
    if (!this.scroll) return;
    if (this.scroll.style === null) document.body.removeAttribute('style');
    else document.body.setAttribute('style', this.scroll.style);
    window.scrollTo(this.scroll.x, this.scroll.y);
    this.scroll = null;
  }
  destroy() {
    [...this.stack].reverse().forEach(item => item.finish());
    window.removeEventListener('beforeunload', this.beforeUnload);
  }
}
