import { mhRepository, supabase } from './supabase-repository.js';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your M&H CRM session expired. Sign in again.');
  return { Authorization: `Bearer ${session.access_token}` };
}

async function calendarRequest(method, params = {}, body) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  const headers = await authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/calendar-events${query.size ? `?${query}` : ''}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Shared Justin calendar request failed.');
  return payload;
}

export function installMayerJustinCalendar() {
  if (mhRepository.__mayerJustinCalendarInstalled) return;
  mhRepository.__mayerJustinCalendarInstalled = true;

  mhRepository.listEvents = async function({ start, end, includeToday = false, includeReschedule = false }) {
    const payload = await calendarRequest('GET', {
      start,
      end,
      includeToday: includeToday ? '1' : '',
      includeReschedule: includeReschedule ? '1' : ''
    });
    return Array.isArray(payload.events) ? payload.events : [];
  };

  mhRepository.saveEvent = async function(value) {
    const payload = {
      client_id: value.client_id || null,
      assigned_agent_id: this.user?.id || value.assigned_agent_id || null,
      title: String(value.title || '').trim() || `Appointment: ${value.person_name || 'Client'}`,
      event_type: value.event_type || 'appointment',
      event_date: value.event_date,
      start_time: value.start_time || null,
      end_time: value.end_time || null,
      notes: value.notes || null,
      status: value.status || 'scheduled'
    };
    const eventId = value.event_id || value.id || '';
    const result = eventId
      ? await calendarRequest('PATCH', { id: eventId }, payload)
      : await calendarRequest('POST', {}, payload);
    return result.event;
  };

  mhRepository.deleteEvent = async function(eventId) {
    if (!eventId) throw new Error('Missing calendar event ID.');
    return calendarRequest('DELETE', { id: eventId });
  };

  mhRepository.completeEvent = async function(eventId) {
    const result = await calendarRequest('PATCH', { id: eventId }, { action: 'complete' });
    return result.event;
  };

  mhRepository.rescheduleEvent = async function(eventId, note) {
    const result = await calendarRequest('PATCH', { id: eventId }, { action: 'reschedule', note });
    return result.event;
  };

  window.MHCalendarSync = {
    source: 'Mayer CRM · Justin calendar',
    refresh() {
      if (location.hash.startsWith('#/dashboard') || location.hash.startsWith('#/appointments')) {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    }
  };

  window.addEventListener('focus', () => {
    if (document.querySelector('dialog[open]')) return;
    window.MHCalendarSync.refresh();
  });
}
