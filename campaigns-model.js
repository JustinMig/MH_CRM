/** Campaigns have one Contact stage. Outcomes are not sequential workflow steps. */
export const CONTACT_OUTCOMES = Object.freeze([
  ['no_answer', 'No Answer'], ['voicemail', 'Voicemail Left'], ['declined', 'Declined'],
  ['appointment', 'Appointment'], ['follow_up', 'Follow Up / More Info Needed']
]);
export const CAMPAIGN_TOPICS = Object.freeze([
  ['general', 'General Client Review'], ['medicare', 'Medicare'], ['life', 'Life'],
  ['health', 'Health'], ['retirement', 'Retirement'], ['other', 'Other']
]);
export const isScheduledOutcome = value => value === 'appointment' || value === 'follow_up';
export const outcomeLabel = value => CONTACT_OUTCOMES.find(([key]) => key === value)?.[1] || 'Not Contacted';
export const fullName = client => [client?.first_name, client?.last_name].filter(Boolean).join(' ').trim() || 'Client';
const centralDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
const centralStamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
export function campaignToday(now = new Date()) {
  const p = Object.fromEntries(centralDay.formatToParts(now).map(v => [v.type, v.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function campaignTimestamp(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? centralStamp.format(date) : 'Not yet';
}
export function timeMinutes(value) {
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(value || ''));
  return match && +match[1] < 24 && +match[2] < 60 ? +match[1] * 60 + +match[2] : null;
}
export function minuteTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
export const appointmentSlots = () => Array.from({ length: 25 }, (_, i) => minuteTime(480 + i * 30));
export function slotIsBooked(time, duration, events, excludedId = '') {
  const start = timeMinutes(time), end = start === null ? null : start + Number(duration);
  if (start === null || !Number.isFinite(end) || end > 1440 || end <= start) return true;
  return events.some(event => {
    if (event.id === excludedId || (event.status && event.status !== 'scheduled')) return false;
    const from = timeMinutes(event.start_time);
    if (from === null) return true; // An all-day scheduled event blocks the day.
    const parsedEnd = timeMinutes(event.end_time);
    const to = parsedEnd !== null && parsedEnd > from ? parsedEnd : from + 30;
    return start < to && end > from;
  });
}
export function safeSearchPattern(value) {
  const term = String(value || '').replace(/[%_*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return term ? JSON.stringify(`%${term}%`) : '';
}
export function memberOrders(sort = 'name', direction = 'asc') {
  const asc = direction !== 'desc';
  const fields = { name: 'last_name_sort', state: 'state_sort', county: 'county_sort', added: 'added_at', activity: 'last_contacted_at', due: 'next_event_date' };
  const first = fields[sort] || fields.name;
  return [[first, asc], ...['last_name_sort', 'first_name_sort', 'id'].filter(k => k !== first).map(k => [k, true])];
}
