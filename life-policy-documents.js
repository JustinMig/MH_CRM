import { supabase } from './supabase-repository.js';

const BUCKET = 'mh-client-documents';
const CATEGORY = 'life_policy_document';
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

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

const safeName = value => String(value || 'policy-document')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'policy-document';

const mimeFor = file => file.type || ({
  pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp',
  heic:'image/heic', heif:'image/heif', doc:'application/msword',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt:'text/plain'
})[String(file.name || '').toLowerCase().split('.').pop()] || '';

const humanSize = bytes => {
  const n = Number(bytes || 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 ** 2)).toFixed(1)} MB`;
};

async function signedUrl(record, seconds = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(record.storage_path, seconds);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Unable to create a secure policy document link.');
  return data.signedUrl;
}

async function downloadFile(url, fileName) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to download this policy document.');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName || 'policy-document';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function preview(url, record) {
  const mime = String(record.mime_type || '');
  const image = mime.startsWith('image/');
  const inline = image || mime === 'application/pdf' || mime.startsWith('text/');
  const modal = document.createElement('dialog');
  modal.className = 'mh-file-preview-dialog';
  modal.innerHTML = `<div class="mh-file-preview-frame">
    <header class="mh-file-preview-head">
      <div><h2>${esc(record.file_name || 'Life Policy Document')}</h2><p>Life policy document • secure in-site preview</p></div>
      <div class="mh-file-preview-actions">
        <button type="button" class="btn secondary" data-policy-download>Download</button>
        <button type="button" class="modal-close" data-policy-preview-close aria-label="Close preview">×</button>
      </div>
    </header>
    <div class="mh-file-preview-body">
      ${image ? `<img src="${esc(url)}" alt="${esc(record.file_name || 'Policy document')}">` : inline ? `<iframe src="${esc(url)}" title="${esc(record.file_name || 'Policy document')}"></iframe>` : `<div class="mh-file-preview-unavailable"><strong>Preview is not available for this file type.</strong><span>You can download the file without leaving the CRM.</span></div>`}
    </div>
  </div>`;
  document.body.append(modal);
  const close = () => { if (modal.isConnected) { modal.close(); modal.remove(); } };
  modal.querySelector('[data-policy-preview-close]').onclick = close;
  modal.querySelector('[data-policy-download]').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await downloadFile(url, record.file_name); }
    catch (error) { alert(error?.message || 'Unable to download this file.'); }
    finally { button.disabled = false; }
  };
  modal.addEventListener('cancel', event => { event.preventDefault(); close(); });
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.showModal();
}

async function listDocuments(clientId, policyId) {
  const { data, error } = await supabase.from('documents')
    .select('id,client_id,life_policy_id,category,file_name,storage_path,mime_type,file_size,created_at')
    .eq('client_id', clientId)
    .eq('life_policy_id', policyId)
    .eq('category', CATEGORY)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function uploadOne(clientId, policyId, file) {
  const mime = mimeFor(file);
  if (!ALLOWED.has(mime)) throw new Error(`${file.name}: this file type is not allowed.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: files must be 25 MB or smaller.`);
  const path = `${clientId}/life-policies/${policyId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: mime
  });
  if (uploadError) throw uploadError;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('documents').insert({
      client_id: clientId,
      life_policy_id: policyId,
      uploaded_by: user?.id || null,
      category: CATEGORY,
      file_name: file.name,
      storage_path: path,
      mime_type: mime,
      file_size: file.size,
      notes: 'Life policy document'
    }).select('id,client_id,life_policy_id,category,file_name,storage_path,mime_type,file_size,created_at').single();
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
  const { error } = await supabase.from('documents')
    .delete().eq('id', record.id).eq('client_id', record.client_id).eq('life_policy_id', record.life_policy_id);
  if (error) throw error;
}

function managerMarkup(saved) {
  if (!saved) return `<section class="life-policy-documents span-all life-policy-documents-unsaved">
    <div><strong>Policy Documents</strong><span>Save this policy first, then you can attach multiple policy files here.</span></div>
  </section>`;
  return `<section class="life-policy-documents span-all">
    <div class="life-policy-documents-head">
      <div><strong>Policy Documents</strong><span>Upload the policy, application pages, illustrations, or other files for this policy.</span></div>
      <div class="life-policy-document-actions">
        <label class="btn secondary">Upload Files<input type="file" data-life-policy-files multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.txt" hidden></label>
        <label class="btn secondary">Camera / Scan<input type="file" data-life-policy-camera accept="image/*" capture="environment" hidden></label>
      </div>
    </div>
    <div class="life-policy-document-list" data-life-policy-document-list></div>
    <div class="life-policy-document-status" data-life-policy-document-status role="status" aria-live="polite"></div>
  </section>`;
}

