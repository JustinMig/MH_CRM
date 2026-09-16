function dateDigits(value) {
  const raw = String(value || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return `${iso[2]}${iso[3]}${iso[1]}`;
  return raw.replace(/\D/g, '').slice(0, 8);
}

function formatDateTyping(value) {
  const d = dateDigits(value);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}`;
}

function looksLikeClientDate(input) {
  if (!(input instanceof HTMLInputElement)) return false;
  if (!input.closest('dialog.client-dialog, form.client-form')) return false;
  if (input.hasAttribute('data-date')) return true;
  if (String(input.placeholder || '').toUpperCase().includes('MM/DD/YYYY')) return true;
  if (String(input.type || '').toLowerCase() !== 'text') return false;
  const name = String(input.name || '').toLowerCase();
  return /(^|_)(date|dob|effective_date|expiration|expiration_date|birth_date|date_of_birth)(_|$)/.test(name) || name.endsWith('_date');
}

function configureDate(input) {
  if (!looksLikeClientDate(input)) return;
  input.inputMode = 'numeric';
  input.maxLength = 10;
  input.placeholder = 'MM/DD/YYYY';
  input.dataset.crmSlashDate = 'true';
  const formatted = formatDateTyping(input.value);
  if (formatted && formatted !== input.value) input.value = formatted;
}

function applyDate(input) {
  if (!looksLikeClientDate(input)) return;
  configureDate(input);
  const formatted = formatDateTyping(input.value);
  if (formatted === input.value) return;
  const atEnd = input.selectionStart == null || input.selectionStart === input.value.length;
  input.value = formatted;
  if (atEnd) {
    try { input.setSelectionRange(formatted.length, formatted.length); } catch {}
  }
}

function dropZoneFor(input) {
  return input.closest('label') || input.parentElement;
}

function installDropInput(input) {
  if (!(input instanceof HTMLInputElement) || input.type !== 'file' || input.disabled || input.dataset.crmDropReady === 'true') return;
  if (!input.closest('dialog.client-dialog, form.client-form')) return;
  input.dataset.crmDropReady = 'true';
  if (!input.hasAttribute('capture')) input.multiple = true;
  const zone = dropZoneFor(input);
  if (!zone) return;
  zone.classList.add('crm-file-drop-zone');
  if (!zone.title) zone.title = 'Choose files or drag and drop files here';

  let depth = 0;
  const active = on => zone.classList.toggle('is-dragging-file', on);
  zone.addEventListener('dragenter', event => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    depth += 1;
    active(true);
  });
  zone.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    active(true);
  });
  zone.addEventListener('dragleave', event => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    depth = Math.max(0, depth - 1);
    if (!depth) active(false);
  });
  zone.addEventListener('drop', event => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    event.stopPropagation();
    depth = 0;
    active(false);
    const incoming = Array.from(event.dataTransfer.files);
    const chosen = input.multiple ? incoming : incoming.slice(0, 1);
    if (!chosen.length) return;
    try {
      const transfer = new DataTransfer();
      chosen.forEach(file => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      console.error('Drag and drop upload could not attach the selected files.', error);
    }
  });
}

export function installClientDateAndDragDrop(root) {
  if (!root || root.dataset.clientDateDropInstalled === 'true') return;
  root.dataset.clientDateDropInstalled = 'true';

  const style = document.createElement('style');
  style.id = 'client-date-drop-style';
  style.textContent = `
    dialog.client-dialog .crm-file-drop-zone{position:relative;transition:outline-color .12s ease,background-color .12s ease}
    dialog.client-dialog .crm-file-drop-zone.is-dragging-file{outline:3px dashed #6f8798;outline-offset:4px;background:#edf3f6!important}
    dialog.client-dialog .multi-file-manager .medicare-card-actions::after,
    dialog.client-dialog .document-actions::after{content:'Drag & drop files here';align-self:center;color:#6b7e8b;font-size:11px;font-weight:700;padding:4px 2px}
    @media(max-width:620px){dialog.client-dialog .multi-file-manager .medicare-card-actions::after,dialog.client-dialog .document-actions::after{flex-basis:100%;text-align:center}}
  `;
  document.head.append(style);

  const enhance = scope => {
    const base = scope instanceof Element ? scope : root;
    base.querySelectorAll?.('input').forEach(input => {
      if (looksLikeClientDate(input)) configureDate(input);
      if (input.type === 'file') installDropInput(input);
    });
    if (base instanceof HTMLInputElement) {
      if (looksLikeClientDate(base)) configureDate(base);
      if (base.type === 'file') installDropInput(base);
    }
  };

  document.addEventListener('focusin', event => {
    if (looksLikeClientDate(event.target)) applyDate(event.target);
  }, true);
  document.addEventListener('input', event => {
    if (looksLikeClientDate(event.target)) applyDate(event.target);
  }, true);
  document.addEventListener('paste', event => {
    if (!looksLikeClientDate(event.target)) return;
    queueMicrotask(() => applyDate(event.target));
  }, true);

  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) enhance(node);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  enhance(document.body);
}
