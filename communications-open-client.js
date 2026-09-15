import { mhRepository, supabase } from './supabase-repository.js';
import { Dialogs } from './dialogs.js';
import { hydrate, serializable } from './core.js';
import { clientForm, saveFooter, icon, empty } from './views.js';

const dialogs = new Dialogs();
let scanTimer = null;
let scanning = false;

function installStyles() {
  if (document.querySelector('#mh-communications-open-client-styles')) return;
  const style = document.createElement('style');
  style.id = 'mh-communications-open-client-styles';
  style.textContent = `
    .mh-open-client{border:1px solid #b8cad6;background:#f5f9fb;color:#28495e;border-radius:10px;padding:7px 10px;font:inherit;font-size:.72rem;font-weight:850;cursor:pointer;white-space:nowrap}
    .mh-open-client:hover{background:#eaf2f6;border-color:#91acbd}.mh-open-client:disabled{opacity:.55;cursor:wait}
    .sms-conversation-manage{grid-template-columns:minmax(0,1fr) auto auto!important}
    .sms-conversation-manage>.mh-open-client{height:100%;min-width:96px;border-radius:13px}
    .mh-message-delete-row,.mh-call-delete-row{gap:6px;flex-wrap:wrap}
    .sms-bubble .mh-open-client{padding:3px 7px;font-size:.62rem;border-radius:7px;background:transparent}
    .mh-call-delete-row .mh-open-client{padding:4px 8px;font-size:.65rem}
    .sms-head-actions .mh-open-client{padding:8px 10px}
    @media(max-width:620px){
      .sms-conversation-manage{grid-template-columns:1fr 1fr!important}
      .sms-conversation-manage>.sms-conversation-card{grid-column:1/-1}
      .sms-conversation-manage>.mh-open-client,.sms-conversation-manage>.mh-comm-delete{width:100%;height:auto}
    }
  `;
  document.head.append(style);
}

function wireTabs(node) {
  const buttons = Array.from(node.querySelectorAll('[data-tab]'));
  function choose(button) {
    buttons.forEach(b => {
      b.setAttribute('aria-selected', String(b === button));
      b.tabIndex = b === button ? 0 : -1;
    });
    node.querySelectorAll('[data-panel]').forEach(panel => panel.hidden = panel.dataset.panel !== button.dataset.tab);
  }
  buttons.forEach((button, index) => {
    button.onclick = () => choose(button);
    button.onkeydown = event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      choose(buttons[next]);
      buttons[next].focus();
    };
  });
}

function existingClientDialog(clientId) {
  return Array.from(document.querySelectorAll('dialog.client-dialog')).find(dialog => dialog.dataset.smsClientId === clientId) || null;
}

function openClientRecord(clientId, invoker = null) {
  if (!clientId) return;
  const existing = existingClientDialog(clientId);
  if (existing) {
    existing.focus();
    existing.querySelector('h2')?.focus({ preventScroll:true });
    return;
  }

  if (invoker instanceof HTMLElement) invoker.dataset.clientId = clientId;
  let record = {};
  const controller = dialogs.open({
    title: 'Client Information',
    hint: 'Opened directly from Communications',
    icon: icon('client', true),
    kind: 'client-dialog',
    body: '<p class="subtle">Loading client information…</p>',
    footer: saveFooter('Save Client'),
    onSave: async form => {
      const saved = await mhRepository.saveClient({ ...record, ...serializable(form) }, { expectedVersion: record.updated_at || null });
      if (!saved?.id) throw new Error('The save was not confirmed by the database. Your changes remain open.');
      record = saved;
      return saved;
    }
  });

  const mount = loaded => {
    if (!controller.node.isConnected) return;
    record = loaded;
    controller.node.dataset.smsClientId = clientId;
    controller.node.querySelector('.modal-body').innerHTML = clientForm(mhRepository.connected === true, mhRepository.agents || []);
    const form = controller.node.querySelector('form');
    hydrate(form, record);
    wireTabs(controller.node);
    controller.attachForm(form);
  };

  mhRepository.getClient(clientId).then(loaded => {
    if (!loaded?.id) throw new Error('The client could not be found.');
    mount(loaded);
  }).catch(error => {
    if (!controller.node.isConnected) return;
    controller.node.querySelector('.modal-body').innerHTML = empty('Client unavailable', error instanceof Error ? error.message : 'Please close this window and retry.');
    controller.node.querySelector('[data-save]')?.setAttribute('disabled', '');
  });
}

