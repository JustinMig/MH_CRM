import { adminRest, requireCrmUser } from '../server/communications.js';

const MAYER_RECORDING_BRIDGE = 'https://crm.mayerig.com/api/mh-ringcentral/recordings';

export async function GET(request) {
  try {
    await requireCrmUser(request);
    const url = new URL(request.url);
    const recordingId = String(url.searchParams.get('id') || '').trim();
    if (!recordingId) return Response.json({ error: 'Missing recording ID.' }, { status: 400 });

    const rows = await adminRest(`/rest/v1/ringcentral_calls?recording_id=eq.${encodeURIComponent(recordingId)}&hidden_at=is.null&select=id,recording_id&limit=1`);
    if (!Array.isArray(rows) || !rows[0]) return Response.json({ error: 'Recording is not linked to a visible M&H client call.' }, { status: 404 });

    const authorization = request.headers.get('authorization') || '';
    const source = await fetch(`${MAYER_RECORDING_BRIDGE}/${encodeURIComponent(recordingId)}`, {
      headers: { Authorization: authorization },
      cache: 'no-store'
    });
    if (!source.ok) {
      const payload = await source.json().catch(() => ({}));
      return Response.json({ error: payload.error || 'Unable to load recording.' }, { status: source.status });
    }

    const headers = new Headers();
    headers.set('Content-Type', source.headers.get('content-type') || 'audio/mpeg');
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Content-Disposition', `inline; filename="ringcentral-${recordingId}.mp3"`);
    return new Response(source.body, { status: 200, headers });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to play recording.' }, { status });
  }
}