function bindCard(card) {
  if (!(card instanceof HTMLElement) || card.dataset.policyDocumentsReady === 'true') return;
  const body = card.querySelector(':scope > .life-policy-body');
  const idInput = card.querySelector('input[name$="_id"]');
  if (!body || !idInput) return;
  card.dataset.policyDocumentsReady = 'true';
  const policyId = String(idInput.value || '').trim();
  const dialog = card.closest('dialog.client-dialog');
  const clientId = dialog?.dataset.clientId || '';
  const host = document.createElement('div');
  host.className = 'span-all';
  host.dataset.lifePolicyDocumentsHost = 'true';
  host.innerHTML = managerMarkup(!!(policyId && clientId));
  const actions = body.querySelector('.life-policy-actions');
  if (actions) actions.insertAdjacentElement('beforebegin', host);
  else body.append(host);
  if (!policyId || !clientId) return;

  const picker = host.querySelector('[data-life-policy-files]');
  const camera = host.querySelector('[data-life-policy-camera]');
  const list = host.querySelector('[data-life-policy-document-list]');
  const status = host.querySelector('[data-life-policy-document-status]');
  let records = [];
  let busy = false;
  const setStatus = (text = '', error = false) => { status.textContent = text; status.classList.toggle('error', error); };
  const render = () => {
    list.innerHTML = records.length ? records.map(record => `<article class="life-policy-document-row" data-policy-document-id="${esc(record.id)}">
      <div><strong>${esc(record.file_name)}</strong><span>${esc(humanSize(record.file_size))} • ${esc(new Date(record.created_at).toLocaleDateString())}</span></div>
      <div><button type="button" class="btn secondary" data-policy-document-view>View</button><button type="button" class="btn danger" data-policy-document-remove>Remove</button></div>
    </article>`).join('') : '<div class="life-policy-document-empty">No policy documents uploaded yet.</div>';
  };
  const load = async () => {
    try {
      records = await listDocuments(clientId, policyId);
      render();
      setStatus(`${records.length} policy document${records.length === 1 ? '' : 's'} stored.`);
    } catch (error) { setStatus(error?.message || 'Unable to load policy documents.', true); }
  };
  const uploadMany = async files => {
    const selected = Array.from(files || []);
    if (!selected.length || busy) return;
    busy = true;
    try {
      let count = 0;
      for (const file of selected) {
        setStatus(`Uploading ${count + 1} of ${selected.length}: ${file.name}`);
        await uploadOne(clientId, policyId, file);
        count += 1;
      }
      picker.value = '';
      camera.value = '';
      records = await listDocuments(clientId, policyId);
      render();
      setStatus(`${count} policy document${count === 1 ? '' : 's'} uploaded securely.`);
    } catch (error) { setStatus(error?.message || 'Policy document upload failed.', true); }
    finally { busy = false; }
  };
  picker.onchange = () => uploadMany(picker.files);
  camera.onchange = () => uploadMany(camera.files);
  list.addEventListener('click', async event => {
    const row = event.target.closest?.('[data-policy-document-id]');
    if (!row) return;
    const record = records.find(item => item.id === row.dataset.policyDocumentId);
    if (!record) return;
    if (event.target.closest('[data-policy-document-view]')) {
      try {
        setStatus('Opening secure preview…');
        preview(await signedUrl(record), record);
        setStatus('Policy document opened inside the CRM.');
      } catch (error) { setStatus(error?.message || 'Unable to preview this document.', true); }
    }
    if (event.target.closest('[data-policy-document-remove]')) {
      if (!confirm(`Remove ${record.file_name}?`)) return;
      try {
        setStatus('Removing policy document…');
        await removeOne(record);
        records = records.filter(item => item.id !== record.id);
        render();
        setStatus('Policy document removed.');
      } catch (error) { setStatus(error?.message || 'Unable to remove this document.', true); }
    }
  });
  load();
}

function enhance(scope = document) {
  if (scope instanceof Element && scope.matches?.('[data-life-policy-card]')) bindCard(scope);
  scope.querySelectorAll?.('[data-life-policy-card]').forEach(bindCard);
}

const observer = new MutationObserver(mutations => {
  const added = new Set();
  for (const mutation of mutations) for (const node of mutation.addedNodes) if (node instanceof Element) added.add(node);
  added.forEach(node => queueMicrotask(() => enhance(node)));
});
observer.observe(document.body, { childList: true, subtree: true });
enhance();
