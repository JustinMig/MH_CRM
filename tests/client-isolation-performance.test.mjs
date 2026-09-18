import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');

test('client dialogs own their identity and New Client cannot inherit the previous client', async () => {
  const [workspace, dialogs] = await Promise.all([read('workspace.js'), read('dialogs.js')]);
  assert.match(workspace, /clientId:\s*id \|\| null/);
  assert.match(workspace, /isNewClient:\s*!id/);
  assert.match(dialogs, /node\.dataset\.clientId = String\(clientId\)/);
  assert.match(dialogs, /node\.dataset\.newClient = 'true'/);

  for (const file of [
    'medicare-gov-credentials.js',
    'banking-information.js',
    'client-pharmacy.js',
    'client-health-tabs.js',
    'life-multiple-policies.js',
    'client-personal-underwriting.js',
    'client-medicare-assets.js',
    'client-medicare-cleanup.js',
    'client-audit-fixes.js',
  ]) {
    const source = await read(file);
    assert.doesNotMatch(source, /pendingClientId/, file);
  }
});

test('New Client hard-reset clears client-entered controls after enhancers run', async () => {
  const source = await read('new-client-clean-close.js');
  assert.match(source, /clearNewClientData\(nextForm\)/);
  assert.match(source, /form\.reset\(\)/);
  assert.match(source, /control\.name === 'assigned_agent_id'/);
  assert.match(source, /control\.value = ''/);
});

test('client opening avoids duplicate Medicare reads and starts independent record loads in parallel', async () => {
  const [repository, health, views, extensions, cleanup] = await Promise.all([
    read('supabase-repository.js'),
    read('client-health-tabs.js'),
    read('views.js'),
    read('workspace-extensions.js'),
    read('client-medicare-cleanup.js'),
  ]);
  assert.match(repository, /const \[client, medicare, health, life, retirement\] = await Promise\.all/);
  assert.match(repository, /medicare_notes: medicare\?\.notes/);
  assert.match(repository, /health_plan_type: health\?\.plan_type/);
  assert.match(health, /const \[base,d,m,h\] = await Promise\.all/);
  assert.match(views, /group\('Medicare Notes', medicareNotes\)/);
  assert.match(repository, /notes: clean\(record\.medicare_notes\)/);
  assert.doesNotMatch(extensions, /client-medicare-notes\.js/);
  assert.doesNotMatch(cleanup, /mhRepository\.getClient\s*=/);
});

test('global observers avoid unnecessary full-tree watches where route or direct-dialog events are enough', async () => {
  const [appointments, users] = await Promise.all([read('appointment-ui.js'), read('admin-users.js')]);
  assert.match(appointments, /observer\.observe\(document\.body, \{ childList: true \}\)/);
  assert.doesNotMatch(users, /MutationObserver/);
});


test('post-save helpers target the exact client dialog instead of the most recent dialog', async () => {
  const [extras, pharmacy, files] = await Promise.all([
    read('client-notes-extras.js'),
    read('client-pharmacy-postsave.js'),
    read('client-file-experience.js'),
  ]);
  assert.match(extras, /dataset\.newClient==='true'/);
  assert.match(extras, /dataset\.clientId===id/);
  assert.match(pharmacy, /dialog\.client-dialog\[data-new-client="true"\]/);
  assert.match(files, /dataset\.clientId===id/);
  assert.match(files, /dataset\.newClient==='true'/);
});

test('New Client toolbar observer disconnects after installation', async () => {
  const source = await read('top-add-client.js');
  assert.match(source, /if \(ensureTopAddClient\(\)\) observer\.disconnect\(\)/);
});
