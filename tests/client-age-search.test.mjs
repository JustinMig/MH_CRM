import test from 'node:test';
import assert from 'node:assert/strict';
import { clientAgeBounds, makeClientSearch, clientSearchMarkup } from '../client-search.js';

const now = () => new Date('2026-09-11T17:00:00Z');
function fakeDb(records = []) {
  const calls = [], predicates = [];
  const q = {};
  for (const method of ['from', 'select', 'or', 'order']) q[method] = (...args) => { calls.push([method, ...args]); return q; };
  q.eq = (key, value) => { calls.push(['eq', key, value]); predicates.push(r => r[key] === value); return q; };
  q.contains = (key, values) => { calls.push(['contains', key, values]); predicates.push(r => values.every(v => (r[key] || []).includes(v))); return q; };
  for (const method of ['gte', 'lte']) q[method] = (key, value) => {
    calls.push([method, key, value]);
    predicates.push(r => r[key] != null && (method === 'gte' ? r[key] >= value : r[key] <= value));
    return q;
  };
  q.range = async (from, to) => { calls.push(['range', from, to]); return { data: records.filter(r => predicates.every(f => f(r))).slice(from, to + 1), error: null }; };
  return { db: q, calls };
}
const samples = [
  { id: 'older', date_of_birth: '1940-12-31' },
  { id: 'last-year', date_of_birth: '1960-12-31' },
  { id: 'jan1', date_of_birth: '1961-01-01' },
  { id: 'birthday-today', date_of_birth: '1961-09-11' },
  { id: 'birthday-tomorrow', date_of_birth: '1961-09-12' },
  { id: 'dec31', date_of_birth: '1961-12-31' },
  { id: 'next-year', date_of_birth: '1962-01-01' },
  { id: 'no-dob', date_of_birth: null }
];

