import { createWorkspace } from './workspace.js';
import { mhRepository, supabase } from './supabase-repository.js';
import { installAdminUsers } from './admin-users.js';

const root = document.querySelector('#app');

function authScreen(message = '') {
  root.innerHTML = `<main class="auth-shell"><section class="auth-card"><img src="/assets/mh-logo.jpg" alt="M&H shield"><h1>M&amp;H CRM</h1><p>Sign in to M&amp;H Insurance Group.</p>${message ? `<div class="auth-message">${message}</div>` : ''}<form id="signin-form"><label>Email <input name="email" type="email" autocomplete="username" inputmode="email" required></label><label>Password <input name="password" type="password" autocomplete="current-password" minlength="8" required></label><div class="auth-actions"><button class="btn primary" type="submit">Sign In</button></div></form><small>Accounts are added by an M&amp;H CRM Owner or Admin. Public account creation is disabled.</small></section></main>`;
  const form = root.querySelector('#signin-form');
  form.onsubmit = async e => {
    e.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = new FormData(form);
      await mhRepository.signIn(String(data.get('email') || '').trim(), String(data.get('password') || ''));
      location.reload();
    } catch (error) {
      authScreen(`<b>Sign in failed:</b> ${error.message || 'Please check your email and password.'}`);
    }
  };
}

async function start() {
  root.innerHTML = '<div class="auth-loading">Connecting securely to the M&amp;H database…</div>';
  try {
    const signedIn = await mhRepository.initialize();
    if (!signedIn) { authScreen(); return; }
    createWorkspace(root, mhRepository);
    installAdminUsers(root, mhRepository);
  } catch (error) {
    authScreen(`<b>Database connection error:</b> ${error.message || 'Please retry.'}`);
  }
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') location.reload();
});

start();
