import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientSearchMarkup, clientResultsMarkup } from '../client-search.js';
const state = { query: '', product: '', agent: 'agent-a', sortBy: 'name', sortDirection: 'asc', applied: null };

test('main search contains only Search Clients and Product / Status criteria', () => {
  const html = clientSearchMarkup(state);
  const form = html.match(/<form id="client-search"[\s\S]*?<\/form>/)[0];
  assert.equal((form.match(/<label /g) || []).length, 2);
  assert.match(form, /<span>Search Clients<\/span>/);
  assert.match(form, /<span>Product \/ Status<\/span>/);
  assert.match(form, /type="submit"/);
  assert.match(form, /data-reset-search/);
  assert.doesNotMatch(form, /Birth Year|birthYear|data-turn65|Turn 65/);
});
test('legacy birth-year state is not rendered as a visible or hidden filter', () => {
  assert.doesNotMatch(clientSearchMarkup({ ...state, birthYear: '1961' }), /birthYear|1961|YYYY/);
  const workspace = readFileSync(new URL('../workspace.js', import.meta.url), 'utf8');
  assert.doesNotMatch(workspace, /birthYear|data-turn65/);
});
test('current-user scoping survives without an extra agent dropdown', () => {
  const html = clientSearchMarkup(state);
  assert.match(html, /type="hidden" name="agent" value="agent-a"/);
  assert.doesNotMatch(html, /<select name="agent"/);
});
test('sort controls appear with results, not on the untouched search page', () => {
  assert.match(clientSearchMarkup(state), /data-client-result-toolbar hidden/);
  const html = clientSearchMarkup({ ...state, applied: { query: 'Test' } });
  assert.match(html, /data-client-result-toolbar>/);
  for (const name of ['Client Name', 'State', 'County', 'Date Added']) assert.ok(html.includes(name));
  assert.match(html, /name="sortBy" form="client-search"/);
  assert.match(html, /name="sortDirection" form="client-search"/);
});
test('untouched page removes duplicate headings, instructions and empty results panel', () => {
  assert.equal(clientResultsMarkup({ rows: null }), '');
  assert.doesNotMatch(clientSearchMarkup(state), /<h2>|Search first|saved creation date/);
});
test('product and deceased options, saved values and escaping are retained', () => {
  const html = clientSearchMarkup({ ...state, query: '"><img src=x>', product: 'deceased' });
  for (const item of ['Medicare', 'Life', 'Retirement', 'Deceased', 'All Products / Statuses']) assert.ok(html.includes(item));
  assert.match(html, /value="deceased" selected/);
  assert.match(html, /&quot;&gt;&lt;img/);
  assert.doesNotMatch(html, /<img/);
});
test('loading, empty-search and error feedback remain available', () => {
  assert.match(clientResultsMarkup({ rows: null, loading: true, message: 'Searching…' }), /Searching…/);
  assert.match(clientResultsMarkup({ rows: [], message: 'No matching clients found.' }), /No matching clients found/);
  assert.match(clientResultsMarkup({ rows: null, error: '<Offline>' }), /role="alert">&lt;Offline&gt;/);
});
test('result cards still open clients and retain Load more', () => {
  const html = clientResultsMarkup({ rows: [{ id: 'test-id', first_name: 'Sample', last_name: 'Client' }], nextCursor: '50' });
  assert.match(html, /data-client-id="test-id" aria-haspopup="dialog"/);
  assert.match(html, /data-more/);
});
