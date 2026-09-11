import { mhRepository, supabase } from './supabase-repository.js';

const BUCKET = 'mh-client-documents';
const PRODUCT_OPTIONS = [
  'Medicare Advantage (Part C) / Cost Plans',
  'Stand-alone Prescription Drug Plans (Part D)',
  'Medicare Supplement (Medigap)',
  'Dental / Vision / Hearing products',
  'Hospital Indemnity products',
  'Other Medicare-related health products'
];

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeName = value => String(value || 'document').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'document';
const localDate = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const humanDate = value => value ? new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString() : '';
const coverageYears = () => { const year = new Date().getFullYear(); return [year, year + 1]; };
const retentionUntil = signedAt => { const date = new Date(signedAt); date.setUTCFullYear(date.getUTCFullYear() + 10); return date.toISOString(); };

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
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
  return '';
}

async function clientContext(clientId) {
  const [{ data: client, error }, { data: { user } }] = await Promise.all([
    supabase.from('clients').select('id,first_name,last_name,phone,address1,address2,city,state,zip_code,assigned_agent_id').eq('id', clientId).single(),
    supabase.auth.getUser()
  ]);
  if (error) throw error;
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

function pointer(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return { x:(event.clientX-rect.left)*(canvas.width/rect.width), y:(event.clientY-rect.top)*(canvas.height/rect.height) };
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '', cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { ctx.fillText(line,x,cy); line=word; cy+=lineHeight; }
    else line = test;
  }
  if (line) ctx.fillText(line,x,cy);
  return cy + lineHeight;
}

async function buildSoaPng({ context, products, otherProduct, signatureCanvas, agentPhone, appointmentDate, coverageYear, signedAt }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1400;
  canvas.height = 2400;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the signed Scope of Appointment.');
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#0f172a'; ctx.font='bold 48px Arial'; ctx.fillText('M&H Insurance Group',90,110);
  ctx.font='bold 38px Arial'; ctx.fillText('Scope of Sales Appointment Confirmation',90,175);
  ctx.font='22px Arial'; ctx.fillStyle='#475569';
  ctx.fillText(`Appointment date: ${appointmentDate}`,90,225);
  ctx.fillText(`Coverage year: ${coverageYear}`,90,263);
  ctx.fillText(`SOA signed: ${signedAt.toLocaleString()}`,90,301);
  ctx.fillStyle='#0f172a'; ctx.font='22px Arial';
  let y=356;
  y=wrapText(ctx,'This Scope of Appointment documents the Medicare and health-related product types the beneficiary requested to discuss with the agent named below for the stated coverage year.',90,y,1210,32)+18;
  y=wrapText(ctx,'Signing this form does not obligate the beneficiary to enroll, does not affect current or future Medicare enrollment status, and does not automatically enroll the beneficiary in any plan.',90,y,1210,32)+28;
  ctx.font='bold 28px Arial'; ctx.fillText('Beneficiary',90,y); y+=44;
  ctx.font='24px Arial'; ctx.fillText(`Name: ${context.clientName}`,90,y); y+=38;
  ctx.fillText(`Phone: ${context.client.phone || 'Not provided'}`,90,y); y+=38;
  y=wrapText(ctx,`Address: ${context.address || 'Not provided'}`,90,y,1210,34)+20;
  ctx.font='bold 28px Arial'; ctx.fillText('Agent',90,y); y+=44;
  ctx.font='24px Arial'; ctx.fillText(`Name: ${context.agentName}`,90,y); y+=38;
  ctx.fillText(`Phone: ${agentPhone || 'Not provided'}`,90,y); y+=58;
  ctx.font='bold 28px Arial'; ctx.fillText('Products requested for discussion',90,y); y+=44;
  ctx.font='24px Arial';
  const selected=[...products]; if(otherProduct.trim()) selected.push(otherProduct.trim());
  selected.forEach(product=>{ctx.fillText(`• ${product}`,110,y);y+=36;});
  y+=26; ctx.font='bold 28px Arial'; ctx.fillText('Beneficiary acknowledgement',90,y); y+=44;
  ctx.font='24px Arial';
  y=wrapText(ctx,'By signing below, I confirm that I requested discussion of the product types listed above for the stated coverage year. I understand that signing does not obligate me to enroll, does not affect my current or future Medicare enrollment status, and does not automatically enroll me in any plan.',90,y,1210,36)+15;
  y=wrapText(ctx,'The agent may discuss only the product types agreed to on this Scope of Appointment. If I request discussion of a different product type or a different coverage year, an updated or new Scope of Appointment must be documented before that additional discussion.',90,y,1210,36)+30;
  ctx.font='bold 26px Arial'; ctx.fillText('Beneficiary signature',90,y); y+=24;
  ctx.strokeStyle='#cbd5e1'; ctx.strokeRect(90,y,1210,300);
  ctx.drawImage(signatureCanvas,110,y+20,1170,260); y+=345;
  ctx.font='22px Arial'; ctx.fillStyle='#475569'; ctx.fillText(`Signed electronically: ${signedAt.toLocaleString()}`,90,y); y+=40;
  ctx.font='18px Arial'; ctx.fillText('Generated and stored securely by M&H Insurance Group CRM. Compliance retention: 10 years from signature.',90,y);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create signed Scope of Appointment.')),'image/png'));
}

