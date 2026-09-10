export function installAdminUsers(root, repository) {
  let busy = false;

  async function mount() {
    if (!root?.isConnected || location.hash.replace(/^#\/?/, '') !== 'agents') return;
    const content = root.querySelector('.content');
    if (!content || content.querySelector('[data-mh-user-admin]')) return;

    const role = String(repository.profile?.role || '').toLowerCase();
    const canManage = repository.profile?.active && (role === 'owner' || role === 'admin');
    const section = document.createElement('section');
    section.className = 'panel-card dark-card mh-user-admin';
    section.dataset.mhUserAdmin = 'true';

    if (!canManage) {
      section.innerHTML = '<h2>User Accounts</h2><p class="muted">Only an Owner or Admin can add M&H CRM users.</p>';
      content.append(section);
      return;
    }

    section.innerHTML = `
      <div class="mh-user-admin-head">
        <div><h2>User Accounts</h2><p class="muted">Only people you invite can receive an M&H CRM account.</p></div>
        <span class="tag mh-admin-tag">Owner/Admin controlled</span>
      </div>
      <form class="mh-invite-form" data-invite-form>
        <label><span>Full Name</span><input name="full_name" autocomplete="name" required></label>
        <label><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
        <label><span>Role</span><select name="role"><option value="agent">Agent</option><option value="assistant">Assistant</option><option value="admin">Admin</option></select></label>
        <button type="submit" class="btn primary">Send Invite</button>
      </form>
      <div class="mh-invite-status" data-invite-status aria-live="polite"></div>
      <div class="mh-user-list" data-user-list><p class="muted">Loading users…</p></div>`;
    content.append(section);

    const form = section.querySelector('[data-invite-form]');
    const status = section.querySelector('[data-invite-status]');
    const list = section.querySelector('[data-user-list]');

    async function loadUsers() {
      try {
        const users = await repository.listUsers();
        list.innerHTML = users.length ? users.map(user => `
          <article class="mh-user-row">
            <div><strong>${escapeHtml(user.full_name || 'CRM User')}</strong><small>${escapeHtml(user.role || 'agent')}</small></div>
            <span class="tag ${user.active ? 'mh-active' : ''}">${user.active ? 'Active' : 'Inactive'}</span>
          </article>`).join('') : '<p class="muted">No users found.</p>';
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
      status.textContent = 'Sending invite…';
      try {
        const values = Object.fromEntries(new FormData(form));
        const result = await repository.inviteUser(values);
        status.textContent = result?.message || 'Invite sent.';
        form.reset();
        await loadUsers();
      } catch (error) {
        status.textContent = error.message || 'Unable to invite this user.';
      } finally {
        busy = false;
        button.disabled = false;
      }
    };

    await loadUsers();
  }

  const observer = new MutationObserver(() => { void mount(); });
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => setTimeout(() => void mount(), 0));
  void mount();
  return () => observer.disconnect();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
