import { mhRepository, supabase } from './supabase-repository.js';

const BUCKET = 'mh-client-documents';
const MAX_BYTES = 25 * 1024 * 1024;
const CARD_MIMES = new Set(['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']);
const DOC_MIMES = new Set([
  ...CARD_MIMES,
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
]);
const MEDICARE_DOCUMENT_CATEGORY = 'medicare_photo';
const dialogState = new WeakMap();
let pendingClientId = null;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));
const safeName = value => String(value || 'document')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'document';
const fileMime = file => file.type || ({
  pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp',
  heic:'image/heic', heif:'image/heif', doc:'application/msword',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt:'text/plain'
})[String(file.name || '').toLowerCase().split('.').pop()] || '';
const humanDate = value => value ? new Date(value).toLocaleDateString() : '';
const humanSize = bytes => {
  const n = Number(bytes || 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 ** 2)).toFixed(1)} MB`;
};

function stateFor(dialog) {
  let state = dialogState.get(dialog);
  if (!state) {
    state = { clientId: dialog.dataset.clientId || '', cards: new Map(), documents: [], flushPromise: null };
    dialogState.set(dialog, state);
  }
  return state;
}

function groupBySummary(panel, title) {
  return Array.from(panel.querySelectorAll('details.field-group'))
    .find(group => group.querySelector(':scope > summary')?.textContent.trim() === title) || null;
}

function markPending(dialog) {
  const state = stateFor(dialog);
  const form = dialog.querySelector('form');
  let marker = form?.querySelector('[data-pending-medicare-marker]');
  if (!marker && form) {
    marker = document.createElement('input');
    marker.type = 'hidden';
    marker.name = '_pending_medicare_uploads';
    marker.dataset.pendingMedicareMarker = 'true';
    form.append(marker);
  }
  if (marker) {
    marker.value = String(state.cards.size + state.documents.length || '');
    marker.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function clearFileInput(input) {
  if (!input) return;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function uploadStored(clientId, file, category, allowed = DOC_MIMES) {
  const mime = fileMime(file);
  if (!allowed.has(mime)) throw new Error(`${file.name}: this file type is not allowed.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: files must be 25 MB or smaller.`);
  const path = `${clientId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: mime || 'application/octet-stream'
  });
  if (uploadError) throw uploadError;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('documents').insert({
      client_id: clientId,
      uploaded_by: user?.id || null,
      category,
      file_name: file.name,
      storage_path: path,
      mime_type: mime || 'application/octet-stream',
      file_size: file.size
    }).select().single();
    if (error) throw error;
    return data;
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
}

