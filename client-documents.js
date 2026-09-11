import { supabase } from './supabase-repository.js';

const BUCKET = 'mh-client-documents';
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

let pendingClientId = null;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));

const safeName = value => String(value || 'document')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'document';

const humanSize = bytes => {
  const n = Number(bytes || 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 ** 2)).toFixed(1)} MB`;
};

const typeFallback = file => {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split('.').pop();
  return ({
    pdf:'application/pdf', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp',
    heic:'image/heic', heif:'image/heif', doc:'application/msword',
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt:'text/plain'
  })[ext] || '';
};

async function listDocuments(clientId) {
  const { data, error } = await supabase
    .from('documents')
    .select('id,client_id,category,file_name,storage_path,mime_type,file_size,document_date,notes,created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function uploadDocument(clientId, file, category) {
  const mime = typeFallback(file);
  if (!ALLOWED.has(mime)) throw new Error(`${file.name}: this file type is not allowed.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: files must be 25 MB or smaller.`);

  const path = `${clientId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: mime });
  if (uploadError) throw uploadError;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('documents').insert({
      client_id: clientId,
      uploaded_by: user?.id || null,
      category: category || 'other',
      file_name: file.name,
      storage_path: path,
      mime_type: mime,
      file_size: file.size
    }).select().single();
    if (error) throw error;
    return data;
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
}

async function openDocument(record) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(record.storage_path, 60);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Unable to create a secure document link.');
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

async function deleteDocument(record) {
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([record.storage_path]);
  if (storageError) throw storageError;
  const { error: rowError } = await supabase.from('documents').delete().eq('id', record.id).eq('client_id', record.client_id);
  if (rowError) throw rowError;
}

function documentPanelMarkup() {
  return `
    <div class="client-documents-panel">
      <div class="document-manager-head">
        <div>
          <h3>Secure Documents</h3>
          <p>Files are stored in the private M&amp;H document vault and require an authenticated CRM login to access.</p>
        </div>
      </div>
      <div class="document-upload-card">
        <label class="document-category"><span>Document Type</span>
          <select data-doc-category>
            <option value="other">Other</option>
            <option value="medicare_card">Medicare Card</option>
            <option value="insurance_policy">Insurance Policy</option>
            <option value="soa">Scope of Appointment</option>
            <option value="application">Application</option>
            <option value="id">Identification</option>
          </select>
        </label>
        <label class="document-file-picker"><span>Choose Document</span><input type="file" data-doc-files multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.txt"></label>
        <button type="button" class="btn primary" data-upload-documents>Upload Securely</button>
        <label class="btn secondary document-camera">Camera / Scan<input type="file" data-doc-camera accept="image/*" capture="environment" hidden></label>
      </div>
      <div class="document-status" data-document-status role="status" aria-live="polite"></div>
      <div class="document-list" data-document-list></div>
    </div>`;
}

