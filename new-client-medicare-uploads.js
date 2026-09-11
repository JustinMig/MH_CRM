import { mhRepository, supabase } from './supabase-repository.js';

const BUCKET = 'mh-client-documents';
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

const states = new WeakMap();
let pendingOpenMode = null;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const safeName = value => String(value || 'document')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'document';

const fileMime = file => file.type || ({
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif'
})[String(file.name || '').toLowerCase().split('.').pop()] || '';

function stateFor(dialog) {
  let state = states.get(dialog);
  if (!state) {
    state = { clientId: '', files: new Map(), flushing: null };
    states.set(dialog, state);
  }
  return state;
}

function groupBySummary(panel, title) {
  return Array.from(panel.querySelectorAll('details.field-group'))
    .find(group => group.querySelector(':scope > summary')?.textContent.trim() === title) || null;
}

function markerFor(dialog) {
  const form = dialog.querySelector('form.client-form');
  if (!form) return null;
  let marker = form.querySelector('[data-new-client-asset-marker]');
  if (!marker) {
    marker = document.createElement('input');
    marker.type = 'hidden';
    marker.name = '_new_client_assets';
    marker.dataset.newClientAssetMarker = 'true';
    form.append(marker);
  }
  return marker;
}

function syncMarker(dialog) {
  const marker = markerFor(dialog);
  if (!marker) return;
  const state = stateFor(dialog);
  marker.value = Array.from(state.files.entries())
    .map(([key, item]) => `${key}:${item.file.name}:${item.file.size}:${item.file.lastModified}`)
    .join('|');
  marker.dispatchEvent(new Event('input', { bubbles: true }));
}

function setStatus(host, text, error = false) {
  const status = host.querySelector('[data-intake-file-status]');
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('error', error);
}

function updateQueuedHost(host, file = null, saved = false) {
  const summary = host.querySelector('[data-intake-file-summary]');
  const view = host.querySelector('[data-intake-file-view]');
  const remove = host.querySelector('[data-intake-file-remove]');
  if (summary) summary.textContent = file ? `${file.name}${saved ? ' • attached' : ' • ready to save'}` : 'No file added';
  if (view) view.hidden = !file || saved;
  if (remove) remove.hidden = !file || saved;
}

function boxMarkup(label, description) {
  return `<div class="medicare-card-manager span-all">
    <div class="medicare-card-heading">
      <strong>${esc(label)}</strong>
      <span data-intake-file-summary>No file added</span>
    </div>
    <p class="subtle">${esc(description)}</p>
    <div class="medicare-card-actions">
      <label class="btn secondary">Upload File<input type="file" data-intake-file accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" hidden></label>
      <label class="btn secondary">Camera / Scan<input type="file" data-intake-camera accept="image/*" capture="environment" hidden></label>
      <button type="button" class="btn secondary" data-intake-file-view hidden>View</button>
      <button type="button" class="btn danger" data-intake-file-remove hidden>Remove</button>
    </div>
    <div class="medicare-card-status" data-intake-file-status role="status" aria-live="polite"></div>
  </div>`;
}

function bindFileBox(dialog, group, { key, category, label, description, markerAttribute }) {
  if (!group || group.querySelector(`[${markerAttribute}]`)) return;
  const grid = group.querySelector(':scope > .form-grid');
  if (!grid) return;

  const host = document.createElement('div');
  host.className = 'medicare-card-host span-all';
  host.setAttribute(markerAttribute, 'true');
  if (category !== 'soa') host.dataset.cardManager = category;
  host.innerHTML = boxMarkup(label, description);
  grid.append(host);

  const state = stateFor(dialog);
  const picker = host.querySelector('[data-intake-file]');
  const camera = host.querySelector('[data-intake-camera]');
  const view = host.querySelector('[data-intake-file-view]');
  const remove = host.querySelector('[data-intake-file-remove]');

  const select = files => {
    const file = files?.[0];
    if (!file) return;
    const mime = fileMime(file);
    if (!ALLOWED_MIMES.has(mime)) {
      setStatus(host, 'Use a PDF or image file.', true);
      picker.value = '';
      camera.value = '';
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus(host, 'Files must be 25 MB or smaller.', true);
      picker.value = '';
      camera.value = '';
      return;
    }
    state.files.set(key, { file, category, label, host });
    picker.value = '';
    camera.value = '';
    updateQueuedHost(host, file, false);
    setStatus(host, `${label} is ready. It will attach when you click Save Client.`);
    syncMarker(dialog);
  };

  picker.addEventListener('change', () => select(picker.files));
  camera.addEventListener('change', () => select(camera.files));
  view.addEventListener('click', () => {
    const item = state.files.get(key);
    if (!item?.file) return;
    const url = URL.createObjectURL(item.file);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  remove.addEventListener('click', () => {
    state.files.delete(key);
    updateQueuedHost(host, null, false);
    setStatus(host, `${label} removed from this intake.`);
    syncMarker(dialog);
  });
}

function ensureSoaGroup(panel) {
  let group = panel.querySelector('[data-soa-group]');
  if (group) return group;
  const health = groupBySummary(panel, 'Health Plan Information');
  group = document.createElement('details');
  group.className = 'field-group';
  group.dataset.soaGroup = 'true';
  group.open = true;
  group.innerHTML = '<summary>Scope of Appointment (SOA)</summary><div class="form-grid"></div>';
  if (health) health.insertAdjacentElement('afterend', group);
  else panel.append(group);
  return group;
}

function intakeNotice(panel) {
  let notice = panel.querySelector('[data-assets-new-client]');
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'notice';
    notice.dataset.assetsNewClient = 'true';
    panel.prepend(notice);
  }
  const text = 'You can add cards and the Scope of Appointment now. They stay with this intake and attach automatically when you click Save Client.';
  if (notice.textContent !== text) notice.textContent = text;
}

function enhanceNewClient(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('client-dialog')) return;
  if (dialog.dataset.newClientIntakeAssets === 'true') return;
  if (pendingOpenMode !== 'new') return;
  if (dialog.dataset.clientId) return;

  const panel = dialog.querySelector('[data-panel="medicare"]');
  const form = dialog.querySelector('form.client-form');
  if (!panel || !form) return;

  const medicare = groupBySummary(panel, 'Medicare Information');
  const medicaid = groupBySummary(panel, 'Medicaid Information') || medicare;
  const health = groupBySummary(panel, 'Health Plan Information');
  if (!medicare || !health) return;

  dialog.dataset.newClientIntakeAssets = 'true';
  intakeNotice(panel);

  bindFileBox(dialog, medicare, {
    key: 'medicare-card', category: 'medicare_card', label: 'Medicare Card',
    description: 'Add the client’s Medicare card now.', markerAttribute: 'data-new-medicare-card'
  });
  bindFileBox(dialog, medicaid, {
    key: 'medicaid-card', category: 'medicaid_card', label: 'Medicaid Card',
    description: 'Add the client’s Medicaid card if applicable.', markerAttribute: 'data-new-medicaid-card'
  });
  bindFileBox(dialog, health, {
    key: 'health-plan-card', category: 'health_plan_card', label: 'Health Plan Card',
    description: 'Add the current plan/member card if available.', markerAttribute: 'data-new-health-plan-card'
  });
  bindFileBox(dialog, ensureSoaGroup(panel), {
    key: 'soa', category: 'soa', label: 'Scope of Appointment (SOA)',
    description: 'Upload the signed SOA or scan/photo it during intake.', markerAttribute: 'data-new-soa-upload'
  });

  markerFor(dialog);
}

