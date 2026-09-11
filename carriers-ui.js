import { supabase } from './supabase-repository.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const route = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
const normalizeUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return ['http:','https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
};

async function listCarriers() {
  const { data, error } = await supabase.rpc('list_my_carriers');
  if (error) throw error;
  return data || [];
}
async function saveCarrier(value) {
  const { data, error } = await supabase.rpc('save_my_carrier', {
    p_id: value.id || null,
    p_carrier_name: value.carrier_name,
    p_site_url: value.site_url,
    p_login_username: value.login_username || null,
    p_login_password: value.login_password
  });
  if (error) throw error;
  return data;
}
async function deleteCarrier(id) {
  const { data, error } = await supabase.rpc('delete_my_carrier', { p_id: id });
  if (error) throw error;
  return data;
}

export function installCarrierVault(root) {
  let token = 0;
  let rendering = false;

  const draw = async (force = false) => {
    if (rendering || route() !== 'carriers') return;
    const content = root.querySelector('.content');
    const heading = content?.querySelector(':scope > .page-heading');
    if (!content || !heading) return;

    // If the Carriers screen is already mounted, do not rebuild it just because
    // something inside the page changed. Rebuilding on every DOM mutation was
    // what caused the navigation to feel like it was sticking.
    if (!force && content.querySelector(':scope > .carrier-vault')) return;

    rendering = true;
    const myToken = ++token;
    Array.from(content.children).forEach(node => { if (node !== heading) node.remove(); });
    const mount = document.createElement('section');
    mount.className = 'carrier-vault';
    mount.innerHTML = `<div class="carrier-toolbar"><div><p>Keep each carrier website and your login details organized in one place.</p><small>Passwords are encrypted in the M&amp;H database and are only available to your signed-in account.</small></div><button type="button" class="btn primary" data-add-carrier>+ Add Carrier</button></div><div class="carrier-status" aria-live="polite">Loading carriers…</div><div class="carrier-grid" data-carrier-grid></div>`;
    content.appendChild(mount);

    const status = mount.querySelector('.carrier-status');
    const grid = mount.querySelector('[data-carrier-grid]');

    const openEditor = (record = {}) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'carrier-dialog';
      const site = record.site_url || '';
      dialog.innerHTML = `<form method="dialog" class="carrier-form"><header><div><h2>${record.id ? 'Edit Carrier' : 'Add Carrier'}</h2><p>${record.id ? 'Update the website or login details.' : 'Add a carrier website and your login details.'}</p></div><button type="button" class="carrier-close" aria-label="Close">×</button></header><div class="carrier-form-body"><input type="hidden" name="id" value="${esc(record.id || '')}"><label>Carrier Name<input name="carrier_name" required autocomplete="organization" value="${esc(record.carrier_name || '')}" placeholder="Example: UnitedHealthcare"></label><label>Carrier Website<input name="site_url" required inputmode="url" autocomplete="url" value="${esc(site)}" placeholder="https://www.carrier.com"></label><label>Username<input name="login_username" autocomplete="username" value="${esc(record.login_username || '')}" placeholder="Your carrier username"></label><label>Password<div class="carrier-password-input"><input name="login_password" type="password" autocomplete="new-password" value="${esc(record.login_password || '')}" placeholder="Your carrier password"><button type="button" data-toggle-password>Show</button></div><small>${record.id ? 'Change it here when your carrier password changes.' : 'Stored encrypted at rest in the M&H database.'}</small></label><div class="carrier-form-error" role="alert" hidden></div></div><footer>${record.id ? '<button type="button" class="btn danger" data-delete-carrier>Delete</button>' : '<span></span>'}<div><button type="button" class="btn secondary" data-cancel>Cancel</button><button type="submit" class="btn primary">Save Carrier</button></div></footer></form>`;
      document.body.appendChild(dialog);
      const form = dialog.querySelector('form');
      const original = new FormData(form);
      const isDirty = () => {
        const now = new FormData(form);
        for (const key of ['carrier_name','site_url','login_username','login_password']) if (String(now.get(key) || '') !== String(original.get(key) || '')) return true;
        return false;
      };
      const close = () => {
        if (isDirty() && !confirm('Discard your unsaved carrier changes?')) return;
        dialog.close();
      };
      dialog.querySelector('.carrier-close').onclick = close;
      dialog.querySelector('[data-cancel]').onclick = close;
      dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
      dialog.addEventListener('close', () => dialog.remove(), { once:true });
      dialog.querySelector('[data-toggle-password]').onclick = e => {
        const input = form.elements.login_password;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        e.currentTarget.textContent = show ? 'Hide' : 'Show';
      };
      const showError = error => {
        const box = dialog.querySelector('.carrier-form-error');
        box.hidden = false;
        box.textContent = error?.message || 'Unable to save this carrier.';
      };
      dialog.querySelector('[data-delete-carrier]')?.addEventListener('click', async () => {
        if (!confirm(`Delete ${record.carrier_name}?`)) return;
        try { await deleteCarrier(record.id); dialog.close(); await draw(true); } catch (error) { showError(error); }
      });
      form.onsubmit = async e => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const url = normalizeUrl(fd.get('site_url'));
        if (!url) { showError(new Error('Enter a valid carrier website.')); return; }
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          await saveCarrier({ id: fd.get('id') || null, carrier_name: String(fd.get('carrier_name') || '').trim(), site_url: url, login_username: String(fd.get('login_username') || '').trim(), login_password: String(fd.get('login_password') ?? '') });
          dialog.close();
          await draw(true);
        } catch (error) { submit.disabled = false; showError(error); }
      };
      dialog.showModal();
      form.elements.carrier_name.focus();
    };

    mount.querySelector('[data-add-carrier]').onclick = () => openEditor();

    try {
      const rows = await listCarriers();
      if (myToken !== token || route() !== 'carriers' || !mount.isConnected) return;
      status.textContent = rows.length ? `${rows.length} carrier${rows.length === 1 ? '' : 's'}` : 'No carriers added yet.';
      grid.innerHTML = rows.length ? rows.map(row => {
        const href = normalizeUrl(row.site_url);
        return `<article class="carrier-card" data-carrier-id="${esc(row.id)}"><div class="carrier-card-head"><div><a class="carrier-name" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(row.carrier_name)}</a><a class="carrier-site" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(row.site_url)}</a></div><button type="button" class="btn secondary" data-edit>Edit</button></div><dl><div><dt>Username</dt><dd><span>${esc(row.login_username || '—')}</span>${row.login_username ? '<button type="button" data-copy="username">Copy</button>' : ''}</dd></div><div><dt>Password</dt><dd><span class="carrier-secret" data-secret>••••••••</span>${row.login_password ? '<button type="button" data-reveal>Show</button><button type="button" data-copy="password">Copy</button>' : '<span>—</span>'}</dd></div></dl><a class="btn primary carrier-open" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Open Carrier Site ↗</a></article>`;
      }).join('') : '<div class="carrier-empty"><h3>No carriers yet</h3><p>Use “Add Carrier” to save your first carrier website and login.</p></div>';
      rows.forEach(row => {
        const card = grid.querySelector(`[data-carrier-id="${CSS.escape(row.id)}"]`);
        card.querySelector('[data-edit]')?.addEventListener('click', () => openEditor(row));
        card.querySelector('[data-reveal]')?.addEventListener('click', e => {
          const secret = card.querySelector('[data-secret]');
          const showing = secret.dataset.showing === 'true';
          secret.textContent = showing ? '••••••••' : (row.login_password || '');
          secret.dataset.showing = String(!showing);
          e.currentTarget.textContent = showing ? 'Show' : 'Hide';
        });
        card.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
          const text = button.dataset.copy === 'password' ? row.login_password : row.login_username;
          if (!text) return;
          try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; setTimeout(() => button.textContent = 'Copy', 1200); } catch { button.textContent = 'Select manually'; }
        }));
      });
    } catch (error) {
      status.textContent = '';
      grid.innerHTML = `<div class="notice error" role="alert">${esc(error?.message || 'Unable to load carriers.')}</div>`;
    } finally { rendering = false; }
  };

  // Workspace navigation replaces the direct children of #app when routes change.
  // Watch only that level so edits inside the Carriers page cannot recursively
  // trigger another full redraw.
  const observer = new MutationObserver(() => {
    if (route() === 'carriers') queueMicrotask(() => draw());
  });
  observer.observe(root, { childList:true });
  window.addEventListener('hashchange', () => queueMicrotask(() => draw()));
  draw();
  return () => observer.disconnect();
}
