import { mhRepository, supabase } from './supabase-repository.js';

const BUCKET = 'mh-client-documents';
const MAX_BYTES = 25 * 1024 * 1024;
const EXCLUDED_CATEGORIES = new Set([
  'medicare_card','medicaid_card','health_plan_card','soa','scope_of_appointment','medicare_photo','card_information',
  'life_policy_document','medication_document'
]);
const ALLOWED = new Set([
  'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'
]);
const states = new WeakMap();

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeName = value => String(value || 'document').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120) || 'document';
const mimeFor = file => file?.type || ({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',txt:'text/plain'})[String(file?.name||'').toLowerCase().split('.').pop()] || '';
const humanSize = bytes => { const n=Number(bytes||0); if(!n)return '—'; if(n<1024)return `${n} B`; if(n<1024**2)return `${(n/1024).toFixed(1)} KB`; return `${(n/(1024**2)).toFixed(1)} MB`; };

function stateFor(dialog){let state=states.get(dialog);if(!state){state={clientId:dialog.dataset.clientId||'',queued:[],records:[],busy:false,loaded:false};states.set(dialog,state);}return state;}

async function listDocuments(clientId){
  const {data,error}=await supabase.from('documents')
    .select('id,client_id,category,file_name,storage_path,mime_type,file_size,created_at')
    .eq('client_id',clientId).order('created_at',{ascending:false});
  if(error)throw error;
  return (data||[]).filter(row=>!EXCLUDED_CATEGORIES.has(String(row.category||'').toLowerCase()));
}

async function uploadOne(clientId,file,category){
  const mime=mimeFor(file);
  if(!ALLOWED.has(mime))throw new Error(`${file.name}: this file type is not allowed.`);
  if(file.size>MAX_BYTES)throw new Error(`${file.name}: files must be 25 MB or smaller.`);
  const path=`${clientId}/extras/${crypto.randomUUID()}-${safeName(file.name)}`;
  const {error:uploadError}=await supabase.storage.from(BUCKET).upload(path,file,{cacheControl:'3600',upsert:false,contentType:mime});
  if(uploadError)throw uploadError;
  try{
    const {data:{user}}=await supabase.auth.getUser();
    const {data,error}=await supabase.from('documents').insert({
      client_id:clientId,uploaded_by:user?.id||null,category:category||'extra_document',file_name:file.name,
      storage_path:path,mime_type:mime,file_size:file.size,notes:'Notes / Extras document'
    }).select('id,client_id,category,file_name,storage_path,mime_type,file_size,created_at').single();
    if(error)throw error;
    return data;
  }catch(error){try{await supabase.storage.from(BUCKET).remove([path]);}catch{}throw error;}
}

async function removeOne(record){
  const {error:storageError}=await supabase.storage.from(BUCKET).remove([record.storage_path]);
  if(storageError)throw storageError;
  const {error}=await supabase.from('documents').delete().eq('id',record.id).eq('client_id',record.client_id);
  if(error)throw error;
}

async function signedUrl(record){const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(record.storage_path,300);if(error)throw error;if(!data?.signedUrl)throw new Error('Unable to create a secure document link.');return data.signedUrl;}
async function downloadFile(url,fileName){const response=await fetch(url);if(!response.ok)throw new Error('Unable to download this document.');const blob=await response.blob();const objectUrl=URL.createObjectURL(blob);const link=document.createElement('a');link.href=objectUrl;link.download=fileName||'document';link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}
function preview(url,record,revoke=false){
  const mime=String(record.mime_type||'');const image=mime.startsWith('image/');const inline=image||mime==='application/pdf'||mime.startsWith('text/');
  const modal=document.createElement('dialog');modal.className='mh-file-preview-dialog';
  modal.innerHTML=`<div class="mh-file-preview-frame"><header class="mh-file-preview-head"><div><h2>${esc(record.file_name||'Document')}</h2><p>Notes / Extras • secure in-site preview</p></div><div class="mh-file-preview-actions"><button type="button" class="btn secondary" data-extras-download>Download</button><button type="button" class="modal-close" data-extras-close aria-label="Close preview">×</button></div></header><div class="mh-file-preview-body">${image?`<img src="${esc(url)}" alt="${esc(record.file_name||'Document')}">`:inline?`<iframe src="${esc(url)}" title="${esc(record.file_name||'Document')}"></iframe>`:`<div class="mh-file-preview-unavailable"><strong>Preview is not available for this file type.</strong><span>You can download the file without leaving the CRM.</span></div>`}</div></div>`;
  document.body.append(modal);const close=()=>{if(!modal.isConnected)return;modal.close();modal.remove();if(revoke)URL.revokeObjectURL(url);};
  modal.querySelector('[data-extras-close]').onclick=close;modal.querySelector('[data-extras-download]').onclick=async e=>{e.currentTarget.disabled=true;try{await downloadFile(url,record.file_name);}catch(error){alert(error?.message||'Unable to download this document.');}finally{e.currentTarget.disabled=false;}};modal.addEventListener('cancel',e=>{e.preventDefault();close();});modal.addEventListener('click',e=>{if(e.target===modal)close();});modal.showModal();
}

function markup(){return `<section class="client-documents-panel notes-extras-documents" data-notes-extras-documents>
  <div class="document-manager-head"><div><h3>Documents / Extras</h3><p>Upload multiple general client documents, photos, forms, IDs, or other supporting files here.</p></div></div>
  <div class="document-upload-card">
    <label class="document-category"><span>Document Type</span><select data-extras-category><option value="extra_document">Other / Extra</option><option value="application">Application</option><option value="insurance_policy">Insurance Policy</option><option value="id">Identification</option></select></label>
    <label class="document-file-picker"><span>Choose Documents</span><input type="file" data-extras-files multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.txt"></label>
    <button type="button" class="btn primary" data-extras-upload>Upload Securely</button>
    <label class="btn secondary document-camera">Camera / Scan<input type="file" data-extras-camera accept="image/*" capture="environment" hidden></label>
  </div>
  <div class="document-status" data-extras-status role="status" aria-live="polite"></div>
  <div class="document-list" data-extras-list></div>
</section>`;}

function bind(dialog){
  if(!(dialog instanceof HTMLDialogElement)||!dialog.classList.contains('client-dialog'))return;
  const panel=dialog.querySelector('[data-panel="notes"]');if(!panel||panel.querySelector('[data-notes-extras-documents]'))return;
  panel.insertAdjacentHTML('beforeend',markup());
  const host=panel.querySelector('[data-notes-extras-documents]'),files=host.querySelector('[data-extras-files]'),camera=host.querySelector('[data-extras-camera]'),category=host.querySelector('[data-extras-category]'),upload=host.querySelector('[data-extras-upload]'),status=host.querySelector('[data-extras-status]'),list=host.querySelector('[data-extras-list]');
  const state=stateFor(dialog);state.clientId=dialog.dataset.clientId||state.clientId||'';
  const setStatus=(text='',error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
  const render=()=>{
    const stored=state.records.map(record=>`<article class="document-row" data-extra-id="${esc(record.id)}"><div class="document-row-main"><strong>${esc(record.file_name)}</strong><span>${esc(String(record.category||'extra_document').replaceAll('_',' '))} • ${esc(humanSize(record.file_size))} • ${esc(new Date(record.created_at).toLocaleDateString())}</span></div><div class="document-row-actions"><button type="button" class="btn secondary" data-extra-view>View</button><button type="button" class="btn danger" data-extra-remove>Delete</button></div></article>`).join('');
    const queued=state.queued.map(item=>`<article class="document-row queued" data-extra-queued="${item.id}"><div class="document-row-main"><strong>${esc(item.file.name)}</strong><span>${esc(humanSize(item.file.size))} • ready to attach after Save Client</span></div><div class="document-row-actions"><button type="button" class="btn secondary" data-extra-queued-view>View</button><button type="button" class="btn danger" data-extra-queued-remove>Remove</button></div></article>`).join('');
    list.innerHTML=stored+queued||'<div class="document-empty"><strong>No extra documents uploaded yet.</strong><span>You can add one file or several at a time.</span></div>';
  };
  const validate=selected=>{const good=[],errors=[];for(const file of Array.from(selected||[])){const mime=mimeFor(file);if(!ALLOWED.has(mime))errors.push(`${file.name}: file type not allowed.`);else if(file.size>MAX_BYTES)errors.push(`${file.name}: over 25 MB.`);else good.push(file);}return{good,errors};};
  const choose=async selected=>{const{good,errors}=validate(selected);files.value='';camera.value='';if(!good.length){if(errors.length)setStatus(errors.join(' '),true);return;}state.clientId=dialog.dataset.clientId||state.clientId||'';if(!state.clientId){good.forEach(file=>state.queued.push({id:crypto.randomUUID(),file,category:category.value}));render();setStatus(`${good.length} document${good.length===1?'':'s'} ready. They will attach when you save the client.${errors.length?` ${errors.join(' ')}`:''}`,errors.length>0);const form=dialog.querySelector('form.client-form');form?.dispatchEvent(new Event('input',{bubbles:true}));return;}if(state.busy)return;state.busy=true;upload.disabled=true;try{let done=0;for(const file of good){setStatus(`Uploading ${done+1} of ${good.length}: ${file.name}`);await uploadOne(state.clientId,file,category.value);done++;}state.records=await listDocuments(state.clientId);state.loaded=true;render();setStatus(`${done} document${done===1?'':'s'} uploaded securely.${errors.length?` ${errors.join(' ')}`:''}`,errors.length>0);}catch(error){setStatus(error?.message||'Document upload failed.',true);}finally{state.busy=false;upload.disabled=false;}};
  upload.onclick=()=>choose(files.files);camera.onchange=()=>choose(camera.files);
  list.addEventListener('click',async event=>{const stored=event.target.closest?.('[data-extra-id]');if(stored){const record=state.records.find(x=>x.id===stored.dataset.extraId);if(!record)return;if(event.target.closest('[data-extra-view]')){try{preview(await signedUrl(record),record);}catch(error){setStatus(error?.message||'Unable to preview this document.',true);}}if(event.target.closest('[data-extra-remove]')){if(!confirm(`Delete ${record.file_name}? This cannot be undone.`))return;try{await removeOne(record);state.records=state.records.filter(x=>x.id!==record.id);render();setStatus('Document deleted.');}catch(error){setStatus(error?.message||'Unable to delete this document.',true);}}return;}const queued=event.target.closest?.('[data-extra-queued]');if(!queued)return;const item=state.queued.find(x=>x.id===queued.dataset.extraQueued);if(!item)return;if(event.target.closest('[data-extra-queued-view]')){const url=URL.createObjectURL(item.file);preview(url,{file_name:item.file.name,mime_type:mimeFor(item.file)},true);}if(event.target.closest('[data-extra-queued-remove]')){state.queued=state.queued.filter(x=>x.id!==item.id);render();dialog.querySelector('form.client-form')?.dispatchEvent(new Event('input',{bubbles:true}));setStatus(`${item.file.name} removed from pending documents.`);}});
  const load=async()=>{state.clientId=dialog.dataset.clientId||state.clientId||'';if(!state.clientId||state.loaded||state.busy)return;state.busy=true;setStatus('Loading secure documents…');try{state.records=await listDocuments(state.clientId);state.loaded=true;render();setStatus(`${state.records.length} extra document${state.records.length===1?'':'s'} stored.`);}catch(error){setStatus(error?.message||'Unable to load documents.',true);}finally{state.busy=false;}};
  dialog.querySelector('[data-tab="notes"]')?.addEventListener('click',load);render();if(state.clientId)load();else setStatus('You can select documents now; they will attach when the client is first saved.');
}

async function flushQueued(dialog,clientId){const state=states.get(dialog);if(!state?.queued.length)return;const remaining=[],failures=[];for(const item of state.queued){try{await uploadOne(clientId,item.file,item.category);}catch(error){remaining.push(item);failures.push(`${item.file.name}: ${error?.message||'upload failed'}`);}}state.queued=remaining;state.clientId=clientId;dialog.dataset.clientId=clientId;state.records=await listDocuments(clientId).catch(()=>state.records);state.loaded=true;if(failures.length)throw new Error(`Client saved, but some Notes / Extras documents need to be retried: ${failures.join(' ')}`);}

const baseSave=mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient=async function saveClientWithNotesExtras(record,...args){const dialog=[...document.querySelectorAll('dialog.client-dialog')].reverse().find(d=>d.isConnected&&states.has(d));const saved=await baseSave(record,...args);if(saved?.id&&dialog){await flushQueued(dialog,saved.id);const host=dialog.querySelector('[data-notes-extras-documents]');if(host){host.remove();bind(dialog);}}return saved;};

const observer=new MutationObserver(mutations=>{for(const mutation of mutations){for(const node of mutation.addedNodes){if(!(node instanceof Element))continue;if(node.matches?.('dialog.client-dialog'))queueMicrotask(()=>bind(node));node.querySelectorAll?.('dialog.client-dialog').forEach(dialog=>queueMicrotask(()=>bind(dialog)));const parent=node.closest?.('dialog.client-dialog');if(parent)queueMicrotask(()=>bind(parent));}}});
observer.observe(document.body,{childList:true,subtree:true});document.querySelectorAll('dialog.client-dialog').forEach(bind);
