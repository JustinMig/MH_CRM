import { Dialogs } from './dialogs.js';
import { mhRepository, supabase } from './supabase-repository.js';

const BUCKET = 'mh-client-documents';
const CATEGORY = 'medication_document';
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
]);

const pharmacyCache = new Map();
const dialogStates = new WeakMap();
let pendingClientId = null;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

const safeName = value => String(value || 'medication-file')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'medication-file';

const mimeFor = file => file?.type || ({
  pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp',
  heic:'image/heic', heif:'image/heif', doc:'application/msword',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt:'text/plain'
})[String(file?.name || '').toLowerCase().split('.').pop()] || '';

const humanSize = bytes => {
  const n = Number(bytes || 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 ** 2)).toFixed(1)} MB`;
};

function stateFor(dialog) {
  let state = dialogStates.get(dialog);
  if (!state) {
    state = { queued: [], records: [], busy: false, clientId: dialog.dataset.clientId || '' };
    dialogStates.set(dialog, state);
  }
  return state;
}

async function listFiles(clientId) {
  const { data, error } = await supabase.from('documents')
    .select('id,client_id,category,file_name,storage_path,mime_type,file_size,created_at')
    .eq('client_id', clientId)
    .eq('category', CATEGORY)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function uploadOne(clientId, file) {
  const mime = mimeFor(file);
  if (!ALLOWED.has(mime)) throw new Error(`${file.name}: this file type is not allowed.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: files must be 25 MB or smaller.`);
  const path = `${clientId}/medications/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: mime
  });
  if (uploadError) throw uploadError;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('documents').insert({
      client_id: clientId,
      uploaded_by: user?.id || null,
      category: CATEGORY,
      file_name: file.name,
      storage_path: path,
      mime_type: mime,
      file_size: file.size,
      notes: 'Medication / pharmacy file'
    }).select('id,client_id,category,file_name,storage_path,mime_type,file_size,created_at').single();
    if (error) throw error;
    return data;
  } catch (error) {
    try { await supabase.storage.from(BUCKET).remove([path]); } catch {}
    throw error;
  }
}

async function removeOne(record) {
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([record.storage_path]);
  if (storageError) throw storageError;
  const { error } = await supabase.from('documents').delete().eq('id', record.id).eq('client_id', record.client_id);
  if (error) throw error;
}

async function signedUrl(record, seconds = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(record.storage_path, seconds);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Unable to create a secure file link.');
  return data.signedUrl;
}

async function downloadFile(url, fileName) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to download this file.');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName || 'medication-file';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function previewFile({ url, fileName, mimeType, revoke = false }) {
  const mime = String(mimeType || '');
  const image = mime.startsWith('image/');
  const inline = image || mime === 'application/pdf' || mime.startsWith('text/');
  const modal = document.createElement('dialog');
  modal.className = 'mh-file-preview-dialog';
  modal.innerHTML = `<div class="mh-file-preview-frame">
    <header class="mh-file-preview-head">
      <div><h2>${esc(fileName || 'Medication File')}</h2><p>Medication / pharmacy file • secure in-site preview</p></div>
      <div class="mh-file-preview-actions">
        <button type="button" class="btn secondary" data-pharmacy-download>Download</button>
        <button type="button" class="modal-close" data-pharmacy-preview-close aria-label="Close preview">×</button>
      </div>
    </header>
    <div class="mh-file-preview-body">
      ${image ? `<img src="${esc(url)}" alt="${esc(fileName || 'Medication file')}">` : inline ? `<iframe src="${esc(url)}" title="${esc(fileName || 'Medication file')}"></iframe>` : `<div class="mh-file-preview-unavailable"><strong>Preview is not available for this file type.</strong><span>You can download the file without leaving the CRM.</span></div>`}
    </div>
  </div>`;
  document.body.append(modal);
  const close = () => {
    if (!modal.isConnected) return;
    modal.close();
    modal.remove();
    if (revoke) URL.revokeObjectURL(url);
  };
  modal.querySelector('[data-pharmacy-preview-close]').onclick = close;
  modal.querySelector('[data-pharmacy-download]').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await downloadFile(url, fileName); }
    catch (error) { alert(error?.message || 'Unable to download this file.'); }
    finally { button.disabled = false; }
  };
  modal.addEventListener('cancel', event => { event.preventDefault(); close(); });
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.showModal();
}

