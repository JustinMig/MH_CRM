import { mhRepository, supabase } from './supabase-repository.js';
import { centralPremiumPeriod, summarizePremiumProduction } from './client-summary-model.js';

const ICONS = {
  total: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M2 21v-2a6 6 0 0 1 12 0v2m0-6a5 5 0 0 1 8 4v2"/></svg>',
  medicare: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.2-8 11-8 11Z"/><path d="M12 9v6m-3-3h6"/></svg>',
  life: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c5-3 8-6.3 8-11V5l-8-3-8 3v6c0 4.7 3 8 8 11Z"/><path d="M8 12h8m-4-4v8"/></svg>'
};

let statsToken = 0;

function agentScope() {
  const role = String(mhRepository.profile?.role || '').toLowerCase();
  return role === 'agent' ? (mhRepository.user?.id || '') : '';
}

function countQuery(product = '') {
  let query = supabase.from('clients').select('id', { count: 'exact', head: true }).neq('status', 'deceased');
  const scopedAgent = agentScope();
  if (scopedAgent) query = query.eq('assigned_agent_id', scopedAgent);
  if (product) query = query.contains('products', [product]);
  return query;
}

mhRepository.clientSummaryCounts = async function clientSummaryCounts() {
  const [totalResult, medicareResult, lifeResult] = await Promise.all([
    countQuery(), countQuery('medicare'), countQuery('life')
  ]);
  for (const result of [totalResult, medicareResult, lifeResult]) if (result.error) throw result.error;
  return {
    total: Number(totalResult.count || 0),
    medicare: Number(medicareResult.count || 0),
    life: Number(lifeResult.count || 0)
  };
};

const baseCommissions = mhRepository.commissions.bind(mhRepository);
mhRepository.commissions = async function commissionsWithLifePremium({ type, agent } = {}) {
  if (type !== 'life') return baseCommissions({ type, agent });
  const period = centralPremiumPeriod();
  let query = supabase.from('life_premium_dashboard_rollup')
    .select('assigned_agent_id,effective_year,effective_month,policy_count,premium_total')
    .eq('effective_year', period.year);
  const scopedAgent = agent || agentScope();
  if (scopedAgent) query = query.eq('assigned_agent_id', scopedAgent);
  const { data, error } = await query;
  if (error) throw error;
  return summarizePremiumProduction(data || [], period);
};

function statCard(kind, label) {
  return `<article class="client-summary-card is-${kind}">
    <span class="client-summary-icon">${ICONS[kind]}</span>
    <strong data-client-summary="${kind}">—</strong>
    <span class="client-summary-label">${label}</span>
  </article>`;
}

function ensureClientStats(panel) {
  if (!panel?.isConnected || panel.previousElementSibling?.matches?.('[data-client-summary-grid]')) return;
  const grid = document.createElement('section');
  grid.className = 'client-summary-grid';
  grid.dataset.clientSummaryGrid = 'true';
  grid.setAttribute('aria-label', 'Client totals');
  grid.setAttribute('aria-live', 'polite');
  grid.innerHTML = [
    statCard('total', 'Total Clients'),
    statCard('medicare', 'Medicare Clients'),
    statCard('life', 'Life Clients')
  ].join('');
  panel.before(grid);
  void refreshClientStats(grid);
}

async function refreshClientStats(existing = null) {
  const grid = existing?.isConnected ? existing : document.querySelector('[data-client-summary-grid]');
  if (!grid) return;
  const token = ++statsToken;
  grid.classList.add('is-loading');
  try {
    const counts = await mhRepository.clientSummaryCounts();
    if (token !== statsToken || !grid.isConnected) return;
    for (const key of ['total', 'medicare', 'life']) {
      const node = grid.querySelector(`[data-client-summary="${key}"]`);
      const next = Number(counts[key] || 0).toLocaleString('en-US');
      if (node && node.textContent !== next) node.textContent = next;
    }
    grid.removeAttribute('data-error');
  } catch (error) {
    if (token !== statsToken || !grid.isConnected) return;
    grid.dataset.error = 'true';
    grid.title = error?.message || 'Client totals could not load.';
  } finally {
    if (token === statsToken && grid.isConnected) grid.classList.remove('is-loading');
  }
}

function decorateCommissionDialog(dialog) {
  if (!dialog?.isConnected) return;
  const lifeButton = dialog.querySelector('[data-commission="life"]');
  const small = lifeButton?.querySelector('small');
  if (small && small.textContent !== 'Premium production') small.textContent = 'Premium production';

  const body = dialog.querySelector('[data-commission-body]');
  if (!body) return;
  const heading = body.querySelector('h3');
  if (heading?.textContent === 'Life Insurance Commissions') heading.textContent = 'Life Insurance Premium Production';

  const articles = body.querySelectorAll('.commission-totals article');
  if (articles.length >= 2) {
    const period = centralPremiumPeriod();
    const first = articles[0].querySelector('span');
    const second = articles[1].querySelector('span');
    const monthlyLabel = `Monthly Premium · ${period.monthName}`;
    const yearlyLabel = `Yearly Total · ${period.year}`;
    if (first && first.textContent !== monthlyLabel) first.textContent = monthlyLabel;
    if (second && second.textContent !== yearlyLabel) second.textContent = yearlyLabel;
    if (!body.querySelector('.life-premium-production-note')) {
      const note = document.createElement('p');
      note.className = 'life-premium-production-note';
      note.textContent = 'Live premium-production totals from Life policies saved in client files, grouped by policy effective date.';
      body.querySelector('.panel-card')?.append(note);
    }
  }
}

function bindCommissionDialog(dialog) {
  if (!dialog || dialog.dataset.lifePremiumBound === 'true') return;
  dialog.dataset.lifePremiumBound = 'true';
  decorateCommissionDialog(dialog);
  const body = dialog.querySelector('[data-commission-body]');
  if (!body) return;
  const observer = new MutationObserver(() => decorateCommissionDialog(dialog));
  observer.observe(body, { childList: true, subtree: true });
  dialog.addEventListener('close', () => observer.disconnect(), { once: true });
}

function enhance(root = document) {
  root.querySelectorAll?.('.client-search-panel').forEach(ensureClientStats);
  root.querySelectorAll?.('dialog.commissions-dialog').forEach(bindCommissionDialog);
}

const savedSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function saveClientAndRefreshSummary(...args) {
  const saved = await savedSaveClient(...args);
  queueMicrotask(() => void refreshClientStats());
  return saved;
};

const app = document.getElementById('app');
if (app) {
  new MutationObserver(mutations => {
    if (mutations.some(mutation => [...mutation.addedNodes].some(node =>
      node instanceof Element && (
        node.matches?.('.client-search-panel,dialog.commissions-dialog') ||
        node.querySelector?.('.client-search-panel,dialog.commissions-dialog')
      )
    ))) enhance(app);
  }).observe(app, { childList: true, subtree: true });
}
enhance();
