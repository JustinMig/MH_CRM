import { mhRepository, supabase } from './supabase-repository.js';

const BUCKET = 'mh-client-documents';
const OWNER_ROLES = new Set(['owner','admin']);
const fileInput = document.getElementById('file');
const importButton = document.getElementById('import');
const authNode = document.getElementById('auth');
const statusNode = document.getElementById('status');
const summaryNode = document.getElementById('summary');
const expiryNode = document.getElementById('expiry');
const barNode = document.getElementById('bar');
let bundle = null;
let running = false;

const clean = value => value === '' || value === undefined ? null : value;
const safeName = value => String(value || 'document').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0,120) || 'document';
const setStatus = (text, error = false) => { statusNode.textContent = text; statusNode.classList.toggle('error', error); };
const progress = (done, total) => { barNode.style.width = `${total ? Math.min(100, Math.round(done / total * 100)) : 0}%`; };

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || {};
}

async function upsert(table, value, onConflict = 'id') {
  const { error } = await supabase.from(table).upsert(value, { onConflict });
  if (error) throw error;
}

function clientNotes(c) {
  const parts = [];
  if (c.is_veteran === true) parts.push('Veteran: Yes');
  else if (c.is_veteran === false) parts.push('Veteran: No');
  if (c.is_smoker === true) parts.push('Smoker: Yes');
  else if (c.is_smoker === false) parts.push('Smoker: No');
  if (c.height_inches != null) parts.push(`Height: ${c.height_inches} in`);
  if (c.weight_lbs != null) parts.push(`Weight: ${c.weight_lbs} lb`);
  const original = String(c.notes || '').trim();
  return [original, parts.join(' • ')].filter(Boolean).join('\n') || null;
}

function verificationType(destination) {
  const value = String(destination || '').trim();
  if (!value) return '';
  if (value.includes('@')) return 'email';
  if (value.replace(/\D/g,'').length >= 7) return 'text';
  return '';
}