function pharmacyMarkup(pharmacy = {}) {
  return `<section class="pharmacy-panel" data-pharmacy-panel>
    <div class="pharmacy-panel-head">
      <div><h3>Pharmacy Information</h3><p>Keep the client's preferred pharmacy and medication-related files together.</p></div>
    </div>
    <div class="pharmacy-fields form-grid">
      <label class="field"><span>Pharmacy Name</span><input name="pharmacy_name" value="${esc(pharmacy.pharmacy_name || '')}" autocomplete="off"></label>
      <label class="field"><span>Pharmacy Location</span><input name="pharmacy_location" value="${esc(pharmacy.pharmacy_location || '')}" placeholder="Address, city, or location" autocomplete="off"></label>
    </div>
    <div class="pharmacy-file-head">
      <div><strong>Medication / Pharmacy Files</strong><span>Upload medication lists, pharmacy printouts, prescription photos, or other related files.</span></div>
      <div class="pharmacy-file-actions">
        <label class="btn secondary">Upload Files<input type="file" data-pharmacy-files multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.txt" hidden></label>
        <label class="btn secondary">Camera / Scan<input type="file" data-pharmacy-camera accept="image/*" capture="environment" hidden></label>
      </div>
    </div>
    <div class="pharmacy-file-list" data-pharmacy-file-list></div>
    <div class="pharmacy-file-status" data-pharmacy-status role="status" aria-live="polite"></div>
  </section>`;
}

function bindPharmacyPanel(form, dialog, clientId, pharmacy = {}) {
  const panel = form.querySelector('[data-panel="medications"]');
  if (!panel || panel.querySelector('[data-pharmacy-panel]')) return;
  panel.insertAdjacentHTML('afterbegin', pharmacyMarkup(pharmacy));
  const host = panel.querySelector('[data-pharmacy-panel]');
  const picker = host.querySelector('[data-pharmacy-files]');
  const camera = host.querySelector('[data-pharmacy-camera]');
  const list = host.querySelector('[data-pharmacy-file-list]');
  const status = host.querySelector('[data-pharmacy-status]');
  const state = stateFor(dialog);
  state.clientId = clientId || '';

  const setStatus = (text = '', error = false) => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };

  const render = () => {
    const stored = state.records.map(record => `<article class="pharmacy-file-row" data-pharmacy-file-id="${esc(record.id)}">
      <div><strong>${esc(record.file_name)}</strong><span>${esc(humanSize(record.file_size))} • ${esc(new Date(record.created_at).toLocaleDateString())}</span></div>
      <div><button type="button" class="btn secondary" data-pharmacy-view>View</button><button type="button" class="btn danger" data-pharmacy-remove>Remove</button></div>
    </article>`).join('');
    const queued = state.queued.map(item => `<article class="pharmacy-file-row queued" data-pharmacy-queued-id="${item.id}">
      <div><strong>${esc(item.file.name)}</strong><span>${esc(humanSize(item.file.size))} • ready to attach</span></div>
      <div><button type="button" class="btn secondary" data-pharmacy-queued-view>View</button><button type="button" class="btn danger" data-pharmacy-queued-remove>Remove</button></div>
    </article>`).join('');
    list.innerHTML = stored + queued || '<div class="pharmacy-file-empty">No medication or pharmacy files uploaded yet.</div>';
  };

  const validateFiles = files => {
    const valid = [];
    const errors = [];
    for (const file of Array.from(files || [])) {
      const mime = mimeFor(file);
      if (!ALLOWED.has(mime)) errors.push(`${file.name}: this file type is not allowed.`);
      else if (file.size > MAX_BYTES) errors.push(`${file.name}: files must be 25 MB or smaller.`);
      else valid.push(file);
    }
    return { valid, errors };
  };

  const selectFiles = async files => {
    const { valid, errors } = validateFiles(files);
    picker.value = '';
    camera.value = '';
    if (!valid.length) {
      if (errors.length) setStatus(errors.join(' '), true);
      return;
    }
    if (!state.clientId) {
      valid.forEach(file => state.queued.push({ id: crypto.randomUUID(), file }));
      render();
      form.dispatchEvent(new Event('input', { bubbles: true }));
      setStatus(`${valid.length} file${valid.length === 1 ? '' : 's'} ready. They will attach when you save the client.${errors.length ? ` ${errors.join(' ')}` : ''}`, errors.length > 0);
      return;
    }
    if (state.busy) return;
    state.busy = true;
    try {
      let count = 0;
      for (const file of valid) {
        setStatus(`Uploading ${count + 1} of ${valid.length}: ${file.name}`);
        await uploadOne(state.clientId, file);
        count += 1;
      }
      state.records = await listFiles(state.clientId);
      render();
      setStatus(`${count} file${count === 1 ? '' : 's'} uploaded securely.${errors.length ? ` ${errors.join(' ')}` : ''}`, errors.length > 0);
    } catch (error) {
      setStatus(error?.message || 'File upload failed.', true);
    } finally {
      state.busy = false;
    }
  };

  picker.onchange = () => selectFiles(picker.files);
  camera.onchange = () => selectFiles(camera.files);
  list.addEventListener('click', async event => {
    const storedRow = event.target.closest?.('[data-pharmacy-file-id]');
    if (storedRow) {
      const record = state.records.find(item => item.id === storedRow.dataset.pharmacyFileId);
      if (!record) return;
      if (event.target.closest('[data-pharmacy-view]')) {
        try { previewFile({ url: await signedUrl(record), fileName: record.file_name, mimeType: record.mime_type }); }
        catch (error) { setStatus(error?.message || 'Unable to preview this file.', true); }
      }
      if (event.target.closest('[data-pharmacy-remove]')) {
        if (!confirm(`Remove ${record.file_name}?`)) return;
        try {
          setStatus('Removing file…');
          await removeOne(record);
          state.records = state.records.filter(item => item.id !== record.id);
          render();
          setStatus('File removed.');
        } catch (error) { setStatus(error?.message || 'Unable to remove this file.', true); }
      }
      return;
    }

    const queuedRow = event.target.closest?.('[data-pharmacy-queued-id]');
    if (!queuedRow) return;
    const item = state.queued.find(file => file.id === queuedRow.dataset.pharmacyQueuedId);
    if (!item) return;
    if (event.target.closest('[data-pharmacy-queued-view]')) {
      const url = URL.createObjectURL(item.file);
      previewFile({ url, fileName: item.file.name, mimeType: mimeFor(item.file), revoke: true });
    }
    if (event.target.closest('[data-pharmacy-queued-remove]')) {
      state.queued = state.queued.filter(file => file.id !== item.id);
      render();
      form.dispatchEvent(new Event('input', { bubbles: true }));
      setStatus(`${item.file.name} removed from the pending uploads.`);
    }
  });

  render();
  if (state.clientId) {
    listFiles(state.clientId).then(records => {
      state.records = records;
      render();
      setStatus(`${records.length} medication/pharmacy file${records.length === 1 ? '' : 's'} stored.`);
    }).catch(error => setStatus(error?.message || 'Unable to load medication files.', true));
  } else {
    setStatus('Files selected here can be previewed now and will attach when you save the client.');
  }
}

