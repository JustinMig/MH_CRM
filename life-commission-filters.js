import { mhRepository } from './supabase-repository.js';

const originalLifeProductionTracker = mhRepository.lifeProductionTracker?.bind(mhRepository);

function centralYear() {
  const year = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric'
  }).format(new Date());
  return Number(year);
}

function selectableLifeYears(existing = [], selected = null) {
  const current = centralYear();
  const values = new Set(existing.map(Number).filter(Number.isFinite));
  for (let year = current + 1; year >= current - 7; year -= 1) values.add(year);
  if (Number.isFinite(Number(selected))) values.add(Number(selected));
  return [...values].sort((a, b) => b - a);
}

if (originalLifeProductionTracker) {
  mhRepository.lifeProductionTracker = async function lifeProductionTrackerWithYearChoices(args = {}) {
    const data = await originalLifeProductionTracker(args);
    data.years = selectableLifeYears(data.years || [], args.year ?? data.year);
    return data;
  };
}

function syncLifeFilters(root) {
  if (!root?.isConnected) return;
  const lifeTab = root.querySelector('[data-tracker-tab="life"]');
  const isLife = lifeTab?.classList.contains('active') || lifeTab?.getAttribute('aria-selected') === 'true';
  const agentSelect = root.querySelector('[data-tracker-agent]');
  const agentField = agentSelect?.closest('.commission-filter-field');

  if (agentField) agentField.hidden = Boolean(isLife);

  if (isLife) {
    root.querySelector('[data-life-month-wrap]')?.removeAttribute('hidden');
    root.querySelector('[data-life-year-wrap]')?.removeAttribute('hidden');
    if (agentSelect?.value) {
      agentSelect.value = '';
      agentSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

function bindTracker(root) {
  if (!root || root.dataset.lifeFilterCleanup === 'true') return;
  root.dataset.lifeFilterCleanup = 'true';
  syncLifeFilters(root);
  root.querySelectorAll('[data-tracker-tab]').forEach(button => {
    button.addEventListener('click', () => queueMicrotask(() => syncLifeFilters(root)));
  });
}

function enhance(scope = document) {
  scope.querySelectorAll?.('[data-commission-tracker]').forEach(bindTracker);
}

const app = document.getElementById('app');
if (app) {
  new MutationObserver(mutations => {
    if (mutations.some(mutation => [...mutation.addedNodes].some(node =>
      node instanceof Element && (
        node.matches?.('[data-commission-tracker]') ||
        node.querySelector?.('[data-commission-tracker]')
      )
    ))) enhance(app);
  }).observe(app, { childList: true, subtree: true });
}

enhance();
