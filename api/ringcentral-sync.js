import { adminRest, requireCrmUser } from '../server/communications.js';

const MAYER_CALL_BRIDGE = 'https://crm.mayerig.com/api/mh-ringcentral/calls';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanCall(row) {
  if (!row || !UUID.test(String(row.client_id || '')) || !row.source_call_id) return null;
  const direction = row.direction === 'Inbound' ? 'Inbound' : row.direction === 'Outbound' ? 'Outbound' : null;
  if (!direction) return null;
  const started = new Date(row.started_at || '');
  if (Number.isNaN(started.getTime())) return null;
  return {
    client_id: String(row.client_id),
    source_call_id: String(row.source_call_id),
    direction,
    result: row.result ? String(row.result) : null,
    started_at: started.toISOString(),
    duration_seconds: Math.max(0, Math.round(Number(row.duration_seconds || 0))),
    contact_phone: row.contact_phone ? String(row.contact_phone) : null,
    from_phone: row.from_phone ? String(row.from_phone) : null,
    to_phone: row.to_phone ? String(row.to_phone) : null,
    recording_id: row.recording_id ? String(row.recording_id) : null,
    source: 'mayer_ringcentral',
    updated_at: new Date().toISOString()
  };
}

export async function GET(request) {
  try {
    await requireCrmUser(request);
    const authorization = request.headers.get('authorization') || '';
    const response = await fetch(MAYER_CALL_BRIDGE, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || 'Unable to read RingCentral call data from Mayer CRM.'), { status: response.status });

    const calls = Array.isArray(payload.calls) ? payload.calls.map(cleanCall).filter(Boolean) : [];
    for (let i = 0; i < calls.length; i += 100) {
      await adminRest('/rest/v1/ringcentral_calls?on_conflict=source_call_id', {
        method: 'POST',
        body: calls.slice(i, i + 100),
        prefer: 'resolution=merge-duplicates,return=minimal'
      });
    }

    return Response.json({ ok: true, matched: calls.length, recordings: calls.filter(call => call.recording_id).length });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return Response.json({ error: error instanceof Error ? error.message : 'RingCentral call sync failed.' }, { status });
  }
}
