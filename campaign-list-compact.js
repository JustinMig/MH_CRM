import { supabase } from './supabase-repository.js';

const fmtDate = value => {
  if (!value) return 'Date not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date not available';
  return date.toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  });
};

let token = 0;
let queued = false;

async function compactCampaignCards() {
  const grid = document.querySelector('.campaigns-root .cmp-campaign-grid');
  if (!grid) return;
  const cards = [...grid.querySelectorAll(':scope > .cmp-campaign-card')];
  if (!cards.length) return;

  const ids = cards.map(card => card.dataset.cmpOpen).filter(Boolean);
  if (!ids.length) return;
  const myToken = ++token;

  const { data, error } = await supabase
    .from('campaign_summaries')
    .select('id,name,created_at,total_count')
    .in('id', ids);
  if (error || myToken !== token || !grid.isConnected) return;

  const rows = new Map((data || []).map(row => [String(row.id), row]));
  for (const card of cards) {
    const row = rows.get(String(card.dataset.cmpOpen || ''));
    if (!row) continue;
    const total = Number(row.total_count || 0);
    card.classList.add('cmp-campaign-card-compact');
    card.dataset.cmpCompactCard = 'true';
    card.innerHTML = `<strong>${String(row.name || 'Campaign').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}</strong><div class="cmp-compact-meta"><span>Added ${fmtDate(row.created_at)}</span><span>${total} total client${total === 1 ? '' : 's'}</span></div>`;
  }
}

function schedule() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    void compactCampaignCards();
  });
}

new MutationObserver(mutations => {
  if (mutations.some(mutation => [...mutation.addedNodes].some(node =>
    node instanceof Element && (
      node.matches?.('.cmp-campaign-card,.cmp-campaign-grid,.campaigns-root') ||
      node.querySelector?.('.cmp-campaign-card')
    )
  ))) schedule();
}).observe(document.body, { childList: true, subtree: true });

schedule();
