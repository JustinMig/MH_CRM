import { createWorkspace } from './workspace.js';
import { mhRepository, supabase } from './supabase-repository.js';
import { installAdminUsers } from './admin-users.js';
import { installPullToRefresh } from './pull-to-refresh.js';
import { installDashboardCleanup } from './dashboard-cleanup.js';
import { installAppointmentSingleAgent } from './appointment-ui.js';

const root = document.querySelector('#app');
installPullToRefresh();

// Keep the Clients screen fast: queries return at most 50 rows at a time.
// A 51st row is requested only to determine whether a Load More button is needed.
mhRepository.searchClients = async function ({ query = '', product = '', agent = '', birthYear = '', limit = 50, cursor = null }) {
  const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 50);
  const offset = Math.max(Number(cursor) || 0, 0);
  let q = supabase
    .from('clients')
    .select('id,first_name,last_name,phone,email,date_of_birth,products,assigned_agent_id,updated_at')
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .order('id', { ascending: true });

  if (query) {
    const term = query.replace(/[,%]/g, ' ').trim();
    q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,address1.ilike.%${term}%,city.ilike.%${term}%`);
  }
  if (product) q = q.contains('products', [String(product).toLowerCase()]);
  if (agent) q = q.eq('assigned_agent_id', agent);
  if (birthYear) q = q.gte('date_of_birth', `${birthYear}-01-01`).lte('date_of_birth', `${birthYear}-12-31`);

  const { data, error } = await q.range(offset, offset + pageSize);
  if (error) throw error;
  const rows = data || [];
  const hasMore = rows.length > pageSize;
  return {
    rows: rows.slice(0, pageSize),
    nextCursor: hasMore ? String(offset + pageSize) : null
  };
};

// Justin is the only current M&H user. The Agent filter is hidden, but the
// search state still needs his ID so pressing Search with empty fields loads
// his first 50 clients instead of treating the form as an empty search.
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
      location.hash = '#/dashboard';
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
    if (!location.hash || location.hash === '#/' || location.hash === '#') history.replaceState(null, '', '#/dashboard');
    createWorkspace(root, mhRepository);
    installDashboardCleanup(root);
    installAppointmentSingleAgent(root, mhRepository);
    installAdminUsers(root, mhRepository);
    applyCurrentUserToClientSearch();
  } catch (error) {
    authScreen(`<b>Database connection error:</b> ${error.message || 'Please retry.'}`);
  }
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') location.reload();
});

start();