async function importRecord(record, actorId) {
  const c = record.client || {};
  const clientId = c.id;
  const products = [];
  if (c.is_medicare) products.push('medicare');
  if (c.is_life) products.push('life');
  if (c.is_retirement) products.push('retirement');
  await upsert('clients', {
    id: clientId,
    assigned_agent_id: actorId,
    first_name: c.first_name || '', last_name: c.last_name || '', date_of_birth: clean(c.date_of_birth), gender: clean(c.gender),
    email: clean(c.email), phone: clean(c.phone), address1: clean(c.address_line1), city: clean(c.city), county: clean(c.county), state: clean(c.state), zip_code: clean(c.zip_code),
    drivers_license_number: clean(record.sensitive?.drivers_license), drivers_license_expiration: clean(c.drivers_license_expiration), drivers_license_state: clean(c.drivers_license_state),
    products, status: c.is_deceased ? 'deceased' : 'active', notes: clientNotes(c), created_at: c.created_at, updated_at: c.updated_at
  });

  const m = record.medicare;
  if (m) await upsert('medicare_details', {
    client_id: clientId, part_a_date: clean(m.part_a_date), part_b_date: clean(m.part_b_date), medicaid_level: clean(m.medicaid_level),
    medicaid_number: null, created_at: m.created_at, updated_at: m.updated_at
  }, 'client_id');

  const care = record.care;
  if (care?.primary_doctor_name) await upsert('client_doctors', {
    id: care.id, client_id: clientId, doctor_name: care.primary_doctor_name, specialty: 'Primary Care', city: clean(care.primary_doctor_city), state: clean(care.primary_doctor_state),
    created_at: care.created_at, updated_at: care.updated_at
  });
  if (care && (care.pharmacy_name || care.pharmacy_city || care.pharmacy_state)) await upsert('client_pharmacies', {
    client_id: clientId, pharmacy_name: clean(care.pharmacy_name), pharmacy_location: [care.pharmacy_city, care.pharmacy_state].filter(Boolean).join(', ') || null,
    created_at: care.created_at, updated_at: care.updated_at
  }, 'client_id');

  for (const d of record.specialists || []) await upsert('client_doctors', {
    id: d.id, client_id: clientId, doctor_name: d.doctor_name || '', specialty: clean(d.specialty), city: clean(d.city), state: clean(d.state), created_at: d.created_at, updated_at: d.updated_at
  });
  for (const md of record.medications || []) {
    const noteParts = [];
    if (md.quantity_filled) noteParts.push(`Quantity filled: ${md.quantity_filled}`);
    if (md.refill_count) noteParts.push(`Refills: ${md.refill_count}`);
    await upsert('client_medications', {
      id: md.id, client_id: clientId, medication_name: md.medication_name || '', dosage: clean(md.dosage), frequency: clean(md.times_per_day), notes: noteParts.join(' • ') || null,
      status: 'active', created_at: md.created_at, updated_at: md.updated_at
    });
  }
  for (const lp of record.life_insurance || []) await upsert('life_policies', {
    id: lp.id, client_id: clientId, carrier: clean(lp.company_name), policy_type: clean(lp.policy_type), face_amount: lp.face_amount ?? null, premium: lp.premium_amount ?? null,
    effective_date: clean(lp.effective_date), status: 'active', created_at: lp.created_at, updated_at: lp.updated_at
  });
  for (const hp of record.health_plans || []) await upsert('health_plans', {
    id: hp.id, client_id: clientId, carrier: clean(hp.company_name), plan_id: clean(hp.plan_id), member_id: clean(hp.member_id), effective_date: clean(hp.effective_date),
    status: 'active', created_at: hp.created_at, updated_at: hp.updated_at
  });
  for (const hi of record.hospital_indemnity || []) await upsert('hospital_indemnity_plans', {
    id: hi.id, client_id: clientId, carrier: clean(hi.company_name), premium: hi.premium_amount ?? null, effective_date: clean(hi.effective_date),
    status: 'active', created_at: hi.created_at, updated_at: hi.updated_at
  });

  const sensitive = {
    ssn: String(record.sensitive?.ssn || '').trim(), medicare_number: String(m?.medicare_number || '').trim(), medicaid_number: String(m?.medicaid_number || '').trim()
  };
  if (sensitive.ssn || sensitive.medicare_number || sensitive.medicaid_number) await invoke('client-sensitive', { action: 'save', client_id: clientId, sensitive });

  if (m) {
    const destination = String(m.medicare_gov_verification_destination || '').trim();
    const credentials = {
      username: String(m.medicare_gov_username || '').trim(), password: String(m.medicare_gov_password || ''), verification_type: verificationType(destination),
      verification_destination: destination, security_answer: String(m.medicare_gov_security_answer || '')
    };
    if (credentials.username || credentials.password || credentials.verification_destination || credentials.security_answer) {
      await invoke('medicare-gov-credentials', { action: 'save', client_id: clientId, credentials });
    }
  }

  const b = record.banking;
  if (b) {
    const method = b.card_number ? 'card' : 'bank';
    const banking = {
      payment_method: method, bank_name: String(b.bank_name || ''), routing_number: String(b.routing_number || ''), account_number: String(b.account_number || ''),
      card_number: String(b.card_number || ''), card_expiration: String(b.card_expiration || ''), card_notes: ''
    };
    await invoke('client-banking', { action: 'save', client_id: clientId, banking });
  }
}

async function copyDocument(doc, actorId) {
  const { data: existing, error: lookupError } = await supabase.from('documents').select('id,storage_path').eq('id', doc.id).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing?.id) return { skipped: true };
  const response = await fetch(doc.signed_url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${doc.file_name}: source download returned ${response.status}`);
  const blob = await response.blob();
  if (blob.size > 25 * 1024 * 1024) throw new Error(`${doc.file_name}: larger than M&H 25 MB document limit.`);
  const path = `${doc.client_id}/mayer-migration-${doc.id}-${safeName(doc.file_name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, cacheControl: '3600', contentType: doc.mime_type || blob.type || 'application/octet-stream' });
  if (uploadError) throw uploadError;
  try {
    const { error } = await supabase.from('documents').insert({
      id: doc.id, client_id: doc.client_id, uploaded_by: actorId, category: doc.document_type || 'other', file_name: doc.file_name,
      storage_path: path, mime_type: doc.mime_type || blob.type || null, file_size: blob.size, created_at: doc.created_at
    });
    if (error) throw error;
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return { skipped: false };
}

async function runPool(items, worker, concurrency, onProgress) {
  let next = 0, done = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index], index);
      done += 1;
      onProgress?.(done, items.length, items[index]);
    }
  });
  await Promise.all(runners);
}

