import { communicationsChanged, releaseRecordings } from './communications-events.js';
import { supabase } from './supabase-repository.js';
import { updateGlobalUnread } from './client-texting.js';

const MH_TEXT_START = '2026-09-15T07:50:00.000Z';
let scanTimer = null;
let scanning = false;

function installStyles() {
  if (document.querySelector('#mh-communications-delete-styles')) return;
  const style = document.createElement('style');
  style.id = 'mh-communications-delete-styles';
  style.textContent = `
    .sms-conversation-manage{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:stretch;min-width:0}
    .sms-conversation-manage>.sms-conversation-card{min-width:0}
    .mh-comm-delete{border:1px solid #ddb9b4;background:#fff8f7;color:#963d34;border-radius:10px;padding:7px 10px;font:inherit;font-size:.72rem;font-weight:850;cursor:pointer;white-space:nowrap;align-self:center}
    .mh-comm-delete:hover{background:#fff0ee;border-color:#cc9088}.mh-comm-delete:disabled{opacity:.55;cursor:wait}
    .sms-conversation-manage>.mh-comm-delete{height:100%;min-width:72px;border-radius:13px}
    .sms-bubble{position:relative}.sms-bubble .mh-message-delete-row{display:flex;justify-content:flex-end;margin-top:6px}.sms-bubble.inbound .mh-message-delete-row{justify-content:flex-start}
    .sms-bubble .mh-comm-delete{padding:3px 7px;font-size:.62rem;border-radius:7px;background:transparent}
    .mh-call-delete-row{display:flex;justify-content:flex-end;margin-top:2px}.mh-call-delete-row .mh-comm-delete{padding:4px 8px;font-size:.65rem}
    .mh-comm-toast{position:fixed;right:18px;bottom:18px;z-index:100000;max-width:min(430px,calc(100vw - 36px));padding:10px 12px;border-radius:10px;background:#203642;color:#fff;box-shadow:0 10px 35px rgba(10,25,34,.25);font-size:.78rem;font-weight:750}
    .mh-comm-toast.error{background:#8b352d}
    @media(max-width:620px){.sms-conversation-manage{grid-template-columns:1fr}.sms-conversation-manage>.mh-comm-delete{height:auto;width:100%}.mh-comm-toast{left:12px;right:12px;bottom:12px;max-width:none}}
  `;
  document.head.append(style);
}

function toast(message, error = false) {
  document.querySelectorAll('.mh-comm-toast').forEach(node => node.remove());
  const node = document.createElement('div');
  node.className = `mh-comm-toast${error ? ' error' : ''}`;
  node.textContent = message;
  document.body.append(node);
  window.setTimeout(() => node.remove(), 3200);
}

async function hide(kind, id) {
  const { error } = await supabase.rpc('hide_my_communication', { p_kind:kind, p_id:id });
  if (error) throw error;
}
const hideTextMessage = id => hide('text', id);
const hideTextConversation = id => hide('conversation', id);
const hideCall = id => hide('call', id);

function refreshTextMetrics(clientId = '') {
  communicationsChanged('texts', clientId);
  return updateGlobalUnread().catch(() => {});
}
function refreshCallMetrics() {
  communicationsChanged('calls');
}
function revokeAudioInside(node) { releaseRecordings(node); }

