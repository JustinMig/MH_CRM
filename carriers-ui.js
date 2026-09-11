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
    p_login_password: value.login_password || ''
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
  let rows = [];
  let loading = false;
  let token = 0;

  function pageMount() {
    if (route() !== 'carriers') return null;
    const content = root.querySelector('.content');
    const heading = content?.querySelector(':scope > .page-heading');
    if (!content || !heading) return null;

    let mount = content.querySelector(':scope > .carrier-vault');
    if (mount) return mount;

    Array.from(content.children).forEach(node => { if (node !== heading) node.remove(); });
    mount = document.createElement('section');
    mount.className = 'carrier-vault';
    mount.innerHTML = `
      <section class="carrier-entry-panel">
        <div class="carrier-section-heading">
          <div>
            <h2>Carrier Login Information</h2>
            <p>Enter the carrier once. After you save it, select it from the drop-down anytime you need the website or login information.</p>
          </div>
        </div>

        <label class="carrier-select-label">
          <span>Saved Carriers</span>
          <select data-carrier-select>
            <option value="">Select a carrier…</option>
          </select>
        </label>

        <form class="carrier-entry-form" autocomplete="off">
          <input type="hidden" name="id">
          <label><span>Carrier Name</span><input name="carrier_name" required placeholder="Example: UnitedHealthcare" autocomplete="organization"></label>
          <label><span>Site Address</span><input name="site_url" required placeholder="https://www.carrier.com" inputmode="url" autocomplete="url"></label>
          <label><span>Username</span><input name="login_username" placeholder="Your username" autocomplete="username"></label>
          <label><span>Password</span><div class="carrier-password-field"><input name="login_password" type="password" placeholder="Your password" autocomplete="new-password"><button type="button" class="btn secondary" data-show-password>Show</button></div></label>
          <div class="carrier-form-message" role="status" aria-live="polite"></div>
          <div class="carrier-form-actions">
            <button type="button" class="btn secondary" data-new-carrier>New / Clear</button>
            <button type="button" class="btn danger" data-delete-carrier hidden>Delete</button>
            <a class="btn secondary carrier-go-site disabled" data-open-site href="#" target="_blank" rel="noopener noreferrer" aria-disabled="true">Go to Carrier Site ↗</a>
            <button type="submit" class="btn primary">Save Carrier</button>
          </div>
        </form>
      </section>

      <section class="carrier-selected-panel" data-selected-panel hidden>
        <h3>Selected Carrier</h3>
        <div class="carrier-selected-grid">
          <div><span>Carrier</span><strong data-selected-name>—</strong></div>
          <div><span>Website</span><a data-selected-site href="#" target="_blank" rel="noopener noreferrer">—</a></div>
          <div><span>Username</span><strong data-selected-username>—</strong></div>
          <div><span>Password</span><strong class="carrier-secret" data-selected-password>••••••••</strong></div>
        </div>
        <div class="carrier-selected-actions">
          <button type="button" class="btn secondary" data-reveal-selected>Show Password</button>
          <a class="btn primary" data-selected-open href="#" target="_blank" rel="noopener noreferrer">Open Carrier Site ↗</a>
        </div>
      </section>
    `;
    content.appendChild(mount);
    bind(mount);
    return mount;
  }

  function bind(mount) {
    if (mount.dataset.bound === 'true') return;
    mount.dataset.bound = 'true';
    const select = mount.querySelector('[data-carrier-select]');
    const form = mount.querySelector('.carrier-entry-form');
    const message = mount.querySelector('.carrier-form-message');
    const deleteButton = mount.querySelector('[data-delete-carrier]');
    const openSite = mount.querySelector('[data-open-site]');
    const selectedPanel = mount.querySelector('[data-selected-panel]');

    const setMessage = (text = '', error = false) => {
      message.textContent = text;
      message.classList.toggle('error', error);
    };

    const setSiteLink = value => {
      const href = normalizeUrl(value);
      openSite.href = href || '#';
      openSite.setAttribute('aria-disabled', String(!href));
      openSite.classList.toggle('disabled', !href);
      return href;
    };

    const refreshDropdown = (selectedId = '') => {
      select.innerHTML = '<option value="">Select a carrier…</option>' + rows.map(row => `<option value="${esc(row.id)}"${String(row.id) === String(selectedId) ? ' selected' : ''}>${esc(row.carrier_name)}</option>`).join('');
    };

    const clearForm = () => {
      form.reset();
      form.elements.id.value = '';
      select.value = '';
      deleteButton.hidden = true;
      selectedPanel.hidden = true;
      setSiteLink('');
      setMessage('Ready for a new carrier.');
    };

    const fillSelected = row => {
      if (!row) { clearForm(); return; }
      form.elements.id.value = row.id || '';
      form.elements.carrier_name.value = row.carrier_name || '';
      form.elements.site_url.value = row.site_url || '';
      form.elements.login_username.value = row.login_username || '';
      form.elements.login_password.value = row.login_password || '';
      form.elements.login_password.type = 'password';
      mount.querySelector('[data-show-password]').textContent = 'Show';
      deleteButton.hidden = false;
      const href = setSiteLink(row.site_url);

      selectedPanel.hidden = false;
      selectedPanel.querySelector('[data-selected-name]').textContent = row.carrier_name || '—';
      const site = selectedPanel.querySelector('[data-selected-site]');
      site.textContent = row.site_url || '—';
      site.href = href || '#';
      selectedPanel.querySelector('[data-selected-username]').textContent = row.login_username || '—';
      const pass = selectedPanel.querySelector('[data-selected-password]');
      pass.textContent = row.login_password ? '••••••••' : '—';
      pass.dataset.revealed = 'false';
      mount.querySelector('[data-reveal-selected]').textContent = 'Show Password';
      const selectedOpen = mount.querySelector('[data-selected-open]');
      selectedOpen.href = href || '#';
      selectedOpen.classList.toggle('disabled', !href);
      selectedOpen.setAttribute('aria-disabled', String(!href));
      setMessage(`Loaded ${row.carrier_name}. Edit any field and press Save Carrier to update it.`);
    };

    select.addEventListener('change', () => {
      const row = rows.find(item => String(item.id) === String(select.value));
      fillSelected(row || null);
    });

    form.elements.site_url.addEventListener('input', e => setSiteLink(e.target.value));
    mount.querySelector('[data-show-password]').addEventListener('click', e => {
      const input = form.elements.login_password;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      e.currentTarget.textContent = showing ? 'Show' : 'Hide';
    });
    mount.querySelector('[data-new-carrier]').addEventListener('click', () => {
      clearForm();
      form.elements.carrier_name.focus();
    });
    openSite.addEventListener('click', e => { if (!normalizeUrl(form.elements.site_url.value)) e.preventDefault(); });

    mount.querySelector('[data-reveal-selected]').addEventListener('click', e => {
      const row = rows.find(item => String(item.id) === String(select.value));
      if (!row?.login_password) return;
      const pass = selectedPanel.querySelector('[data-selected-password]');
      const revealed = pass.dataset.revealed === 'true';
      pass.textContent = revealed ? '••••••••' : row.login_password;
      pass.dataset.revealed = String(!revealed);
      e.currentTarget.textContent = revealed ? 'Show Password' : 'Hide Password';
    });

    deleteButton.addEventListener('click', async () => {
      const id = form.elements.id.value;
      const row = rows.find(item => String(item.id) === String(id));
      if (!id || !row) return;
      if (!confirm(`Delete ${row.carrier_name}?`)) return;
      deleteButton.disabled = true;
      try {
        await deleteCarrier(id);
        rows = rows.filter(item => String(item.id) !== String(id));
        refreshDropdown();
        clearForm();
        setMessage(`${row.carrier_name} was deleted.`);
      } catch (error) {
        setMessage(error?.message || 'Unable to delete this carrier.', true);
      } finally { deleteButton.disabled = false; }
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const site = normalizeUrl(fd.get('site_url'));
      if (!site) { setMessage('Enter a valid carrier site address.', true); return; }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      setMessage('Saving…');
      try {
        const savedId = await saveCarrier({
          id: fd.get('id') || null,
          carrier_name: String(fd.get('carrier_name') || '').trim(),
          site_url: site,
          login_username: String(fd.get('login_username') || '').trim(),
          login_password: String(fd.get('login_password') || '')
        });
        await load(savedId || fd.get('id') || '');
        setMessage('Carrier saved.');
      } catch (error) {
        setMessage(error?.message || 'Unable to save this carrier.', true);
      } finally { submit.disabled = false; }
    });

    async function load(preferredId = '') {
      if (loading) return;
      loading = true;
      const request = ++token;
      setMessage('Loading saved carriers…');
      try {
        const data = await listCarriers();
        if (request !== token || route() !== 'carriers' || !mount.isConnected) return;
        rows = data;
        const keepId = preferredId && rows.some(row => String(row.id) === String(preferredId)) ? preferredId : '';
        refreshDropdown(keepId);
        if (keepId) fillSelected(rows.find(row => String(row.id) === String(keepId)));
        else {
          clearForm();
          setMessage(rows.length ? `${rows.length} saved carrier${rows.length === 1 ? '' : 's'}. Select one from the drop-down or add a new carrier.` : 'No saved carriers yet. Enter the carrier information above and press Save Carrier.');
        }
      } catch (error) {
        setMessage(error?.message || 'Unable to load saved carriers.', true);
      } finally { loading = false; }
    }

    load();
  }

  const sync = () => {
    if (route() !== 'carriers') return;
    pageMount();
  };

  const observer = new MutationObserver(sync);
  observer.observe(root, { childList:true });
  window.addEventListener('hashchange', () => queueMicrotask(sync));
  sync();
  return () => observer.disconnect();
}
