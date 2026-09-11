import { supabase } from './supabase-repository.js';
import { esc } from './core.js';

// Keep the source categories intact unless an exact destination mapping exists.
// This module only lists existing records. It never copies, deletes, or saves files.
const GROUPS = {
  information: [
    { key: 'intake', title: 'Client Intake Files', categories: ['lead_photo'], parent: 'Personal & Contact Information' }
  ],
  medicare: [
    { key: 'medicare', title: 'Medicare Documents', categories: ['medicare_document', 'medicare_photo'], parent: 'Medicare Information' },
    { key: 'cards', title: 'Card Information', categories: ['card_information'], parent: 'Medicare Information' },
    { key: 'health', title: 'Health Plan Documents', categories: ['health_plan'], parent: 'Health Plan Information' },
    { key: 'soa', title: 'All Saved Scopes of Appointment', categories: ['soa', 'scope_of_appointment'], selector: '[data-soa-group]' }
  ],
  hospital_indemnity: [
    { key: 'hospital', title: 'Hospital Indemnity Documents', categories: ['hospital_indemnity'] }
  ],
  life: [
    { key: 'unassigned-life', title: 'Imported Life Documents — Not Yet Assigned', categories: ['life_insurance'], help: 'These files belong to this client. Their original records do not identify an individual policy; no policy has been guessed.' }
  ]
};
const states = new WeakMap();
const MAX_AGE = 15000;
const PAGE_SIZE = 200;

function installStyles() {
  if (document.getElementById('mh-imported-file-styles')) return;
  const style = document.createElement('style');
  style.id = 'mh-imported-file-styles';
  style.textContent = `
    .client-form details.mh-imported-file-group { margin:12px 0; border:1px solid #bec8d0; border-radius:10px; background:#f8fafb; }
    .client-form details.mh-imported-file-group > summary { display:flex; justify-content:space-between; align-items:center; gap:14px; padding:12px 16px!important; background:#d5dce0!important; color:#203442!important; font-size:13px; }
    .client-form details.mh-imported-file-group > summary::before { content:none!important; }
    .client-form details.mh-imported-file-group > summary::after { content:none!important; }
    .mh-imported-file-group > summary span { font-size:12px; font-weight:600; flex:none; }
    .mh-imported-file-body { padding:12px; }
    .mh-imported-file-tools { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; }
    .mh-imported-file-tools p,.mh-imported-file-status { margin:0; color:#526775; font-size:12px; line-height:1.5; }
    .mh-imported-file-status.error { color:#8b3333; }
    .mh-imported-file-row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 0; border-top:1px solid #dce3e8; }
    .mh-imported-file-row > div { min-width:0; }
    .mh-imported-file-row strong { display:block; overflow-wrap:anywhere; color:#203442; font-size:13px; }
    .mh-imported-file-row small { display:block; margin-top:4px; color:#526775; }
    .mh-imported-file-row button { flex:none; }
    @media(max-width:600px) { .mh-imported-file-tools { align-items:flex-start; } .mh-imported-file-tools p { max-width:70%; } }
  `;
  document.head.append(style);
}

function stateFor(dialog, tab) {
  let tabs = states.get(dialog);
  if (!tabs) { tabs = new Map(); states.set(dialog, tabs); }
  if (!tabs.has(tab)) tabs.set(tab, { clientId: '', loadedAt: 0, records: [], pending: null });
  return tabs.get(tab);
}

function destination(panel, group) {
  let section = group.selector ? panel.querySelector(group.selector) : null;
  if (!section && group.parent) {
    section = [...panel.querySelectorAll(':scope > details.field-group')]
      .find(item => item.querySelector(':scope > summary')?.textContent.trim() === group.parent);
  }
  return section?.querySelector(':scope > .form-grid') || section || panel;
}

function hostFor(panel, group) {
  let host = panel.querySelector(`[data-imported-file-group="${group.key}"]`);
  if (host) return host;
  host = document.createElement('details');
  host.className = 'field-group mh-imported-file-group span-all';
  host.dataset.importedFileGroup = group.key;
  host.innerHTML = `<summary>${esc(group.title)}<span data-imported-count>Loading…</span></summary>
    <div class="mh-imported-file-body">
      <div class="mh-imported-file-tools"><p>${esc(group.help || 'Files saved with this client. View opens a popup inside the CRM.')}</p><button type="button" class="btn secondary" data-refresh-imported-files>Refresh</button></div>
      <div data-imported-file-list></div>
      <p class="mh-imported-file-status" data-imported-file-status role="status" aria-live="polite"></p>
    </div>`;
  destination(panel, group).append(host);
  return host;
}

