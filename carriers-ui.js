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
  return Array.isArray(data) ? data : [];
}

async function saveCarrier(value) {
  const { data, error } = await supabase.rpc('save_my_carrier', {
    p_id: value.id || null,
    p_carrier_name: value.carrier_name,
    p_site_url: value.site_url,
    p_login_username: value.login_username || null,
    p_login_password: value.login_password ?? ''
  });
  if (error) throw error;
  return String(data || value.id || '');
}

async function deleteCarrier(id) {
  const { data, error } = await supabase.rpc('delete_my_carrier', { p_id: id });
  if (error) throw error;
  return data;
}

export function installCarrierVault(root) {
  let rows = [];

  function mountPage() {
    if (route() !== 'carriers') return;
    const content = root.querySelector('.content');
    const heading = content?.querySelector(':scope > .page-heading');
    if (!content || !heading) return;
    if (content.querySelector(':scope > .carrier-vault')) return;

    Array.from(content.children).forEach(node => { if (node !== heading) node.remove(); });
    const mount = document.createElement('section');
    mount.className = 'carrier-vault';
    mount.innerHTML = `
      <section class="carrier-add-panel">
        <div class="carrier-section-heading compact">
          <div>
            <h2>Add Carrier</h2>
            <p>Save a carrier website and login.</p>
          </div>
        </div>
        <form class="carrier-add-form" autocomplete="off">
          <label><span>Carrier Name</span><input name="carrier_name" required placeholder="Carrier name" autocomplete="organization"></label>
          <label><span>Site Address</span><input name="site_url" required placeholder="https://carrier.com" inputmode="url" autocomplete="url"></label>
          <label><span>Username</span><input name="login_username" placeholder="Username" autocomplete="username"></label>
          <label><span>Password</span><div class="carrier-password-field"><input name="login_password" type="password" placeholder="Password" autocomplete="new-password"><button type="button" class="btn secondary" data-add-show-password>Show</button></div></label>
          <div class="carrier-add-actions"><div class="carrier-form-message" data-add-message role="status" aria-live="polite"></div><button type="submit" class="btn primary">Save Carrier</button></div>
        </form>
      </section>

      <section class="carrier-saved-panel">
        <div class="carrier-section-heading">
          <div>
            <h2>Saved Carriers</h2>
            <p>Select a carrier to view or edit its information.</p>
          </div>
          <small data-carrier-count></small>
        </div>
        <div class="carrier-saved-select-row">
          <select data-carrier-select aria-label="Saved Carriers"><option value="">Loading saved carriers…</option></select>
          <button type="button" class="btn secondary" data-refresh-carriers>Refresh</button>
        </div>
        <div class="carrier-list-message" data-list-message role="status" aria-live="polite"></div>
      </section>`;

    content.appendChild(mount);
    bind(mount);
  }

  function bind(mount) {
    const addForm = mount.querySelector('.carrier-add-form');
    const addMessage = mount.querySelector('[data-add-message]');
    const select = mount.querySelector('[data-carrier-select]');
    const count = mount.querySelector('[data-carrier-count]');
    const listMessage = mount.querySelector('[data-list-message]');
    const addSubmit = addForm.querySelector('button[type="submit"]');

    const setAddMessage = (text = '', error = false) => {
      addMessage.textContent = text;
      addMessage.classList.toggle('error', error);
    };
    const setListMessage = (text = '', error = false) => {
      listMessage.textContent = text;
      listMessage.classList.toggle('error', error);
    };

    const renderDropdown = () => {
      select.innerHTML = '<option value="">Select a saved carrier…</option>' + rows.map(row => `<option value="${esc(row.id)}">${esc(row.carrier_name)}</option>`).join('');
      select.value = '';
      count.textContent = `${rows.length} saved carrier${rows.length === 1 ? '' : 's'}`;
    };

    async function loadCarriers() {
      select.disabled = true;
      setListMessage('Loading saved carriers…');
      try {
        rows = await listCarriers();
        if (!mount.isConnected || route() !== 'carriers') return;
        renderDropdown();
        setListMessage(rows.length ? 'Choose a carrier from the drop-down.' : 'No saved carriers yet.');
      } catch (error) {
        rows = [];
        renderDropdown();
        setListMessage(error?.message || 'Unable to load saved carriers.', true);
      } finally {
        select.disabled = false;
      }
    }

    const openCarrierEditor = record => {
      const dialog = document.createElement('dialog');
      dialog.className = 'carrier-edit-dialog';
      const href = normalizeUrl(record.site_url);
      dialog.innerHTML = `
        <form class="carrier-edit-form" method="dialog" autocomplete="off">
          <header>
            <div><h2>${esc(record.carrier_name || 'Carrier')}</h2><p>View or edit this saved carrier.</p></div>
            <button type="button" class="carrier-dialog-close" data-close aria-label="Close">×</button>
          </header>
          <div class="carrier-edit-body">
            <input type="hidden" name="id" value="${esc(record.id || '')}">
            <label><span>Carrier Name</span><input name="carrier_name" required value="${esc(record.carrier_name || '')}"></label>
            <label><span>Site Address</span><input name="site_url" required inputmode="url" value="${esc(record.site_url || '')}"></label>
            <label><span>Username</span><input name="login_username" autocomplete="username" value="${esc(record.login_username || '')}"></label>
            <label><span>Password</span><div class="carrier-password-field"><input name="login_password" type="password" autocomplete="new-password" value="${esc(record.login_password || '')}"><button type="button" class="btn secondary" data-edit-show-password>Show</button></div></label>
            <div class="carrier-form-message" data-edit-message role="alert"></div>
          </div>
          <footer>
            <button type="button" class="btn danger" data-delete>Delete</button>
            <div class="carrier-dialog-actions">
              <a class="btn secondary${href ? '' : ' disabled'}" data-dialog-site href="${esc(href || '#')}" target="_blank" rel="noopener noreferrer" aria-disabled="${String(!href)}">Go to Site ↗</a>
              <button type="button" class="btn secondary" data-close>Close</button>
              <button type="submit" class="btn primary">Save Changes</button>
            </div>
          </footer>
        </form>`;
      document.body.appendChild(dialog);

      const form = dialog.querySelector('form');
      const message = dialog.querySelector('[data-edit-message]');
      const submit = form.querySelector('button[type="submit"]');
      const deleteButton = dialog.querySelector('[data-delete]');
      const siteLink = dialog.querySelector('[data-dialog-site]');

      const setEditMessage = (text = '', error = false) => {
        message.textContent = text;
        message.classList.toggle('error', error);
      };
      const updateSiteLink = () => {
        const nextHref = normalizeUrl(form.elements.site_url.value);
        siteLink.href = nextHref || '#';
        siteLink.classList.toggle('disabled', !nextHref);
        siteLink.setAttribute('aria-disabled', String(!nextHref));
      };
      const close = () => dialog.close();

      dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
      dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
      dialog.addEventListener('close', () => { dialog.remove(); select.value = ''; }, { once: true });
      form.elements.site_url.addEventListener('input', updateSiteLink);
      siteLink.addEventListener('click', e => { if (!normalizeUrl(form.elements.site_url.value)) e.preventDefault(); });

      dialog.querySelector('[data-edit-show-password]').addEventListener('click', e => {
        const input = form.elements.login_password;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        e.currentTarget.textContent = showing ? 'Show' : 'Hide';
      });

      deleteButton.addEventListener('click', async () => {
        if (!confirm(`Delete ${record.carrier_name}?`)) return;
        deleteButton.disabled = true;
        setEditMessage('Deleting…');
        try {
          await deleteCarrier(record.id);
          dialog.close();
          await loadCarriers();
          setListMessage(`${record.carrier_name} deleted.`);
        } catch (error) {
          deleteButton.disabled = false;
          setEditMessage(error?.message || 'Unable to delete this carrier.', true);
        }
      });

      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const site = normalizeUrl(fd.get('site_url'));
        if (!site) { setEditMessage('Enter a valid carrier site address.', true); return; }
        submit.disabled = true;
        setEditMessage('Saving changes…');
        try {
          await saveCarrier({
            id: String(fd.get('id') || ''),
            carrier_name: String(fd.get('carrier_name') || '').trim(),
            site_url: site,
            login_username: String(fd.get('login_username') || '').trim(),
            login_password: String(fd.get('login_password') || '')
          });
          dialog.close();
          await loadCarriers();
          setListMessage('Carrier updated successfully.');
        } catch (error) {
          submit.disabled = false;
          setEditMessage(error?.message || 'Unable to update this carrier.', true);
        }
      });

      dialog.showModal();
    };

    mount.querySelector('[data-add-show-password]').addEventListener('click', e => {
      const input = addForm.elements.login_password;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      e.currentTarget.textContent = showing ? 'Show' : 'Hide';
    });

    addForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (!addForm.reportValidity()) return;
      const fd = new FormData(addForm);
      const site = normalizeUrl(fd.get('site_url'));
      if (!site) { setAddMessage('Enter a valid carrier site address.', true); return; }
      addSubmit.disabled = true;
      setAddMessage('Saving…');
      try {
        await saveCarrier({
          carrier_name: String(fd.get('carrier_name') || '').trim(),
          site_url: site,
          login_username: String(fd.get('login_username') || '').trim(),
          login_password: String(fd.get('login_password') || '')
        });
        addForm.reset();
        addForm.elements.login_password.type = 'password';
        mount.querySelector('[data-add-show-password]').textContent = 'Show';
        await loadCarriers();
        setAddMessage('Carrier saved.');
      } catch (error) {
        setAddMessage(error?.message || 'Unable to save this carrier.', true);
      } finally {
        addSubmit.disabled = false;
      }
    });

    select.addEventListener('change', () => {
      const record = rows.find(row => String(row.id) === String(select.value));
      if (record) openCarrierEditor(record);
    });

    mount.querySelector('[data-refresh-carriers]').addEventListener('click', loadCarriers);
    loadCarriers();
  }

  const onHash = () => queueMicrotask(mountPage);
  window.addEventListener('hashchange', onHash);
  mountPage();
  return () => window.removeEventListener('hashchange', onHash);
}