async function savePharmacy(clientId, pharmacyName, pharmacyLocation) {
  const name = String(pharmacyName || '').trim();
  const location = String(pharmacyLocation || '').trim();
  if (!name && !location) {
    const { error } = await supabase.from('client_pharmacies').delete().eq('client_id', clientId);
    if (error) throw error;
    pharmacyCache.set(clientId, null);
    return;
  }
  const payload = {
    client_id: clientId,
    pharmacy_name: name || null,
    pharmacy_location: location || null,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from('client_pharmacies').upsert(payload, { onConflict: 'client_id' }).select('*').single();
  if (error) throw error;
  pharmacyCache.set(clientId, data);
}

async function flushQueued(dialog, clientId) {
  const state = dialogStates.get(dialog);
  if (!state?.queued.length) return;
  const remaining = [];
  const failures = [];
  for (const item of state.queued) {
    try { await uploadOne(clientId, item.file); }
    catch (error) {
      remaining.push(item);
      failures.push(`${item.file.name}: ${error?.message || 'upload failed'}`);
    }
  }
  state.queued = remaining;
  state.clientId = clientId;
  if (failures.length) throw new Error(`Client saved, but ${failures.length} medication/pharmacy file${failures.length === 1 ? '' : 's'} need to be retried: ${failures.join(' ')}`);
}

const baseGetClient = mhRepository.getClient.bind(mhRepository);
mhRepository.getClient = async function getClientWithPharmacy(id) {
  const record = await baseGetClient(id);
  if (!record) return record;
  const { data, error } = await supabase.from('client_pharmacies').select('*').eq('client_id', id).maybeSingle();
  if (error) throw error;
  pharmacyCache.set(id, data || null);
  return { ...record, _pharmacy: data || null };
};

const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function saveClientWithPharmacy(record, ...args) {
  const pharmacyName = record.pharmacy_name ?? '';
  const pharmacyLocation = record.pharmacy_location ?? '';
  const cleaned = { ...record };
  delete cleaned.pharmacy_name;
  delete cleaned.pharmacy_location;
  const saved = await baseSaveClient(cleaned, ...args);
  if (!saved?.id) return saved;
  await savePharmacy(saved.id, pharmacyName, pharmacyLocation);
  const dialog = [...document.querySelectorAll('dialog.client-dialog')].reverse().find(item => item.isConnected && dialogStates.has(item));
  if (dialog) await flushQueued(dialog, saved.id);
  return saved;
};

document.addEventListener('click', event => {
  const existing = event.target.closest?.('[data-client-id]');
  const add = event.target.closest?.('[data-add-client]');
  if (existing) pendingClientId = existing.dataset.clientId || null;
  else if (add) pendingClientId = null;
}, true);

const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function patchedPharmacyOpen(options = {}) {
  const clientId = options.kind === 'client-dialog' ? pendingClientId : null;
  if (options.kind === 'client-dialog') pendingClientId = null;
  const controller = originalOpen.call(this, options);
  if (options.kind !== 'client-dialog') return controller;
  const previousAttachForm = controller.attachForm.bind(controller);
  controller.attachForm = form => {
    const dialog = form.closest('dialog.client-dialog');
    const pharmacy = clientId ? (pharmacyCache.get(clientId) || {}) : {};
    if (dialog) bindPharmacyPanel(form, dialog, clientId || '', pharmacy);
    previousAttachForm(form);
  };
  return controller;
};