async function decorateConversationCards() {
  const container = document.querySelector('#sms-communications-center [data-sms-conversations]');
  if (!container) return;
  const cards = Array.from(container.querySelectorAll(':scope > .sms-conversation-card'));
  for (const card of cards) {
    const clientId = card.dataset.smsConversation || '';
    if (!clientId || card.closest('.sms-conversation-manage')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'sms-conversation-manage';
    card.insertAdjacentElement('beforebegin', wrap);
    wrap.append(card);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mh-comm-delete';
    button.textContent = 'Delete';
    button.title = 'Remove this conversation from Mayer MIG CRM';
    wrap.append(button);
    button.onclick = async event => {
      event.preventDefault();
      event.stopPropagation();
      if (!window.confirm('Delete this entire text conversation from Mayer MIG CRM?\n\nThe original Twilio records will not be deleted, and this conversation will stay hidden after future syncs.')) return;
      button.disabled = true;
      try {
        await hideTextConversation(clientId);
        wrap.remove();
        await refreshTextMetrics(clientId);
        toast('Text conversation removed from Mayer MIG CRM.');
      } catch (error) {
        button.disabled = false;
        toast(error instanceof Error ? error.message : 'Unable to delete the text conversation.', true);
      }
    };
  }
}

async function decorateTextDialogs() {
  const dialogs = Array.from(document.querySelectorAll('dialog.sms-thread-dialog[data-client-id]'));
  for (const dialog of dialogs) {
    if (!dialog.isConnected) continue;
    const clientId = dialog.dataset.clientId || '';
    if (!clientId) continue;
    const bubbles = Array.from(dialog.querySelectorAll('[data-sms-thread] > .sms-bubble[data-message-id]'));
    for (const bubble of bubbles) {
      const row = { id: bubble.dataset.messageId };
      if (!row.id || bubble.dataset.clientId !== clientId || bubble.dataset.deleteMessageId === row.id) continue;
      bubble.dataset.deleteMessageId = row.id;
      bubble.querySelector('.mh-message-delete-row')?.remove();
      const action = document.createElement('div');
      action.className = 'mh-message-delete-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mh-comm-delete';
      button.textContent = 'Delete';
      action.append(button);
      bubble.append(action);
      button.onclick = async event => {
        event.preventDefault();
        event.stopPropagation();
        if (!window.confirm('Delete this text from Mayer MIG CRM?\n\nThe original Twilio record will remain, but this text will stay hidden in Mayer MIG after future syncs.')) return;
        button.disabled = true;
        try {
          await hideTextMessage(row.id);
          bubble.remove();
          const thread = dialog.querySelector('[data-sms-thread]');
          if (thread && !thread.querySelector('.sms-bubble')) thread.innerHTML = '<div class="sms-empty">No visible messages in this conversation.</div>';
          await refreshTextMetrics(clientId);
          toast('Text removed from Mayer MIG CRM.');
        } catch (error) {
          button.disabled = false;
          toast(error instanceof Error ? error.message : 'Unable to delete the text.', true);
        }
      };
    }
  }
}

function addCallDeleteButton(rowNode, callId, afterDelete) {
  if (!rowNode || !callId || rowNode.dataset.deleteCallId === callId) return;
  rowNode.dataset.deleteCallId = callId;
  rowNode.querySelector('.mh-call-delete-row')?.remove();
  const action = document.createElement('div');
  action.className = 'mh-call-delete-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mh-comm-delete';
  button.textContent = 'Delete Call';
  action.append(button);
  rowNode.append(action);
  button.onclick = async event => {
    event.preventDefault();
    event.stopPropagation();
    if (!window.confirm('Delete this call record from Mayer MIG CRM?\n\nThe original RingCentral call and recording will remain in RingCentral, but this call will stay hidden in Mayer MIG after future syncs.')) return;
    button.disabled = true;
    try {
      await hideCall(callId);
      revokeAudioInside(rowNode);
      document.querySelectorAll('.mh-call-row[data-call-id]').forEach(node => {
        if (node.dataset.callId === callId) { releaseRecordings(node); node.remove(); }
      });
      await afterDelete?.();
      toast('Call record removed from Mayer MIG CRM.');
    } catch (error) {
      button.disabled = false;
      toast(error instanceof Error ? error.message : 'Unable to delete the call record.', true);
    }
  };
}

function decorateGlobalCalls() {
  document.querySelectorAll('[data-call-list] > .mh-call-row[data-call-id]').forEach(row => {
    addCallDeleteButton(row, row.dataset.callId, refreshCallMetrics);
  });
}
function decorateClientCallDialogs() {
  document.querySelectorAll('dialog.mh-call-data-dialog[data-client-id]').forEach(dialog => {
    dialog.querySelectorAll('[data-client-call-dialog-list] > .mh-call-row[data-call-id]').forEach(row => {
      addCallDeleteButton(row, row.dataset.callId, () => {
        const remaining = dialog.querySelectorAll('.mh-call-row[data-call-id]');
        const recordings = Array.from(remaining).filter(node => node.dataset.recordingId).length;
        const status = dialog.querySelector('[data-client-call-dialog-status]');
        if (status) status.textContent = `${remaining.length} stored calls · ${recordings} recordings`;
        refreshCallMetrics();
      });
    });
  });
}

async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    await decorateConversationCards();
    await decorateTextDialogs();
    await decorateGlobalCalls();
    await decorateClientCallDialogs();
  } finally { scanning = false; }
}

function scheduleScan() {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scan(), 60);
}

installStyles();
window.addEventListener('mig:communications-rendered', scheduleScan);
window.addEventListener('hashchange', scheduleScan);
window.addEventListener('focus', scheduleScan);
window.setTimeout(() => void scan(), 0);
