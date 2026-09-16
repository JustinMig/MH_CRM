import { communicationsRendered, releaseRecordings } from './communications-events.js';
import { supabase } from './supabase-repository.js';
import { smsAuthHeaders } from './client-texting.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

function installStyles() {
  if (document.querySelector('#mh-ringcentral-ui-adjustments')) return;
  const style = document.createElement('style');
  style.id = 'mh-ringcentral-ui-adjustments';
  style.textContent = `
    /* Communications cards must shrink and wrap instead of overlapping. */
    #sms-communications-center,.mh-text-panel,.mh-call-panel,.sms-center-head,.mh-call-head{min-width:0}
    .sms-center-head>div,.mh-call-head>div{min-width:0;flex:1 1 320px}
    .sms-center-actions,.mh-call-actions{min-width:0;max-width:100%}
    .sms-center-metrics,.mh-call-summary{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))!important;align-items:stretch}
    .sms-center-metrics>div,.mh-call-summary>div{min-width:0;overflow:hidden}
    .sms-center-metrics span,.sms-center-metrics strong,.mh-call-summary span,.mh-call-summary strong{min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:normal}
    @media(max-width:520px){.sms-center-metrics,.mh-call-summary{grid-template-columns:1fr!important}.sms-center-actions,.mh-call-actions{display:grid!important;grid-template-columns:1fr;width:100%}.sms-center-actions .btn,.mh-call-actions .btn{width:100%}}

    /* Client footer Call Data button + read-only popup. */
    .client-call-data-button{white-space:nowrap}
    .mh-call-data-dialog{border:0;padding:0;background:transparent;max-width:none;max-height:none}
    .mh-call-data-dialog::backdrop{background:rgba(12,25,36,.58);backdrop-filter:blur(2px)}
    .mh-call-data-frame{width:min(880px,calc(100vw - 28px));max-height:calc(100dvh - 28px);overflow:hidden;background:#fff;border:1px solid #cad6dd;border-radius:18px;box-shadow:0 28px 90px rgba(12,25,36,.30);display:grid;grid-template-rows:auto auto minmax(0,1fr)}
    .mh-call-data-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px 18px;border-bottom:1px solid #dce4e8;background:#f7f9fa}
    .mh-call-data-head>div{min-width:0;display:grid;gap:3px}.mh-call-data-head h2{margin:0;color:#253946}.mh-call-data-head p{margin:0;color:#6b7b86;font-size:.8rem}
    .mh-call-data-actions{display:flex;gap:7px;flex-wrap:wrap}
    .mh-call-data-status{padding:9px 18px;border-bottom:1px solid #edf1f3;color:#667886;font-size:.75rem;font-weight:700;background:#fff}
    .mh-call-data-list{overflow:auto;padding:12px 14px 16px;display:grid;gap:8px;background:#fbfcfd}
    .mh-call-data-list .mh-call-row{background:#fff}
    @media(max-width:700px){.mh-call-data-frame{width:100vw;max-height:100dvh;height:100dvh;border:0;border-radius:0}.mh-call-data-head{flex-direction:column}.mh-call-data-actions{width:100%}.mh-call-data-actions .btn{flex:1}.modal-footer .footer-actions{flex-wrap:wrap}}
  `;
  document.head.append(style);
}

