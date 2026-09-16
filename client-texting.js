import { smsAuthHeaders, syncSms } from './sms-sync.js';
export { smsAuthHeaders } from './sms-sync.js';
import { communicationsRendered, communicationsChanged } from './communications-events.js';
import { mhRepository, supabase } from './supabase-repository.js';
import { Dialogs } from './dialogs.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const timeText = value => {
  const d = new Date(value || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone: 'America/Chicago', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
};

async function clientSummary(clientId) {
  const { data, error } = await supabase.from('clients').select('id,first_name,last_name,phone').eq('id', clientId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Client not found.');
  return data;
}

async function clientMessages(clientId) {
  const { data, error } = await supabase
    .from('client_sms_messages')
    .select('id,client_id,direction,body,status,error_code,error_message,read_at,occurred_at,created_at')
    .eq('client_id', clientId)
    .order('occurred_at', { ascending: false }).order('id', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).reverse();
}

async function markClientRead(clientId) {
  const { error } = await supabase
    .from('client_sms_messages')
    .update({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('direction', 'inbound')
    .is('read_at', null);
  if (error) throw error;
}

function renderMessages(host, messages) {
  const atBottom = !host.querySelector('.sms-bubble') || host.scrollHeight - host.clientHeight - host.scrollTop < 80;
  const oldTop = host.scrollTop;
  host.innerHTML = messages.length ? messages.map(message => {
    const incoming = message.direction === 'inbound';
    const status = incoming ? 'Received' : (message.status || 'Sent');
    const error = message.error_code ? ` · Error ${esc(message.error_code)}` : '';
    return `<article class="sms-bubble ${incoming ? 'inbound' : 'outbound'}" data-message-id="${esc(message.id)}" data-client-id="${esc(message.client_id)}">
      <div>${esc(message.body).replace(/\n/g, '<br>')}</div>
      <small>${esc(timeText(message.occurred_at || message.created_at))} · ${esc(status)}${error}</small>
    </article>`;
  }).join('') : '<div class="sms-empty">No messages yet. Send the first text below.</div>';
  host.scrollTop = atBottom ? host.scrollHeight : oldTop;
  communicationsRendered(host);
}

export async function openClientThread(clientId) {
  if (!clientId) return;
  const existing = document.querySelector(`dialog.sms-thread-dialog[data-client-id="${CSS.escape(clientId)}"]`);
  if (existing) { existing.focus(); return; }

  const dialog = document.createElement('dialog');
  dialog.className = 'sms-thread-dialog';
  dialog.dataset.clientId = clientId;
  dialog.innerHTML = `<div class="sms-thread-frame">
    <header class="sms-thread-head"><div><h2>Text Client</h2><p data-sms-client-phone>Loading…</p></div><div class="sms-head-actions"><button type="button" class="btn secondary" data-sms-refresh>Refresh</button><button type="button" class="btn secondary" data-sms-close>Close</button></div></header>
    <div class="sms-thread" data-sms-thread aria-live="polite"><div class="sms-empty">Loading messages…</div></div>
    <div class="sms-thread-error" data-sms-error hidden></div>
    <footer class="sms-compose"><textarea maxlength="1500" rows="4" placeholder="Type a text message…" data-sms-body></textarea><div class="sms-compose-actions"><span data-sms-count>0/1500</span><button type="button" class="btn primary" data-sms-send>Send Text</button></div></footer>
  </div>`;
  document.body.append(dialog);
  dialog.showModal();
  communicationsRendered(dialog);

  const thread = dialog.querySelector('[data-sms-thread]');
  const phoneLine = dialog.querySelector('[data-sms-client-phone]');
  const body = dialog.querySelector('[data-sms-body]');
  const sendButton = dialog.querySelector('[data-sms-send]');
  const errorBox = dialog.querySelector('[data-sms-error]');
  const count = dialog.querySelector('[data-sms-count]');
  let client = null;
  let busy = false;
  let closed = false;
  let timer = null;
  let syncing = false;
  let lastMessageSnapshot = null;

  const showError = message => {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  };

  async function load() {
    if (busy || closed) return;
    busy = true;
    try {
      client ||= await clientSummary(clientId);
      const name = [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client';
      dialog.querySelector('h2').textContent = `Text ${name}`;
      phoneLine.textContent = client.phone || 'No phone number entered';
      const messages = await clientMessages(clientId);
      if (closed || !dialog.isConnected) return;
      const snapshot = JSON.stringify(messages);
      if (snapshot !== lastMessageSnapshot) { renderMessages(thread, messages); lastMessageSnapshot = snapshot; }
      if (messages.some(message => message.direction === 'inbound' && !message.read_at)) await markClientRead(clientId);
      sendButton.disabled = !client.phone;
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to load text conversation.');
    } finally {
      busy = false;
    }
  }

  async function syncInBackground(force = false) {
    if (closed || syncing) return;
    syncing = true;
    try {
      const result = await syncSms(clientId, { force });
      if (!closed && !result?.skipped) { await load(); communicationsChanged('texts', clientId); }
    } catch (error) { if (!closed) showError(error.message || 'Unable to check for new texts. Saved messages remain available.'); }
    finally { syncing = false; }
  }

  async function send() {
    const text = body.value.trim();
    if (!text || busy) return;
    busy = true;
    sendButton.disabled = true;
    showError('');
    sendButton.textContent = 'Sending…';
    try {
      const headers = { ...(await smsAuthHeaders()), 'Content-Type': 'application/json' };
      const response = await fetch('/api/twilio-send', {
        method: 'POST', headers,
        body: JSON.stringify({ clientId, body: text })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to send text.');
      body.value = '';
      count.textContent = '0/1500';
      busy = false;
      await load();
      communicationsChanged('texts', clientId);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to send text.');
    } finally {
      busy = false;
      sendButton.disabled = !client?.phone;
      sendButton.textContent = 'Send Text';
    }
  }

  body.addEventListener('input', () => count.textContent = `${body.value.length}/1500`);
  body.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void send(); }
  });
  sendButton.onclick = () => void send();
  dialog.querySelector('[data-sms-refresh]').onclick = () => { showError(''); void load(); void syncInBackground(true); };
  dialog.querySelector('[data-sms-close]').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  dialog.addEventListener('close', () => { closed = true; if (timer) window.clearInterval(timer); dialog.remove(); updateGlobalUnread().catch(() => {}); });

  await load();
  if (!closed) void syncInBackground();
  const onChanged = event => {
    if (event.detail?.kind === 'texts' && (!event.detail.clientId || event.detail.clientId === clientId)) void load();
  };
  window.addEventListener('mig:communications-changed', onChanged);
  dialog.addEventListener('close', () => window.removeEventListener('mig:communications-changed', onChanged), { once:true });
  if (!closed) timer = window.setInterval(() => {
    if (!closed && document.visibilityState === 'visible') { void load(); void syncInBackground(); }
  }, 30000);
}

async function unreadForClient(clientId) {
  const { count, error } = await supabase.from('client_sms_messages').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('direction', 'inbound').is('read_at', null);
  if (error) return 0;
  return count || 0;
}

function attachTextButton(controller, initialId = '') {
  const node = controller.node;
  if (!node?.classList.contains('client-dialog') || node.querySelector('[data-text-client]')) return;
  const actions = node.querySelector('.modal-footer .footer-actions') || node.querySelector('.modal-footer');
  if (!actions) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn secondary client-text-button';
  button.dataset.textClient = '';
  button.textContent = '✉ Text Client';
  actions.prepend(button);

  const setId = async id => {
    if (!id) return;
    node.dataset.smsClientId = id;
    button.disabled = false;
    const unread = await unreadForClient(id);
    button.textContent = unread ? `✉ Text Client (${unread})` : '✉ Text Client';
  };
  button.disabled = !initialId;
  if (initialId) void setId(initialId);
  button.onclick = () => {
    const id = node.dataset.smsClientId;
    if (id) void openClientThread(id);
  };

  if (!initialId) {
    const onLoaded = event => {
      if (!node.isConnected || node.dataset.smsClientId) return;
      if (event.detail?.id) void setId(event.detail.id);
    };
    window.addEventListener('mh:sms-client-loaded', onLoaded);
    window.setTimeout(() => window.removeEventListener('mh:sms-client-loaded', onLoaded), 4000);
  }
  controller.__setSmsClientId = setId;
}

if (!mhRepository.__smsClientLoadPatched) {
  mhRepository.__smsClientLoadPatched = true;
  const originalGetClient = mhRepository.getClient.bind(mhRepository);
  mhRepository.getClient = async function(id) {
    const result = await originalGetClient(id);
    if (result?.id) window.dispatchEvent(new CustomEvent('mh:sms-client-loaded', { detail: { id: result.id } }));
    return result;
  };
}

if (!Dialogs.prototype.__smsPatched) {
  Dialogs.prototype.__smsPatched = true;
  const originalOpen = Dialogs.prototype.open;
  Dialogs.prototype.open = function(options = {}) {
    if (options.kind !== 'client-dialog') return originalOpen.call(this, options);
    const invoker = document.activeElement;
    const initialId = invoker?.getAttribute?.('data-client-id') || '';
    let controller;
    const originalSave = options.onSave;
    controller = originalOpen.call(this, {
      ...options,
      onSave: originalSave ? async form => {
        const result = await originalSave(form);
        const id = mhRepository.lastSavedClientId;
        if (id) await controller?.__setSmsClientId?.(id);
        return result;
      } : null
    });
    attachTextButton(controller, initialId);
    return controller;
  };
}

export async function updateGlobalUnread() {
  const { count, error } = await supabase.from('client_sms_messages').select('id', { count: 'exact', head: true }).eq('direction', 'inbound').is('read_at', null);
  if (error) return 0;
  const unread = count || 0;
  const link = document.querySelector('.nav a[href="#/communications"]');
  if (link) {
    let badge = link.querySelector('.sms-nav-badge');
    if (!badge && unread) { badge = document.createElement('span'); badge.className = 'sms-nav-badge'; link.append(badge); }
    if (badge) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.hidden = !unread;
    }
  }
  return unread;
}

window.MHTexting = { openClientThread, updateGlobalUnread };
window.setTimeout(() => updateGlobalUnread().catch(() => {}), 800);
window.setInterval(() => { if (document.visibilityState === 'visible') updateGlobalUnread().catch(() => {}); }, 60000);
