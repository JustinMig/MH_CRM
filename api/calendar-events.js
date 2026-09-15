import { requireCrmUser } from '../server/communications.js';

const MAYER_CALENDAR_BRIDGE = 'https://crm.mayerig.com/api/mh-calendar/events';

async function proxyCalendar(request) {
  try {
    await requireCrmUser(request);
    const sourceUrl = new URL(request.url);
    const target = new URL(MAYER_CALENDAR_BRIDGE);
    for (const [key, value] of sourceUrl.searchParams) target.searchParams.set(key, value);

    const authorization = request.headers.get('authorization') || '';
    const method = request.method || 'GET';
    const body = ['POST','PATCH'].includes(method) ? await request.text() : undefined;
    const response = await fetch(target, {
      method,
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body,
      cache: 'no-store'
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'private, no-store' }
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to access shared Justin calendar.' }, { status });
  }
}

export const GET = proxyCalendar;
export const POST = proxyCalendar;
export const PATCH = proxyCalendar;
export const DELETE = proxyCalendar;
