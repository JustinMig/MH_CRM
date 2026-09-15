import { supabase } from './supabase-repository.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
const pad = value => String(value).padStart(2, '0');
const localKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
const addDays = (date, days) => { const next = startOfDay(date); next.setDate(next.getDate() + days); return next; };
const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
const parseDate = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
};
const personName = row => `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Client';
const dateLabel = date => date.toLocaleDateString('en-US', { month:'short', day:'numeric' });
const timeLabel = value => {
  const match = /^(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!match) return '';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
};

function birthdayOccurrence(dob, today) {
  const year = today.getFullYear();
  let next = new Date(year, dob.getMonth(), dob.getDate(), 12);
  if (next < startOfDay(today)) next = new Date(year + 1, dob.getMonth(), dob.getDate(), 12);
  return next;
}

function turn65Date(dob) {
  return new Date(dob.getFullYear() + 65, dob.getMonth(), dob.getDate(), 12);
}

function itemMarkup(item) {
  const action = item.action ? ` data-na-action="${esc(item.action)}"` : '';
  const id = item.id ? ` data-na-id="${esc(item.id)}"` : '';
  const name = item.name ? ` data-na-name="${esc(item.name)}"` : '';
  return `<button type="button" class="needs-item"${action}${id}${name}>
    <span class="needs-dot ${esc(item.tone || 'neutral')}"></span>
    <span class="needs-copy"><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></span>
    ${item.meta ? `<span class="needs-meta">${esc(item.meta)}</span>` : ''}
  </button>`;
}

function sectionMarkup(key, title, items, emptyText) {
  return `<section class="needs-section needs-${key}">
    <header><div><span>${esc(title)}</span><strong>${items.length}</strong></div></header>
    <div class="needs-list">${items.length ? items.slice(0, 6).map(itemMarkup).join('') : `<p class="needs-empty">${esc(emptyText)}</p>`}</div>
  </section>`;
}

function shellMarkup() {
  return `<section class="needs-attention" data-needs-attention>
    <div class="needs-head"><div><span class="eyebrow">DAILY COMMAND CENTER</span><h2>Needs Attention</h2><p>What needs your attention now, what is overdue, and what is coming up.</p></div><button type="button" class="needs-refresh" data-needs-refresh aria-label="Refresh Needs Attention">↻</button></div>
    <div class="needs-status" data-needs-status>Loading your priorities…</div>
    <div class="needs-grid" data-needs-grid hidden></div>
  </section>`;
}

async function loadData(widget) {
  const status = widget.querySelector('[data-needs-status]');
  const grid = widget.querySelector('[data-needs-grid]');
  status.hidden = false;
  status.textContent = 'Loading your priorities…';
  grid.hidden = true;

  const today = startOfDay(new Date());
  const todayKey = localKey(today);
  const pastKey = localKey(addDays(today, -30));
  const future14Key = localKey(addDays(today, 14));

  try {
    const [appointmentsResult, leadsResult, clientsResult] = await Promise.all([
      supabase.from('appointments').select('id,client_id,title,event_type,event_date,start_time,status').gte('event_date', pastKey).lte('event_date', future14Key).order('event_date').order('start_time'),
      supabase.from('workspace_leads').select('id,first_name,last_name,phone,status,client_id,created_at,is_medicare,is_life,is_retirement').eq('status', 'lead').order('created_at', { ascending:false }).limit(100),
      supabase.from('clients').select('id,first_name,last_name,date_of_birth,phone,products,status').neq('status', 'deceased').order('last_name').limit(1000)
    ]);
    for (const result of [appointmentsResult, leadsResult, clientsResult]) if (result.error) throw result.error;

    const appointments = appointmentsResult.data || [];
    const leads = leadsResult.data || [];
    const clients = clientsResult.data || [];
    const todayItems = [];
    const overdueItems = [];
    const upcomingItems = [];

    for (const appt of appointments) {
      const date = parseDate(appt.event_date);
      if (!date || ['completed','cancelled'].includes(String(appt.status || '').toLowerCase())) continue;
      const diff = dayDiff(date, today);
      const item = {
        title: appt.title || 'Appointment',
        detail: diff === 0 ? `${timeLabel(appt.start_time) || 'Today'}${appt.event_type ? ` · ${appt.event_type}` : ''}` : `${dateLabel(date)}${timeLabel(appt.start_time) ? ` · ${timeLabel(appt.start_time)}` : ''}`,
        meta: diff < 0 ? `${Math.abs(diff)}d late` : diff === 0 ? 'Today' : `in ${diff}d`,
        tone: diff < 0 ? 'danger' : diff === 0 ? 'today' : 'upcoming',
        action: appt.client_id ? 'client-id' : '', id: appt.client_id || ''
      };
      if (diff < 0) overdueItems.push(item);
      else if (diff === 0) todayItems.push(item);
      else if (diff <= 7) upcomingItems.push(item);
    }

    for (const lead of leads) {
      const created = new Date(lead.created_at);
      if (Number.isNaN(created.getTime())) continue;
      const age = dayDiff(today, created);
      const product = lead.is_medicare ? 'Medicare' : lead.is_life ? 'Life' : lead.is_retirement ? 'Retirement' : 'Lead';
      const item = {
        title: personName(lead),
        detail: `${product} lead${lead.phone ? ` · ${lead.phone}` : ''}`,
        meta: age <= 0 ? 'New' : `${age}d old`,
        tone: age >= 3 ? 'danger' : 'today',
        action:'lead', id:lead.id, name:personName(lead)
      };
      if (age <= 0) todayItems.push(item);
      else if (age >= 3) overdueItems.push(item);
    }

    for (const client of clients) {
      const dob = parseDate(client.date_of_birth);
      if (!dob) continue;
      const birthday = birthdayOccurrence(dob, today);
      const birthdayDiff = dayDiff(birthday, today);
      if (birthdayDiff >= 0 && birthdayDiff <= 7) {
        upcomingItems.push({
          title: `${personName(client)} — Birthday`,
          detail: `${dateLabel(birthday)} · turning ${birthday.getFullYear() - dob.getFullYear()}`,
          meta: birthdayDiff === 0 ? 'Today' : `in ${birthdayDiff}d`,
          tone:'birthday', action:'client', id:client.id, name:personName(client)
        });
      }
      const t65 = turn65Date(dob);
      const t65Diff = dayDiff(t65, today);
      if (t65Diff >= 0 && t65Diff <= 90) {
        upcomingItems.push({
          title: `${personName(client)} — Turning 65`,
          detail: `${dateLabel(t65)} · Medicare opportunity`,
          meta: t65Diff === 0 ? 'Today' : `in ${t65Diff}d`,
          tone:'t65', action:'client', id:client.id, name:personName(client)
        });
      }
    }

    overdueItems.sort((a,b) => Number.parseInt(b.meta) - Number.parseInt(a.meta));
    upcomingItems.sort((a,b) => Number.parseInt(a.meta.replace(/\D/g,'')) - Number.parseInt(b.meta.replace(/\D/g,'')));

    grid.innerHTML = sectionMarkup('today', 'Today', todayItems, 'Nothing urgent for today.') +
      sectionMarkup('overdue', 'Overdue', overdueItems, 'No overdue appointments or aging leads.') +
      sectionMarkup('upcoming', 'Upcoming', upcomingItems, 'Nothing coming up in the next few days.');
    status.hidden = true;
    grid.hidden = false;
  } catch (error) {
    status.hidden = false;
    status.textContent = error?.message || 'Needs Attention could not load.';
    grid.hidden = true;
  }
}

function openClientSearch(name) {
  location.hash = '#/clients';
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    const form = document.querySelector('#client-search');
    if (form) {
      clearInterval(timer);
      const input = form.elements.namedItem('query');
      if (input) input.value = name || '';
      form.requestSubmit();
    } else if (tries > 25) clearInterval(timer);
  }, 120);
}

function bindWidget(widget) {
  widget.querySelector('[data-needs-refresh]')?.addEventListener('click', () => loadData(widget));
  widget.addEventListener('click', event => {
    const item = event.target.closest?.('[data-na-action]');
    if (!item) return;
    const action = item.dataset.naAction;
    if (action === 'lead') document.querySelector('[data-tool="leads"]')?.click();
    else if (action === 'client' || action === 'client-id') openClientSearch(item.dataset.naName || '');
  });
}

function installWidget() {
  const app = document.getElementById('app');
  if (!app) return;
  const heading = app.querySelector('.page-heading h1');
  if (heading?.textContent.trim() !== 'Dashboard') return;
  const content = app.querySelector('.content');
  if (!content || content.querySelector('[data-needs-attention]')) return;
  const anchor = content.querySelector('#calendar-host') || content.querySelector('.metric-grid') || heading.closest('.page-heading')?.nextElementSibling;
  const wrap = document.createElement('div');
  wrap.innerHTML = shellMarkup();
  const widget = wrap.firstElementChild;
  if (anchor) content.insertBefore(widget, anchor);
  else content.append(widget);
  bindWidget(widget);
  loadData(widget);
}

const app = document.getElementById('app');
if (app) {
  installWidget();
  new MutationObserver(mutations => {
    const relevant = mutations.some(mutation => [...mutation.addedNodes].some(node => node instanceof Element && (node.matches?.('.page-heading, #calendar-host') || node.querySelector?.('.page-heading, #calendar-host'))));
    if (relevant) queueMicrotask(installWidget);
  }).observe(app, { childList:true, subtree:true });
}