function bindDocumentPanel(dialog, clientId) {
  if (!clientId || dialog.dataset.documentsBound === 'true') return;
  const panel = dialog.querySelector('[data-panel="documents"]');
  if (!panel) return;
  dialog.dataset.documentsBound = 'true';
  panel.innerHTML = documentPanelMarkup();

  const fileInput = panel.querySelector('[data-doc-files]');
  const cameraInput = panel.querySelector('[data-doc-camera]');
  const category = panel.querySelector('[data-doc-category]');
  const uploadButton = panel.querySelector('[data-upload-documents]');
  const status = panel.querySelector('[data-document-status]');
  const list = panel.querySelector('[data-document-list]');
  let records = [];
  let loaded = false;
  let busy = false;

  const setStatus = (text = '', error = false) => {
    status.textContent = text;
    status.classList.toggle('error', error);
  };

  const render = () => {
    if (!records.length) {
      list.innerHTML = '<div class="document-empty"><strong>No documents uploaded yet.</strong><span>Use the secure upload box above to add this client’s first document.</span></div>';
      return;
    }
    list.innerHTML = records.map(record => `
      <article class="document-row" data-document-id="${esc(record.id)}">
        <div class="document-row-main">
          <strong>${esc(record.file_name)}</strong>
          <span>${esc(String(record.category || 'other').replaceAll('_', ' '))} • ${esc(humanSize(record.file_size))} • ${esc(new Date(record.created_at).toLocaleDateString())}</span>
        </div>
        <div class="document-row-actions">
          <button type="button" class="btn secondary" data-open-document>Open</button>
          <button type="button" class="btn danger" data-delete-document>Delete</button>
        </div>
      </article>`).join('');

    records.forEach(record => {
      const row = list.querySelector(`[data-document-id="${CSS.escape(record.id)}"]`);
      row?.querySelector('[data-open-document]')?.addEventListener('click', async () => {
        try {
          setStatus('Opening secure document…');
          await openDocument(record);
          setStatus('Secure document opened. The access link expires automatically.');
        } catch (error) {
          setStatus(error?.message || 'Unable to open this document.', true);
        }
      });
      row?.querySelector('[data-delete-document]')?.addEventListener('click', async () => {
        if (!confirm(`Delete ${record.file_name}? This cannot be undone.`)) return;
        try {
          setStatus('Deleting document…');
          await deleteDocument(record);
          records = records.filter(item => item.id !== record.id);
          render();
          setStatus('Document deleted.');
        } catch (error) {
          setStatus(error?.message || 'Unable to delete this document.', true);
        }
      });
    });
  };

  const load = async () => {
    if (busy) return;
    busy = true;
    setStatus('Loading secure documents…');
    try {
      records = await listDocuments(clientId);
      loaded = true;
      render();
      setStatus(`${records.length} secure document${records.length === 1 ? '' : 's'} stored for this client.`);
    } catch (error) {
      setStatus(error?.message || 'Unable to load secure documents.', true);
    } finally {
      busy = false;
    }
  };

  const uploadFiles = async files => {
    const selected = Array.from(files || []);
    if (!selected.length || busy) return;
    busy = true;
    uploadButton.disabled = true;
    try {
      let done = 0;
      for (const file of selected) {
        setStatus(`Uploading ${done + 1} of ${selected.length}: ${file.name}`);
        await uploadDocument(clientId, file, category.value);
        done += 1;
      }
      fileInput.value = '';
      cameraInput.value = '';
      records = await listDocuments(clientId);
      loaded = true;
      render();
      setStatus(`${done} document${done === 1 ? '' : 's'} uploaded securely.`);
    } catch (error) {
      setStatus(error?.message || 'Document upload failed.', true);
    } finally {
      busy = false;
      uploadButton.disabled = false;
    }
  };

  uploadButton.addEventListener('click', () => uploadFiles(fileInput.files));
  cameraInput.addEventListener('change', () => uploadFiles(cameraInput.files));
  dialog.querySelector('[data-tab="documents"]')?.addEventListener('click', () => { if (!loaded) load(); });
}

function bindNewDialog(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('client-dialog')) return;
  const clientId = dialog.dataset.clientId || pendingClientId;
  const panel = dialog.querySelector('[data-panel="documents"]');

  // Existing-client dialogs are inserted before their async client form finishes
  // rendering. Wait until the Documents panel actually exists, then replace the
  // old placeholder with the live secure storage manager.
  if (!panel) return;

  if (!clientId) {
    if (dialog.dataset.newClientDocumentsReady === 'true') return;
    dialog.dataset.newClientDocumentsReady = 'true';
    panel.innerHTML = '<div class="panel-card"><h3>Secure Documents</h3><p class="subtle">Save this new client first, then reopen the client record to upload secure documents.</p></div>';
    return;
  }

  dialog.dataset.clientId = clientId;
  bindDocumentPanel(dialog, clientId);
}

document.addEventListener('click', event => {
  const existing = event.target.closest?.('[data-client-id]');
  const add = event.target.closest?.('[data-add-client]');
  if (existing) pendingClientId = existing.dataset.clientId || null;
  else if (add) pendingClientId = null;
}, true);

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    const mutationDialog = mutation.target instanceof Element ? mutation.target.closest?.('dialog.client-dialog') : null;
    if (mutationDialog) bindNewDialog(mutationDialog);

    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;

      if (node.matches('dialog.client-dialog')) bindNewDialog(node);
      node.querySelectorAll?.('dialog.client-dialog').forEach(bindNewDialog);

      // Most importantly, rerun binding when the asynchronously loaded client
      // form/panels are inserted inside an already-open client dialog.
      const parentDialog = node.closest?.('dialog.client-dialog');
      if (parentDialog) bindNewDialog(parentDialog);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('dialog.client-dialog').forEach(bindNewDialog);
