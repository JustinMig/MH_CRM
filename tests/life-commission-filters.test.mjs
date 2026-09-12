import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../life-commission-filters.js', import.meta.url), 'utf8');

test('Life commission view hides agent selection and keeps month/year filters', () => {
  assert.match(source, /agentField\.hidden = Boolean\(isLife\)/);
  assert.match(source, /data-life-month-wrap/);
  assert.match(source, /data-life-year-wrap/);
  assert.match(source, /agentSelect\.value = ''/);
});

test('Life year choices include a useful range plus any selected historical year', () => {
  assert.match(source, /current \+ 1/);
  assert.match(source, /current - 7/);
  assert.match(source, /values\.add\(Number\(selected\)\)/);
  assert.match(source, /sort\(\(a, b\) => b - a\)/);
});

test('tracker patch avoids body-wide attribute observation loops', () => {
  assert.match(source, /childList: true, subtree: true/);
  assert.doesNotMatch(source, /attributes:\s*true/);
  assert.doesNotMatch(source, /characterData:\s*true/);
});
