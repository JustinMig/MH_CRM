const {chromium}=require('playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=process.cwd(),out=path.join(root,'test-results');fs.mkdirSync(out,{recursive:true});
const stub=fs.readFileSync(path.join(root,'tests/fixtures/communications.js'),'utf8');
const A='00000000-0000-4000-8000-000000000011';
const result={scope:'Synthetic data and mocked authentication only. All external browser requests are blocked. No production customer changes.',tests:[]};
const authStub=`export const initialAuthUrl=location.href;
let cb=()=>{};const recovery=location.hash.includes('type=recovery');let session=recovery?{access_token:'SYNTHETIC_NOT_VALID',user:{id:'fake-recovery-user'}}:null;
window.__passwordWrites=0;window.__resetRequests=0;
export const supabase={auth:{onAuthStateChange(fn){cb=fn;return {data:{subscription:{unsubscribe(){}}}}},async getSession(){if(recovery)cb('PASSWORD_RECOVERY',session);return {data:{session},error:null}},async getUser(){return {data:{user:session?.user||null},error:null}},async updateUser(){window.__passwordWrites++;return {data:{user:session.user},error:null}},async signOut(){session=null;cb('SIGNED_OUT',null);return {error:null}},async resetPasswordForEmail(email,opts){window.__resetRequests++;window.__resetRedirect=opts.redirectTo;return {error:null}},async signInWithPassword(){return {error:new Error('Synthetic sign-in is disabled')}}}};`;
let browser;
(async()=>{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
 async function createPage({auth=false,built=false,session=false}={}){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));page.setDefaultTimeout(15000);
  if(session)await page.addInitScript(()=>{const data={access_token:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'+btoa(JSON.stringify({sub:'00000000-0000-4000-8000-000000000001',exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'}))+'.SYNTHETIC_NOT_VALID',refresh_token:'SYNTHETIC_NOT_VALID',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:'00000000-0000-4000-8000-000000000001',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{},aud:'authenticated'}};localStorage.setItem('sb-bogusfmvdrlvxscopgaw-auth-token',JSON.stringify(data));});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(built&&u.hostname==='bogusfmvdrlvxscopgaw.supabase.co'){
    if(u.pathname==='/auth/v1/user')return route.fulfill({contentType:'application/json',body:JSON.stringify({id:'00000000-0000-4000-8000-000000000001'})});
    if(u.pathname.startsWith('/rest/v1/')){
     const profile={id:'00000000-0000-4000-8000-000000000001',full_name:'Synthetic Owner',role:'owner',active:true};
     let data=u.pathname==='/rest/v1/profiles'?[profile]:[];
     if(route.request().headers()['accept']?.includes('vnd.pgrst.object'))data=data[0]||null;
     return route.fulfill({contentType:'application/json',headers:{'content-range':'0-0/0'},body:JSON.stringify(data)});
    }
    if(u.pathname.startsWith('/functions/'))return route.fulfill({contentType:'application/json',body:'{}'});
    return route.abort();
   }
   if(u.hostname!=='127.0.0.1')return route.abort();
   if(!built&&u.pathname==='/supabase-repository.js')return route.fulfill({contentType:'application/javascript',body:stub});
   if(!built&&auth&&u.pathname==='/supabase-client.js')return route.fulfill({contentType:'application/javascript',body:authStub});
   if(u.pathname==='/harness.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/client-texting.css"><link rel="stylesheet" href="/communications-ui.css"></head><body><div id="app"></div></body></html>'});
   if(u.pathname.startsWith('/api/')){
    if(u.pathname==='/api/twilio-sync')await new Promise(r=>setTimeout(r,2000));
    return route.fulfill({contentType:'application/json',body:'{"skipped":true,"matched":0,"synced":0,"events":[]}'});
   }
   const base=built?path.join(root,'dist'):root;const file=path.resolve(base,'.'+(u.pathname==='/'?'/index.html':u.pathname));
   if(!file.startsWith(base+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:'Not found'});
   const ext=path.extname(file);const type={'.js':'application/javascript','.css':'text/css','.html':'text/html','.webp':'image/webp','.png':'image/png','.webmanifest':'application/manifest+json','.json':'application/json'}[ext]||'application/octet-stream';
   return route.fulfill({contentType:type,body:fs.readFileSync(file)});
  });
  return {page,errors,requests};
 }
 // The saved messages should not wait for a deliberately slow remote synchronization.
 let {page,errors}=await createPage();await page.goto('http://127.0.0.1/harness.html#/communications');
 await page.evaluate(async id=>{await import('/client-texting.js');window.__started=performance.now();void window.MHTexting.openClientThread(id)},A);
 await page.waitForSelector('.sms-bubble');const ms=await page.evaluate(()=>performance.now()-window.__started);assert.ok(ms<1500,`Saved text waited ${ms}ms`);
 assert.equal(await page.locator('.sms-bubble').getAttribute('data-message-id'),'sms-a');assert.deepEqual(errors,[]);result.savedMessageMs=Math.round(ms);result.mockTwilioDelayMs=2000;result.tests.push('saved texts before Twilio');await page.close();
 ({page,errors}=await createPage());await page.goto('http://127.0.0.1/harness.html#/communications');
 await page.evaluate(async()=>{const {mhRepository}=await import('/supabase-repository.js');const {createWorkspace}=await import('/workspace.js');createWorkspace(document.querySelector('#app'),mhRepository);for(const f of ['communications-ui','ringcentral-readonly','ringcentral-ui-adjustments','communications-layout-fix','communications-delete','communications-open-client'])await import('/'+f+'.js');});
 await page.waitForSelector('[data-sms-conversation]');await page.locator('[data-channel="calls"]').click();await page.waitForSelector('.mh-call-row .mh-comm-delete');await page.waitForTimeout(500);
 const extract=()=>[...document.querySelectorAll('[data-call-list]>.mh-call-row')].map(r=>({call:r.dataset.callId,client:r.dataset.clientId,delete:r.dataset.deleteCallId,open:r.querySelector('[data-open-client]')?.dataset.openClient}));
 const initial=await page.evaluate(extract);assert.equal(initial.length,2);for(const row of initial){assert.equal(row.call,row.delete);assert.equal(row.client,row.open);}
 const before=await page.evaluate(()=>window.__queries.length);
 for(let i=0;i<4;i++){await page.evaluate(()=>{let e=document.querySelector('#unrelated');if(!e){e=document.createElement('span');e.id='unrelated';document.body.append(e)}e.textContent=String(Date.now())});await page.waitForTimeout(200);}
 const queries=await page.evaluate(n=>window.__queries.slice(n),before);assert.equal(queries.length,0,JSON.stringify(queries));result.unrelatedMutationReads=queries.length;
 await page.evaluate(()=>{window.__fixture.ringcentral_calls.unshift({id:'call-new',client_id:'00000000-0000-4000-8000-000000000013',direction:'Inbound',started_at:'2026-09-15T11:30:00Z'});document.querySelector('#unrelated').textContent='backend changed';});await page.waitForTimeout(300);
 assert.deepEqual(await page.evaluate(extract),initial);result.tests.push('call identities remain stable across unseen backend reordering','no action queries from unrelated DOM changes');
 await page.locator('[data-call-id="call-a"] [data-open-client]').click();await page.waitForSelector('dialog.client-dialog form');assert.equal(await page.locator('dialog.client-dialog [name="last_name"]').inputValue(),'Alpha');
 await page.locator('dialog.client-dialog [data-close]').first().click();await page.waitForSelector('dialog.client-dialog',{state:'detached'});result.tests.push('Open Client opens displayed client after reordering');
 page.on('dialog',d=>d.accept());await page.locator('[data-call-id="call-a"] .mh-comm-delete').click();await page.waitForTimeout(500);
 assert.deepEqual(await page.evaluate(()=>window.__fixture.ringcentral_calls.filter(r=>r.hidden_at).map(r=>r.id)),['call-a']);result.tests.push('Delete Call deletes only displayed synthetic call');
 await page.locator('[data-channel="texts"]').click();await page.locator('[data-sms-conversation]').click();await page.waitForSelector('.sms-bubble .mh-comm-delete');
 await page.evaluate(()=>window.__fixture.client_sms_messages.unshift({id:'sms-new',client_id:'00000000-0000-4000-8000-000000000011',direction:'inbound',body:'NEW SYNTHETIC MESSAGE',status:'received',occurred_at:'2026-09-15T12:00:00Z',created_at:'2026-09-15T12:00:00Z'}));
 await page.locator('[data-message-id="sms-a"] .mh-comm-delete').click();await page.waitForTimeout(300);
 assert.deepEqual(await page.evaluate(()=>window.__fixture.client_sms_messages.filter(r=>r.hidden_at).map(r=>r.id)),['sms-a']);result.tests.push('Delete Text uses stable message ID');
 await page.locator('[data-sms-close]').click();result.layout=[];
 for(const width of [1440,1024,768,390]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(150);
  const layout=await page.evaluate(()=>{const boxes=[...document.querySelectorAll('.sms-center-metrics>div')].map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}});return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,overlap:boxes.some((a,i)=>boxes.slice(i+1).some(b=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h))}});
  assert.equal(layout.overflow,false,JSON.stringify(layout));assert.equal(layout.overlap,false,JSON.stringify(layout));result.layout.push(layout);await page.screenshot({path:path.join(out,`communications-${width}.png`),fullPage:true});
 }
 assert.deepEqual(errors,[]);await page.close();
 // Recovery UI state is tested without consuming a real recovery link or changing a real password.
 for(const suffix of ['?recovery=1','?recovery=1#error=access_denied&error_code=otp_expired']){
  ({page,errors}=await createPage({auth:true}));await page.goto('http://127.0.0.1/'+suffix);await page.waitForSelector('[data-new-reset]');assert.equal(await page.locator('h1').innerText(),'Reset Link Unavailable');
  await page.locator('[data-new-reset]').click();await page.waitForSelector('#reset-request-form');await page.locator('[data-back-signin]').click();await page.waitForSelector('#signin-form');assert.deepEqual(errors,[]);await page.close();
 }
 result.tests.push('missing and expired recovery links offer working recovery and sign-in navigation');
 ({page,errors}=await createPage({auth:true}));await page.goto('http://127.0.0.1/#access_token=SYNTHETIC&type=recovery');await page.waitForSelector('#new-password-form');
 await page.locator('[name="password"]').fill('Synthetic1!');await page.locator('[name="confirm_password"]').fill('NotMatching2!');await page.locator('[type="submit"]').click();assert.match(await page.locator('.auth-message').innerText(),/do not match/);
 await page.locator('[name="password"]').fill('Synthetic1!');await page.locator('[name="confirm_password"]').fill('Synthetic1!');await page.locator('[type="submit"]').click();await page.waitForSelector('#signin-form');assert.match(await page.locator('.auth-message').innerText(),/changed successfully/);assert.equal(await page.evaluate(()=>window.__passwordWrites),1);assert.deepEqual(errors,[]);result.tests.push('verified mock recovery validates confirmation, updates once, and exits without reload loop');await page.close();
 // Inspect the real optimized build, with and without an isolated mock session.
 let made=await createPage({built:true});page=made.page;await page.goto('http://127.0.0.1/');await page.waitForSelector('#signin-form');await page.waitForTimeout(300);
 assert.ok(!made.requests.includes('/workspace-styles.css'));result.builtLoginRequests=made.requests.length;assert.deepEqual(made.errors,[]);await page.screenshot({path:path.join(out,'built-login.png')});await page.close();
 made=await createPage({built:true,session:true});page=made.page;await page.goto('http://127.0.0.1/#/communications');await page.waitForSelector('[data-channel="calls"]',{timeout:25000});await page.waitForTimeout(500);assert.deepEqual(made.errors,[]);assert.equal(await page.locator('.top-brand strong').innerText(),'Mayer MIG CRM');result.tests.push('built signed-in refresh restores Communications after authenticated initialization');await page.close();
 await browser.close();fs.writeFileSync(path.join(out,'browser-regressions.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(async error=>{fs.writeFileSync(path.join(out,'browser-regressions.json'),JSON.stringify({...result,failure:error.message,stack:error.stack},null,2));console.error(error);await browser?.close();process.exitCode=1});
