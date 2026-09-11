import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClientSearch, clientSearchOrders, normalizeClientSort, clientAddedDate, clientPhone, clientProductsMarkup, clientResultContent, clientSearchMarkup, clientResultsMarkup } from '../client-search.js';
function fakeDb(data = [], error = null) {
  const calls = [];
  const q = {};
  for (const method of ['from','select','or','eq','contains','gte','lte','order']) q[method] = (...args) => { calls.push([method,...args]); return q; };
  q.range = async (...args) => { calls.push(['range',...args]); return { data, error }; };
  return { db:q, calls };
}
test('returns the six requested details and escapes stored text', () => {
  const html = clientResultContent({first_name:'Test <img>', last_name:'Client', county:'Alcorn & Lee', state:'ms', phone:'6625550123',products:['medicare','life'],created_at:'2026-09-11T15:00:00Z'});
  for (const label of ['County','State','Phone','Products / Status','Date Added','Medicare','Life','09/11/2026','10:00 AM CDT','662-555-0123']) assert.ok(html.includes(label),label);
  assert.ok(html.includes('>MS<'));
  assert.ok(html.includes('Test &lt;img&gt;'));
  assert.ok(html.includes('Alcorn &amp; Lee'));
  assert.ok(!html.includes('<img>'));
});
test('deceased takes precedence over products without changing record data',()=>{
  const c={status:'deceased',products:['medicare','life']};
  assert.match(clientProductsMarkup(c),/Deceased/);
  assert.doesNotMatch(clientProductsMarkup(c),/Medicare|Life/);
  assert.equal(c.products.length,2);
});
test('blank fields have honest placeholders',()=>{
  const html=clientResultContent({});
  assert.equal((html.match(/Not entered/g)||[]).length,3);
  assert.match(html,/Not selected/); assert.match(html,/Not recorded/);
});
test('Central Time handles midnight and standard/daylight time',()=>{
  assert.deepEqual(clientAddedDate('2026-09-11T01:30:00Z'),{date:'09/10/2026',time:'8:30 PM CDT',iso:'2026-09-11T01:30:00.000Z'});
  assert.equal(clientAddedDate('2026-01-02T15:30:00Z').time,'9:30 AM CST');
  assert.equal(clientAddedDate('2026-09-11').date,'09/11/2026');
  assert.equal(clientAddedDate('bad').date,'Not recorded');
  assert.equal(clientAddedDate('2026-02-30').date,'Not recorded');
});
test('US phone display preserves country codes and extensions',()=>{
  assert.equal(clientPhone('(662) 555-0123'),'662-555-0123');
  assert.equal(clientPhone('+1 (662) 555-0123'),'1-662-555-0123');
  assert.equal(clientPhone('662-555-0123 ext 55'),'662-555-0123 ext 55');
  assert.equal(clientPhone('+44 20 7946 0123'),'+44 20 7946 0123');
});
test('sort columns are allowlisted with stable unique tie breakers',()=>{
  assert.equal(clientSearchOrders('state','desc')[0][0],'state_sort');
  assert.deepEqual(clientSearchOrders('county','asc').slice(0,2),[['county_sort',true],['state_sort',true]]);
  assert.deepEqual(clientSearchOrders('created_at','desc')[0],['created_at',false]);
  assert.deepEqual(clientSearchOrders('name','desc').at(-1),['id',true]);
  assert.equal(normalizeClientSort('DROP TABLE','bad').sortBy,'name');
  assert.equal(normalizeClientSort('created_at').sortDirection,'desc');
});
test('search paginates on the server with a 50-row maximum and all detail columns',async()=>{
  const f=fakeDb(Array.from({length:51},(_,i)=>({id:i})));
  const out=await makeClientSearch(f.db)({query:'Smith',sortBy:'county',sortDirection:'asc',limit:200});
  assert.equal(out.rows.length,50); assert.equal(out.nextCursor,'50');
  assert.deepEqual(f.calls.at(-1),['range',0,50]);
  assert.equal(f.calls[0][1],'client_search_results');
  const columns=f.calls.find(x=>x[0]==='select')[1];
  for(const c of ['county','state','status','created_at','products','phone']) assert.ok(columns.split(',').includes(c));
  assert.equal(f.calls.filter(x=>x[0]==='order')[0][1],'county_sort');
  assert.ok(f.calls.filter(x=>x[0]==='order').every(x=>x[2].nullsFirst===false));
});
test('second page preserves sort and existing agent/product/birth-year filters',async()=>{
  const f=fakeDb([{id:51}]);
  const out=await makeClientSearch(f.db)({product:'Medicare',agent:'agent-a',birthYear:'1961',sortBy:'created_at',sortDirection:'asc',cursor:'50'});
  assert.equal(out.nextCursor,null);
  assert.deepEqual(f.calls.at(-1),['range',50,100]);
  assert.ok(f.calls.some(x=>JSON.stringify(x)===JSON.stringify(['contains','products',['medicare']])));
  assert.ok(f.calls.some(x=>x[0]==='eq'&&x[1]==='assigned_agent_id'&&x[2]==='agent-a'));
  assert.ok(f.calls.some(x=>x[0]==='gte'&&x[2]==='1961-01-01'));
});
test('deceased filter uses status rather than products',async()=>{
  const f=fakeDb(); await makeClientSearch(f.db)({product:'deceased'});
  assert.ok(f.calls.some(x=>x[0]==='eq'&&x[1]==='status'&&x[2]==='deceased'));
  assert.equal(f.calls.filter(x=>x[0]==='contains').length,0);
});
test('query values are quoted and formatted phone lookup uses digits',async()=>{
  const f=fakeDb(); await makeClientSearch(f.db)({query:'O\'Brien, ("Jr")'});
  assert.ok(f.calls.find(x=>x[0]==='or')[1].includes('full_name.ilike.'+JSON.stringify('%O\'Brien, ("Jr")%')));
  const p=fakeDb(); await makeClientSearch(p.db)({query:'(662) 555-0123'});
  assert.ok(p.calls.find(x=>x[0]==='or')[1].includes('phone_digits.ilike."%6625550123%"'));
});
test('errors are visible to caller and invalid birth years do not query range',async()=>{
  const f=fakeDb([],new Error('Offline')); await assert.rejects(makeClientSearch(f.db)({query:'test'}),/Offline/);
  const g=fakeDb(); await assert.rejects(makeClientSearch(g.db)({birthYear:'196x'}),/four-digit/);
  assert.ok(!g.calls.some(x=>x[0]==='range'));
});
test('sorting controls remain present before searching and do not pre-load rows',()=>{
  const html=clientSearchMarkup({query:'',product:'',agent:'',birthYear:'',sortBy:'created_at',sortDirection:'asc'});
  for(const label of ['State','County','Date Added','Newest first','Oldest first']) assert.ok(html.includes(label));
  assert.ok(html.includes('form="client-search"'));
  assert.doesNotMatch(clientResultsMarkup({rows:null}),/data-client-id=/);
});
