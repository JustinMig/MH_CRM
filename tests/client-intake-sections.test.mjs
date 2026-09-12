import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client-intake-sections.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../client-intake-sections.css', import.meta.url), 'utf8');

test('Personal and Contact intake uses the requested distinct groups', () => {
  for (const label of [
    'Client Name',
    'Date of Birth & Gender',
    'Email & Phone',
    'Address',
    'Social Security',
    'Client Assignment & Household'
  ]) assert.match(source, new RegExp(label.replace(/[&]/g, '\\&')));
});

test('requested fields are assigned to their matching groups', () => {
  for (const field of [
    'first_name','last_name','date_of_birth','gender','email','phone',
    'address','city','county','state','zip','ssn','assigned_agent_id','spouse'
  ]) assert.match(source, new RegExp(`['\"]${field}['\"]`));
});

test('Height and Weight card is preserved and placed with the intake groups', () => {
  assert.match(source, /data-personal-underwriting/);
  assert.match(source, /intake-section-underwriting/);
});

test('unknown injected client fields are preserved instead of discarded', () => {
  assert.match(source, /originalChildren/);
  assert.match(source, /Additional Client Details/);
  assert.match(source, /leftovers/);
});

test('Social Security is moved visually while Driver License identification remains separate', () => {
  assert.match(source, /fields:\s*\['ssn'\]/);
  assert.match(source, /Driver’s License Identification/);
});

test('box styling matches the existing muted underwriting card language and remains mobile-safe', () => {
  assert.match(css, /border:1px solid #c7c2b8/);
  assert.match(css, /background:#f7f5f1/);
  assert.match(css, /border-radius:12px/);
  assert.match(css, /@media\(max-width:390px\)/);
});
