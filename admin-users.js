export function installAdminUsers(root, repository) {
  let busy = false;

  async function mount() {
    if (!root?.isConnected || location.hash.replace(/^#\/?/, '') !== 'agents') return;
    const content = root.querySelector('.content');
    if (!content || content.querySelector('[data-mh-user-admin]')) return;

    const role = String(repository.profile?.role || '').toLowerCase();
    const isOwner = repository.profile?.active && role === 'owner';
    const section = document.createElement('section');
    section.className = 'panel-card dark-card mh-user-admin';
    section.dataset.mhUserAdmin = 'true';

    if (!isOwner) {
      section.innerHTML = '<h2>User Access</h2><p class="muted">User activation and deactivation are controlled by the CRM Owner.</p>';
      content.append(section);
      return;
    }

    section.innerHTML = `
      <div class="mh-user-admin-head">
        <div>
          <h2>User Access</h2>
          <p class="muted">Create a full-access username and password, then deactivate the user when their work is finished. Their history remains, but CRM access stops.</p>
        </div>
        <span class="tag mh-admin-tag">Owner controlled</span>
      </div>
      <form class="mh-invite-form" data-invite-form>
        <label><span>Full Name</span><input name="full_name" autocomplete="name" required></label>
        <label><span>Username</span><input name="username" autocomplete="off" minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]{3,40}" placeholder="Example: sheena" required></label>
        <label><span>Password</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <label><span>Access</span><input value="Full Access" disabled></label>
        <button type="submit" class="btn primary">Create Full-Access User</button>
      </form>
      <div class="mh-invite-status" data-invite-status aria-live="polite"></div>
      <div class="mh-user-list" data-user-list><p class="muted">Loading users…</p></div>`;
    content.append(section);

    const form = section.querySelector('[data-invite-form]');
    const status = section.querySelector('[data-invite-status]');
    const list = section.querySelector('[data-user-list]');

    async function changeAccess(button) {
      if (busy) return;
      const userId = button.dataset.userId;
      const nextActive = button.dataset.nextActive === 'true';
      const name = button.dataset.userName || 'this user';
      const action = nextActive ? 'reactivate' : 'deactivate';
      if (!window.confirm(`${action[0].toUpperCase() + action.slice(1)} ${name}?\n\n${nextActive ? 'They will regain full CRM access.' : 'They will immediately lose CRM access, but their history and records will remain.'}`)) return;
      busy = true;
      button.disabled = true;
      status.textContent = `${nextActive ? 'Reactivating' : 'Deactivating'} ${name}…`;
      try {
        const result = await repository.setUserActive(userId, nextActive);
        status.textContent = result?.message || `${name} updated.`;
        await loadUsers();
      } catch (error) {
        status.textContent = error.message || `Unable to ${action} this user.`;
      } finally {
        busy = false;
      }
    }

    async function loadUsers() {
      try {
        const users = await repository.listUsers();
        list.innerHTML = users.length ? users.map(user => {
          const owner = String(user.role || '').toLowerCase() === 'owner';
          const current = user.id === repository.user?.id;
          const accessLabel = owner ? 'Owner' : String(user.role || '').toLowerCase() === 'admin' ? 'Full Access' : (user.role || 'User');
          const username = user.username ? `<small>Username: ${escapeHtml(user.username)}</small>` : '';
          const action = owner || current ? '' : `<button type="button" class="btn ${user.active ? 'danger' : 'secondary'}" data-user-access data-user-id="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.full_name || 'CRM User')}" data-next-active="${user.active ? 'false' : 'true'}">${user.active ? 'Deactivate' : 'Reactivate'}</button>`;
          return `
            <article class="mh-user-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <div><strong>${escapeHtml(user.full_name || 'CRM User')}</strong>${username}<small>${escapeHtml(accessLabel)}</small></div>
              <div style="display:flex;align-items:center;gap:8px">
                <span class="tag ${user.active ? 'mh-active' : ''}">${user.active ? 'Active' : 'Inactive'}</span>
                ${action}
              </div>
            </article>`;
        }).join('') : '<p class="muted">No users found.</p>';
        list.querySelectorAll('[data-user-access]').forEach(button => button.addEventListener('click', () => void changeAccess(button)));
      } catch (error) {
        list.innerHTML = `<div class="notice error">${escapeHtml(error.message || 'Unable to load users.')}</div>`;
      }
    }

    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      status.textContent = 'Creating full-access username and password…';
      try {
        const values = Object.fromEntries(new FormData(form));
        const result = await repository.createCredentialUser(values);
        status.textContent = result?.message || 'Full-access user created.';
        form.reset();
        await loadUsers();
      } catch (error) {
        status.textContent = error.message || 'Unable to create this user.';
      } finally {
        busy = false;
        button.disabled = false;
      }
    };

    await loadUsers();
  }

  const onHashChange = () => setTimeout(() => void mount(), 0);
  window.addEventListener('hashchange', onHashChange);
  void mount();
  return () => window.removeEventListener('hashchange', onHashChange);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
