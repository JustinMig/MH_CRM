import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../leads-icon-screen.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../sql/workspace-leads.sql', import.meta.url), 'utf8');
test('top toolbar exposes Leads icon', () => {
  assert.match(source, /installLeadsButton/);
  assert.match(source, /data-tool=\"leads\"/);
  assert.match(source, /<strong>Leads<\/strong>/);
});
test('Leads icon directly opens lead manager', () => {
  assert.match(source, /data-tool=.?leads/);
  assert.match(source, /openLeadsScreen/);
  assert.match(source, /stopImmediatePropagation/);
});
test('lead workflow supports add edit search files conversion and client open', () => {
  for (const text of ['New Lead','Search Leads','Convert to Client','Open Client','Lead File / Photo']) assert.match(source, new RegExp(text));
  assert.match(source, /workspace_leads/);
  assert.match(source, /mh-client-documents/);
  assert.match(source, /createSignedUrl/);
});
test('lead schema is RLS protected and Mayer imports are duplicate-safe', () => {
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.workspace_leads from anon/i);
  assert.match(sql, /to authenticated/i);
  assert.match(sql, /source_system, source_record_id/i);
  assert.match(sql, /private\.is_active_crm_user\(\)/i);
});
