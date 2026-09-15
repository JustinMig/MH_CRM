import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const text = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Twilio API routes require CRM auth or a signed Twilio callback', async () => {
  const [send, bulk, sync, status] = await Promise.all([
    text('api/twilio-send.js'),
    text('api/twilio-bulk.js'),
    text('api/twilio-sync.js'),
    text('api/twilio-status.js')
  ]);
  assert.match(send, /requireCrmUser\(request\)/);
  assert.match(bulk, /requireCrmUser\(request\)/);
  assert.match(sync, /requireCrmUser\(request\)/);
  assert.match(status, /validateTwilioRequest/);
  assert.match(status, /x-twilio-signature/);
});

test('M&H texting keeps the Mayer inbound webhook untouched', async () => {
  const server = await text('server/communications.js');
  assert.match(server, /syncRecentMessages/);
  assert.match(server, /syncClientMessages/);
  assert.match(server, /https:\/\/mh\.mayerig\.com\/api\/twilio-status/);
  assert.doesNotMatch(server, /crm\.mayerig\.com\/api\/twilio\/incoming/);
});

test('Texting UI is loaded without broad mutation observers', async () => {
  const [index, client, center] = await Promise.all([
    text('index.html'),
    text('client-texting.js'),
    text('communications-ui.js')
  ]);
  assert.match(index, /client-texting\.js\?v=1/);
  assert.match(index, /communications-ui\.js\?v=1/);
  assert.match(index, /client-texting\.css\?v=1/);
  assert.match(index, /communications-ui\.css\?v=1/);
  assert.doesNotMatch(client, /MutationObserver/);
  assert.doesNotMatch(center, /MutationObserver/);
  assert.match(client, /options\.kind !== 'client-dialog'/);
});

test('SMS schema uses RLS and does not grant browser inserts', async () => {
  const schema = await text('sql/client-sms-messages.sql');
  assert.match(schema, /enable row level security/i);
  assert.match(schema, /grant select, update on table public\.client_sms_messages to authenticated/i);
  assert.doesNotMatch(schema, /grant[^;]*insert[^;]*to authenticated/i);
  assert.match(schema, /client_sms_messages_staff_select/);
  assert.match(schema, /client_sms_messages_staff_update/);
  assert.match(schema, /client_sms_messages_user_id_idx/);
});
