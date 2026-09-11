import { mhRepository, supabase } from './supabase-repository.js';

const BUCKET = 'mh-client-documents';
const CATEGORY = 'medication_document';
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set([
  'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'
]);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeName = value => String(value || 'medication-file').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120) || 'medication-file';
const mimeFor = file => file?.type || ({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',txt:'text/plain'})[String(file?.name||'').toLowerCase().split('.').pop()] || '';
const humanSize = bytes => { const n=Number(bytes||0); if(!n)return '—'; if(n<1024)return `${n} B`; if(n<1024**2)return `${(n/1024).toFixed(1)} KB`; return `${(n/(1024**2)).toFixed(1)} MB`; };

async function listFiles(clientId){
  const {data,error}=await supabase.from('documents').select('id,client_id,category,file_name,storage_path,mime_type,file_size,created_at').eq('client_id',clientId).eq('category',CATEGORY).order('created_at',{ascending:false});
  if(error)throw error;
  return data||[];
}
async function uploadOne(clientId,file){
  const mime=mimeFor(file);
  if(!ALLOWED.has(mime))throw new Error(`${file.name}: this file type is not allowed.`);
  if(file.size>MAX_BYTES)throw new Error(`${file.name}: files must be 25 MB or smaller.`);
  const path=`${clientId}/medications/${crypto.randomUUID()}-${safeName(file.name)}`;
  const {error:uploadError}=await supabase.storage.from(BUCKET).upload(path,file,{cacheControl:'3600',upsert:false,contentType:mime});
  if(uploadError)throw uploadError;
  try{
    const {data:{user}}=await supabase.auth.getUser();
    const {error}=await supabase.from('documents').insert({client_id:clientId,uploaded_by:user?.id||null,category:CATEGORY,file_name:file.name,storage_path:path,mime_type:mime,file_size:file.size,notes:'Medication / pharmacy file'});
    if(error)throw error;
  }catch(error){try{await supabase.storage.from(BUCKET).remove([path]);}catch{}throw error;}
}
async function removeOne(record){
  const {error:storageError}=await supabase.storage.from(BUCKET).remove([record.storage_path]);
  if(storageError)throw storageError;
  const {error}=await supabase.from('documents').delete().eq('id',record.id).eq('client_id',record.client_id);
  if(error)throw error;
}
async function openOne(record){
  const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(record.storage_path,300);
  if(error)throw error;
  if(!data?.signedUrl)throw new Error('Unable to create a secure file link.');
  window.open(data.signedUrl,'_blank','noopener,noreferrer');
}

async function activate(form,clientId){
  const host=form?.querySelector('[data-pharmacy-panel]');
  if(!host||host.dataset.pharmacyPostsaveReady==='true')return;
  host.dataset.pharmacyPostsaveReady='true';
  const picker=host.querySelector('[data-pharmacy-files]');
  const camera=host.querySelector('[data-pharmacy-camera]');
  const oldList=host.querySelector('[data-pharmacy-file-list]');
  const status=host.querySelector('[data-pharmacy-status]');
  if(!picker||!camera||!oldList||!status)return;
  const list=oldList.cloneNode(false);
  oldList.replaceWith(list);
  let records=[];
  let busy=false;
  const setStatus=(text='',error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
  const render=()=>{list.innerHTML=records.length?records.map(record=>`<article class="pharmacy-file-row" data-postsave-pharmacy-id="${esc(record.id)}"><div><strong>${esc(record.file_name)}</strong><span>${esc(humanSize(record.file_size))} • ${esc(new Date(record.created_at).toLocaleDateString())}</span></div><div><button type="button" class="btn secondary" data-postsave-pharmacy-view>View</button><button type="button" class="btn danger" data-postsave-pharmacy-remove>Remove</button></div></article>`).join(''):'<div class="pharmacy-file-empty">No medication or pharmacy files uploaded yet.</div>';};
  const refresh=async()=>{records=await listFiles(clientId);render();};
  const uploadMany=async files=>{
    const selected=Array.from(files||[]);
    picker.value='';camera.value='';
    if(!selected.length||busy)return;
    busy=true;
    try{
      let done=0;
      for(const file of selected){setStatus(`Uploading ${done+1} of ${selected.length}: ${file.name}`);await uploadOne(clientId,file);done++;}
      await refresh();
      setStatus(`${done} file${done===1?'':'s'} uploaded securely.`);
    }catch(error){setStatus(error?.message||'File upload failed.',true);}finally{busy=false;}
  };
  picker.onchange=()=>uploadMany(picker.files);
  camera.onchange=()=>uploadMany(camera.files);
  list.addEventListener('click',async event=>{
    const row=event.target.closest?.('[data-postsave-pharmacy-id]');
    if(!row)return;
    const record=records.find(item=>item.id===row.dataset.postsavePharmacyId);
    if(!record)return;
    if(event.target.closest('[data-postsave-pharmacy-view]')){
      try{await openOne(record);setStatus('Preview opened inside the CRM.');}catch(error){setStatus(error?.message||'Unable to preview this file.',true);}
    }
    if(event.target.closest('[data-postsave-pharmacy-remove]')){
      if(!confirm(`Remove ${record.file_name}?`))return;
      try{setStatus('Removing file…');await removeOne(record);await refresh();setStatus('File removed.');}catch(error){setStatus(error?.message||'Unable to remove this file.',true);}
    }
  });
  try{await refresh();setStatus(`${records.length} medication/pharmacy file${records.length===1?'':'s'} stored.`);}catch(error){setStatus(error?.message||'Unable to load medication files.',true);}
}

const baseSave=mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient=async function saveClientWithPostsavePharmacy(record,...args){
  const form=[...document.querySelectorAll('dialog.client-dialog form.client-form')].reverse().find(item=>item.isConnected)||null;
  const wasNew=!String(record?.id||'').trim()&&!String(form?.elements.namedItem('id')?.value||'').trim();
  const saved=await baseSave(record,...args);
  if(saved?.id&&wasNew&&form)await activate(form,saved.id);
  return saved;
};