function makeOpenButton(clientId, label = 'Open Client') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mh-open-client';
  button.dataset.openClient = clientId;
  button.dataset.clientId = clientId;
  button.textContent = label;
  button.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    openClientRecord(clientId, button);
  };
  return button;
}

function decorateConversationCards() {
  document.querySelectorAll('.sms-conversation-manage').forEach(wrap => {
    if (wrap.querySelector(':scope > .mh-open-client')) return;
    const card = wrap.querySelector('.sms-conversation-card[data-sms-conversation]');
    const clientId = card?.dataset.smsConversation || '';
    if (!clientId) return;
    const button = makeOpenButton(clientId);
    const deleteButton = wrap.querySelector(':scope > .mh-comm-delete');
    if (deleteButton) wrap.insertBefore(button, deleteButton);
    else wrap.append(button);
  });
}

function decorateTextDialogs() {
  document.querySelectorAll('dialog.sms-thread-dialog[data-client-id]').forEach(dialog => {
    const clientId = dialog.dataset.clientId || '';
    if (!clientId) return;

    const head = dialog.querySelector('.sms-head-actions');
    if (head && !head.querySelector('[data-open-client]')) head.prepend(makeOpenButton(clientId));

    dialog.querySelectorAll('[data-sms-thread] > .sms-bubble').forEach(bubble => {
      let actions = bubble.querySelector('.mh-message-delete-row');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'mh-message-delete-row';
        bubble.append(actions);
      }
      if (!actions.querySelector('[data-open-client]')) actions.prepend(makeOpenButton(clientId));
    });
  });
}

async function visibleCalls(clientId = '', limit = 500) {
  let query = supabase.from('ringcentral_calls')
    .select('id,client_id,started_at')
    .order('started_at', { ascending:false })
    .limit(limit);
  if (clientId) query = query.eq('client_id', clientId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function putOpenOnCallRow(rowNode, clientId) {
  if (!rowNode || !clientId) return;
  let actions = rowNode.querySelector('.mh-call-delete-row');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'mh-call-delete-row';
    rowNode.append(actions);
  }
  if (!actions.querySelector('[data-open-client]')) actions.prepend(makeOpenButton(clientId));
}

async function decorateGlobalCalls() {
  const panel = document.querySelector('.mh-call-panel');
  const list = panel?.querySelector('[data-call-list]');
  if (!panel || !list || panel.hidden) return;
  let rows;
  try { rows = await visibleCalls('', 500); } catch { return; }
  if (!list.isConnected) return;
  const nodes = Array.from(list.querySelectorAll(':scope > .mh-call-row'));
  const count = Math.min(nodes.length, rows.length);
  for (let i = 0; i < count; i += 1) putOpenOnCallRow(nodes[i], rows[i].client_id);
}

async function decorateClientCallDialogs() {
  for (const dialog of Array.from(document.querySelectorAll('dialog.mh-call-data-dialog[data-client-id]'))) {
    const clientId = dialog.dataset.clientId || '';
    if (!clientId) continue;
    const head = dialog.querySelector('.mh-call-data-actions');
    if (head && !head.querySelector('[data-open-client]')) head.prepend(makeOpenButton(clientId));
    dialog.querySelectorAll('[data-client-call-dialog-list] > .mh-call-row').forEach(row => putOpenOnCallRow(row, clientId));
  }
}

async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    decorateConversationCards();
    decorateTextDialogs();
    await decorateGlobalCalls();
    await decorateClientCallDialogs();
  } finally {
    scanning = false;
  }
}

function scheduleScan() {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scan(), 75);
}

installStyles();
new MutationObserver(scheduleScan).observe(document.body, { childList:true, subtree:true });
window.addEventListener('hashchange', scheduleScan);
window.addEventListener('focus', scheduleScan);
window.setTimeout(() => void scan(), 0);

window.MHOpenClientFromCommunications = openClientRecord;