fileInput.addEventListener('change', async () => {
  bundle = null; importButton.disabled = true; summaryNode.hidden = true; expiryNode.hidden = true; progress(0,1);
  const file = fileInput.files?.[0]; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.format !== 'mayer-to-mh-migration-v1' || !Array.isArray(parsed.records)) throw new Error('This is not a valid Mayer → M&H migration file.');
    if (String(parsed.source?.agent_name || '').toLowerCase() !== 'justin mayer') throw new Error('This export is not scoped to Justin Mayer.');
    bundle = parsed;
    const counts = parsed.counts || {};
    summaryNode.innerHTML = [
      ['Clients',counts.clients ?? parsed.records.length],['Medicare',counts.medicare ?? '—'],['Life policies',counts.life_insurance ?? '—'],['Doctors',counts.specialists ?? '—'],['Documents',counts.documents ?? '—'],['Warnings',counts.warnings ?? 0]
    ].map(([label,value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
    summaryNode.hidden = false;
    const expires = new Date(parsed.document_links_expire_at);
    if (!Number.isNaN(expires.valueOf())) { expiryNode.textContent = `Source document links expire ${expires.toLocaleString()}. Start the import before then.`; expiryNode.hidden = false; }
    setStatus(`Validated ${parsed.records.length} Justin Mayer client records. Ready to import.`);
    importButton.disabled = false;
  } catch (error) { setStatus(error?.message || 'Unable to read migration file.', true); }
});

importButton.addEventListener('click', async () => {
  if (!bundle || running) return;
  running = true; importButton.disabled = true; fileInput.disabled = true;
  const failures = [];
  try {
    const actorId = mhRepository.user.id;
    const records = bundle.records;
    let structuredDone = 0;
    for (const record of records) {
      try { await importRecord(record, actorId); }
      catch (error) { failures.push(`Client ${record.client?.first_name || ''} ${record.client?.last_name || ''}: ${error?.message || error}`); }
      structuredDone += 1;
      progress(structuredDone, records.length + Number(bundle.counts?.documents || 0));
      setStatus(`Client data: ${structuredDone}/${records.length}. ${failures.length ? `${failures.length} issue(s) logged.` : 'No issues so far.'}`);
    }

    const docs = records.flatMap(record => (record.documents || []).map(doc => ({ ...doc, client_id: record.client.id })));
    let docsDone = 0;
    await runPool(docs, async doc => {
      try { await copyDocument(doc, actorId); }
      catch (error) { failures.push(`Document ${doc.file_name}: ${error?.message || error}`); }
    }, 4, done => {
      docsDone = done;
      progress(records.length + done, records.length + docs.length);
      setStatus(`Client data complete: ${records.length}/${records.length}. Documents: ${done}/${docs.length}. ${failures.length ? `${failures.length} issue(s) logged.` : 'No issues so far.'}`);
    });

    if (failures.length) {
      setStatus(`Import finished with ${failures.length} issue(s). Successful records were kept.\n\n${failures.slice(0,25).join('\n')}${failures.length > 25 ? `\n…and ${failures.length-25} more.` : ''}`, true);
    } else {
      setStatus(`IMPORT COMPLETE\n${records.length} clients imported and ${docs.length} documents copied into M&H. Protected identifiers and banking information were saved through M&H encrypted secure storage.`);
    }
  } catch (error) { setStatus(error?.message || 'Migration stopped unexpectedly.', true); }
  finally { running = false; importButton.disabled = false; fileInput.disabled = false; }
});

(async () => {
  try {
    const ok = await mhRepository.initialize();
    if (!ok || !mhRepository.user) { authNode.textContent = 'Not signed in to M&H. Open the main CRM, sign in, then return to this page.'; authNode.classList.add('error'); return; }
    if (!OWNER_ROLES.has(String(mhRepository.profile?.role || '').toLowerCase())) { authNode.textContent = 'This migration requires an M&H Owner/Admin account.'; authNode.classList.add('error'); return; }
    authNode.textContent = `Signed in as ${mhRepository.profile?.full_name || 'M&H Owner'} (${mhRepository.profile?.role}).`;
    fileInput.disabled = false;
  } catch (error) { authNode.textContent = error?.message || 'Unable to verify M&H login.'; authNode.classList.add('error'); }
})();
