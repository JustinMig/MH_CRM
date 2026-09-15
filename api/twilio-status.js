import { adminRest, publicRequestUrl, validateTwilioRequest } from '../server/communications.js';

export async function POST(request) {
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const signature = request.headers.get('x-twilio-signature');
  if (!validateTwilioRequest(publicRequestUrl(request), params, signature)) {
    return new Response('Invalid Twilio signature', { status: 403 });
  }

  const sid = String(params.get('MessageSid') || params.get('SmsSid') || '').trim();
  if (!sid) return new Response('OK', { status: 200 });
  const status = String(params.get('MessageStatus') || params.get('SmsStatus') || '').trim();
  const errorCode = String(params.get('ErrorCode') || '').trim();
  const errorMessage = String(params.get('ErrorMessage') || '').trim();

  try {
    await adminRest(`/rest/v1/client_sms_messages?twilio_message_sid=eq.${encodeURIComponent(sid)}`, {
      method: 'PATCH',
      body: {
        ...(status ? { status } : {}),
        error_code: errorCode || null,
        error_message: errorMessage || null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      prefer: 'return=minimal'
    });
  } catch (error) {
    console.error('M&H Twilio status update failed', { sid, message: error instanceof Error ? error.message : 'unknown error' });
    return new Response('Status update failed', { status: 500 });
  }
  return new Response('OK', { status: 200 });
}
