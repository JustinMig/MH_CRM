import { mhRepository, supabase } from './supabase-repository.js';

const BUCKET = 'mh-client-documents';
const MAX_CARD_BYTES = 25 * 1024 * 1024;
const CARD_TYPES = new Set(['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']);
const PRODUCT_OPTIONS = [
  'Medicare Advantage (Part C) / Cost Plans',
  'Stand-alone Prescription Drug Plans (Part D)',
  'Medicare Supplement (Medigap)',
  'Dental / Vision / Hearing products',
  'Hospital Indemnity products',
  'Other Medicare-related health products'
];

let pendingClientId = null;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeName = value => String(value || 'document').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'document';
const today = () => new Date().toISOString().slice(0, 10);
const fileMime = file => file.type || ({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif'})[String(file.name || '').toLowerCase().split('.').pop()] || '';
const humanDate = value => value ? new Date(value).toLocaleDateString() : '';

async function listCategory(clientId, categories) {
  const names = Array.isArray(categories) ? categories : [categories];
  const { data, error } = await supabase.from('documents')
    .select('id,client_id,category,file_name,storage_path,mime_type,file_size,document_date,notes,created_at')
    .eq('client_id', clientId)
    .in('category', names)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function uploadFile(clientId, file, category, notes = null, documentDate = null) {
  const mime = fileMime(file);
  if (!CARD_TYPES.has(mime) && category !== 'soa') throw new Error('Use a PDF or image file for this card.');
  if (file.size > MAX_CARD_BYTES) throw new Error('Files must be 25 MB or smaller.');
  const path = `${clientId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: mime || 'image/png'
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
      mime_type: mime || 'image/png',
      file_size: file.size,
      document_date: documentDate,
      notes
    }).select().single();
    if (error) throw error;
    return data;
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
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

function groupBySummary(panel, title) {
  return Array.from(panel.querySelectorAll('details.field-group')).find(group => group.querySelector(':scope > summary')?.textContent.trim() === title) || null;
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

function bindCardManager(group, clientId, category, label) {
  if (!group || group.querySelector(`[data-card-manager="${category}"]`)) return;
  const grid = group.querySelector(':scope > .form-grid');
  if (!grid) return;
  const host = document.createElement('div');
  host.dataset.cardManager = category;
  host.className = 'medicare-card-host span-all';
  host.innerHTML = cardMarkup(label);
  grid.append(host);

  const fileInput = host.querySelector('[data-card-file]');
  const cameraInput = host.querySelector('[data-card-camera]');
  const openButton = host.querySelector('[data-card-open]');
  const removeButton = host.querySelector('[data-card-remove]');
  const summary = host.querySelector('[data-card-summary]');
  const status = host.querySelector('[data-card-status]');
  let current = null;
  let busy = false;

  const render = () => {
    summary.textContent = current ? `${current.file_name} • ${humanDate(current.created_at)}` : 'No card saved';
    openButton.hidden = !current;
    removeButton.hidden = !current;
  };
  const setStatus = (text = '', isError = false) => {
    status.textContent = text;
    status.classList.toggle('error', isError);
  };
  const load = async () => {
    try {
      const rows = await listCategory(clientId, category);
      current = rows[0] || null;
      render();
    } catch (error) { setStatus(error?.message || 'Unable to load card.', true); }
  };
  const upload = async files => {
    const file = files?.[0];
    if (!file || busy) return;
    busy = true;
    setStatus(`Uploading ${file.name} securely…`);
    try {
      current = await uploadFile(clientId, file, category);
      fileInput.value = '';
      cameraInput.value = '';
      render();
      setStatus(`${label} saved securely.`);
    } catch (error) { setStatus(error?.message || 'Upload failed.', true); }
    finally { busy = false; }
  };

  fileInput.addEventListener('change', () => upload(fileInput.files));
  cameraInput.addEventListener('change', () => upload(cameraInput.files));
  openButton.addEventListener('click', async () => {
    if (!current) return;
    try { setStatus('Opening secure card…'); await openStored(current); setStatus('Secure card opened.'); }
    catch (error) { setStatus(error?.message || 'Unable to open card.', true); }
  });
  removeButton.addEventListener('click', async () => {
    if (!current || !confirm(`Remove ${label}?`)) return;
    try { setStatus('Removing card…'); await removeStored(current); current = null; render(); setStatus(`${label} removed.`); }
    catch (error) { setStatus(error?.message || 'Unable to remove card.', true); }
  });
  load();
}

async function clientContext(clientId) {
  const [{ data: client, error: clientError }, { data: { user } }] = await Promise.all([
    supabase.from('clients').select('id,first_name,last_name,phone,address1,address2,city,state,zip_code,assigned_agent_id').eq('id', clientId).single(),
    supabase.auth.getUser()
  ]);
  if (clientError) throw clientError;
  let agent = mhRepository.profile || null;
  if (client.assigned_agent_id) {
    const { data } = await supabase.from('profiles').select('id,full_name,phone').eq('id', client.assigned_agent_id).maybeSingle();
    if (data) agent = data;
  }
  return {
    user,
    client,
    clientName: [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client',
    address: [client.address1, client.address2, client.city, client.state, client.zip_code].filter(Boolean).join(', '),
    agentName: agent?.full_name || mhRepository.profile?.full_name || 'M&H Insurance Group Agent',
    agentPhone: agent?.phone || mhRepository.profile?.phone || ''
  };
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '', cursorY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY); line = word; cursorY += lineHeight;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, cursorY);
  return cursorY + lineHeight;
}

function signaturePointer(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
}

async function buildSoaPng(context, products, otherProduct, signatureCanvas, agentPhone) {
  const canvas = document.createElement('canvas');
  canvas.width = 1400; canvas.height = 2300;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the signed SOA.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 48px Arial'; ctx.fillText('M&H Insurance Group', 90, 110);
  ctx.font = 'bold 38px Arial'; ctx.fillText('Scope of Sales Appointment Confirmation', 90, 175);
  const signedAt = new Date();
  ctx.font = '22px Arial'; ctx.fillStyle = '#475569'; ctx.fillText(`Appointment date: ${today()}`, 90, 225); ctx.fillText(`SOA signed: ${signedAt.toLocaleString()}`, 90, 265);
  ctx.fillStyle = '#0f172a'; ctx.font = '22px Arial';
  let y = 320;
  y = wrapText(ctx, 'This Scope of Appointment documents the Medicare and health-related product types the beneficiary requested to discuss with the agent named below.', 90, y, 1210, 32) + 20;
  y = wrapText(ctx, 'Signing this form does not obligate the beneficiary to enroll, does not affect current or future Medicare enrollment status, and does not automatically enroll the beneficiary in any plan.', 90, y, 1210, 32) + 30;
  ctx.font = 'bold 28px Arial'; ctx.fillText('Beneficiary', 90, y); y += 44;
  ctx.font = '24px Arial'; ctx.fillText(`Name: ${context.clientName}`, 90, y); y += 38; ctx.fillText(`Phone: ${context.client.phone || 'Not provided'}`, 90, y); y += 38;
  y = wrapText(ctx, `Address: ${context.address || 'Not provided'}`, 90, y, 1210, 34) + 20;
  ctx.font = 'bold 28px Arial'; ctx.fillText('Agent', 90, y); y += 44;
  ctx.font = '24px Arial'; ctx.fillText(`Name: ${context.agentName}`, 90, y); y += 38; ctx.fillText(`Phone: ${agentPhone || 'Not provided'}`, 90, y); y += 60;
  ctx.font = 'bold 28px Arial'; ctx.fillText('Products requested for discussion', 90, y); y += 44; ctx.font = '24px Arial';
  const selected = [...products]; if (otherProduct.trim()) selected.push(otherProduct.trim());
  selected.forEach(product => { ctx.fillText(`• ${product}`, 110, y); y += 36; });
  y += 28; ctx.font = 'bold 28px Arial'; ctx.fillText('Beneficiary acknowledgement', 90, y); y += 44; ctx.font = '24px Arial';
  y = wrapText(ctx, 'By signing below, I confirm that I requested discussion of the product types selected above. I understand I am under no obligation to enroll in a plan and that the agent may discuss only the product types agreed to on this Scope of Appointment unless an updated Scope is documented.', 90, y, 1210, 36) + 35;
  ctx.font = 'bold 26px Arial'; ctx.fillText('Beneficiary signature', 90, y); y += 24; ctx.strokeStyle = '#cbd5e1'; ctx.strokeRect(90, y, 1210, 300);
  ctx.drawImage(signatureCanvas, 110, y + 20, 1170, 260); y += 345; ctx.font = '22px Arial'; ctx.fillStyle = '#475569'; ctx.fillText(`Signed electronically: ${signedAt.toLocaleString()}`, 90, y);
  y += 40; ctx.font = '18px Arial'; ctx.fillText('Generated and stored securely by M&H Insurance Group CRM.', 90, y);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create signed SOA.')), 'image/png'));
}

async function openSignOnScreen(clientId, onSaved) {
  const context = await clientContext(clientId);
  const modal = document.createElement('dialog');
  modal.className = 'mh-soa-dialog';
  modal.innerHTML = `<div class="mh-soa-frame">
    <header><div><h2>Scope of Appointment</h2><p>Review the products with the client, then have the client sign on screen.</p></div><button type="button" class="modal-close" data-soa-close>×</button></header>
    <div class="mh-soa-body">
      <div class="mh-soa-client"><strong>${esc(context.clientName)}</strong><span>${esc(context.client.phone || 'No phone on file')}</span><span>${esc(context.address || 'No address on file')}</span></div>
      <label class="field"><span>Agent Phone</span><input data-agent-phone value="${esc(context.agentPhone)}" placeholder="Agent phone number"></label>
      <fieldset class="mh-soa-products"><legend>Products requested for discussion</legend>${PRODUCT_OPTIONS.map((p,i)=>`<label><input type="checkbox" data-soa-product value="${esc(p)}"${i < PRODUCT_OPTIONS.length ? ' checked' : ''}> ${esc(p)}</label>`).join('')}<label class="span-all"><span>Other product</span><input data-soa-other placeholder="Optional"></label></fieldset>
      <div class="mh-signature-wrap"><strong>Beneficiary Signature</strong><canvas data-soa-signature width="1000" height="260"></canvas><button type="button" class="btn secondary" data-soa-clear>Clear Signature</button></div>
      <div class="medicare-card-status" data-soa-status role="status"></div>
    </div>
    <footer><button type="button" class="btn secondary" data-soa-cancel>Cancel</button><button type="button" class="btn primary" data-soa-save>Save Signed SOA</button></footer>
  </div>`;
  document.body.append(modal); modal.showModal();
  const canvas = modal.querySelector('[data-soa-signature]');
  const ctx = canvas.getContext('2d');
  let drawing = false, last = null, hasInk = false;
  canvas.addEventListener('pointerdown', e => { e.preventDefault(); drawing = true; canvas.setPointerCapture(e.pointerId); last = signaturePointer(canvas,e); });
  canvas.addEventListener('pointermove', e => { if (!drawing || !last) return; e.preventDefault(); const next = signaturePointer(canvas,e); ctx.strokeStyle='#111827';ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(next.x,next.y);ctx.stroke();last=next;hasInk=true; });
  const end = e => { if (e) e.preventDefault(); drawing=false;last=null; };
  canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('pointerleave',end);
  modal.querySelector('[data-soa-clear]').onclick = () => { ctx.clearRect(0,0,canvas.width,canvas.height);hasInk=false; };
  const close = () => { modal.close(); modal.remove(); };
  modal.querySelector('[data-soa-close]').onclick = close; modal.querySelector('[data-soa-cancel]').onclick = close;
  modal.addEventListener('cancel', e => { e.preventDefault(); close(); });
  modal.querySelector('[data-soa-save]').onclick = async e => {
    const status = modal.querySelector('[data-soa-status]');
    const button = e.currentTarget;
    try {
      if (!hasInk) throw new Error('The client must sign before saving the SOA.');
      const products = Array.from(modal.querySelectorAll('[data-soa-product]:checked')).map(input => input.value);
      const other = modal.querySelector('[data-soa-other]').value.trim();
      if (!products.length && !other) throw new Error('Select at least one product type to discuss.');
      button.disabled = true; status.textContent = 'Creating and saving signed SOA…';
      const blob = await buildSoaPng(context, products, other, canvas, modal.querySelector('[data-agent-phone]').value.trim());
      const file = new File([blob], `Scope_of_Appointment_${safeName(context.clientName)}_${today()}.png`, { type:'image/png' });
      await uploadFile(clientId, file, 'soa', 'Signed on screen', today());
      status.textContent = 'Signed SOA saved securely.';
      await onSaved?.();
      setTimeout(close, 500);
    } catch (error) { status.textContent = error?.message || 'Unable to save SOA.'; status.classList.add('error'); button.disabled = false; }
  };
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = ''; bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function smsPhone(value) {
  const digits = String(value || '').replace(/\D/g,'');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return String(value || '').trim();
}

async function openTextSoa(clientId, onCreated) {
  const context = await clientContext(clientId);
  const modal = document.createElement('dialog');
  modal.className = 'mh-soa-dialog';
  modal.innerHTML = `<div class="mh-soa-frame compact">
    <header><div><h2>Text Scope of Appointment</h2><p>Create a secure signing link and send it to the client.</p></div><button type="button" class="modal-close" data-soa-close>×</button></header>
    <div class="mh-soa-body">
      <label class="field"><span>Client Mobile Number</span><input data-text-phone value="${esc(context.client.phone || '')}" placeholder="(###) ###-####"></label>
      <fieldset class="mh-soa-products"><legend>Products requested for discussion</legend>${PRODUCT_OPTIONS.map(p=>`<label><input type="checkbox" data-text-product value="${esc(p)}" checked> ${esc(p)}</label>`).join('')}<label class="span-all"><span>Other product</span><input data-text-other placeholder="Optional"></label></fieldset>
      <div class="medicare-card-status" data-text-status role="status"></div>
    </div>
    <footer><button type="button" class="btn secondary" data-soa-cancel>Cancel</button><button type="button" class="btn primary" data-text-send>TEXT SOA TO CLIENT</button></footer>
  </div>`;
  document.body.append(modal); modal.showModal();
  const close = () => { modal.close();modal.remove(); };
  modal.querySelector('[data-soa-close]').onclick=close;modal.querySelector('[data-soa-cancel]').onclick=close;modal.addEventListener('cancel',e=>{e.preventDefault();close();});
  modal.querySelector('[data-text-send]').onclick = async e => {
    const status = modal.querySelector('[data-text-status]');
    const button = e.currentTarget;
    try {
      const phone = smsPhone(modal.querySelector('[data-text-phone]').value);
      if (!phone) throw new Error('Enter the client mobile number.');
      const products = Array.from(modal.querySelectorAll('[data-text-product]:checked')).map(input=>input.value);
      const other = modal.querySelector('[data-text-other]').value.trim();
      if (!products.length && !other) throw new Error('Select at least one product type.');
      button.disabled=true;status.textContent='Creating secure signing link…';
      const token = randomToken(); const tokenHash = await sha256Hex(token);
      const { error } = await supabase.from('soa_signature_requests').insert({
        client_id: clientId,
        requested_by: context.user?.id,
        token_hash: tokenHash,
        phone,
        request_payload: {
          beneficiary_name: context.clientName,
          beneficiary_phone: context.client.phone || phone,
          beneficiary_address: context.address,
          agent_name: context.agentName,
          agent_phone: context.agentPhone,
          products,
          other_product: other
        }
      });
      if (error) throw error;
      const signUrl = `https://mh.mayerig.com/soa-sign.html?token=${encodeURIComponent(token)}`;
      const message = `M&H Insurance Group: ${context.clientName}, please review and sign your Scope of Appointment here: ${signUrl}`;
      try { await navigator.clipboard?.writeText(signUrl); } catch {}
      const separator = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?';
      const smsUrl = `sms:${encodeURIComponent(phone)}${separator}body=${encodeURIComponent(message)}`;
      status.innerHTML = `Secure signing link created. The link was copied to your clipboard. <a href="${esc(smsUrl)}">Open text message</a>`;
      const link = document.createElement('a'); link.href=smsUrl; link.style.display='none'; document.body.append(link); link.click(); link.remove();
      await onCreated?.();
      button.disabled=false;
    } catch (error) { status.textContent=error?.message || 'Unable to create SOA text.';status.classList.add('error');button.disabled=false; }
  };
}

function bindSoaGroup(panel, clientId) {
  if (panel.querySelector('[data-soa-group]')) return;
  const health = groupBySummary(panel, 'Health Plan Information');
  if (!health) return;
  const group = document.createElement('details');
  group.className='field-group';group.dataset.soaGroup='true';group.open=false;
  group.innerHTML=`<summary>Scope of Appointment (SOA)</summary><div class="form-grid"><div class="soa-control-box span-all">
    <div><strong>Scope of Appointment</strong><span data-soa-summary>No signed SOA saved</span></div>
    <div class="soa-control-actions"><button type="button" class="btn primary" data-sign-soa>Sign On Screen</button><button type="button" class="btn primary" data-text-soa>Text SOA</button><button type="button" class="btn secondary" data-view-soa hidden>View Signed SOA</button></div>
    <div class="medicare-card-status" data-soa-group-status role="status"></div>
  </div></div>`;
  const notes = groupBySummary(panel,'Medicare Notes');
  if (notes) notes.insertAdjacentElement('beforebegin',group); else health.insertAdjacentElement('afterend',group);
  const summary=group.querySelector('[data-soa-summary]'),view=group.querySelector('[data-view-soa]'),status=group.querySelector('[data-soa-group-status]');
  let latest=null;
  const refresh=async()=>{try{const rows=await listCategory(clientId,['soa','scope_of_appointment']);latest=rows[0]||null;summary.textContent=latest?`Signed ${humanDate(latest.document_date || latest.created_at)} • ${latest.file_name}`:'No signed SOA saved';view.hidden=!latest;}catch(error){status.textContent=error?.message||'Unable to load SOA.';status.classList.add('error');}};
  view.onclick=async()=>{if(!latest)return;try{await openStored(latest);}catch(error){status.textContent=error?.message||'Unable to open SOA.';status.classList.add('error');}};
  group.querySelector('[data-sign-soa]').onclick=()=>openSignOnScreen(clientId,refresh).catch(error=>{status.textContent=error?.message||'Unable to open SOA signer.';status.classList.add('error');});
  group.querySelector('[data-text-soa]').onclick=()=>openTextSoa(clientId,refresh).catch(error=>{status.textContent=error?.message||'Unable to create SOA text.';status.classList.add('error');});
  refresh();
}

function bindMedicareAssets(dialog) {
  if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('client-dialog')) return;
  const panel=dialog.querySelector('[data-panel="medicare"]');
  if (!panel) return;
  const clientId=dialog.dataset.clientId || pendingClientId || '';
  if (!clientId) {
    if (!panel.querySelector('[data-assets-new-client]')) {
      const health=groupBySummary(panel,'Health Plan Information');
      if (health) { const msg=document.createElement('div');msg.dataset.assetsNewClient='true';msg.className='notice';msg.textContent='Save this new client first, then reopen the client record to add Medicare cards or a Scope of Appointment.';health.insertAdjacentElement('afterend',msg); }
    }
    return;
  }
  dialog.dataset.clientId=clientId;
  bindCardManager(groupBySummary(panel,'Medicare Information'),clientId,'medicare_card','Medicare Card');
  bindCardManager(groupBySummary(panel,'Medicaid Information'),clientId,'medicaid_card','Medicaid Card');
  bindCardManager(groupBySummary(panel,'Health Plan Information'),clientId,'health_plan_card','Health Plan Card');
  bindSoaGroup(panel,clientId);
}

document.addEventListener('click',event=>{
  const existing=event.target.closest?.('[data-client-id]');
  const add=event.target.closest?.('[data-add-client]');
  if(existing) pendingClientId=existing.dataset.clientId||null; else if(add) pendingClientId=null;
},true);

const observer=new MutationObserver(mutations=>{
  for(const mutation of mutations){
    const parent=mutation.target instanceof Element?mutation.target.closest?.('dialog.client-dialog'):null;
    if(parent) queueMicrotask(()=>bindMedicareAssets(parent));
    for(const node of mutation.addedNodes){
      if(!(node instanceof Element))continue;
      const dialog=node.matches?.('dialog.client-dialog')?node:node.closest?.('dialog.client-dialog');
      if(dialog)queueMicrotask(()=>bindMedicareAssets(dialog));
      node.querySelectorAll?.('dialog.client-dialog').forEach(d=>queueMicrotask(()=>bindMedicareAssets(d)));
    }
  }
});
observer.observe(document.body,{childList:true,subtree:true});
document.querySelectorAll('dialog.client-dialog').forEach(bindMedicareAssets);