async function storeSignedSoa(clientId, file, metadata) {
  const path=`${clientId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path,file,{cacheControl:'3600',upsert:false,contentType:'image/png'});
  if (uploadError) throw uploadError;
  const { data:{user} } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('documents').insert({
    client_id:clientId,
    uploaded_by:user?.id || null,
    category:'soa',
    file_name:file.name,
    storage_path:path,
    mime_type:'image/png',
    file_size:file.size,
    document_date:localDate(metadata.signedAt),
    appointment_date:metadata.appointmentDate,
    coverage_year:metadata.coverageYear,
    signed_at:metadata.signedAt.toISOString(),
    retention_until:retentionUntil(metadata.signedAt),
    compliance_locked:true,
    notes:`${metadata.method}; Appointment ${metadata.appointmentDate}; Coverage Year ${metadata.coverageYear}`
  }).select('id,client_id,file_name,storage_path,document_date,appointment_date,coverage_year,signed_at,retention_until,created_at').single();
  if (error) {
    try { await supabase.storage.from(BUCKET).remove([path]); } catch {}
    throw error;
  }
  return data;
}

async function latestSoa(clientId) {
  const { data, error } = await supabase.from('documents')
    .select('id,client_id,file_name,storage_path,document_date,appointment_date,coverage_year,signed_at,created_at')
    .eq('client_id',clientId).in('category',['soa','scope_of_appointment']).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function openStored(record) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(record.storage_path,90);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Unable to create a secure SOA link.');
  window.open(data.signedUrl,'_blank','noopener,noreferrer');
}

function clientIdFor(button) {
  return button.closest('dialog.client-dialog')?.dataset.clientId || '';
}

async function refreshSoaBox(button, clientId) {
  const group=button.closest('[data-soa-group]');
  if(!group) return;
  const summary=group.querySelector('[data-soa-summary]');
  const view=group.querySelector('[data-view-soa]');
  const record=await latestSoa(clientId);
  if(summary) summary.textContent=record ? `Signed ${humanDate(record.signed_at || record.document_date || record.created_at)} • ${record.file_name}` : 'No signed SOA saved';
  if(view) view.hidden=!record;
}

function yearOptions() {
  return coverageYears().map((year,i)=>`<option value="${year}"${i===0?' selected':''}>${year}</option>`).join('');
}

function acknowledgementMarkup() {
  return `<div class="mh-soa-acknowledgement">
    <strong>Beneficiary acknowledgement</strong>
    <p>By signing below, I confirm that I requested discussion of the selected product types for the stated coverage year. I understand that signing does not obligate me to enroll, does not affect my current or future Medicare enrollment status, and does not automatically enroll me in any plan.</p>
    <p>The agent may discuss only the product types agreed to on this Scope of Appointment. If I request discussion of a different product type or a different coverage year, an updated or new Scope of Appointment must be documented before that discussion.</p>
    <label><input type="checkbox" data-soa-ack> I have reviewed and agree to the acknowledgement above.</label>
  </div>`;
}

async function openCompliantSignOnScreen(button) {
  const clientId=clientIdFor(button); if(!clientId) throw new Error('Save this client before creating an SOA.');
  const context=await clientContext(clientId);
  const modal=document.createElement('dialog'); modal.className='mh-soa-dialog';
  modal.innerHTML=`<div class="mh-soa-frame">
    <header><div><h2>Scope of Appointment</h2><p>Confirm the appointment and coverage year, review the scope, then have the beneficiary sign.</p></div><button type="button" class="modal-close" data-close>×</button></header>
    <div class="mh-soa-body">
      <div class="mh-soa-client"><strong>${esc(context.clientName)}</strong><span>${esc(context.client.phone||'No phone on file')}</span><span>${esc(context.address||'No address on file')}</span></div>
      <div class="mh-soa-compliance-grid">
        <label class="field"><span>Appointment Date</span><input type="date" data-appointment value="${localDate()}"></label>
        <label class="field"><span>Coverage Year</span><select data-year>${yearOptions()}</select></label>
      </div>
      <label class="field"><span>Agent Phone</span><input data-agent-phone value="${esc(context.agentPhone)}" placeholder="Agent phone number"></label>
      <fieldset class="mh-soa-products"><legend>Products requested for discussion</legend>${PRODUCT_OPTIONS.map(p=>`<label><input type="checkbox" data-product value="${esc(p)}" checked> ${esc(p)}</label>`).join('')}<label class="span-all"><span>Other product</span><input data-other placeholder="Optional"></label></fieldset>
      ${acknowledgementMarkup()}
      <div class="mh-signature-wrap"><strong>Beneficiary Signature</strong><canvas data-signature width="1000" height="260"></canvas><button type="button" class="btn secondary" data-clear>Clear Signature</button></div>
      <div class="medicare-card-status" data-status role="status"></div>
    </div>
    <footer><button type="button" class="btn secondary" data-cancel>Cancel</button><button type="button" class="btn primary" data-save>Save Signed SOA</button></footer>
  </div>`;
  document.body.append(modal); modal.showModal();
  const canvas=modal.querySelector('[data-signature]'), ctx=canvas.getContext('2d');
  let drawing=false,last=null,hasInk=false;
  canvas.onpointerdown=e=>{e.preventDefault();drawing=true;canvas.setPointerCapture(e.pointerId);last=pointer(canvas,e)};
  canvas.onpointermove=e=>{if(!drawing||!last)return;e.preventDefault();const next=pointer(canvas,e);ctx.strokeStyle='#111827';ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(next.x,next.y);ctx.stroke();last=next;hasInk=true};
  const end=e=>{e?.preventDefault();drawing=false;last=null}; canvas.onpointerup=end;canvas.onpointercancel=end;canvas.onpointerleave=end;
  modal.querySelector('[data-clear]').onclick=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);hasInk=false};
  const close=()=>{modal.close();modal.remove()}; modal.querySelector('[data-close]').onclick=close;modal.querySelector('[data-cancel]').onclick=close;modal.addEventListener('cancel',e=>{e.preventDefault();close()});
  modal.querySelector('[data-save]').onclick=async e=>{
    const status=modal.querySelector('[data-status]'), save=e.currentTarget;
    try{
      const appointmentDate=modal.querySelector('[data-appointment]').value;
      const coverageYear=Number(modal.querySelector('[data-year]').value);
      const products=Array.from(modal.querySelectorAll('[data-product]:checked')).map(input=>input.value);
      const otherProduct=modal.querySelector('[data-other]').value.trim();
      if(!appointmentDate) throw new Error('Enter the appointment date.');
      if(!coverageYear) throw new Error('Select the coverage year.');
      if(!products.length&&!otherProduct) throw new Error('Select at least one product type.');
      if(!modal.querySelector('[data-soa-ack]').checked) throw new Error('The beneficiary must confirm the acknowledgement before signing.');
      if(!hasInk) throw new Error('The beneficiary must sign before saving the SOA.');
      save.disabled=true;status.textContent='Creating and securely saving the signed SOA…';
      const signedAt=new Date();
      const blob=await buildSoaPng({context,products,otherProduct,signatureCanvas:canvas,agentPhone:modal.querySelector('[data-agent-phone]').value.trim(),appointmentDate,coverageYear,signedAt});
      const file=new File([blob],`Scope_of_Appointment_${safeName(context.clientName)}_${localDate(signedAt)}.png`,{type:'image/png'});
      await storeSignedSoa(clientId,file,{appointmentDate,coverageYear,signedAt,method:'Signed on screen'});
      status.textContent='Signed SOA saved and locked for the compliance retention period.';
      await refreshSoaBox(button,clientId);
      setTimeout(close,650);
    }catch(error){status.textContent=error?.message||'Unable to save SOA.';status.classList.add('error');save.disabled=false}
  };
}

async function openCompliantTextSoa(button) {
  const clientId=clientIdFor(button); if(!clientId) throw new Error('Save this client before creating an SOA.');
  const context=await clientContext(clientId);
  const modal=document.createElement('dialog'); modal.className='mh-soa-dialog';
  modal.innerHTML=`<div class="mh-soa-frame compact">
    <header><div><h2>Text Scope of Appointment</h2><p>Create a secure signing link with the correct appointment date and coverage year.</p></div><button type="button" class="modal-close" data-close>×</button></header>
    <div class="mh-soa-body">
      <label class="field"><span>Client Mobile Number</span><input data-phone value="${esc(context.client.phone||'')}" placeholder="(###) ###-####"></label>
      <div class="mh-soa-compliance-grid">
        <label class="field"><span>Appointment Date</span><input type="date" data-appointment value="${localDate()}"></label>
        <label class="field"><span>Coverage Year</span><select data-year>${yearOptions()}</select></label>
      </div>
      <fieldset class="mh-soa-products"><legend>Products requested for discussion</legend>${PRODUCT_OPTIONS.map(p=>`<label><input type="checkbox" data-product value="${esc(p)}" checked> ${esc(p)}</label>`).join('')}<label class="span-all"><span>Other product</span><input data-other placeholder="Optional"></label></fieldset>
      <div class="medicare-card-status" data-status role="status"></div>
    </div>
    <footer><button type="button" class="btn secondary" data-cancel>Cancel</button><button type="button" class="btn primary" data-send>TEXT SOA TO CLIENT</button></footer>
  </div>`;
  document.body.append(modal); modal.showModal();
  const close=()=>{modal.close();modal.remove()};modal.querySelector('[data-close]').onclick=close;modal.querySelector('[data-cancel]').onclick=close;modal.addEventListener('cancel',e=>{e.preventDefault();close()});
  modal.querySelector('[data-send]').onclick=async e=>{
    const status=modal.querySelector('[data-status]'),send=e.currentTarget;
    try{
      const phone=smsPhone(modal.querySelector('[data-phone]').value);
      const appointmentDate=modal.querySelector('[data-appointment]').value;
      const coverageYear=Number(modal.querySelector('[data-year]').value);
      const products=Array.from(modal.querySelectorAll('[data-product]:checked')).map(input=>input.value);
      const otherProduct=modal.querySelector('[data-other]').value.trim();
      if(!phone) throw new Error('Enter a valid U.S. mobile number.');
      if(!appointmentDate) throw new Error('Enter the appointment date.');
      if(!coverageYear) throw new Error('Select the coverage year.');
      if(!products.length&&!otherProduct) throw new Error('Select at least one product type.');
      send.disabled=true;status.textContent='Creating secure signing link…';
      const token=randomToken(), tokenHash=await sha256Hex(token);
      const { error }=await supabase.from('soa_signature_requests').insert({
        client_id:clientId,requested_by:context.user?.id,token_hash:tokenHash,phone,
        request_payload:{beneficiary_name:context.clientName,beneficiary_phone:context.client.phone||phone,beneficiary_address:context.address,agent_name:context.agentName,agent_phone:context.agentPhone,appointment_date:appointmentDate,coverage_year:coverageYear,products,other_product:otherProduct}
      });
      if(error) throw error;
      const signUrl=`https://mh.mayerig.com/soa-sign.html?token=${encodeURIComponent(token)}`;
      const message=`M&H Insurance Group: ${context.clientName}, please review and sign your Scope of Appointment for coverage year ${coverageYear}: ${signUrl}`;
      try{await navigator.clipboard?.writeText(signUrl)}catch{}
      const separator=/iPhone|iPad|iPod/i.test(navigator.userAgent)?'&':'?';
      const smsUrl=`sms:${encodeURIComponent(phone)}${separator}body=${encodeURIComponent(message)}`;
      status.innerHTML=`Secure signing link created for the ${coverageYear} coverage year. <a href="${esc(smsUrl)}">Open text message</a>`;
      const link=document.createElement('a');link.href=smsUrl;link.style.display='none';document.body.append(link);link.click();link.remove();
      send.disabled=false;
    }catch(error){status.textContent=error?.message||'Unable to create SOA text.';status.classList.add('error');send.disabled=false}
  };
}

document.addEventListener('click',event=>{
  const sign=event.target.closest?.('[data-sign-soa]');
  const text=event.target.closest?.('[data-text-soa]');
  const view=event.target.closest?.('[data-view-soa]');
  const button=sign||text||view;
  if(!button) return;
  const dialog=button.closest('dialog.client-dialog');
  if(!dialog) return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  const clientId=clientIdFor(button);
  if(sign) openCompliantSignOnScreen(button).catch(error=>alert(error?.message||'Unable to open SOA signer.'));
  else if(text) openCompliantTextSoa(button).catch(error=>alert(error?.message||'Unable to create SOA text.'));
  else if(view) latestSoa(clientId).then(record=>record?openStored(record):null).catch(error=>alert(error?.message||'Unable to open SOA.'));
},true);
