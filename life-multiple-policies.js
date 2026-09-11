import { Dialogs } from './dialogs.js';
import { esc, dateText, wireDates } from './core.js';
import { mhRepository, supabase } from './supabase-repository.js';

const LIFE_CARRIERS = ['American Amicable','Mutual of Omaha','Physicians Mutual','CiCa/Citizen','CoreBridge','Gerber','TransAmerica','Aflac'];
const PRODUCTS = ['Term', 'Whole Life', 'Final Expense', 'Universal Life', 'Indexed Universal Life'];
const FREQUENCIES = ['Monthly', 'Quarterly', 'Semiannual', 'Annual'];
const policyCache = new Map();
let pendingClientId = null;
const clean = value => value === '' || value === undefined || value === null ? null : value;
const money = value => value === '' || value === undefined || value === null ? null : Number(value);

function optionList(values, current = '') {
  const list = [...values];
  if (current && !list.includes(current)) list.unshift(current);
  return `<option value="">Select…</option>${list.map(value => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(value)}${!values.includes(value) ? ' (Existing)' : ''}</option>`).join('')}`;
}
function policyFromRow(row = {}) {
  return { id:row.id||'', carrier:row.carrier||'', product:row.product||row.policy_type||'', policy_number:row.policy_number||'', face_amount:row.face_amount??'', premium:row.premium??'', premium_mode:row.premium_mode||'', effective_date:row.effective_date||'', expiration_date:row.expiration_date||'', beneficiary_name:row.beneficiary_name||row.beneficiary_notes||'', beneficiary_relationship:row.beneficiary_relationship||'', notes:row.notes||'' };
}
function policyMarkup(policy, index, { open = false, removable = false } = {}) {
  const prefix = `life_policy_${index}_`, title = policy.carrier || policy.product || `Life Policy ${index + 1}`, subtitle = policy.policy_number ? `Policy ${policy.policy_number}` : 'Click to view policy information';
  return `<details class="life-policy-card" data-life-policy-card data-policy-index="${index}"${open ? ' open' : ''}><summary><span class="life-policy-summary-text"><strong data-policy-title>${esc(title)}</strong><small data-policy-subtitle>${esc(subtitle)}</small></span><span class="life-policy-chevron" aria-hidden="true">⌄</span></summary><div class="life-policy-body form-grid">
      <input type="hidden" name="${prefix}id" value="${esc(policy.id)}">
      <label class="field"><span>Carrier</span><select name="${prefix}carrier">${optionList(LIFE_CARRIERS, policy.carrier)}</select></label>
      <label class="field"><span>Product</span><select name="${prefix}product">${optionList(PRODUCTS, policy.product)}</select></label>
      <label class="field"><span>Policy Number</span><input name="${prefix}policy_number" value="${esc(policy.policy_number)}" autocomplete="off"></label>
      <label class="field"><span>Face Amount</span><input name="${prefix}face_amount" type="number" min="0" step="0.01" value="${esc(policy.face_amount)}"></label>
      <label class="field"><span>Premium</span><input name="${prefix}premium" type="number" min="0" step="0.01" value="${esc(policy.premium)}"></label>
      <label class="field"><span>Premium Frequency</span><select name="${prefix}frequency">${optionList(FREQUENCIES, policy.premium_mode)}</select></label>
      <label class="field"><span>Effective Date</span><input name="${prefix}effective_date" data-date inputmode="numeric" maxlength="10" placeholder="MM/DD/YYYY" value="${esc(dateText(policy.effective_date))}"></label>
      <label class="field"><span>Expiration Date</span><input name="${prefix}expiration_date" data-date inputmode="numeric" maxlength="10" placeholder="MM/DD/YYYY" value="${esc(dateText(policy.expiration_date))}"></label>
      <label class="field"><span>Beneficiary</span><input name="${prefix}beneficiary_name" value="${esc(policy.beneficiary_name)}" autocomplete="off"></label>
      <label class="field"><span>Beneficiary Relationship</span><input name="${prefix}beneficiary_relationship" value="${esc(policy.beneficiary_relationship)}" autocomplete="off"></label>
      <label class="field span-all"><span>Life Notes</span><textarea name="${prefix}notes" rows="5">${esc(policy.notes)}</textarea></label>
      ${removable ? '<div class="life-policy-actions span-all"><button type="button" class="btn danger life-policy-remove" data-remove-life-policy>Remove Policy</button></div>' : ''}
    </div></details>`;
}
function refreshSummary(card) {
  const carrier = card.querySelector('select[name$="_carrier"]')?.value || '', product = card.querySelector('select[name$="_product"]')?.value || '', policyNumber = card.querySelector('input[name$="_policy_number"]')?.value.trim() || '', index = Number(card.dataset.policyIndex || 0);
  card.querySelector('[data-policy-title]')?.replaceChildren(document.createTextNode(carrier || product || `Life Policy ${index + 1}`));
  card.querySelector('[data-policy-subtitle]')?.replaceChildren(document.createTextNode(policyNumber ? `Policy ${policyNumber}` : 'Click to view policy information'));
}
function bindLifePanel(form, panel) {
  if (panel.dataset.multiLifeBound === 'true') return;
  panel.dataset.multiLifeBound = 'true';
  panel.addEventListener('input', event => { const card=event.target.closest?.('[data-life-policy-card]'); if(card)refreshSummary(card); });
  panel.addEventListener('change', event => { const card=event.target.closest?.('[data-life-policy-card]'); if(card)refreshSummary(card); });
  panel.addEventListener('click', event => {
    const add=event.target.closest?.('[data-add-life-policy]');
    if(add){const list=panel.querySelector('[data-life-policy-list]');const index=Number(panel.dataset.nextPolicyIndex||list.children.length||0);panel.dataset.nextPolicyIndex=String(index+1);list.insertAdjacentHTML('beforeend',policyMarkup({},index,{open:true,removable:true}));const card=list.lastElementChild;wireDates(card);const productLife=form.elements.namedItem('product_life');if(productLife&&!productLife.checked)productLife.checked=true;form.dispatchEvent(new Event('input',{bubbles:true}));card.querySelector('select[name$="_carrier"]')?.focus();return;}
    const remove=event.target.closest?.('[data-remove-life-policy]');if(remove){const card=remove.closest('[data-life-policy-card]');if(!card)return;card.remove();form.dispatchEvent(new Event('input',{bubbles:true}));}
  });
}
function renderLifePanel(form, policies = []) {
  const panel=form.querySelector('[data-panel="life"]');if(!panel)return;const rows=policies.length?policies.map(policyFromRow):[{}];
  panel.innerHTML=`<div class="life-policy-toolbar"><div><h3>Life Insurance Policies</h3><p>Add each carrier or policy separately. Policies stay collapsed until you open them.</p></div><button type="button" class="btn primary" data-add-life-policy>+ Add Policy</button></div><div class="life-policy-list" data-life-policy-list>${rows.map((policy,index)=>policyMarkup(policy,index,{open:false,removable:index>0})).join('')}</div><p class="life-policy-status">${policies.length?`${policies.length} saved polic${policies.length===1?'y':'ies'}`:'No saved life policies yet.'}</p>`;
  panel.dataset.nextPolicyIndex=String(rows.length);bindLifePanel(form,panel);wireDates(panel);if(policies.length){const productLife=form.elements.namedItem('product_life');if(productLife)productLife.checked=true;}
}
function parsePolicies(record={}) {
  const indexes=new Set();Object.keys(record).forEach(key=>{const match=/^life_policy_(\d+)_/.exec(key);if(match)indexes.add(Number(match[1]));});
  return [...indexes].sort((a,b)=>a-b).map(index=>{const prefix=`life_policy_${index}_`;return{id:String(record[`${prefix}id`]||'').trim(),carrier:String(record[`${prefix}carrier`]||'').trim(),product:String(record[`${prefix}product`]||'').trim(),policy_number:String(record[`${prefix}policy_number`]||'').trim(),face_amount:record[`${prefix}face_amount`]??'',premium:record[`${prefix}premium`]??'',premium_mode:String(record[`${prefix}frequency`]||'').trim(),effective_date:String(record[`${prefix}effective_date`]||'').trim(),expiration_date:String(record[`${prefix}expiration_date`]||'').trim(),beneficiary_name:String(record[`${prefix}beneficiary_name`]||'').trim(),beneficiary_relationship:String(record[`${prefix}beneficiary_relationship`]||'').trim(),notes:String(record[`${prefix}notes`]||'').trim()};});
}
function isMeaningful(policy){return !!(policy.carrier||policy.product||policy.policy_number||policy.face_amount!==''||policy.premium!==''||policy.effective_date||policy.expiration_date||policy.beneficiary_name||policy.beneficiary_relationship||policy.notes);}
function withoutLegacyLife(record){const copy={...record};['life_carrier','life_product','life_policy_number','life_face_amount','life_premium','life_frequency','life_effective_date','life_expiration_date','beneficiary_name','beneficiary_relationship','life_notes','_life_id','_life_policies'].forEach(key=>delete copy[key]);return copy;}

async function savePolicies(clientId, policies) {
  const {data:current,error:currentError}=await supabase.from('life_policies').select('id').eq('client_id',clientId);if(currentError)throw currentError;
  const keepIds=[], savedRows=[];
  for(const policy of policies){
    if(!isMeaningful(policy))continue;
    const beneficiaryNotes=[policy.beneficiary_name,policy.beneficiary_relationship?`(${policy.beneficiary_relationship})`:''].filter(Boolean).join(' ');
    const payload={client_id:clientId,carrier:clean(policy.carrier),product:clean(policy.product),policy_type:clean(policy.product),policy_number:clean(policy.policy_number),face_amount:money(policy.face_amount),premium:money(policy.premium),premium_mode:clean(policy.premium_mode),effective_date:clean(policy.effective_date),expiration_date:clean(policy.expiration_date),beneficiary_name:clean(policy.beneficiary_name),beneficiary_relationship:clean(policy.beneficiary_relationship),beneficiary_notes:clean(beneficiaryNotes),notes:clean(policy.notes),status:'active'};
    if(policy.id){const{data,error}=await supabase.from('life_policies').update(payload).eq('id',policy.id).eq('client_id',clientId).select('*').maybeSingle();if(error)throw error;if(!data?.id)throw new Error('One life policy could not be updated. Please retry.');keepIds.push(data.id);savedRows.push(data);}else{const{data,error}=await supabase.from('life_policies').insert(payload).select('*').single();if(error)throw error;keepIds.push(data.id);savedRows.push(data);}
  }
  const removed=(current||[]).map(row=>row.id).filter(id=>!keepIds.includes(id));if(removed.length){const{error}=await supabase.from('life_policies').delete().eq('client_id',clientId).in('id',removed);if(error)throw error;}
  return savedRows;
}

const baseGetClient=mhRepository.getClient.bind(mhRepository);
mhRepository.getClient=async function getClientWithAllLifePolicies(id){const record=await baseGetClient(id);if(!record)return record;const{data,error}=await supabase.from('life_policies').select('*').eq('client_id',id).order('created_at',{ascending:true});if(error)throw error;const policies=data||[];policyCache.set(id,policies);return{...record,_life_policies:policies};};

const baseSaveClient=mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient=async function saveClientWithAllLifePolicies(record,...args){const policies=parsePolicies(record);const saved=await baseSaveClient(withoutLegacyLife(record),...args);if(!saved?.id)return saved;const savedPolicies=await savePolicies(saved.id,policies);policyCache.set(saved.id,savedPolicies);const dialog=Array.from(document.querySelectorAll('dialog.client-dialog')).at(-1);const form=dialog?.querySelector('form.client-form');if(form)renderLifePanel(form,savedPolicies);return{...saved,_life_policies:savedPolicies};};

document.addEventListener('click',event=>{const existing=event.target.closest?.('[data-client-id]');const add=event.target.closest?.('[data-add-client]');if(existing)pendingClientId=existing.dataset.clientId||null;else if(add)pendingClientId=null;},true);
const originalOpen=Dialogs.prototype.open;
Dialogs.prototype.open=function patchedMultiLifeOpen(options={}){const dialogClientId=options.kind==='client-dialog'?pendingClientId:null;if(options.kind==='client-dialog')pendingClientId=null;const controller=originalOpen.call(this,options);if(options.kind!=='client-dialog')return controller;const previousAttachForm=controller.attachForm.bind(controller);controller.attachForm=form=>{renderLifePanel(form,dialogClientId?(policyCache.get(dialogClientId)||[]):[]);previousAttachForm(form);};return controller;};