function dateTime(value) {
  const d = new Date(value || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone:'America/Chicago', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
}

function durationText(value) {
  const total = Math.max(0, Number(value || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function phoneText(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}` : String(value || '');
}

function callMarkup(call) {
  const number = call.contact_phone || (call.direction === 'Inbound' ? call.from_phone : call.to_phone) || call.client?.phone || '';
  const result = call.result || (call.direction === 'Inbound' ? 'Inbound call' : 'Outbound call');
  return `<article class="mh-call-row ${String(call.direction || '').toLowerCase()}" data-call-id="${esc(call.id)}" data-client-id="${esc(call.client_id)}" data-call-direction="${esc(call.direction)}" data-recording-id="${esc(call.recording_id || '')}">
    <div class="mh-call-row-head"><div><span class="mh-call-direction">${esc(call.direction || 'Call')}</span></div><span class="mh-call-time">${esc(dateTime(call.started_at))}</span></div>
    <div class="mh-call-meta"><span>${esc(result)}</span><span>${esc(durationText(call.duration_seconds))}</span>${number ? `<span>${esc(phoneText(number))}</span>` : ''}</div>
    ${call.recording_id ? `<div class="mh-recording-wrap" data-client-recording-wrap="${esc(call.recording_id)}"><button type="button" class="btn secondary" data-client-load-recording="${esc(call.recording_id)}">▶ Play Recording</button></div>` : ''}
  </article>`;
}

async function bindRecordings(host) {
  host.querySelectorAll('[data-client-load-recording]').forEach(button => {
    if (button.dataset.bound) return;
    button.dataset.bound = 'true';
    button.onclick = async () => {
      const id = button.dataset.clientLoadRecording;
      const wrap = button.closest('[data-client-recording-wrap]');
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
        if (!wrap.isConnected) return;
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

async function loadClientCalls(clientId) {
  if (window.MHRingCentralReadOnly?.loadCalls) return window.MHRingCentralReadOnly.loadCalls({ clientId, limit:125 });
  const { data, error } = await supabase.from('ringcentral_calls')
    .select('id,client_id,direction,result,started_at,duration_seconds,contact_phone,from_phone,to_phone,recording_id')
    .eq('client_id', clientId).order('started_at', { ascending:false }).limit(125);
  if (error) throw error;
  return data || [];
}

async function drawDialog(dialog, clientId) {
  const list = dialog.querySelector('[data-client-call-dialog-list]');
  const status = dialog.querySelector('[data-client-call-dialog-status]');
  status.textContent = 'Loading saved call data…';
  try {
    const calls = await loadClientCalls(clientId);
    if (!dialog.isConnected) return;
    releaseRecordings(list);
    list.innerHTML = calls.length ? calls.map(callMarkup).join('') : '<div class="mh-client-call-empty">No RingCentral calls are stored for this client yet.</div>';
    const recordings = calls.filter(call => call.recording_id).length;
    status.textContent = `${calls.length} stored call${calls.length === 1 ? '' : 's'}${recordings ? ` · ${recordings} recording${recordings === 1 ? '' : 's'}` : ''}`;
    await bindRecordings(list);
    communicationsRendered(list);
  } catch (error) {
    if (dialog.isConnected) status.textContent = error instanceof Error ? error.message : 'Unable to load client call history.';
  }
}

function openClientCallDialog(clientId, clientDialog) {
  if (!clientId) return;
  const existing = document.querySelector(`dialog.mh-call-data-dialog[data-client-id="${CSS.escape(clientId)}"]`);
  if (existing) { existing.focus(); return; }
  const name = [clientDialog?.querySelector('[name="first_name"]')?.value, clientDialog?.querySelector('[name="last_name"]')?.value].filter(Boolean).join(' ') || 'Client';
  const dialog = document.createElement('dialog');
  dialog.className = 'mh-call-data-dialog';
  dialog.dataset.clientId = clientId;
  dialog.innerHTML = `<div class="mh-call-data-frame"><header class="mh-call-data-head"><div><span class="eyebrow">RingCentral</span><h2>${esc(name)} — Call Data</h2><p>Read-only call history and recordings. Calling is not enabled in Mayer MIG CRM.</p></div><div class="mh-call-data-actions"><button type="button" class="btn secondary" data-client-call-refresh>Refresh</button><button type="button" class="btn secondary" data-client-call-close>Close</button></div></header><div class="mh-call-data-status" data-client-call-dialog-status>Loading call history…</div><div class="mh-call-data-list" data-client-call-dialog-list></div></div>`;
  document.body.append(dialog);
  dialog.showModal();
  communicationsRendered(dialog);
  dialog.querySelector('[data-client-call-close]').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  dialog.addEventListener('close', () => { releaseRecordings(dialog); dialog.remove(); });
  dialog.querySelector('[data-client-call-refresh]').onclick = async () => {
    const button = dialog.querySelector('[data-client-call-refresh]');
    button.disabled = true;
    try {
      await window.MHRingCentralReadOnly?.syncCalls?.({ force:true });
      await drawDialog(dialog, clientId);
    } catch (error) {
      dialog.querySelector('[data-client-call-dialog-status]').textContent = error instanceof Error ? error.message : 'Unable to refresh call data.';
    } finally { if (dialog.isConnected) button.disabled = false; }
  };
  void drawDialog(dialog, clientId);
  window.MHRingCentralReadOnly?.syncCalls?.().then(result => {
    if (!result?.skipped && dialog.isConnected) void drawDialog(dialog, clientId);
  }).catch(() => {});
}

function attachFooterButton(dialog) {
  if (!dialog?.isConnected) return;

  // Remove the old in-form Call Data section and leave its mounted marker in place
  // so the original read-only module does not reinsert it.
  dialog.querySelectorAll('.mh-client-call-history').forEach(node => node.remove());
  dialog.dataset.callHistoryMounted = 'true';

  const actions = dialog.querySelector('.modal-footer .footer-actions') || dialog.querySelector('.modal-footer');
  if (!actions) return;
  let button = actions.querySelector('[data-client-call-data]');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn secondary client-call-data-button';
    button.dataset.clientCallData = '';
    button.textContent = '☎ Call Data';
    const textButton = actions.querySelector('[data-text-client]');
    const closeButton = actions.querySelector('[data-close]');
    if (textButton) textButton.insertAdjacentElement('afterend', button);
    else if (closeButton) actions.insertBefore(button, closeButton);
    else actions.prepend(button);
  }
  const clientId = dialog.dataset.smsClientId || '';
  button.disabled = !clientId;
  button.onclick = () => {
    const id = dialog.dataset.smsClientId || '';
    if (id) openClientCallDialog(id, dialog);
  };
}

function scan() {
  document.querySelectorAll('dialog.client-dialog').forEach(attachFooterButton);
}

installStyles();
new MutationObserver(scan).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['data-sms-client-id'] });
window.setTimeout(scan, 0);
