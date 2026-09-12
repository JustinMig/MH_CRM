import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../campaign-workflow-polish.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../campaign-workflow-polish.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('client search gets a select-all results campaign action', () => {
  assert.match(js, /Select All Results → Campaign/);
  assert.match(js, /MAX_CAMPAIGN_SELECTION = 500/);
  assert.match(js, /\[data-more\]/);
  assert.match(js, /\[data-cmp-assign\]/);
});

test('select all workflow respects disabled and deceased campaign checkboxes through existing selector', () => {
  assert.match(js, /\.cmp-search-checkbox input\[type="checkbox"\]:not\(:disabled\)/);
});

test('new campaign control is converted to a compact icon tile', () => {
  assert.match(js, /cmp-new-campaign-tile/);
  assert.match(js, /cmp-new-campaign-icon/);
  assert.match(css, /background:#f3dfad/);
});

test('campaign cards receive multiple muted color tones', () => {
  for (let i = 0; i < 8; i += 1) assert.match(css, new RegExp(`cmp-tone-${i}`));
  assert.match(js, /index % 8/);
});

test('production index loads campaign workflow polish assets', () => {
  assert.match(html, /campaign-workflow-polish\.css/);
  assert.match(html, /campaign-workflow-polish\.js/);
});
