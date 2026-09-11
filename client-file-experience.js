import { mhRepository, supabase } from './supabase-repository.js';

const BUCKET = 'mh-client-documents';
const MAX_BYTES = 25 * 1024 * 1024;
const CARD_MIMES = new Set(['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']);
const intakeStates = new WeakMap();

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeName = value => String(value || 'document').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120) || 'document';
const mimeFor = file => file?.type || ({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif'})[String(file?.name || '').toLowerCase().split('.').pop()] || 'application/octet-stream';
const humanDate = value => value ? new Date(value).toLocaleDateString() : '';

async function signedUrl(record, seconds = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(record.storage_path, seconds);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Unable to create a secure file link.');
  return data.signedUrl;
}

async function downloadInsideSite(url, fileName) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Unable to download this file.');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName || 'document';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function openPreview({ url, fileName = 'Document', mimeType = '', revokeOnClose = false }) {
  const modal = document.createElement('dialog');
  modal.className = 'mh-file-preview-dialog';
  const image = String(mimeType).startsWith('image/');
  const inline = image || mimeType === 'application/pdf' || String(mimeType).startsWith('text/');
  modal.innerHTML = `<div class="mh-file-preview-frame">
    <header class="mh-file-preview-head">
      <div><h2>${esc(fileName)}</h2><p>Secure in-site preview</p></div>
      <div class="mh-file-preview-actions">
        <button type="button" class="btn secondary" data-preview-download>Download</button>
        <button type="button" class="modal-close" data-preview-close aria-label="Close preview">×</button>
      </div>
    </header>
    <div class="mh-file-preview-body">
      ${image ? `<img src="${esc(url)}" alt="${esc(fileName)}">` : inline ? `<iframe src="${esc(url)}" title="${esc(fileName)}"></iframe>` : `<div class="mh-file-preview-unavailable"><strong>Preview is not available for this file type.</strong><span>You can download the file without leaving the CRM.</span></div>`}
    </div>
  </div>`;
  document.body.append(modal);
  const close = () => {
    if (!modal.isConnected) return;
    modal.close();
    modal.remove();
    if (revokeOnClose) URL.revokeObjectURL(url);
  };
  modal.querySelector('[data-preview-close]').onclick = close;
  modal.querySelector('[data-preview-download]').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await downloadInsideSite(url, fileName); }
    catch (error) { alert(error?.message || 'Unable to download this file.'); }
    finally { button.disabled = false; }
  };
  modal.addEventListener('cancel', event => { event.preventDefault(); close(); });
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.showModal();
  return modal;
}

async function previewStored(record) {
  const url = await signedUrl(record);
  openPreview({ url, fileName: record.file_name || 'Document', mimeType: record.mime_type || '' });
}

