import { makeClientSearch } from './client-search.js';
import { createCampaignRepository } from './campaigns-repository.js';
import { createWorkspace } from './workspace.js';
import { mhRepository, supabase } from './supabase-repository.js';
import { installAdminUsers } from './admin-users.js';
import { installPullToRefresh } from './pull-to-refresh.js';
import { installDashboardCleanup } from './dashboard-cleanup.js';
import { installAppointmentSingleAgent } from './appointment-ui.js';
import { installCarrierVault } from './carriers-ui.js';
import { installMayerJustinCalendar } from './calendar-sync.js?v=justin-calendar-1';

const root = document.querySelector('#app');
installPullToRefresh();

mhRepository.searchClients = makeClientSearch(supabase);
mhRepository.campaigns = createCampaignRepository(supabase);

function applyCurrentUserToClientSearch(form = root.querySelector('#client-search')) {
  if (!form || !mhRepository.user?.id) return;
  const agent = form.elements.namedItem('agent');
  if (!agent || agent.value === mhRepository.user.id) return;
  agent.value = mhRepository.user.id;
  agent.dispatchEvent(new Event('input', { bubbles: true }));
  agent.dispatchEvent(new Event('change', { bubbles: true }));
}

root.addEventListener('submit', event => {
  if (event.target?.id === 'client-search') applyCurrentUserToClientSearch(event.target);
}, true);
root.addEventListener('click', event => {
  if (event.target?.closest?.('[data-reset-search]')) setTimeout(() => applyCurrentUserToClientSearch(), 0);
}, true);
new MutationObserver(() => applyCurrentUserToClientSearch()).observe(root, { childList: true, subtree: true });

const recoveryRequested = () => new URLSearchParams(location.search).get('recovery') === '1' || location.hash.includes('type=recovery');

function cleanRecoveryUrl() {
  try {
    history.replaceState(null, '', `${location.origin}/`);
  } catch {}
}

function authScreen(message = '') {
  root.innerHTML = `<main class="auth-shell"><section class="auth-card"><img src="https://crm.mayerig.com/mayer-bear.png?v=mig-1" alt="Mayer MIG bear"><h1>Mayer MIG CRM</h1><p>Sign in to Mayer MIG CRM.</p>${message ? `<div class="auth-message">${message}</div>` : ''}<form id="signin-form"><label>Email <input name="email" type="email" autocomplete="username" inputmode="email" required></label><label>Password <input name="password" type="password" autocomplete="current-password" minlength="8" required></label><div class="auth-actions"><button class="btn primary" type="submit">Sign In</button><button class="btn secondary" type="button" data-forgot-password>Forgot password?</button></div></form><small>Accounts are added by a Mayer MIG CRM Owner or Admin. Public account creation is disabled.</small></section></main>`;
  const form = root.querySelector('#signin-form');
  form.onsubmit = async e => {
    e.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = new FormData(form);
      await mhRepository.signIn(String(data.get('email') || '').trim(), String(data.get('password') || ''));
      location.hash = '#/dashboard';
      location.reload();
    } catch (error) {
      authScreen(`<b>Sign in failed:</b> ${error.message || 'Please check your email and password.'}`);
    }
  };
  root.querySelector('[data-forgot-password]')?.addEventListener('click', () => requestResetScreen());
}

function requestResetScreen(message = '') {
  root.innerHTML = `<main class="auth-shell"><section class="auth-card"><img src="https://crm.mayerig.com/mayer-bear.png?v=mig-1" alt="Mayer MIG bear"><h1>Reset Password</h1><p>Enter the email you use for Mayer MIG CRM.</p>${message ? `<div class="auth-message">${message}</div>` : ''}<form id="reset-request-form"><label>Email <input name="email" type="email" autocomplete="username" inputmode="email" required></label><div class="auth-actions"><button class="btn primary" type="submit">Send Reset Link</button><button class="btn secondary" type="button" data-back-signin>Back to Sign In</button></div></form><small>The reset link will return you to Mayer MIG CRM to choose a new password.</small></section></main>`;
  const form = root.querySelector('#reset-request-form');
  form.onsubmit = async e => {
    e.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const email = String(new FormData(form).get('email') || '').trim();
    try {
      const redirectTo = `${location.origin}/?recovery=1`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      requestResetScreen('<b>Reset email sent.</b> Check your inbox and click the newest password-reset link.');
    } catch (error) {
      requestResetScreen(`<b>Could not send reset email:</b> ${error.message || 'Please try again.'}`);
    }
  };
  root.querySelector('[data-back-signin]')?.addEventListener('click', () => authScreen());
}

function passwordResetScreen(message = '') {
  root.innerHTML = `<main class="auth-shell"><section class="auth-card"><img src="https://crm.mayerig.com/mayer-bear.png?v=mig-1" alt="Mayer MIG bear"><h1>Choose New Password</h1><p>Set a new password for your Mayer MIG CRM account.</p>${message ? `<div class="auth-message">${message}</div>` : ''}<form id="new-password-form"><label>New Password <input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Confirm New Password <input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required></label><div class="auth-actions"><button class="btn primary" type="submit">Save New Password</button></div></form><small>Use at least 8 characters. After saving, you will return to the sign-in screen.</small></section></main>`;
  const form = root.querySelector('#new-password-form');
  form.onsubmit = async e => {
    e.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const data = new FormData(form);
    const password = String(data.get('password') || '');
    const confirm = String(data.get('confirm_password') || '');
    if (password.length < 8) {
      passwordResetScreen('<b>Password is too short.</b> Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      passwordResetScreen('<b>Passwords do not match.</b> Enter the same password in both boxes.');
      return;
    }
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      cleanRecoveryUrl();
      authScreen('<b>Password changed successfully.</b> Sign in with your new password.');
    } catch (error) {
      passwordResetScreen(`<b>Could not change password:</b> ${error.message || 'The reset link may have expired. Request a new reset email.'}`);
    }
  };
}

async function start() {
  root.innerHTML = '<div class="auth-loading">Connecting securely to the Mayer MIG database…</div>';
  try {
    const signedIn = await mhRepository.initialize();
    if (recoveryRequested()) {
      if (signedIn) passwordResetScreen();
      else root.innerHTML = '<div class="auth-loading">Opening your secure password reset…</div>';
      return;
    }
    if (!signedIn) { authScreen(); return; }
    if (!location.hash || location.hash === '#/' || location.hash === '#') history.replaceState(null, '', '#/dashboard');
    installMayerJustinCalendar();
    createWorkspace(root, mhRepository);
    installDashboardCleanup(root);
    installAppointmentSingleAgent(root, mhRepository);
    installAdminUsers(root, mhRepository);
    installCarrierVault(root);
    applyCurrentUserToClientSearch();

    void import('./communications-ui.js?v=communications-perf-2')
      .then(() => import('./ringcentral-readonly.js?v=readonly-calls-2'))
      .then(() => import('./ringcentral-ui-adjustments.js?v=footer-call-data-1'))
      .then(() => import('./communications-layout-fix.js?v=communications-layout-1'))
      .then(() => import('./communications-delete.js?v=communications-delete-1'))
      .then(() => import('./communications-open-client.js?v=communications-open-client-1'))
      .catch(error => {
        console.error('Communications UI failed to load.', error);
      });
  } catch (error) {
    authScreen(`<b>Database connection error:</b> ${error.message || 'Please retry.'}`);
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    mhRepository.user = session?.user || null;
    passwordResetScreen();
    return;
  }
  if (event === 'SIGNED_OUT' && !root.querySelector('#signin-form')) location.reload();
});

start();
