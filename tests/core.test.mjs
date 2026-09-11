import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV, CLIENT_TABS, esc, monthDays, isoDate, dateISO, dateText, stable, snapshot, disconnectedRepository, NotConnectedError } from '../core.js';

test('sidebar contains only workspace pages, not client sections', () => {
  const names = NAV.map(([key]) => key);
  for (const key of ['client', 'medicare', 'life', 'retirement', 'documents']) assert.equal(names.includes(key), false);
  assert.equal(names.includes('clients'), true);
});
test('client sections are nested in the information dialog', () => {
  assert.deepEqual(CLIENT_TABS.map(([key]) => key), [
    'information','medicare','doctors','medications','hospital_indemnity','life','retirement','notes'
  ]);
});
test('Documents is merged into Notes Extras', () => {
  const labels = Object.fromEntries(CLIENT_TABS);
  assert.equal('documents' in labels, false);
  assert.equal(labels.notes, 'Notes / Extras');
});
test('client health sections stay inside the client record and not the sidebar', () => {
  const nav = new Set(NAV.map(([key]) => key));
  const tabs = new Set(CLIENT_TABS.map(([key]) => key));
  for (const key of ['doctors','medications','hospital_indemnity']) {
    assert.equal(nav.has(key), false);
    assert.equal(tabs.has(key), true);
  }
});
test('month grids start Sunday, end Saturday and contain complete weeks', () => {
  for (let year = 2024; year <= 2032; year++) for (let month = 0; month < 12; month++) {
    const days = monthDays(year, month);
    assert.equal(days[0].getDay(), 0); assert.equal(days.at(-1).getDay(), 6);
    assert.equal(days.length % 7, 0);
    assert.equal(new Set(days.map(isoDate)).size, days.length);
    assert.equal(days.filter(d => d.getMonth() === month).length, new Date(year, month + 1, 0).getDate());
  }
});
test('manual dates accept slash entry and compact numeric entry', () => {
  assert.equal(dateISO('2/29/2024'), '2024-02-29');
  assert.equal(dateISO('02292024'), '2024-02-29');
  assert.equal(dateText('2024-02-29'), '02/29/2024');
});
test('impossible and incomplete dates do not silently roll into another month', () => {
  for (const value of ['02/29/2025','04/31/2026','13/01/2026','00/10/2026','02/00/2026','02/02/26','02/02/1800']) assert.equal(dateISO(value), null);
});
test('dirty comparison is order-independent and reversions become clean', () => {
  const value = { name: '', selected: false, notes: '' };
  const initial = stable(value);
  assert.equal(initial, stable({ notes: '', selected: false, name: '' }));
  value.selected = true; assert.notEqual(stable(value), initial);
  value.selected = false; assert.equal(stable(value), initial);
});
test('all named form fields count, including fields in hidden tab panels', () => {
  const elements = [
    {name:'name', type:'text', value:'', disabled:false},
    {name:'product_life', type:'checkbox', checked:true},
    {name:'life_notes', type:'textarea', value:'changed', hidden:true},
    {name:'ssn', type:'text', value:'', disabled:true},
    {name:'action', type:'submit', value:'save'}
  ];
  assert.deepEqual(snapshot({elements}), {name:'', product_life:true, life_notes:'changed'});
});
test('untrusted strings are escaped before insertion into markup', () => {
  assert.equal(esc('<img onerror="x">&'), '&lt;img onerror=&quot;x&quot;&gt;&amp;');
});
test('disconnected provider never returns a false save confirmation', async () => {
  for (const method of ['saveClient','saveEvent','saveNote']) await assert.rejects(disconnectedRepository[method]({}), NotConnectedError);
});
test('no demo rows, users or financial data are seeded by the provider', async () => {
  assert.equal(disconnectedRepository.connected, false);
  assert.deepEqual(disconnectedRepository.agents, []);
  for (const method of ['searchClients','listEvents','listNotes','searchContacts','commissions','getBuildChart']) await assert.rejects(disconnectedRepository[method]({}), NotConnectedError);
});