async function uploadStored(clientId, file, category, notes = null) {
  const mime = mimeFor(file);
  if (!CARD_MIMES.has(mime) && category !== 'soa') throw new Error(`${file.name}: use a PDF or image file.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: files must be 25 MB or smaller.`);
  const path = `${clientId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl:'3600', upsert:false, contentType:mime });
  if (uploadError) throw uploadError;
  try {
    const { data:{ user } } = await supabase.auth.getUser();
    const body = {
      client_id: clientId,
      uploaded_by: user?.id || null,
      category,
      file_name: file.name,
      storage_path: path,
      mime_type: mime,
      file_size: file.size,
      notes
    };
    if (category === 'soa') body.document_date = new Date().toISOString().slice(0,10);
    const { data, error } = await supabase.from('documents').insert(body).select('id,client_id,category,file_name,storage_path,mime_type,file_size,created_at').single();
    if (error) throw error;
    return data;
  } catch (error) {
    try { await supabase.storage.from(BUCKET).remove([path]); } catch {}
    throw error;
  }
}

async function removeStored(record) {
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([record.storage_path]);
  if (storageError) throw storageError;
  const { error } = await supabase.from('documents').delete().eq('id',record.id).eq('client_id',record.client_id);
  if (error) throw error;
}

async function listCategory(clientId, category) {
  const { data, error } = await supabase.from('documents')
    .select('id,client_id,category,file_name,storage_path,mime_type,file_size,created_at')
    .eq('client_id',clientId).eq('category',category).order('created_at',{ascending:false});
  if (error) throw error;
  return data || [];
}

function existingCardMarkup(label) {
  return `<div class="medicare-card-manager multi-file-manager">
    <div class="medicare-card-heading"><strong>${esc(label)}</strong><span data-multi-summary>No files saved</span></div>
    <div class="medicare-card-actions">
      <label class="btn secondary">Upload Files<input type="file" data-multi-files multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" hidden></label>
      <label class="btn secondary">Camera / Scan<input type="file" data-multi-camera accept="image/*" capture="environment" hidden></label>
    </div>
    <div class="multi-file-list" data-multi-list></div>
    <div class="medicare-card-status" data-multi-status role="status" aria-live="polite"></div>
  </div>`;
}

function takeoverExistingCardHost(host) {
  if (!(host instanceof HTMLElement) || host.dataset.mhMultiFilesReady === 'true') return;
  const dialog = host.closest('dialog.client-dialog');
  if (!dialog || dialog.dataset.newClientIntakeAssets === 'true') return;
  const clientId = dialog.dataset.clientId || '';
  const category = host.dataset.cardManager || '';
  if (!clientId || !category) return;
  const label = host.querySelector('.medicare-card-heading strong')?.textContent?.trim() || 'Card / File';
  host.dataset.mhMultiFilesReady = 'true';
  host.innerHTML = existingCardMarkup(label);
  const picker = host.querySelector('[data-multi-files]');
  const camera = host.querySelector('[data-multi-camera]');
  const list = host.querySelector('[data-multi-list]');
  const summary = host.querySelector('[data-multi-summary]');
  const status = host.querySelector('[data-multi-status]');
  let records = [];
  let busy = false;

  const setStatus = (text='', error=false) => { status.textContent=text; status.classList.toggle('error',error); };
  const render = () => {
    summary.textContent = records.length ? `${records.length} file${records.length===1?'':'s'} saved` : 'No files saved';
    list.innerHTML = records.length ? records.map(record => `<div class="multi-file-row" data-multi-id="${esc(record.id)}"><div><strong>${esc(record.file_name)}</strong><span>${esc(humanDate(record.created_at))}</span></div><div><button type="button" class="btn secondary" data-multi-view>View</button><button type="button" class="btn danger" data-multi-remove>Remove</button></div></div>`).join('') : '<div class="multi-file-empty">No files uploaded yet.</div>';
  };
  const load = async () => {
    try { records = await listCategory(clientId,category); render(); setStatus(`${records.length} file${records.length===1?'':'s'} stored securely.`); }
    catch (error) { setStatus(error?.message || 'Unable to load files.',true); }
  };
  const uploadMany = async files => {
    const selected = Array.from(files || []);
    if (!selected.length || busy) return;
    busy = true;
    try {
      let done = 0;
      for (const file of selected) {
        setStatus(`Uploading ${done+1} of ${selected.length}: ${file.name}`);
        await uploadStored(clientId,file,category);
        done++;
      }
      picker.value=''; camera.value='';
      records = await listCategory(clientId,category); render();
      setStatus(`${done} file${done===1?'':'s'} uploaded securely.`);
    } catch (error) { setStatus(error?.message || 'Upload failed.',true); }
    finally { busy=false; }
  };
  picker.onchange = () => uploadMany(picker.files);
  camera.onchange = () => uploadMany(camera.files);
  list.addEventListener('click', async event => {
    const row = event.target.closest?.('[data-multi-id]');
    if (!row) return;
    const record = records.find(item => item.id === row.dataset.multiId);
    if (!record) return;
    if (event.target.closest('[data-multi-view]')) {
      try { setStatus('Opening secure preview…'); await previewStored(record); setStatus('Preview opened inside the CRM.'); }
      catch (error) { setStatus(error?.message || 'Unable to preview this file.',true); }
    }
    if (event.target.closest('[data-multi-remove]')) {
      if (!confirm(`Remove ${record.file_name}?`)) return;
      try { setStatus('Removing file…'); await removeStored(record); records=records.filter(item=>item.id!==record.id); render(); setStatus('File removed.'); }
      catch (error) { setStatus(error?.message || 'Unable to remove this file.',true); }
    }
  });
  load();
}

function intakeInfo(host) {
  if (host.hasAttribute('data-new-medicare-card')) return { key:'medicare-card', category:'medicare_card', label:'Medicare Card' };
  if (host.hasAttribute('data-new-medicaid-card')) return { key:'medicaid-card', category:'medicaid_card', label:'Medicaid Card' };
  if (host.hasAttribute('data-new-health-plan-card')) return { key:'health-plan-card', category:'health_plan_card', label:'Health Plan Card' };
  if (host.hasAttribute('data-new-soa-upload')) return { key:'soa', category:'soa', label:'Scope of Appointment (SOA)' };
  return null;
}

function stateFor(dialog) {
  let state = intakeStates.get(dialog);
  if (!state) { state = { groups:new Map(), flushing:null }; intakeStates.set(dialog,state); }
  return state;
}

function syncIntakeMarker(dialog) {
  const form = dialog.querySelector('form.client-form');
  if (!form) return;
  let marker = form.querySelector('[data-multi-intake-marker]');
  if (!marker) {
    marker=document.createElement('input'); marker.type='hidden'; marker.name='_multi_intake_assets'; marker.dataset.multiIntakeMarker='true'; form.append(marker);
  }
  const state=stateFor(dialog);
  marker.value=[...state.groups.values()].flatMap(group=>group.files.map(item=>`${group.key}:${item.file.name}:${item.file.size}:${item.file.lastModified}`)).join('|');
  marker.dispatchEvent(new Event('input',{bubbles:true}));
}

function newIntakeMarkup(label) {
  return `<div class="medicare-card-manager multi-file-manager">
    <div class="medicare-card-heading"><strong>${esc(label)}</strong><span data-intake-multi-summary>No files added</span></div>
    <div class="medicare-card-actions"><label class="btn secondary">Upload Files<input type="file" data-intake-multi-files multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" hidden></label><label class="btn secondary">Camera / Scan<input type="file" data-intake-multi-camera accept="image/*" capture="environment" hidden></label></div>
    <div class="multi-file-list" data-intake-multi-list></div>
    <div class="medicare-card-status" data-intake-multi-status role="status" aria-live="polite"></div>
  </div>`;
}

function takeoverNewIntakeHost(host) {
  if (!(host instanceof HTMLElement) || host.dataset.mhMultiIntakeReady === 'true') return;
  const info = intakeInfo(host);
  if (!info) return;
  const dialog = host.closest('dialog.client-dialog');
  if (!dialog) return;
  host.dataset.mhMultiIntakeReady='true';
  host.innerHTML=newIntakeMarkup(info.label);
  const state=stateFor(dialog);
  const group={ ...info, host, files:[] };
  state.groups.set(info.key,group);
  const picker=host.querySelector('[data-intake-multi-files]');
  const camera=host.querySelector('[data-intake-multi-camera]');
  const list=host.querySelector('[data-intake-multi-list]');
  const summary=host.querySelector('[data-intake-multi-summary]');
  const status=host.querySelector('[data-intake-multi-status]');
  const setStatus=(text='',error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
  const render=()=>{
    summary.textContent=group.files.length?`${group.files.length} file${group.files.length===1?'':'s'} ready to save`:'No files added';
    list.innerHTML=group.files.length?group.files.map(item=>`<div class="multi-file-row" data-queued-id="${item.id}"><div><strong>${esc(item.file.name)}</strong><span>Ready to attach</span></div><div><button type="button" class="btn secondary" data-queued-view>View</button><button type="button" class="btn danger" data-queued-remove>Remove</button></div></div>`).join(''):'<div class="multi-file-empty">No files added yet.</div>';
  };
  const addFiles=files=>{
    const selected=Array.from(files||[]);
    const errors=[];
    for(const file of selected){
      const mime=mimeFor(file);
      if(!CARD_MIMES.has(mime)){errors.push(`${file.name}: use a PDF or image file.`);continue;}
      if(file.size>MAX_BYTES){errors.push(`${file.name}: files must be 25 MB or smaller.`);continue;}
      group.files.push({id:crypto.randomUUID(),file});
    }
    picker.value=''; camera.value=''; render(); syncIntakeMarker(dialog);
    setStatus(errors.length?errors.join(' '):`${group.files.length} file${group.files.length===1?'':'s'} ready. They will attach when you save the client.`,errors.length>0);
  };
  picker.onchange=()=>addFiles(picker.files);
  camera.onchange=()=>addFiles(camera.files);
  list.addEventListener('click',event=>{
    const row=event.target.closest?.('[data-queued-id]'); if(!row)return;
    const item=group.files.find(file=>file.id===row.dataset.queuedId); if(!item)return;
    if(event.target.closest('[data-queued-view]')){
      const url=URL.createObjectURL(item.file);
      openPreview({url,fileName:item.file.name,mimeType:mimeFor(item.file),revokeOnClose:true});
    }
    if(event.target.closest('[data-queued-remove]')){
      group.files=group.files.filter(file=>file.id!==item.id); render(); syncIntakeMarker(dialog); setStatus(`${item.file.name} removed from this intake.`);
    }
  });
  render(); syncIntakeMarker(dialog);
}

async function flushIntake(dialog,clientId){
  const state=stateFor(dialog); if(state.flushing)return state.flushing;
  state.flushing=(async()=>{
    const failures=[];
    for(const group of state.groups.values()){
      const remaining=[];
      for(let i=0;i<group.files.length;i++){
        const item=group.files[i];
        const status=group.host.querySelector('[data-intake-multi-status]');
        if(status)status.textContent=`Attaching ${i+1} of ${group.files.length}: ${item.file.name}`;
        try{await uploadStored(clientId,item.file,group.category,group.category==='soa'?'Uploaded during new client intake':'Added during new client intake');}
        catch(error){remaining.push(item);failures.push(`${item.file.name}: ${error?.message||'upload failed'}`);}
      }
      group.files=remaining;
      group.host.querySelector('[data-intake-multi-summary]').textContent=remaining.length?`${remaining.length} file${remaining.length===1?'':'s'} still need to upload`:'All files attached';
      group.host.querySelector('[data-intake-multi-list]').innerHTML=remaining.length?remaining.map(item=>`<div class="multi-file-row" data-queued-id="${item.id}"><div><strong>${esc(item.file.name)}</strong><span>Retry on next save</span></div></div>`).join(''):'<div class="multi-file-empty">All selected files are attached.</div>';
      const status=group.host.querySelector('[data-intake-multi-status]'); if(status){status.textContent=remaining.length?'Some files could not be attached. Save again to retry.':`${group.label} files attached securely.`;status.classList.toggle('error',remaining.length>0);}
    }
    dialog.dataset.clientId=clientId; syncIntakeMarker(dialog);
    if(failures.length)throw new Error(`Client saved, but ${failures.length} file${failures.length===1?'':'s'} need to be retried: ${failures.join(' ')}`);
  })().finally(()=>{state.flushing=null;});
  return state.flushing;
}

const baseSaveClient=mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient=async function saveClientWithMultipleIntakeFiles(record,...args){
  const saved=await baseSaveClient(record,...args); if(!saved?.id)return saved;
  const dialog=[...document.querySelectorAll('dialog.client-dialog')].reverse().find(item=>item.isConnected&&intakeStates.has(item)&&(!item.dataset.clientId||item.dataset.clientId===saved.id));
  if(dialog)await flushIntake(dialog,saved.id);
  return saved;
};

async function interceptExistingPreview(event){
  const documentButton=event.target.closest?.('[data-open-document]');
  const soaButton=event.target.closest?.('[data-view-soa]');
  const cardButton=event.target.closest?.('[data-card-open]');
  if(!documentButton&&!soaButton&&!cardButton)return;
  event.preventDefault(); event.stopPropagation();
  try{
    if(documentButton){
      const id=documentButton.closest('[data-document-id]')?.dataset.documentId; if(!id)return;
      const {data,error}=await supabase.from('documents').select('id,client_id,file_name,storage_path,mime_type').eq('id',id).single(); if(error)throw error; await previewStored(data); return;
    }
    const dialog=(soaButton||cardButton).closest('dialog.client-dialog'); const clientId=dialog?.dataset.clientId||''; if(!clientId)return;
    let query=supabase.from('documents').select('id,client_id,category,file_name,storage_path,mime_type,created_at').eq('client_id',clientId);
    if(soaButton)query=query.in('category',['soa','scope_of_appointment']);
    else {const category=cardButton.closest('[data-card-manager]')?.dataset.cardManager; if(!category)return; query=query.eq('category',category);}
    const {data,error}=await query.order('created_at',{ascending:false}).limit(1).maybeSingle(); if(error)throw error; if(!data)throw new Error('No saved file was found.'); await previewStored(data);
  }catch(error){alert(error?.message||'Unable to preview this file.');}
}
document.addEventListener('click',interceptExistingPreview,true);

function enhanceScope(scope){
  if(!(scope instanceof Element))return;
  const roots=[];
  if(scope.matches?.('[data-card-manager]'))roots.push(scope);
  scope.querySelectorAll?.('[data-card-manager]').forEach(node=>roots.push(node));
  roots.forEach(takeoverExistingCardHost);
  const intake=[];
  if(intakeInfo(scope))intake.push(scope);
  scope.querySelectorAll?.('[data-new-medicare-card],[data-new-medicaid-card],[data-new-health-plan-card],[data-new-soa-upload]').forEach(node=>intake.push(node));
  intake.forEach(takeoverNewIntakeHost);
}

const observer=new MutationObserver(mutations=>{
  const scopes=new Set();
  for(const mutation of mutations){
    for(const node of mutation.addedNodes)if(node instanceof Element)scopes.add(node);
  }
  scopes.forEach(scope=>queueMicrotask(()=>enhanceScope(scope)));
});
observer.observe(document.body,{childList:true,subtree:true});
document.querySelectorAll('dialog.client-dialog').forEach(enhanceScope);