test('T65 spans the whole current calendar birth year', () => {
  assert.deepEqual(clientAgeBounds('t65', now()), { min: '1961-01-01', max: '1961-12-31' });
});
test('65+ uses the current Central calendar date inclusively', () => {
  assert.deepEqual(clientAgeBounds('65plus', now()), { min: null, max: '1961-09-11' });
});
test('T65 rolls over at Central New Year, not UTC midnight', () => {
  assert.equal(clientAgeBounds('t65', new Date('2027-01-01T05:59:59Z')).min, '1961-01-01');
  assert.equal(clientAgeBounds('t65', new Date('2027-01-01T06:00:00Z')).min, '1962-01-01');
});
test('65+ changes its cutoff at Central midnight in daylight time', () => {
  assert.equal(clientAgeBounds('65plus', new Date('2026-09-12T04:59:59Z')).max, '1961-09-11');
  assert.equal(clientAgeBounds('65plus', new Date('2026-09-12T05:00:00Z')).max, '1961-09-12');
});
test('leap day is clamped to a valid DOB cutoff, without including March 1', () => {
  assert.equal(clientAgeBounds('65plus', new Date('2028-02-29T18:00:00Z')).max, '1963-02-28');
  assert.equal(clientAgeBounds('65plus', new Date('2028-03-01T18:00:00Z')).max, '1963-03-01');
});
test('leap birth-date cutoff advances through February correctly', () => {
  assert.equal(clientAgeBounds('65plus', new Date('2029-02-28T18:00:00Z')).max, '1964-02-28');
  assert.equal(clientAgeBounds('65plus', new Date('2029-03-01T18:00:00Z')).max, '1964-03-01');
});
test('ordinary product/status selections do not use age bounds', () => {
  for (const filter of ['', 'medicare', 'life', 'retirement', 'deceased']) assert.equal(clientAgeBounds(filter, new Date('bad')), null);
});
test('invalid clock fails safely rather than returning an unfiltered age list', async () => {
  const f = fakeDb(samples);
  await assert.rejects(makeClientSearch(f.db, { now: () => new Date('bad') })({ product: 't65' }), /current date/);
  assert.ok(!f.calls.some(c => c[0] === 'range'));
});
test('T65 searches DOBs before pagination, not products or only the loaded page', async () => {
  const f = fakeDb(samples);
  const result = await makeClientSearch(f.db, { now })({ product: 'T65' });
  assert.deepEqual(result.rows.map(r => r.id), ['jan1', 'birthday-today', 'birthday-tomorrow', 'dec31']);
  assert.ok(!f.calls.some(c => c[0] === 'contains'));
  assert.deepEqual(f.calls.filter(c => ['gte','lte'].includes(c[0])), [['gte','date_of_birth','1961-01-01'],['lte','date_of_birth','1961-12-31']]);
});
test('65+ includes clients turning 65 today and all older DOBs, not tomorrow or missing DOBs', async () => {
  const f = fakeDb(samples);
  const result = await makeClientSearch(f.db, { now })({ product: '65plus' });
  assert.deepEqual(result.rows.map(r => r.id), ['older', 'last-year', 'jan1', 'birthday-today']);
  assert.ok(!f.calls.some(c => c[0] === 'contains' || c[0] === 'gte'));
});
test('age filtering keeps query, current-user scope, sorting and pagination', async () => {
  const f = fakeDb();
  await makeClientSearch(f.db, { now })({ product: 't65', query: 'Lee', agent: 'agent-a', sortBy: 'county', sortDirection: 'desc', cursor: '50' });
  assert.ok(f.calls.some(c => c[0] === 'or' && c[1].includes('county.ilike.')));
  assert.ok(f.calls.some(c => c[0] === 'eq' && c[1] === 'assigned_agent_id' && c[2] === 'agent-a'));
  assert.deepEqual(f.calls.find(c => c[0] === 'order'), ['order','county_sort',{ ascending: false, nullsFirst: false }]);
  assert.deepEqual(f.calls.at(-1), ['range',50,100]);
  assert.ok(f.calls.some(c => c[0] === 'lte' && c[2] === '1961-12-31'));
});
test('age results keep the 50-client limit and Load more cursor', async () => {
  const f = fakeDb(Array.from({ length: 60 }, (_, i) => ({ id: i, date_of_birth: '1950-01-01' })));
  const result = await makeClientSearch(f.db, { now })({ product: '65plus', limit: 500 });
  assert.equal(result.rows.length, 50);
  assert.equal(result.nextCursor, '50');
});
test('the same search function recomputes the year on the next request', async () => {
  let date = new Date('2026-12-31T18:00:00Z');
  const f = fakeDb();
  const search = makeClientSearch(f.db, { now: () => date });
  await search({ product: 't65' });
  date = new Date('2027-01-01T18:00:00Z');
  await search({ product: 't65' });
  assert.deepEqual(f.calls.filter(c => c[0] === 'gte').map(c => c[2]), ['1961-01-01', '1962-01-01']);
});
test('product/status searches are unchanged and age search does not change status rules', async () => {
  for (const product of ['', 'medicare', 'life', 'retirement', 'deceased']) {
    const f = fakeDb();
    await makeClientSearch(f.db, { now })({ product });
    assert.ok(!f.calls.some(c => c[0] === 'gte' || c[0] === 'lte'));
    if (product === 'deceased') assert.ok(f.calls.some(c => c[0] === 'eq' && c[1] === 'status'));
    else if (product) assert.ok(f.calls.some(c => c[0] === 'contains' && c[2][0] === product));
  }
});
test('both age options fit the existing dropdown without adding another search box', () => {
  const html = clientSearchMarkup({ query: '', agent: 'agent-a', product: 't65' });
  const form = html.match(/<form id="client-search"[\s\S]*?<\/form>/)[0];
  assert.equal((form.match(/<label /g) || []).length, 2);
  assert.match(form, /<option value="t65" selected>T65<\/option>/);
  assert.match(form, /<option value="65plus">65\+<\/option>/);
  assert.doesNotMatch(form, /birthYear|Birth Year|YYYY|data-turn65/);
  assert.match(html, /value="deceased"/);
  assert.match(html, /value="medicare"/);
});
test('65+ selection and the existing state/county/date sorting survive rendering', () => {
  const html = clientSearchMarkup({ query: 'Test', product: '65plus', agent: 'agent-a', sortBy: 'state', sortDirection: 'asc', applied: { product: '65plus' } });
  assert.match(html, /value="65plus" selected>65\+/);
  for (const text of ['Client Name','State','County','Date Added']) assert.ok(html.includes(text));
  assert.match(html, /type="hidden" name="agent" value="agent-a"/);
});
