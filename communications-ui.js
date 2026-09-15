import { mhRepository, supabase } from './supabase-repository.js';
import { openClientThread, smsAuthHeaders, updateGlobalUnread } from './client-texting.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const when = value => {
  const d = new Date(value || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone:'America/Chicago', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
};
let refreshTimer = null;
let loading = false;

async function syncRecent() {
  const headers = await smsAuthHeaders();
  const response = await fetch('/api/twilio-sync', { headers, cache:'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Twilio message sync failed.');
  return payload;
}

async function conversationRows() {
  const { data: messages, error } = await supabase
    .from('client_sms_messages')
    .select('id,client_id,direction,body,status,read_at,occurred_at,created_at')
    .order('occurred_at', { ascending:false })
    .limit(1000);
  if (error) throw error;
  const ids = Array.from(new Set((messages || []).map(row => row.client_id).filter(Boolean)));
  let clients = [];
  if (ids.length) {
    const { data, error: clientError } = await supabase.from('clients').select('id,first_name,last_name,phone').in('id', ids);
    if (clientError) throw clientError;
    clients = data || [];
  }
  const byId = new Map(clients.map(client => [client.id, client]));
  const groups = new Map();
  for (const message of messages || []) {
    let group = groups.get(message.client_id);
    if (!group) {
      group = { client: byId.get(message.client_id) || { id:message.client_id, first_name:'Client', last_name:'', phone:'' }, latest:message, unread:0, count:0 };
      groups.set(message.client_id, group);
    }
    group.count += 1;
    if (message.direction === 'inbound' && !message.read_at) group.unread += 1;
  }
  return Array.from(groups.values());
}

function conversationMarkup(groups) {
  if (!groups.length) return '<div class="sms-center-empty"><h3>No text conversations yet</h3><p>Send a text from a client file or start a mass text. Replies will appear here.</p></div>';
  return groups.map(group => {
    const client = group.client;
    const name = [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client';
    const latest = group.latest;
    return `<button type="button" class="sms-conversation-card${group.unread ? ' has-unread' : ''}" data-sms-conversation="${esc(client.id)}">
      <span class="sms-conversation-name"><strong>${esc(name)}</strong><small>${esc(client.phone || 'No phone')}</small></span>
      <span class="sms-conversation-preview"><span>${esc(latest.body || '').slice(0,150)}</span><small>${esc(latest.direction === 'inbound' ? 'Received' : 'Sent')} · ${esc(when(latest.occurred_at || latest.created_at))}</small></span>
      ${group.unread ? `<span class="sms-conversation-unread">${group.unread > 99 ? '99+' : group.unread}</span>` : '<span class="sms-conversation-arrow">›</span>'}
    </button>`;
  }).join('');
}

async function loadCenter(host, { sync = false } = {}) {
  if (!host?.isConnected || loading) return;
  loading = true;
  const status = host.querySelector('[data-sms-center-status]');
  try {
    if (sync) {
      status.textContent = 'Syncing Twilio replies…';
      await syncRecent();
    }
    const groups = await conversationRows();
    if (!host.isConnected) return;
    const unread = groups.reduce((sum, group) => sum + group.unread, 0);
    host.querySelector('[data-sms-unread-total]').textContent = String(unread);
    host.querySelector('[data-sms-conversation-total]').textContent = String(groups.length);
    host.querySelector('[data-sms-conversations]').innerHTML = conversationMarkup(groups);
    host.querySelectorAll('[data-sms-conversation]').forEach(button => button.onclick = async () => {
      await openClientThread(button.dataset.smsConversation);
      if (host.isConnected) void loadCenter(host);
    });
    status.textContent = `Updated ${new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}`;
    await updateGlobalUnread();
  } catch (error) {
    if (host.isConnected) status.textContent = error instanceof Error ? error.message : 'Unable to load text messages.';
  } finally {
    loading = false;
  }
}

function massTextDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'sms-mass-dialog';
  dialog.innerHTML = `<div class="sms-mass-frame">
    <header><div><h2>Mass Text Clients</h2><p>Each client receives a separate text. Recipients never see one another.</p></div><button type="button" class="btn secondary" data-mass-close>Close</button></header>
    <div class="sms-mass-grid">
      <section class="sms-recipient-picker"><label class="field"><span>Find Clients</span><input type="search" placeholder="Name, phone, email…" data-mass-search autocomplete="off"></label><div class="sms-recipient-results" data-mass-results></div></section>
      <section class="sms-mass-compose"><div class="sms-selected-head"><strong>Selected Recipients</strong><span data-mass-selected-count>0</span></div><div class="sms-selected-list" data-mass-selected><p>No clients selected.</p></div><label class="field"><span>Message</span><textarea rows="7" maxlength="1500" placeholder="Type the message to send…" data-mass-body></textarea></label><div class="sms-mass-footer"><span data-mass-char-count>0/1500</span><button type="button" class="btn primary" data-mass-send disabled>Send Mass Text</button></div><div class="sms-mass-status" data-mass-status></div></section>
    </div>
  </div>`;
  document.body.append(dialog);
  dialog.showModal();

  const selected = new Map();
  const search = dialog.querySelector('[data-mass-search]');
  const results = dialog.querySelector('[data-mass-results]');
  const selectedList = dialog.querySelector('[data-mass-selected]');
  const selectedCount = dialog.querySelector('[data-mass-selected-count]');
  const body = dialog.querySelector('[data-mass-body]');
  const send = dialog.querySelector('[data-mass-send]');
  const status = dialog.querySelector('[data-mass-status]');
  let searchToken = 0;
  let sending = false;

  function drawSelected() {
    selectedCount.textContent = `${selected.size}/250`;
    selectedList.innerHTML = selected.size ? Array.from(selected.values()).map(client => `<span class="sms-selected-chip">${esc([client.first_name,client.last_name].filter(Boolean).join(' ') || 'Client')}<button type="button" data-remove-selected="${esc(client.id)}" aria-label="Remove">×</button></span>`).join('') : '<p>No clients selected.</p>';
    selectedList.querySelectorAll('[data-remove-selected]').forEach(button => button.onclick = () => { selected.delete(button.dataset.removeSelected); drawSelected(); void drawResults(); });
    send.disabled = !selected.size || !body.value.trim() || sending;
  }

  async function searchClients() {
    const token = ++searchToken;
    results.innerHTML = '<p class="subtle">Searching…</p>';
    try {
      const found = await mhRepository.searchClients({ query: search.value.trim(), limit:50 });
      if (token !== searchToken) return;
      const rows = found?.rows || [];
      results.innerHTML = rows.length ? rows.map(client => {
        const checked = selected.has(client.id);
        const disabled = !client.phone || String(client.status || '').toLowerCase() === 'deceased';
        const name = [client.first_name,client.last_name].filter(Boolean).join(' ') || 'Client';
        return `<label class="sms-recipient-row${disabled ? ' is-disabled' : ''}"><input type="checkbox" data-recipient-id="${esc(client.id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span><strong>${esc(name)}</strong><small>${esc(client.phone || 'No phone number')}${String(client.status || '').toLowerCase() === 'deceased' ? ' · Deceased' : ''}</small></span></label>`;
      }).join('') : '<p class="subtle">No matching clients.</p>';
      results.querySelectorAll('[data-recipient-id]').forEach(input => input.onchange = () => {
        const client = rows.find(row => row.id === input.dataset.recipientId);
        if (!client) return;
        if (input.checked) {
          if (selected.size >= 250) { input.checked = false; status.textContent = 'Mass text is limited to 250 clients at a time.'; return; }
          selected.set(client.id, client);
        } else selected.delete(client.id);
        drawSelected();
      });
    } catch (error) {
      if (token === searchToken) results.innerHTML = `<p class="notice error">${esc(error instanceof Error ? error.message : 'Search failed.')}</p>`;
    }
  }

  async function drawResults() { await searchClients(); }
  let debounce = null;
  search.oninput = () => { window.clearTimeout(debounce); debounce = window.setTimeout(searchClients, 220); };
  body.oninput = () => { dialog.querySelector('[data-mass-char-count]').textContent = `${body.value.length}/1500`; drawSelected(); };
  send.onclick = async () => {
    const message = body.value.trim();
    if (!message || !selected.size || sending) return;
    sending = true; drawSelected(); status.textContent = `Sending ${selected.size} separate texts…`;
    try {
      const headers = { ...(await smsAuthHeaders()), 'Content-Type':'application/json' };
      const response = await fetch('/api/twilio-bulk', { method:'POST', headers, body:JSON.stringify({ clientIds:Array.from(selected.keys()), body:message }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && !payload.sent) throw new Error(payload.error || 'Mass text failed.');
      status.textContent = payload.failed ? `Finished: ${payload.sent} sent, ${payload.failed} failed. ${Array.isArray(payload.failures) ? payload.failures.slice(0,3).join(' • ') : ''}` : `Sent successfully to all ${payload.sent} clients.`;
      if (payload.sent) body.value = '';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Mass text failed.';
    } finally {
      sending = false; drawSelected();
    }
  };
  dialog.querySelector('[data-mass-close]').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  dialog.addEventListener('close', () => { window.clearTimeout(debounce); dialog.remove(); });
  void searchClients();
}

function mountCommunications() {
  if (!location.hash.startsWith('#/communications')) {
    window.clearInterval(refreshTimer); refreshTimer = null; return;
  }
  const content = document.querySelector('.content');
  if (!content) return;
  let host = content.querySelector('#sms-communications-center');
  if (!host) {
    const old = Array.from(content.children).find(node => node.matches?.('.panel-card'));
    if (!old) return;
    host = document.createElement('section');
    host.id = 'sms-communications-center';
    host.className = 'sms-center';
    old.replaceWith(host);
  }
  if (!host.dataset.mounted) {
    host.dataset.mounted = 'true';
    host.innerHTML = `<div class="sms-center-head"><div><span class="eyebrow">Twilio</span><h2>Client Text Messages</h2><p>Office number: (662) 572-2425</p></div><div class="sms-center-actions"><button type="button" class="btn secondary" data-sms-sync>Sync Replies</button><button type="button" class="btn primary" data-sms-mass>+ Mass Text</button></div></div>
      <div class="sms-center-metrics"><div><span>Unread Replies</span><strong data-sms-unread-total>—</strong></div><div><span>Conversations</span><strong data-sms-conversation-total>—</strong></div><div><span>Twilio</span><strong class="sms-connected">Connected</strong></div></div>
      <div class="sms-center-status" data-sms-center-status>Loading text conversations…</div>
      <div class="sms-conversations" data-sms-conversations></div>`;
    host.querySelector('[data-sms-sync]').onclick = () => void loadCenter(host, { sync:true });
    host.querySelector('[data-sms-mass]').onclick = massTextDialog;
  }
  void loadCenter(host, { sync:true });
  window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => { if (location.hash.startsWith('#/communications') && document.visibilityState === 'visible') void loadCenter(host, { sync:true }); }, 45000);
}

window.addEventListener('hashchange', () => window.setTimeout(mountCommunications, 0));
window.addEventListener('focus', () => { if (location.hash.startsWith('#/communications')) window.setTimeout(mountCommunications, 0); });
window.setTimeout(mountCommunications, 0);
