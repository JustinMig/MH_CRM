import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recoveryContext, withTimeout } from '../auth-flow.js';
import { canAccessClient, requireCrmAdmin, getClient, getClients } from '../server/communications.js';
const a='00000000-0000-4000-8000-000000000001';
const b='00000000-0000-4000-8000-000000000002';
const c='00000000-0000-4000-8000-000000000011';
const actor=(role='agent',active=true)=>({id:a,profile:{role,active}});
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');

test('recovery parser distinguishes absent, expired, and genuine callback forms',()=>{
 assert.equal(recoveryContext('https://mig.example/').requested,false);
 assert.equal(recoveryContext('https://mig.example/?recovery=1').tokenCallback,false);
 for(const url of ['https://mig.example/?recovery=1#error=access_denied&error_code=otp_expired','https://mig.example/#error_code=otp_expired']) {
  assert.equal(recoveryContext(url).invalid,true);assert.equal(recoveryContext(url).requested,true);
 }
 const valid=recoveryContext('https://mig.example/#access_token=SYNTHETIC&type=recovery');
 assert.equal(valid.requested,true);assert.equal(valid.tokenCallback,true);assert.equal(valid.invalid,false);
 assert.equal(recoveryContext('https://mig.example/#access_token=SYNTHETIC&type=signup').requested,false);
});
test('recovery operations finish on success, failure, and network timeout',async()=>{
 assert.equal(await withTimeout(Promise.resolve('ok'),30),'ok');
 await assert.rejects(withTimeout(Promise.reject(new Error('failed')),30),/failed/);
 await assert.rejects(withTimeout(new Promise(()=>{}),15),/timed out/);
});
test('client authorization limits agents to assigned clients and requires active users',()=>{
 const own={id:c,assigned_agent_id:a},other={id:c,assigned_agent_id:b};
 assert.equal(canAccessClient(actor(),own),true);assert.equal(canAccessClient(actor(),other),false);
 assert.equal(canAccessClient(actor('owner'),other),true);assert.equal(canAccessClient(actor('admin'),other),true);
 assert.equal(canAccessClient(actor('owner',false),own),false);assert.equal(canAccessClient(null,own),false);
 assert.equal(canAccessClient(actor(),null),false);assert.throws(()=>requireCrmAdmin(actor()),/administrator/);
 assert.doesNotThrow(()=>requireCrmAdmin(actor('owner')));
});
test('service-backed client lookup does not return another agent’s client',async()=>{
 const old=global.fetch,oldKey=process.env.SUPABASE_SECRET_KEY;process.env.SUPABASE_SECRET_KEY='SYNTHETIC_TEST_ONLY';
 global.fetch=async()=>Response.json([{id:c,assigned_agent_id:b}]);
 try{assert.equal(await getClient(c,actor()),null);assert.deepEqual(await getClients([c],actor()),[]);assert.equal((await getClient(c,actor('owner'))).id,c);}
 finally{global.fetch=old;if(oldKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=oldKey;}
});
test('all browser-callable communication APIs reject requests without login before any network operation',async()=>{
 const old=global.fetch;global.fetch=()=>{throw new Error('Unexpected network call');};
 try{
  for(const [path,method] of [['twilio-send','POST'],['twilio-bulk','POST'],['twilio-sync','GET'],['ringcentral-sync','GET'],['ringcentral-recording','GET'],['calendar-events','GET']]){
   const mod=await import(`../api/${path}.js`);const res=await mod[method](new Request('https://mig.example/api/'+path,{method}));assert.equal(res.status,401,path);
  }
 }finally{global.fetch=old;}
});
test('foreign clients and recordings cannot be sent or played through service APIs',async()=>{
 const old=global.fetch,oldKey=process.env.SUPABASE_SECRET_KEY;process.env.SUPABASE_SECRET_KEY='SYNTHETIC_TEST_ONLY';const seen=[];
 global.fetch=async(url,options={})=>{
  const u=String(url);seen.push(u);
  if(u.endsWith('/auth/v1/user'))return Response.json({id:a});
  if(u.includes('/rest/v1/profiles?'))return Response.json([{id:a,role:'agent',active:true}]);
  if(u.includes('/rest/v1/ringcentral_calls?'))return Response.json([{id:'fake-call',client_id:c,recording_id:'fake-recording'}]);
  if(u.includes('/rest/v1/clients?'))return Response.json([{id:c,assigned_agent_id:b,phone:'6625550101'}]);
  throw new Error('Unexpected external call: '+u);
 };
 try{
  const headers={Authorization:'Bearer SYNTHETIC_TEST_ONLY','Content-Type':'application/json'};
  const send=await import('../api/twilio-send.js');assert.equal((await send.POST(new Request('https://mig.example/api/twilio-send',{method:'POST',headers,body:JSON.stringify({clientId:c,body:'Never sent'})}))).status,404);
  const bulk=await import('../api/twilio-bulk.js');assert.equal((await bulk.POST(new Request('https://mig.example/api/twilio-bulk',{method:'POST',headers,body:JSON.stringify({clientIds:[c],body:'Never sent'})}))).status,404);
  const audio=await import('../api/ringcentral-recording.js');assert.equal((await audio.GET(new Request('https://mig.example/api/ringcentral-recording?id=fake-recording',{headers}))).status,404);
  const calendar=await import('../api/calendar-events.js');assert.equal((await calendar.GET(new Request('https://mig.example/api/calendar-events',{headers}))).status,403);
  assert.ok(seen.every(u=>u.startsWith('https://bogusfmvdrlvxscopgaw.supabase.co/')));
 }finally{global.fetch=old;if(oldKey===undefined)delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=oldKey;}
});
test('communication actions use rendered immutable IDs and never query their own parallel record list',async()=>{
 const [calls,dialogs,texts,del,open]=await Promise.all(['ringcentral-readonly.js','ringcentral-ui-adjustments.js','client-texting.js','communications-delete.js','communications-open-client.js'].map(read));
 for(const source of [calls,dialogs]){assert.match(source,/data-call-id=/);assert.match(source,/data-client-id=/);}
 assert.match(texts,/data-message-id=/);assert.match(del,/bubble\.dataset\.messageId/);assert.match(del,/row\.dataset\.callId/);
 assert.match(open,/row\.dataset\.clientId/);
 for(const source of [del,open])assert.doesNotMatch(source,/visibleCalls|visibleThreadMessages|rows\[index\]|new MutationObserver/);
});
test('public startup does not import workspace and feature modules until after authentication',async()=>{
 const [html,app,workspace]=await Promise.all(['index.html','app.js','workspace-start.js'].map(read));
 assert.equal((html.match(/<script/g)||[]).length,1);assert.equal((html.match(/rel="stylesheet"/g)||[]).length,1);
 assert.doesNotMatch(app,/^import .*workspace/m);assert.match(app,/import\('\.\/workspace-start\.js(?:\?[^']*)?'\)/);
 assert.match(workspace,/import \{ mhRepository, supabase \}/);
 assert.match(app,/if \(!candidate\) return invalidReset/);assert.match(app,/passwordSaved/);
});
