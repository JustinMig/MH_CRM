import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT_OUTCOMES, outcomeLabel, isScheduledOutcome } from '../campaigns-model.js';
import { campaignUpdateOptions, RETURN_TO_STEP_ONE } from '../campaign-return-step-one.js';
import { createCampaignRepository } from '../campaigns-repository.js';

test('normal contact outcomes stay unchanged',()=>assert.equal(CONTACT_OUTCOMES.length,5));
for(const [status] of CONTACT_OUTCOMES){
  test(`can return to Step 1 from ${status}`,()=>assert(campaignUpdateOptions({contact_status:status}).some(([key])=>key===RETURN_TO_STEP_ONE)));
}
test('Step 1 does not show a redundant reset',()=>assert(!campaignUpdateOptions({contact_status:'not_contacted'}).some(([key])=>key===RETURN_TO_STEP_ONE)));
test('completed cards reopen rather than accidentally rebook',()=>{for(const contact_status of ['appointment','declined'])assert.deepEqual(campaignUpdateOptions({contact_status}),[[RETURN_TO_STEP_ONE,'Return to Step 1']]);});
test('correction history is clearly labeled, not scheduled',()=>{assert.equal(outcomeLabel(RETURN_TO_STEP_ONE),'Returned to Step 1');assert.equal(isScheduledOutcome(RETURN_TO_STEP_ONE),false);});
test('reset uses separate RPC and forwards only its allowed fields',async()=>{
  const calls=[];
  const api=createCampaignRepository({rpc:async(name,payload)=>{calls.push({name,payload});return{data:{saved:true},error:null};}});
  const payload={p_member_id:'member',p_operation_id:'operation',p_expected_version:7,p_note:'Correction'};
  assert.deepEqual(await api.returnToStepOne({...payload,p_replace_event:true}),{saved:true});
  assert.deepEqual(calls,[{name:'campaign_return_to_step_one',payload}]);
});
test('RPC failure is not marked as a successful correction',async()=>{
 const api=createCampaignRepository({rpc:async()=>({data:null,error:new Error('Save failed')})});
 await assert.rejects(api.returnToStepOne({}),/Save failed/);
});
test('correction cannot be submitted as a normal new contact attempt',async()=>{
 const api=createCampaignRepository({rpc:async()=>{throw new Error('Should not reach database');}});
 await assert.rejects(api.recordContact({p_outcome:RETURN_TO_STEP_ONE}),/Choose a contact result/);
});
