import { adminRest } from '../server/communications.js';

export async function GET() {
  const twilioReady = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_MESSAGING_SERVICE_SID &&
    process.env.TWILIO_PHONE_NUMBER
  );
  const databaseServerReady = Boolean(process.env.SUPABASE_SECRET_KEY);
  let databaseAuthenticated = false;
  let twilioAuthenticated = false;

  if (databaseServerReady) {
    try {
      await adminRest('/rest/v1/profiles?select=id&limit=1');
      databaseAuthenticated = true;
    } catch {}
  }

  if (twilioReady) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID.trim();
      const token = process.env.TWILIO_AUTH_TOKEN.trim();
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
        cache: 'no-store'
      });
      twilioAuthenticated = response.ok;
    } catch {}
  }

  return Response.json({ twilioReady, databaseServerReady, databaseAuthenticated, twilioAuthenticated });
}