async function listStored(clientId, categories) {
  const names = Array.isArray(categories) ? categories : [categories];
  const { data, error } = await supabase.from('documents')
    .select('id,client_id,category,file_name,storage_path,mime_type,file_size,created_at')
    .eq('client_id', clientId)
    .in('category', names)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function openStored(record) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(record.storage_path, 90);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Could not create a secure file link.');
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

async function removeStored(record) {
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([record.storage_path]);
  if (storageError) throw storageError;
  const { error } = await supabase.from('documents').delete().eq('id', record.id).eq('client_id', record.client_id);
  if (error) throw error;
}

function pendingNotice(panel) {
  let notice = panel.querySelector('[data-assets-new-client]');
  if (!notice) {
    notice = document.createElement('div');
    notice.dataset.assetsNewClient = 'true';
    notice.className = 'notice';
    const health = groupBySummary(panel, 'Health Plan Information');
    if (health) health.insertAdjacentElement('afterend', notice);
    else panel.prepend(notice);
  }
  notice.textContent = 'Add Medicare cards and documents now. They will upload securely and attach to this client when you click Save Client.';
  panel.querySelectorAll('.notice').forEach(item => {
    if (item !== notice && /Medicare cards and Scope of Appointment files belong in Documents/i.test(item.textContent || '')) {
      item.textContent = 'Medicare cards, plan cards, and supporting Medicare documents can be added directly in this tab.';
    }
  });
}

function cardMarkup(label) {
  return `<div class="medicare-card-manager span-all">
    <div class="medicare-card-heading"><strong>${esc(label)}</strong><span data-card-summary>No card saved</span></div>
    <div class="medicare-card-actions">
      <label class="btn secondary">Upload Card<input type="file" data-card-file accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" hidden></label>
      <label class="btn secondary">Camera / Scan<input type="file" data-card-camera accept="image/*" capture="environment" hidden></label>
      <button type="button" class="btn secondary" data-card-open hidden>View Card</button>
      <button type="button" class="btn danger" data-card-remove hidden>Remove</button>
    </div>
    <div class="medicare-card-status" data-card-status role="status"></div>
  </div>`;
}

function bindNewCard(dialog, group, category, label) {
  if (!group || group.querySelector(`[data-card-manager="${category}"]`)) return;
  const grid = group.querySelector(':scope > .form-grid');
  if (!grid) return;
  const host = document.createElement('div');
  host.dataset.cardManager = category;
  host.dataset.newClientCard = 'true';
  host.className = 'medicare-card-host span-all';
  host.innerHTML = cardMarkup(label);
  grid.append(host);

  const state = stateFor(dialog);
  const fileInput = host.querySelector('[data-card-file]');
  const cameraInput = host.querySelector('[data-card-camera]');
  const openButton = host.querySelector('[data-card-open]');
  const removeButton = host.querySelector('[data-card-remove]');
  const summary = host.querySelector('[data-card-summary]');
  const status = host.querySelector('[data-card-status]');
  let current = null;
  let queued = null;
  let busy = false;

  fileInput.name = `_pending_${category}`;
  cameraInput.name = `_pending_${category}_camera`;

  const render = () => {
    summary.textContent = current
      ? `${current.file_name} • ${humanDate(current.created_at)}`
      : queued ? `${queued.name} • ready to save` : 'No card saved';
    openButton.hidden = !(current || queued);
    removeButton.hidden = !(current || queued);
  };
  const setStatus = (text = '', error = false) => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };

  const selectFile = async files => {
    const file = files?.[0];
    if (!file || busy) return;
    const mime = fileMime(file);
    if (!CARD_MIMES.has(mime)) { setStatus('Use a PDF or image file for this card.', true); return; }
    if (file.size > MAX_BYTES) { setStatus('Files must be 25 MB or smaller.', true); return; }
    const clientId = state.clientId || dialog.dataset.clientId || '';
    if (!clientId) {
      queued = file;
      state.cards.set(category, { file, label, host, onSaved: record => {
        current = record;
        queued = null;
        render();
        setStatus(`${label} saved securely.`);
        clearFileInput(fileInput);
        clearFileInput(cameraInput);
      } });
      render();
      setStatus(`${label} ready. It will save with this client when you click Save Client.`);
      clearFileInput(fileInput);
      clearFileInput(cameraInput);
      markPending(dialog);
      return;
    }
    busy = true;
    try {
      setStatus(`Uploading ${file.name} securely…`);
      current = await uploadStored(clientId, file, category, CARD_MIMES);
      queued = null;
      render();
      setStatus(`${label} saved securely.`);
      clearFileInput(fileInput);
      clearFileInput(cameraInput);
    } catch (error) {
      setStatus(error?.message || 'Upload failed.', true);
    } finally { busy = false; }
  };

  fileInput.addEventListener('change', () => selectFile(fileInput.files));
  cameraInput.addEventListener('change', () => selectFile(cameraInput.files));
  openButton.addEventListener('click', async () => {
    try {
      if (current) return await openStored(current);
      if (queued) {
        const url = URL.createObjectURL(queued);
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (error) { setStatus(error?.message || 'Unable to open card.', true); }
  });
  removeButton.addEventListener('click', async () => {
    if (busy) return;
    if (queued) {
      queued = null;
      state.cards.delete(category);
      clearFileInput(fileInput);
      clearFileInput(cameraInput);
      markPending(dialog);
      render();
      setStatus(`${label} removed from this new client.`);
      return;
    }
    if (!current || !confirm(`Remove ${label}?`)) return;
    try {
      busy = true;
      setStatus('Removing card…');
      await removeStored(current);
      current = null;
      render();
      setStatus(`${label} removed.`);
    } catch (error) { setStatus(error?.message || 'Unable to remove card.', true); }
    finally { busy = false; }
  });
  render();
}

function documentsMarkup() {
  return `<details class="field-group" data-medicare-documents open>
    <summary>Medicare Documents</summary>
    <div class="form-grid">
      <div class="span-all document-upload-card">
        <label class="document-file-picker"><span>Choose Documents</span><input type="file" data-medicare-doc-files multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.txt"></label>
        <label class="btn secondary document-camera">Camera / Scan<input type="file" data-medicare-doc-camera accept="image/*" capture="environment" hidden></label>
      </div>
      <div class="span-all document-status" data-medicare-doc-status role="status" aria-live="polite"></div>
      <div class="span-all document-list" data-medicare-doc-list></div>
    </div>
  </details>`;
}

function bindMedicareDocuments(dialog, panel, initialClientId = '') {
  if (panel.querySelector('[data-medicare-documents]')) return;
  const health = groupBySummary(panel, 'Health Plan Information');
  const holder = document.createElement('div');
  holder.innerHTML = documentsMarkup();
  const group = holder.firstElementChild;
  if (health) health.insertAdjacentElement('afterend', group);
  else panel.append(group);

  const state = stateFor(dialog);
  if (initialClientId) state.clientId = initialClientId;
  const fileInput = group.querySelector('[data-medicare-doc-files]');
  const cameraInput = group.querySelector('[data-medicare-doc-camera]');
  const status = group.querySelector('[data-medicare-doc-status]');
  const list = group.querySelector('[data-medicare-doc-list]');
  let stored = [];
  let busy = false;

  fileInput.name = '_pending_medicare_documents';
  cameraInput.name = '_pending_medicare_document_camera';

  const setStatus = (text = '', error = false) => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };
  const render = () => {
    const queued = state.documents;
    const rows = [
      ...queued.map((item, index) => ({ kind:'queued', index, name:item.file.name, size:item.file.size })),
      ...stored.map(record => ({ kind:'stored', record, name:record.file_name, size:record.file_size, created_at:record.created_at }))
    ];
    if (!rows.length) {
      list.innerHTML = '<div class="document-empty"><strong>No Medicare documents added yet.</strong><span>Add PDFs, photos, scans, or supporting Medicare files here.</span></div>';
      return;
    }
    list.innerHTML = rows.map((row, index) => `
      <article class="document-row" data-med-doc-row="${index}">
        <div class="document-row-main"><strong>${esc(row.name)}</strong><span>${row.kind === 'queued' ? 'Ready to save' : `Saved • ${esc(humanDate(row.created_at))}`} • ${esc(humanSize(row.size))}</span></div>
        <div class="document-row-actions">
          ${row.kind === 'stored' ? '<button type="button" class="btn secondary" data-med-doc-open>Open</button>' : ''}
          <button type="button" class="btn danger" data-med-doc-remove>${row.kind === 'queued' ? 'Remove' : 'Delete'}</button>
        </div>
      </article>`).join('');
    rows.forEach((row, index) => {
      const el = list.querySelector(`[data-med-doc-row="${index}"]`);
      el?.querySelector('[data-med-doc-open]')?.addEventListener('click', async () => {
        try { await openStored(row.record); }
        catch (error) { setStatus(error?.message || 'Unable to open document.', true); }
      });
      el?.querySelector('[data-med-doc-remove]')?.addEventListener('click', async () => {
        if (row.kind === 'queued') {
          state.documents.splice(row.index, 1);
          markPending(dialog);
          render();
          setStatus('Pending Medicare document removed.');
          return;
        }
        if (!confirm(`Delete ${row.record.file_name}? This cannot be undone.`)) return;
        try {
          await removeStored(row.record);
          stored = stored.filter(item => item.id !== row.record.id);
          render();
          setStatus('Medicare document deleted.');
        } catch (error) { setStatus(error?.message || 'Unable to delete document.', true); }
      });
    });
  };

  const load = async () => {
    const clientId = state.clientId || dialog.dataset.clientId || '';
    if (!clientId || busy) { render(); return; }
    busy = true;
    try {
      stored = await listStored(clientId, MEDICARE_DOCUMENT_CATEGORY);
      render();
      setStatus(`${stored.length} Medicare document${stored.length === 1 ? '' : 's'} stored for this client.`);
    } catch (error) { setStatus(error?.message || 'Unable to load Medicare documents.', true); }
    finally { busy = false; }
  };

  const selectDocuments = async files => {
    const selected = Array.from(files || []);
    if (!selected.length || busy) return;
    const valid = [];
    for (const file of selected) {
      const mime = fileMime(file);
      if (!DOC_MIMES.has(mime)) { setStatus(`${file.name}: this file type is not allowed.`, true); return; }
      if (file.size > MAX_BYTES) { setStatus(`${file.name}: files must be 25 MB or smaller.`, true); return; }
      valid.push(file);
    }
    const clientId = state.clientId || dialog.dataset.clientId || '';
    if (!clientId) {
      valid.forEach(file => state.documents.push({ file }));
      render();
      setStatus(`${valid.length} document${valid.length === 1 ? '' : 's'} ready. They will save with this client when you click Save Client.`);
      clearFileInput(fileInput);
      clearFileInput(cameraInput);
      markPending(dialog);
      return;
    }
    busy = true;
    try {
      let done = 0;
      for (const file of valid) {
        setStatus(`Uploading ${done + 1} of ${valid.length}: ${file.name}`);
        await uploadStored(clientId, file, MEDICARE_DOCUMENT_CATEGORY, DOC_MIMES);
        done += 1;
      }
      clearFileInput(fileInput);
      clearFileInput(cameraInput);
      stored = await listStored(clientId, MEDICARE_DOCUMENT_CATEGORY);
      render();
      setStatus(`${done} Medicare document${done === 1 ? '' : 's'} uploaded securely.`);
    } catch (error) { setStatus(error?.message || 'Medicare document upload failed.', true); }
    finally { busy = false; }
  };

  fileInput.addEventListener('change', () => selectDocuments(fileInput.files));
  cameraInput.addEventListener('change', () => selectDocuments(cameraInput.files));
  group.addEventListener('toggle', () => { if (group.open && state.clientId && !stored.length) load(); });
  state.refreshDocuments = async () => { await load(); };
  state.clearDocumentInputs = () => { clearFileInput(fileInput); clearFileInput(cameraInput); };
  render();
  if (state.clientId) load();
}

async function flushPending(dialog, clientId) {
  const state = stateFor(dialog);
  state.clientId = clientId;
  dialog.dataset.clientId = clientId;
  if (state.flushPromise) return state.flushPromise;
  state.flushPromise = (async () => {
    const failures = [];
    for (const [category, item] of Array.from(state.cards.entries())) {
      try {
        const record = await uploadStored(clientId, item.file, category, CARD_MIMES);
        state.cards.delete(category);
        item.onSaved?.(record);
      } catch (error) {
        failures.push(`${item.label}: ${error?.message || 'upload failed'}`);
        const status = item.host?.querySelector('[data-card-status]');
        if (status) {
          status.classList.add('error');
          status.textContent = error?.message || 'Upload failed. Save again to retry.';
        }
      }
    }

    const remainingDocs = [];
    for (const item of state.documents) {
      try { await uploadStored(clientId, item.file, MEDICARE_DOCUMENT_CATEGORY, DOC_MIMES); }
      catch (error) {
        remainingDocs.push(item);
        failures.push(`${item.file.name}: ${error?.message || 'upload failed'}`);
      }
    }
    state.documents = remainingDocs;
    state.clearDocumentInputs?.();
    await state.refreshDocuments?.();
    markPending(dialog);

    const notice = dialog.querySelector('[data-assets-new-client]');
    if (notice) {
      if (failures.length) {
        notice.textContent = `Client saved, but ${failures.length} Medicare upload${failures.length === 1 ? '' : 's'} need to be retried. The files remain queued in this window.`;
        notice.classList.add('error');
      } else {
        notice.textContent = 'Client saved. Medicare cards and documents are attached securely to this client.';
        notice.classList.remove('error');
      }
    }
    if (failures.length) {
      setTimeout(() => {
        const marker = dialog.querySelector('[data-pending-medicare-marker]');
        if (marker) {
          marker.value = `retry-${Date.now()}`;
          marker.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 0);
    }
    return failures;
  })().finally(() => { state.flushPromise = null; });
  return state.flushPromise;
}

function enhanceDialog(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('client-dialog')) return;
  const panel = dialog.querySelector('[data-panel="medicare"]');
  if (!panel) return;

  const id = dialog.dataset.clientId || pendingClientId || '';
  const state = stateFor(dialog);
  if (id) state.clientId = id;

  bindMedicareDocuments(dialog, panel, id);

  if (id) return;
  dialog.dataset.newClientMedicareUploads = 'true';
  pendingNotice(panel);
  bindNewCard(dialog, groupBySummary(panel, 'Medicare Information'), 'medicare_card', 'Medicare Card');
  bindNewCard(dialog, groupBySummary(panel, 'Medicaid Information'), 'medicaid_card', 'Medicaid Card');
  bindNewCard(dialog, groupBySummary(panel, 'Health Plan Information'), 'health_plan_card', 'Health Plan Card');
}

const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function(record, ...args) {
  const saved = await baseSaveClient(record, ...args);
  if (!saved?.id) return saved;
  const dialogs = Array.from(document.querySelectorAll('dialog.client-dialog'));
  const dialog = dialogs.reverse().find(item => item.dataset.newClientMedicareUploads === 'true' || item.dataset.clientId === saved.id);
  if (dialog) {
    pendingClientId = saved.id;
    await flushPending(dialog, saved.id);
  }
  return saved;
};

document.addEventListener('click', event => {
  const existing = event.target.closest?.('[data-client-id]');
  const add = event.target.closest?.('[data-add-client]');
  if (existing) pendingClientId = existing.dataset.clientId || null;
  else if (add) pendingClientId = null;
}, true);

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    const mutationDialog = mutation.target instanceof Element ? mutation.target.closest?.('dialog.client-dialog') : null;
    if (mutationDialog) queueMicrotask(() => enhanceDialog(mutationDialog));
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('dialog.client-dialog')) queueMicrotask(() => enhanceDialog(node));
      node.querySelectorAll?.('dialog.client-dialog').forEach(item => queueMicrotask(() => enhanceDialog(item)));
      const parent = node.closest?.('dialog.client-dialog');
      if (parent) queueMicrotask(() => enhanceDialog(parent));
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('dialog.client-dialog').forEach(dialog => enhanceDialog(dialog));