function fileSize(value) {
  const bytes = Number(value || 0);
  return bytes ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : '';
}

function showRecords(panel, groups, records) {
  for (const group of groups) {
    const matches = records.filter(record => group.categories.includes(record.category));
    const existing = panel.querySelector(`[data-imported-file-group="${group.key}"]`);
    if (!matches.length && !existing) continue;
    const host = existing || hostFor(panel, group);
    host.hidden = matches.length === 0;
    host.querySelector('[data-imported-count]').textContent = `${matches.length} file${matches.length === 1 ? '' : 's'} · expand`;
    host.querySelector('[data-imported-file-list]').innerHTML = matches.map(record => {
      const date = new Date(record.created_at);
      const meta = [fileSize(record.file_size), Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString()].filter(Boolean).join(' • ');
      // The existing client-file-experience handler opens this ID using RLS and a signed URL.
      return `<article class="mh-imported-file-row" data-document-id="${esc(record.id)}"><div><strong>${esc(record.file_name || 'Document')}</strong><small>${esc(meta)}</small></div><button type="button" class="btn secondary" data-open-document aria-label="${esc(`View ${record.file_name || 'document'}`)}">View</button></article>`;
    }).join('');
    const status = host.querySelector('[data-imported-file-status]');
    status.textContent = '';
    status.classList.remove('error');
  }
}

async function loadTab(dialog, tab, force = false) {
  const groups = GROUPS[tab];
  const panel = dialog.querySelector(`[data-panel="${tab}"]`);
  const clientId = dialog.dataset.clientId;
  if (!groups || !panel || !clientId || !dialog.isConnected) return;
  const state = stateFor(dialog, tab);
  if (state.pending) return state.pending;
  if (state.clientId === clientId && state.loadedAt && !force && Date.now() - state.loadedAt < MAX_AGE) {
    showRecords(panel, groups, state.records);
    return;
  }
  state.clientId = clientId;
  const controls = panel.querySelectorAll('[data-refresh-imported-files]');
  controls.forEach(button => { button.disabled = true; });
  state.pending = (async () => {
    try {
      const categories = [...new Set(groups.flatMap(group => group.categories))];
      const records = [];
      // Page explicitly so larger archives are not silently truncated by the API limit.
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase.from('documents')
          .select('id,client_id,category,file_name,file_size,created_at')
          .eq('client_id', clientId).in('category', categories)
          .order('created_at', { ascending: false }).order('id', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!dialog.isConnected || dialog.dataset.clientId !== clientId) return;
        records.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
      }
      state.records = records;
      state.loadedAt = Date.now();
      showRecords(panel, groups, records);
    } catch (error) {
      state.loadedAt = 0;
      if (!dialog.isConnected || dialog.dataset.clientId !== clientId) return;
      const host = hostFor(panel, groups[0]);
      host.hidden = false;
      host.open = true;
      host.querySelector('[data-imported-count]').textContent = 'Retry needed';
      const status = host.querySelector('[data-imported-file-status]');
      status.textContent = `Unable to load these files. ${error?.message || 'Use Refresh to retry.'}`;
      status.classList.add('error');
    } finally {
      controls.forEach(button => { button.disabled = false; });
    }
  })().finally(() => { state.pending = null; });
  return state.pending;
}

installStyles();
document.addEventListener('click', event => {
  const tab = event.target.closest?.('button[data-tab]');
  const refresh = event.target.closest?.('[data-refresh-imported-files]');
  const dialog = (tab || refresh)?.closest('dialog.client-dialog');
  if (!dialog) return;
  const key = tab?.dataset.tab || refresh.closest('[data-panel]')?.dataset.panel;
  if (!GROUPS[key]) return;
  // Let the ordinary tab switch finish; do not replace any existing event handlers.
  queueMicrotask(() => { void loadTab(dialog, key, !!refresh); });
});

function initialLoad(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('client-dialog')) return;
  requestAnimationFrame(() => {
    const tab = dialog.querySelector('[data-tab][aria-selected="true"]')?.dataset.tab;
    if (tab && GROUPS[tab]) void loadTab(dialog, tab);
  });
}
// Observe only dialogs appended directly to body, never the client form subtree.
const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) for (const node of mutation.addedNodes) {
    if (node instanceof HTMLDialogElement) initialLoad(node);
  }
});
observer.observe(document.body, { childList: true });
document.querySelectorAll('dialog.client-dialog').forEach(initialLoad);
