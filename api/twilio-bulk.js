import { getClients, requireCrmUser, sendClientSms } from '../server/communications.js';

const MAX_RECIPIENTS = 250;
const CONCURRENCY = 10;

async function runPool(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { ok: true, value: await worker(items[index], index) }; }
      catch (error) { results[index] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, next));
  return results;
}

export async function POST(request) {
  try {
    const user = await requireCrmUser(request);
    const payload = await request.json().catch(() => ({}));
    const ids = Array.from(new Set(Array.isArray(payload.clientIds) ? payload.clientIds.map(String).filter(Boolean) : [])).slice(0, MAX_RECIPIENTS);
    const body = String(payload.body || '').trim();
    if (!ids.length) return Response.json({ error: 'Choose at least one client.' }, { status: 400 });
    if (!body) return Response.json({ error: 'Enter a message.' }, { status: 400 });
    if (body.length > 1500) return Response.json({ error: 'Message is too long.' }, { status: 400 });

    const clients = await getClients(ids);
    const found = new Set(clients.map(client => client.id));
    const failures = ids.filter(id => !found.has(id)).map(() => 'One selected client could not be found.');
    const results = await runPool(clients, client => sendClientSms(client, user.id, body));
    let sent = 0;
    results.forEach((result, index) => {
      if (result.ok) sent += 1;
      else {
        const client = clients[index];
        const name = [client?.first_name, client?.last_name].filter(Boolean).join(' ') || 'Client';
        failures.push(`${name}: ${result.error instanceof Error ? result.error.message : 'send failed'}`);
      }
    });

    return Response.json({
      ok: failures.length === 0,
      requested: ids.length,
      sent,
      failed: failures.length,
      failures: failures.slice(0, 20)
    }, { status: sent ? 200 : 502 });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to send mass text.' }, { status });
  }
}
