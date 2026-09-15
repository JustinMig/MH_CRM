import { getClient, requireCrmUser, syncClientMessages, syncRecentMessages } from '../server/communications.js';

export async function GET(request) {
  try {
    const user = await requireCrmUser(request);
    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId') || '';
    if (clientId) {
      const client = await getClient(clientId);
      if (!client) return Response.json({ error: 'Client not found.' }, { status: 404 });
      const result = await syncClientMessages(client, user.id);
      return Response.json({ ok: true, scope: 'client', ...result });
    }
    const result = await syncRecentMessages(user.id);
    return Response.json({ ok: true, scope: 'recent', ...result });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to sync Twilio messages.' }, { status });
  }
}
