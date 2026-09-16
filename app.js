import { supabase, initialAuthUrl } from './supabase-client.js';
import { recoveryContext, withTimeout } from './auth-flow.js';

const root = document.querySelector('#app');
const context = recoveryContext(initialAuthUrl || location.href);
const recoveryKey = 'mig-password-recovery';
let recoveryUserId = '';
let suppressSignOutReload = false;
let workspaceStarted = false;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function clearCallback() { history.replaceState(null, '', '/'); }
function rememberRecovery(userId) {
  recoveryUserId = userId;
  try { sessionStorage.setItem(recoveryKey, JSON.stringify({ userId, expires:Date.now()+1800000 })); } catch {}
  history.replaceState(null, '', '/?recovery=1');
}
function forgetRecovery() { recoveryUserId = ''; try { sessionStorage.removeItem(recoveryKey); } catch {} }
function rememberedRecovery() {
  try { const saved = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null'); return saved?.expires > Date.now() ? saved.userId : ''; } catch { return ''; }
}
function loginEmail(value) {
  const identity = String(value || '').trim();
  if (identity.includes('@')) return identity.toLowerCase();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(identity)) throw new Error('Enter a valid username or email address.');
  return `${identity.toLowerCase()}@users.mayerig.com`;
}
function frame(title, copy, content, message = '', error = false) {
  root.innerHTML = `<main class="auth-shell"><section class="auth-card"><img src="/assets/mayer-bear.webp" width="192" height="192" alt="Mayer MIG bear"><h1>${esc(title)}</h1><p>${esc(copy)}</p>${message ? `<div class="auth-message" role="${error ? 'alert' : 'status'}">${esc(message)}</div>` : ''}${content}</section></main>`;
}
function signInScreen(message = '', error = false) {
  forgetRecovery(); clearCallback();
  frame('Mayer MIG CRM','Sign in to Mayer MIG CRM.', `<form id="signin-form"><label>Username or Email <input name="identity" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></label><label>Password <input name="password" type="password" autocomplete="current-password" required></label><div class="auth-actions"><button class="btn primary" type="submit">Sign In</button><button class="btn secondary" type="button" data-forgot-password>Forgot password?</button></div></form><small>Use the username created by the CRM Owner, or your existing email login.</small>`,message,error);
  root.querySelector('[data-forgot-password]').onclick = () => requestResetScreen();
  root.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const values = new FormData(form);
      const email = loginEmail(values.get('identity'));
      const { error } = await withTimeout(supabase.auth.signInWithPassword({email,password:String(values.get('password') || '')}));
      if (error) throw error;
      await openWorkspace();
    } catch (error) { signInScreen(error.message || 'Unable to sign in. Please retry.',true); }
  };
}
function requestResetScreen(message = '', error = false) {
  forgetRecovery(); clearCallback();
  frame('Reset Password','Enter the email you use for Mayer MIG CRM.', `<form id="reset-request-form"><label>Email <input name="email" type="email" autocomplete="username" inputmode="email" required></label><div class="auth-actions"><button class="btn primary" type="submit">Send Reset Link</button><button class="btn secondary" type="button" data-back-signin>Back to Sign In</button></div></form><small>Username-only accounts should have their password reset by the CRM Owner.</small>`,message,error);
  root.querySelector('[data-back-signin]').onclick = () => signInScreen();
  root.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget; form.querySelector('[type="submit"]').disabled = true;
    try {
      const email = String(new FormData(form).get('email') || '').trim();
      const { error } = await withTimeout(supabase.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}/?recovery=1`}));
      if (error) throw error;
      requestResetScreen('If this email belongs to an account, a reset link has been sent. Check your inbox and spam folder.');
    } catch (error) { requestResetScreen(error.message || 'Unable to send the email. Please retry.',true); }
  };
}
function invalidReset(message = 'This password-reset link has expired or is invalid. Request a new link and open the newest email.') {
  forgetRecovery(); clearCallback();
  frame('Reset Link Unavailable','Your password has not been changed.', '<div class="auth-actions"><button class="btn primary" data-new-reset>Request New Link</button><button class="btn secondary" data-back-signin>Back to Sign In</button></div>',message,true);
  root.querySelector('[data-new-reset]').onclick = () => requestResetScreen();
  root.querySelector('[data-back-signin]').onclick = () => signInScreen();
}
function passwordResetScreen(message = '', error = false) {
  frame('Choose New Password','Set a new password for your Mayer MIG CRM account.', '<form id="new-password-form"><label>New Password <input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label>Confirm New Password <input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required></label><div class="auth-actions"><button class="btn primary" type="submit">Save New Password</button><button class="btn secondary" type="button" data-new-reset>Request New Link</button></div></form><small>Use at least 8 characters. You will sign in again after saving.</small>',message,error);
  root.querySelector('[data-new-reset]').onclick = () => requestResetScreen();
  root.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    const password = String(values.get('password') || '');
    if (password.length < 8) return passwordResetScreen('Use at least 8 characters.',true);
    if (password !== String(values.get('confirm_password') || '')) return passwordResetScreen('Passwords do not match. Enter the same password in both boxes.',true);
    form.querySelector('[type="submit"]').disabled = true;
    let passwordSaved = false;
    try {
      const { data, error: userError } = await withTimeout(supabase.auth.getUser());
      if (userError || !data?.user?.id || data.user.id !== recoveryUserId) return invalidReset();
      const { error } = await withTimeout(supabase.auth.updateUser({ password }));
      if (error) throw error;
      passwordSaved = true;
      suppressSignOutReload = true; forgetRecovery(); clearCallback();
      const { error: signOutError } = await withTimeout(supabase.auth.signOut());
      signInScreen(signOutError ? 'Password changed. Sign-out could not be confirmed; close other CRM tabs and sign in with your new password.' : 'Password changed successfully. Sign in with your new password.');
    } catch (error) {
      if (passwordSaved) signInScreen('Password changed. Sign-out could not be confirmed; close other CRM tabs and sign in with your new password.');
      else passwordResetScreen(error.message || 'Unable to change the password. Request a new link.',true);
    }
    finally { suppressSignOutReload = false; }
  };
}
async function openWorkspace() {
  if (workspaceStarted) return;
  root.innerHTML = '<div class="auth-loading" role="status">Opening your workspace…</div>';
  let sheet = document.querySelector('[data-workspace-css]');
  if (!sheet) {
    sheet = document.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = '/workspace-styles.css?v=ssn-input-layout-1'; sheet.dataset.workspaceCss = '';
    const loaded = new Promise((resolve,reject) => {sheet.onload=resolve;sheet.onerror=()=>reject(new Error('Unable to load workspace styles. Refresh and retry.'));});
    document.head.append(sheet);
    try { await withTimeout(loaded); } catch (error) { sheet.remove(); throw error; }
  }
  const { startWorkspace } = await withTimeout(import('./workspace-start.js?v=cleanup-1'),20000);
  root.inert = true;
  try { await startWorkspace(); workspaceStarted = true; }
  finally { root.inert = false; }
}
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session?.user?.id) recoveryUserId = session.user.id;
  if (event === 'SIGNED_OUT' && workspaceStarted && !suppressSignOutReload) location.reload();
});
async function start() {
  try {
    const { data, error } = await withTimeout(supabase.auth.getSession());
    if (context.requested || recoveryUserId) {
      if (context.invalid || error || !data?.session) return invalidReset();
      const candidate = recoveryUserId || (context.tokenCallback ? data.session.user?.id : rememberedRecovery());
      if (!candidate) return invalidReset();
      const { data: verified, error: verifyError } = await withTimeout(supabase.auth.getUser());
      if (verifyError || verified?.user?.id !== candidate) return invalidReset();
      rememberRecovery(candidate); passwordResetScreen(); return;
    }
    if (error || !data?.session) return signInScreen();
    await openWorkspace();
  } catch (error) {
    if (context.requested) invalidReset(error.message || 'Unable to verify the reset link. Request a new one.');
    else signInScreen(error.message || 'Unable to connect. Please retry.',true);
  }
}
void start();