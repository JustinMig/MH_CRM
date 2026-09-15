export function GET() {
  const twilioReady = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_MESSAGING_SERVICE_SID &&
    process.env.TWILIO_PHONE_NUMBER
  );
  const databaseServerReady = Boolean(
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  return Response.json({ twilioReady, databaseServerReady });
}
