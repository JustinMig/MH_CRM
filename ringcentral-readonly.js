import { supabase } from './supabase-repository.js';
import { smsAuthHeaders } from './client-texting.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
let syncPromise = null;
let lastSyncAt = 0;
let routeObserver = null;

function installStyles() {
  if (document.querySelector('#mh-ringcentral-readonly-styles')) return;
  const style = document.createElement('style');
  style.id = 'mh-ringcentral-readonly-styles';
  style.textContent = `
    .mh-comm-channel-tabs{display:flex;gap:7px;margin:0 0 12px;border-bottom:1px solid #d5dee5;padding:0 0 9px;flex-wrap:wrap}
    .mh-comm-channel-tabs button{border:1px solid #cbd7df;background:#f8fafb;color:#516574;border-radius:999px;padding:7px 13px;font:inherit;font-size:.78rem;font-weight:850;cursor:pointer}
    .mh-comm-channel-tabs button.active{background:#18324a;border-color:#18324a;color:#fff}
    .mh-call-panel[hidden],.mh-text-panel[hidden]{display:none!important}
    .mh-call-panel{display:grid;gap:11px}
    .mh-call-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
    .mh-call-head>div{display:grid;gap:3px}.mh-call-head h2{margin:0}.mh-call-head p{margin:0;color:#71808d;font-size:.78rem}
    .mh-call-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
    .mh-call-status{min-height:18px;color:#667886;font-size:.72rem;font-weight:700}
    .mh-call-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    .mh-call-summary>div{border:1px solid #dce4e9;border-radius:10px;background:#f8fafb;padding:9px 10px;display:grid;gap:2px}
    .mh-call-summary span{font-size:.64rem;color:#758491;text-transform:uppercase;font-weight:850;letter-spacing:.04em}.mh-call-summary strong{font-size:1.05rem;color:#263b4b}
    .mh-call-list{display:grid;gap:7px}.mh-call-row{border:1px solid #dfe6eb;border-left:3px solid #6c8798;background:#fff;border-radius:9px;padding:8px 9px;display:grid;gap:5px}
    .mh-call-row.inbound{border-left-color:#3d7f69}.mh-call-row.outbound{border-left-color:#507ea3}
    .mh-call-row-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.mh-call-row-head>div{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .mh-call-direction{font-weight:900;color:#2e4353}.mh-call-client{font-size:.7rem;font-weight:850;color:#526777;background:#eef3f6;border-radius:999px;padding:2px 6px}.mh-call-time{font-size:.68rem;color:#71808d;font-weight:700}
    .mh-call-meta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;color:#516575;font-size:.72rem;font-weight:700}.mh-call-meta span+span{border-left:1px solid #d5dfe5;padding-left:7px}
    .mh-recording-wrap{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.mh-recording-wrap audio{width:min(100%,440px);height:31px}.mh-recording-error{color:#9b3434;font-size:.7rem;font-weight:700}
    .mh-client-call-history{margin-top:10px;border:1px solid #d7e1e7;border-left:4px solid #6c8798;border-radius:10px;background:#f8fafb;overflow:hidden}.mh-client-call-history>summary{cursor:pointer;padding:10px 12px;font-weight:900;color:#314958;display:flex;justify-content:space-between;gap:8px}.mh-client-call-history>summary small{font-weight:700;color:#71808d}
    .mh-client-call-body{padding:0 10px 10px;display:grid;gap:8px}.mh-client-call-body .mh-call-row{background:#fff}.mh-client-call-empty{padding:10px;border:1px dashed #ccd8df;border-radius:8px;color:#71808d;font-size:.76rem;background:#fff}
    @media(max-width:700px){.mh-call-summary{grid-template-columns:1fr}.mh-call-row-head{align-items:flex-start}.mh-client-call-history>summary{display:grid}.mh-call-actions{width:100%}.mh-call-actions .btn{flex:1}}
  `;
  document.head.append(style);
}