async function uploadStored(clientId, item) {
  const file = item.file;
  const mime = fileMime(file);
  const path = `${clientId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: mime || 'application/octet-stream'
  });
  if (uploadError) throw uploadError;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    const body = {
      client_id: clientId,
      uploaded_by: user?.id || null,
      category: item.category,
      file_name: file.name,
      storage_path: path,
      mime_type: mime || 'application/octet-stream',
      file_size: file.size,
      notes: item.category === 'soa' ? 'Uploaded during new client intake' : 'Added during new client intake'
    };
    if (item.category === 'soa') body.document_date = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from('documents').insert(body);
    if (error) throw error;
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
}

async function flushPending(dialog, clientId) {
  const state = stateFor(dialog);
  state.clientId = clientId;
  dialog.dataset.clientId = clientId;
  if (state.flushing) return state.flushing;

  state.flushing = (async () => {
    const failures = [];
    for (const [key, item] of Array.from(state.files.entries())) {
      setStatus(item.host, `Attaching ${item.label}…`);
      try {
        await uploadStored(clientId, item);
        state.files.delete(key);
        updateQueuedHost(item.host, item.file, true);
        setStatus(item.host, `${item.label} attached securely.`);
      } catch (error) {
        failures.push(`${item.label}: ${error?.message || 'upload failed'}`);
        setStatus(item.host, `${item.label} could not be attached. Save again to retry.`, true);
      }
    }

    syncMarker(dialog);
    const notice = dialog.querySelector('[data-assets-new-client]');
    if (notice) {
      notice.textContent = failures.length
        ? `Client saved, but ${failures.length} file${failures.length === 1 ? '' : 's'} still need to upload. They remain queued here; click Save Client again to retry.`
        : 'Client saved. The cards and Scope of Appointment added during intake are attached to this client.';
      notice.classList.toggle('error', failures.length > 0);
    }

    if (failures.length) {
      setTimeout(() => {
        const marker = markerFor(dialog);
        if (!marker) return;
        marker.value = `${marker.value}|retry:${Date.now()}`;
        marker.dispatchEvent(new Event('input', { bubbles: true }));
      }, 0);
    }

    return failures;
  })().finally(() => { state.flushing = null; });

  return state.flushing;
}

const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function(record, ...args) {
  const saved = await baseSaveClient(record, ...args);
  if (!saved?.id) return saved;

  const dialogs = Array.from(document.querySelectorAll('dialog.client-dialog[data-new-client-intake-assets="true"]'));
  const dialog = dialogs.reverse().find(item => item.isConnected && (!item.dataset.clientId || item.dataset.clientId === saved.id));
  if (dialog) await flushPending(dialog, saved.id);
  return saved;
};

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-add-client]')) pendingOpenMode = 'new';
  else if (event.target.closest?.('[data-client-id]')) pendingOpenMode = 'existing';
}, true);

const observer = new MutationObserver(mutations => {
  const candidates = new Set();
  for (const mutation of mutations) {
    const parent = mutation.target instanceof Element ? mutation.target.closest?.('dialog.client-dialog') : null;
    if (parent) candidates.add(parent);
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('dialog.client-dialog')) candidates.add(node);
      const parentDialog = node.closest?.('dialog.client-dialog');
      if (parentDialog) candidates.add(parentDialog);
      node.querySelectorAll?.('dialog.client-dialog').forEach(dialog => candidates.add(dialog));
    }
  }
  candidates.forEach(dialog => queueMicrotask(() => enhanceNewClient(dialog)));
});

observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('dialog.client-dialog').forEach(dialog => enhanceNewClient(dialog));
