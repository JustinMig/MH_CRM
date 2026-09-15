import { getClient, requireCrmUser, sendClientSms } from '../server/communications.js';

export async function POST(request) {
  try {
    const user = await requireCrmUser(request);
    const payload = await request.json().catch(() => ({}));
    const client = await getClient(payload.clientId);
    if (!client) return Response.json({ error: 'Client not found.' }, { status: 404 });
    const result = await sendClientSms(client, user.id, payload.body);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to send text.' }, { status });
  }
}