function dateTime(value) {
  const d = new Date(value || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone:'America/Chicago', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
}

function durationText(value) {
  const total = Math.max(0, Number(value || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function phoneText(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}` : String(value || '');
}

async function syncCalls({ force = false } = {}) {
  if (syncPromise) return syncPromise;
  if (!force && Date.now() - lastSyncAt < SYNC_COOLDOWN_MS) return { skipped:true };
  syncPromise = (async () => {
    const headers = await smsAuthHeaders();
    const response = await fetch('/api/ringcentral-sync', { headers, cache:'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to refresh call data.');
    lastSyncAt = Date.now();
    return payload;
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}

async function loadCalls({ clientId = '', limit = 500 } = {}) {
  let query = supabase
    .from('ringcentral_calls')
    .select('id,client_id,source_call_id,direction,result,started_at,duration_seconds,contact_phone,from_phone,to_phone,recording_id')
    .order('started_at', { ascending:false })
    .limit(limit);
  if (clientId) query = query.eq('client_id', clientId);
  const { data: calls, error } = await query;
  if (error) throw error;
  const rows = calls || [];
  const ids = Array.from(new Set(rows.map(row => row.client_id).filter(Boolean)));
  let clients = [];
  if (ids.length) {
    const { data, error: clientError } = await supabase.from('clients').select('id,first_name,last_name,phone').in('id', ids);
    if (clientError) throw clientError;
    clients = data || [];
  }
  const byId = new Map(clients.map(client => [client.id, client]));
  return rows.map(row => ({ ...row, client: byId.get(row.client_id) || null }));
}

function callRowMarkup(call, { showClient = true } = {}) {
  const client = call.client;
  const name = client ? [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client' : 'Client';
  const number = call.contact_phone || (call.direction === 'Inbound' ? call.from_phone : call.to_phone) || client?.phone || '';
  const result = call.result || (call.direction === 'Inbound' ? 'Inbound call' : 'Outbound call');
  const recording = call.recording_id ? `<div class="mh-recording-wrap" data-recording-wrap="${esc(call.recording_id)}"><button type="button" class="btn secondary" data-load-recording="${esc(call.recording_id)}">▶ Play Recording</button></div>` : '';
  return `<article class="mh-call-row ${String(call.direction || '').toLowerCase()}">
    <div class="mh-call-row-head"><div><span class="mh-call-direction">${esc(call.direction || 'Call')}</span>${showClient ? `<span class="mh-call-client">${esc(name)}</span>` : ''}</div><span class="mh-call-time">${esc(dateTime(call.started_at))}</span></div>
    <div class="mh-call-meta"><span>${esc(result)}</span><span>${esc(durationText(call.duration_seconds))}</span>${number ? `<span>${esc(phoneText(number))}</span>` : ''}</div>
    ${recording}
  </article>`;
}

async function bindRecordings(host) {
  host.querySelectorAll('[data-load-recording]').forEach(button => {
    if (button.dataset.boundRecording) return;
    button.dataset.boundRecording = 'true';
    button.onclick = async () => {
      const id = button.dataset.loadRecording;
      const wrap = button.closest('[data-recording-wrap]');
      if (!id || !wrap) return;
      button.disabled = true;
      button.textContent = 'Loading…';
      try {
        const headers = await smsAuthHeaders();
        const response = await fetch(`/api/ringcentral-recording?id=${encodeURIComponent(id)}`, { headers, cache:'no-store' });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'Unable to load recording.');
        }
        const blob = await response.blob();
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'metadata';
        audio.src = URL.createObjectURL(blob);
        audio.addEventListener('emptied', () => { if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src); }, { once:true });
        wrap.replaceChildren(audio);
        try { await audio.play(); } catch {}
      } catch (error) {
        button.disabled = false;
        button.textContent = '▶ Play Recording';
        let message = wrap.querySelector('.mh-recording-error');
        if (!message) { message = document.createElement('span'); message.className = 'mh-recording-error'; wrap.append(message); }
        message.textContent = error instanceof Error ? error.message : 'Unable to load recording.';
      }
    };
  });
}

async function drawGlobalCalls(panel, { message = '' } = {}) {
  if (!panel?.isConnected) return;
  const list = panel.querySelector('[data-call-list]');
  const status = panel.querySelector('[data-call-status]');
  try {
    const calls = await loadCalls({ limit:500 });
    if (!panel.isConnected) return;
    const inbound = calls.filter(call => call.direction === 'Inbound').length;
    const recordings = calls.filter(call => call.recording_id).length;
    panel.querySelector('[data-call-total]').textContent = String(calls.length);
    panel.querySelector('[data-call-inbound]').textContent = String(inbound);
    panel.querySelector('[data-call-recordings]').textContent = String(recordings);
    list.innerHTML = calls.length ? calls.map(call => callRowMarkup(call)).join('') : '<div class="mh-client-call-empty">No RingCentral call data is stored for M&H clients yet.</div>';
    status.textContent = message || `M&H client calls only · Updated ${new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}`;
    await bindRecordings(list);
  } catch (error) {
    if (panel.isConnected) status.textContent = error instanceof Error ? error.message : 'Unable to load call data.';
  }
}

function decorateCommunications(host) {
  if (!host?.isConnected || host.dataset.callTabsMounted) return;
  host.dataset.callTabsMounted = 'true';

  const existing = Array.from(host.childNodes);
  const tabs = document.createElement('div');
  tabs.className = 'mh-comm-channel-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = '<button type="button" class="active" role="tab" aria-selected="true" data-channel="texts">Text Messages</button><button type="button" role="tab" aria-selected="false" data-channel="calls">Call Data</button>';

  const textPanel = document.createElement('div');
  textPanel.className = 'mh-text-panel';
  textPanel.dataset.channelPanel = 'texts';
  existing.forEach(node => textPanel.append(node));

  const callPanel = document.createElement('section');
  callPanel.className = 'mh-call-panel';
  callPanel.dataset.channelPanel = 'calls';
  callPanel.hidden = true;
  callPanel.innerHTML = `<div class="mh-call-head"><div><span class="eyebrow">RingCentral</span><h2>Client Call Data</h2><p>Read-only call history and recordings for saved M&H clients. Calling is not enabled in this CRM.</p></div><div class="mh-call-actions"><button type="button" class="btn secondary" data-refresh-calls>Refresh Call Data</button></div></div>
    <div class="mh-call-summary"><div><span>Stored Calls</span><strong data-call-total>—</strong></div><div><span>Inbound</span><strong data-call-inbound>—</strong></div><div><span>Recordings</span><strong data-call-recordings>—</strong></div></div>
    <div class="mh-call-status" data-call-status>Open Call Data to load saved calls.</div><div class="mh-call-list" data-call-list></div>`;

  host.replaceChildren(tabs, textPanel, callPanel);
  let callsLoaded = false;
  const choose = async channel => {
    tabs.querySelectorAll('[data-channel]').forEach(button => {
      const active = button.dataset.channel === channel;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    textPanel.hidden = channel !== 'texts';
    callPanel.hidden = channel !== 'calls';
    if (channel === 'calls' && !callsLoaded) {
      callsLoaded = true;
      await drawGlobalCalls(callPanel);
      syncCalls().then(result => {
        if (!result?.skipped && callPanel.isConnected) void drawGlobalCalls(callPanel, { message:`Call data refreshed · ${result.matched || 0} matched calls` });
      }).catch(error => { if (callPanel.isConnected) callPanel.querySelector('[data-call-status]').textContent = error.message || 'Unable to refresh call data.'; });
    }
  };
  tabs.querySelectorAll('[data-channel]').forEach(button => button.onclick = () => void choose(button.dataset.channel));
  callPanel.querySelector('[data-refresh-calls]').onclick = async () => {
    const button = callPanel.querySelector('[data-refresh-calls]');
    button.disabled = true;
    callPanel.querySelector('[data-call-status]').textContent = 'Refreshing matched M&H client calls…';
    try {
      const result = await syncCalls({ force:true });
      await drawGlobalCalls(callPanel, { message:`Call data refreshed · ${result.matched || 0} matched calls · ${result.recordings || 0} recordings` });
    } catch (error) {
      callPanel.querySelector('[data-call-status]').textContent = error instanceof Error ? error.message : 'Unable to refresh call data.';
    } finally { button.disabled = false; }
  };

  // Keep call data current without delaying the Text Messages screen.
  window.setTimeout(() => syncCalls().catch(() => {}), 1200);
}

function mountCommunicationsTabs() {
  if (!location.hash.startsWith('#/communications')) return;
  const host = document.querySelector('#sms-communications-center');
  if (host) { decorateCommunications(host); return; }
  const content = document.querySelector('.content');
  if (!content || routeObserver) return;
  routeObserver = new MutationObserver(() => {
    const found = document.querySelector('#sms-communications-center');
    if (found) { routeObserver?.disconnect(); routeObserver = null; decorateCommunications(found); }
  });
  routeObserver.observe(content, { childList:true, subtree:true });
}

async function drawClientCalls(container, clientId) {
  if (!container?.isConnected || !clientId) return;
  const status = container.querySelector('[data-client-call-status]');
  const list = container.querySelector('[data-client-call-list]');
  status.textContent = 'Loading saved call data…';
  try {
    const calls = await loadCalls({ clientId, limit:125 });
    if (!container.isConnected) return;
    list.innerHTML = calls.length ? calls.map(call => callRowMarkup(call, { showClient:false })).join('') : '<div class="mh-client-call-empty">No RingCentral calls are stored for this client yet.</div>';
    status.textContent = `${calls.length} stored call${calls.length === 1 ? '' : 's'}${calls.some(call => call.recording_id) ? ' · recordings available' : ''}`;
    await bindRecordings(list);
  } catch (error) {
    if (container.isConnected) status.textContent = error instanceof Error ? error.message : 'Unable to load client call history.';
  }
}

function attachClientHistory(dialog) {
  if (!dialog?.isConnected || dialog.dataset.callHistoryMounted) return;
  const clientId = dialog.dataset.smsClientId || '';
  const panel = dialog.querySelector('#client-panel-information');
  if (!clientId || !panel) return;
  dialog.dataset.callHistoryMounted = 'true';
  const details = document.createElement('details');
  details.className = 'mh-client-call-history';
  details.innerHTML = `<summary><span>Call Data &amp; Recordings</span><small>Read-only RingCentral history</small></summary><div class="mh-client-call-body"><div class="mh-call-status" data-client-call-status>Open to load call history.</div><div class="mh-call-list" data-client-call-list></div></div>`;
  panel.append(details);
  let loaded = false;
  details.addEventListener('toggle', () => {
    if (!details.open || loaded) return;
    loaded = true;
    void drawClientCalls(details, clientId);
    syncCalls().then(result => { if (!result?.skipped && details.isConnected) void drawClientCalls(details, clientId); }).catch(() => {});
  });
}

function scanClientDialogs() {
  document.querySelectorAll('dialog.client-dialog').forEach(dialog => attachClientHistory(dialog));
}

installStyles();
window.addEventListener('hashchange', () => window.setTimeout(mountCommunicationsTabs, 0));
window.addEventListener('focus', () => { if (location.hash.startsWith('#/communications')) window.setTimeout(mountCommunicationsTabs, 0); });
new MutationObserver(scanClientDialogs).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['data-sms-client-id'] });
window.setTimeout(() => { mountCommunicationsTabs(); scanClientDialogs(); }, 0);

window.MHRingCentralReadOnly = { syncCalls, loadCalls };
