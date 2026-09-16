import { supabase } from './supabase-repository.js';

export const SMS_SYNC_COOLDOWN_MS = 120000;
const inFlight = new Map();
const attemptedAt = new Map();
const completedAt = new Map();
export async function smsAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your Mayer MIG CRM session expired. Sign in again.');
  return { Authorization: `Bearer ${session.access_token}` };
}
// One shared scheduler for the Communications center and all client threads.
export function syncSms(clientId = '', { force = false } = {}) {
  const key = clientId || '*';
  if (inFlight.has('*')) return inFlight.get('*');
  if (inFlight.has(key)) return inFlight.get(key);
  const now = Date.now();
  const lastAttempt = attemptedAt.get(key) || 0;
  if (now - lastAttempt < (force ? 5000 : SMS_SYNC_COOLDOWN_MS) ||
      (!force && now - (completedAt.get('*') || 0) < SMS_SYNC_COOLDOWN_MS)) {
    return Promise.resolve({ skipped: true });
  }
  attemptedAt.set(key, now);
  const job = (async () => {
    const headers = await smsAuthHeaders();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const suffix = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const response = await fetch(`/api/twilio-sync${suffix}`, { headers, cache: 'no-store', signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Text message sync failed.');
      completedAt.set(key, Date.now());
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('The text sync took too long. Your saved messages are still available.');
      throw error;
    } finally { clearTimeout(timer); }
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}
