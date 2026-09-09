import { createWorkspace } from './workspace.js';
import { mhRepository, supabase } from './supabase-repository.js';

const root = document.querySelector('#app');

function authScreen(message = '') {
  root.innerHTML = `<main class="auth-shell"><section class="auth-card"><img src="/assets/mh-logo.jpg" alt="M&H shield"><h1>M&amp;H CRM</h1><p>Sign in to the standalone M&amp;H database.</p>${message ? `<div class="auth-message">${message}</div>` : ''}<form id="signin-form"><label>Full Name <input name="full_name" autocomplete="name" placeholder="Used only when creating an account"></label><label>Email <input name="email" type="email" autocomplete="username" required></label><label>Password <input name="password" type="password" autocomplete="current-password" minlength="8" required></label><div class="auth-actions"><button class="btn primary" type="submit">Sign In</button><button class="btn secondary" type="button" id="create-account">Create Account</button></div></form><small>This login is for M&amp;H CRM only. It does not use the Mayer CRM database.</small></section></main>`;
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
  root.querySelector('#create-account').onclick = async () => {
    const data = new FormData(form);
    const fullName = String(data.get('full_name') || '').trim();
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    if (!fullName || !email || password.length < 8) { authScreen('Enter your full name, email, and a password of at least 8 characters to create the first M&H CRM account.'); return; }
    try {
      const result = await mhRepository.signUp(fullName, email, password);
      if (result.session) location.reload();
      else authScreen('Account created. Check your email for the Supabase confirmation message, confirm it, then return here and sign in.');
    } catch (error) {
      authScreen(`<b>Account creation failed:</b> ${error.message || 'Please try again.'}`);
    }
  };
}

async function start() {
  root.innerHTML = '<div class="auth-loading">Connecting securely to the M&amp;H database…</div>';
  try {
    const signedIn = await mhRepository.initialize();
    if (!signedIn) { authScreen(); return; }
    createWorkspace(root, mhRepository);
  } catch (error) {
    authScreen(`<b>Database connection error:</b> ${error.message || 'Please retry.'}`);
  }
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') location.reload();
});

start();
