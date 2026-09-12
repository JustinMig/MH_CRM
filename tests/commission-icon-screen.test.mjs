import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../commission-icon-screen.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('top Commissions icon is intercepted directly before the legacy onclick runs', () => {
  assert.match(source, /\[data-tool=\\?"commissions\\?"\]/);
  assert.match(source, /stopImmediatePropagation\(\)/);
  assert.match(source, /addEventListener\('click',[\s\S]*true\)/);
});

test('Life commission icon screen exposes Month and Year and no Agent control', () => {
  assert.match(source, /data-icon-life-month/);
  assert.match(source, /data-icon-life-year/);
  assert.match(source, />Month</);
  assert.match(source, />Year</);
  assert.doesNotMatch(source, />Agent</);
  assert.doesNotMatch(source, /data-tracker-agent/);
});

test('Life Month and Year selectors reload production totals', () => {
  assert.match(source, /lifeMonth\.onchange = loadLife/);
  assert.match(source, /lifeYear\.onchange = loadLife/);
  assert.match(source, /lifeProductionTracker\(\{ year:Number\(lifeYear\.value\), month:Number\(lifeMonth\.value\) \}\)/);
  for (const label of ['Monthly Sales','Monthly Premium','Year Sales','Year Premium']) assert.match(source, new RegExp(label));
});

test('same direct Commissions screen retains Medicare tracker', () => {
  assert.match(source, /data-icon-commission-tab="medicare"/);
  assert.match(source, /medicareCommissionTracker/);
  for (const label of ['Current Medicare Book','AEP','OEP','SEP','T65 / IEP']) assert.match(source, new RegExp(label));
});

test('production index loads direct Commissions icon override last', () => {
  assert.match(index, /client-summary-commissions\.js\?v=3[\s\S]*commission-icon-screen\.js\?v=1/);
});
