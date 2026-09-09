import { NAV, CLIENT_TABS, esc, isoDate, monthDays, todayKey, longDate, timeLabel } from './core.js';

const paths = {
  appointments: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M13 13h3M8 16.5h3M13 16.5h3"/>',
  notes: '<path d="M6.5 3.75h8.9l3.1 3.1v13.4H6.5z"/><path d="M15.4 3.75v3.1h3.1M9 11h7M9 14.5h7M9 18h4.5"/>',
  contacts: '<circle cx="8" cy="8" r="2.7"/><circle cx="16.3" cy="9" r="2.1"/><path d="M3.9 18.5c.5-3 2-4.7 4.1-4.7s3.6 1.7 4.1 4.7M12.8 18.5c.4-2.3 1.6-3.7 3.5-3.7 1.8 0 3 1.4 3.6 3.7"/>',
  build: '<path d="M7 3.5v17M7 6h4M7 10h3M7 14h4M7 18h3M14.3 8.5h4.2l1.5 11h-7.2zM14.8 8.5a1.6 1.6 0 0 1 3.2 0"/>',
  commissions: '<circle cx="12" cy="12" r="8.5"/><path d="M15.2 8.8c-.7-.8-1.7-1.2-3-1.2-1.8 0-3 .9-3 2.2 0 1.4 1.1 2 3.1 2.4 2 .4 2.9 1 2.9 2.3 0 1.4-1.2 2.4-3.2 2.4-1.4 0-2.6-.5-3.4-1.4M12 6v12"/>',
  client: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'
};
export const TOOLS = Object.freeze([
  ['appointments', 'Appointments', 'Appt', 'Set an appointment'],
  ['notes', 'Notes', 'Notes', 'Open dashboard notes'],
  ['contacts', 'Contacts', 'Contacts', 'Find company contacts'],
  ['build', 'Height & Weight', 'H&W', 'Open height and weight underwriting lookup'],
  ['commissions', 'Commissions', 'Comm', 'Open life and Medicare commissions']
]);
export const icon = (key, large = false) => `<span class="tool-icon tool-${key}${large ? ' large' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true">${paths[key] || paths.client}</svg></span>`;
export const empty = (title, copy = '') => `<div class="empty-state"><h3>${esc(title)}</h3>${copy ? `<p>${esc(copy)}</p>` : ''}</div>`;
export const note = text => `<div class="notice">${esc(text)}</div>`;
export const pending = 'The standalone database is not connected. No records have been loaded or saved.';
export const saveFooter = (label = 'Save Changes') => '<span class="dirty-state" data-dirty aria-live="polite">No changes</span><div class="footer-actions"><button type="button" class="btn secondary" data-close>Close</button><button type="button" class="btn primary" data-save="stay">' + esc(label) + '</button></div>';
export const options = (items, selected = '') => items.map(item => {
  const [value, label] = Array.isArray(item) ? item : [item, item];
  return `<option value="${esc(value)}"${String(selected) === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
}).join('');
export function input(name, label, { type = 'text', placeholder = '', required = false, disabled = false, span = false, extra = '' } = {}) {
  return `<label class="field${span ? ' span-all' : ''}"><span>${esc(label)}${required ? ' <span aria-hidden="true">*</span>' : ''}</span><input name="${esc(name)}" type="${type}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${disabled ? 'disabled' : ''} ${extra}></label>`;
}
export const dateInput = (name, label, required = false) => input(name, label, { placeholder: 'MM/DD/YYYY', required, extra: 'data-date inputmode="numeric" maxlength="10"' });
export const select = (name, label, items, disabled = false) => `<label class="field"><span>${esc(label)}</span><select name="${esc(name)}" ${disabled ? 'disabled' : ''}>${options(items)}</select></label>`;
export const textArea = (name, label, placeholder = '') => `<label class="field span-all"><span>${esc(label)}</span><textarea name="${esc(name)}" rows="5" placeholder="${esc(placeholder)}"></textarea></label>`;
const group = (title, body, open = false) => `<details class="field-group"${open ? ' open' : ''}><summary>${esc(title)}</summary><div class="form-grid">${body}</div></details>`;
export function clientForm(connected, agents = []) {
  const sensitive = !connected;
  const general = input('first_name', 'First Name', { required: true }) + input('last_name', 'Last Name', { required: true }) +
    dateInput('date_of_birth', 'Date of Birth') + select('gender', 'Gender', [['', 'Select…'], 'Male', 'Female', 'Other', 'Not specified']) +
    input('email', 'Email', { type: 'email' }) + input('phone', 'Phone', { type: 'tel', placeholder: '(###) ###-####' }) +
    input('address', 'Address', { span: true }) + input('city', 'City') + input('county', 'County') + input('state', 'State') + input('zip', 'ZIP Code', { extra: 'inputmode="numeric"' }) +
    select('assigned_agent_id', 'Assigned Agent', [['', connected ? 'Unassigned' : 'No agents connected'], ...agents.map(a => [a.id, a.full_name])], !connected) + input('spouse', 'Spouse') +
    `<fieldset class="product-choices span-all"><legend>Products</legend>${['medicare', 'life', 'retirement'].map(p => `<label><input type="checkbox" name="product_${p}"> ${p[0].toUpperCase() + p.slice(1)}</label>`).join('')}</fieldset>`;
  const identity = (!connected ? '<p class="subtle span-all">Sensitive identifiers stay disabled until authentication and secure storage are connected.</p>' : '') +
    input('ssn', 'Social Security Number', { type: 'password', disabled: sensitive, extra: 'autocomplete="new-password"' }) +
    input('license_number', 'Driver’s License Number', { disabled: sensitive }) + dateInput('license_expiration', 'License Expiration') + input('license_state', 'License State');
  const medicare = input('medicare_number', 'Medicare Number', { disabled: sensitive }) + dateInput('part_a_date', 'Part A Date') + dateInput('part_b_date', 'Part B Date') + input('medicaid_number', 'Medicaid Number', { disabled: sensitive }) +
    select('medicaid_level', 'Medicaid Level', [['', 'Select…'], 'None', 'QMB', 'QMB+', 'SLMB', 'SLMB+', 'QI', 'QDWI', 'FBDE']);
  const health = input('health_carrier', 'Carrier / Original Medicare') + input('health_plan_id', 'Plan ID') + input('health_member_id', 'Member ID') + dateInput('health_effective_date', 'Effective Date') + input('health_premium', 'Monthly Premium', { type: 'number', extra: 'min="0" step="0.01"' });
  const life = input('life_carrier', 'Carrier') + select('life_product', 'Product', [['', 'Select…'], 'Term', 'Whole Life', 'Final Expense', 'Universal Life', 'Indexed Universal Life']) + input('life_policy_number', 'Policy Number') +
    input('life_face_amount', 'Face Amount', { type: 'number', extra: 'min="0" step="0.01"' }) + input('life_premium', 'Premium', { type: 'number', extra: 'min="0" step="0.01"' }) + select('life_frequency', 'Premium Frequency', [['', 'Select…'], 'Monthly', 'Quarterly', 'Semiannual', 'Annual']) + dateInput('life_effective_date', 'Effective Date') + dateInput('life_expiration_date', 'Expiration Date') + input('beneficiary_name', 'Beneficiary') + input('beneficiary_relationship', 'Beneficiary Relationship') + textArea('life_notes', 'Life Notes');
  const retirement = input('retirement_carrier', 'Carrier / Institution') + input('retirement_product', 'Product') + input('retirement_contract', 'Contract Number') + dateInput('retirement_effective_date', 'Effective Date') + input('retirement_contribution', 'Contribution', { type: 'number', extra: 'min="0" step="0.01"' }) + input('retirement_value', 'Account Value', { type: 'number', extra: 'min="0" step="0.01"' }) + textArea('retirement_notes', 'Retirement Notes');
  const panels = {
    information: group('Personal & Contact Information', general, true) + group('Identification', identity),
    medicare: group('Medicare Information', medicare, true) + group('Health Plan Information', health) + note('Medicare cards and Scope of Appointment files belong in Documents.'),
    life: group('Life Policy Information', life, true), retirement: group('Retirement Information', retirement, true),
    documents: `<div class="panel-card"><h3>Client Documents &amp; SOA</h3><p class="subtle">Files, card photos, policy documents, and signed Scopes of Appointment belong to this client.</p><div class="document-actions"><label class="btn secondary disabled">Upload File<input type="file" disabled hidden></label><button type="button" class="btn secondary" disabled>Camera / Scan</button><button type="button" class="btn secondary" disabled>Send SOA</button></div>${empty('Secure storage not connected', 'Uploads and signatures will be enabled after the new storage and signing services are configured.')}</div>`,
    notes: group('Client Notes', textArea('notes', 'Notes', 'Client-specific notes'), true)
  };
  return `<form class="client-form" autocomplete="off" novalidate><nav class="section-tabs" role="tablist" aria-label="Client information sections">${CLIENT_TABS.map(([key, label], i) => `<button type="button" role="tab" id="client-tab-${key}" aria-controls="client-panel-${key}" aria-selected="${i === 0}" tabindex="${i === 0 ? '0' : '-1'}" data-tab="${key}">${label}</button>`).join('')}</nav>${CLIENT_TABS.map(([key, label], i) => `<section role="tabpanel" id="client-panel-${key}" aria-labelledby="client-tab-${key}" data-panel="${key}"${i ? ' hidden' : ''}>${panels[key]}</section>`).join('')}</form>`;
}
export function calendarMarkup(month, events = [], connected = false, agents = []) {
  const days = monthDays(month.getFullYear(), month.getMonth());
  const today = todayKey();
  const todayCount = events.filter(e => e.event_date === today && e.status !== 'completed' && e.status !== 'needs_reschedule').length;
  const pendingCount = events.filter(e => e.status === 'needs_reschedule').length;
  return `<section class="dashboard-calendar"><div class="calendar-queues"><button class="today-queue" type="button" data-queue="today">TODAY’S APPOINTMENTS <span>${connected ? todayCount : '—'}</span></button><button class="reschedule-queue" type="button" data-queue="reschedule">RESCHEDULE <span>${connected ? pendingCount : '—'}</span></button></div><div class="calendar-card"><div class="calendar-head"><div><h2>Calendar</h2><p class="calendar-legend">${agents.length ? agents.map(a => `<span><i></i>${esc(a.full_name)}</span>`).join('') : 'Appointments & activities'}</p></div><div class="calendar-actions"><button type="button" class="btn primary" data-new-appointment>+ ADD APPOINTMENT / ACTIVITY</button><div class="calendar-controls"><button type="button" class="btn secondary" data-month="-1" aria-label="Previous month">‹</button><button type="button" class="btn secondary" data-month="today">Today</button><button type="button" class="btn secondary" data-month="1" aria-label="Next month">›</button></div></div></div><h3 class="calendar-month" aria-live="polite">${month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3><p class="calendar-status" role="status">${connected ? '' : 'Calendar layout is ready. Scheduling is not connected yet.'}</p><div class="calendar-grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<div class="calendar-weekday">${day}</div>`).join('')}${days.map(day => {
    const key = isoDate(day), entries = events.filter(e => e.event_date === key && e.status !== 'needs_reschedule');
    return `<button type="button" class="calendar-day${day.getMonth() !== month.getMonth() ? ' outside' : ''}${key === today ? ' today' : ''}" data-day="${key}" aria-label="${longDate(key)}${connected ? `, ${entries.length} items` : ''}"${key === today ? ' aria-current="date"' : ''}><span class="day-number">${day.getDate()}</span><span class="day-events">${entries.slice(0, 3).map(e => `<span class="calendar-event"><small>${esc(timeLabel(e.start_time))}</small><strong>${esc(e.title)}</strong></span>`).join('')}${entries.length > 3 ? `<small>+${entries.length - 3} more</small>` : ''}</span><span class="day-dots">${entries.slice(0, 4).map(() => '<i></i>').join('')}</span></button>`;
  }).join('')}</div></div></section>`;
}
export function shell(route, connected, body) {
  const label = NAV.find(([key]) => key === route)?.[1] || 'Dashboard';
  return `<div class="shell"><button class="sidebar-shade" aria-label="Close navigation" hidden></button><aside class="sidebar" id="sidebar"><a class="brand" href="#/dashboard"><img src="/assets/mh-logo.jpg" width="56" height="56" alt="M&H shield"><span>M&amp;H CRM<small>Insurance Group</small></span></a><nav class="nav" aria-label="Main navigation">${NAV.map(([key, text]) => `<a href="#/${key}"${key === route ? ' aria-current="page" class="active"' : ''}>${text}</a>`).join('')}</nav><div class="sidebar-footer">M&amp;H Insurance Group<small>Standalone workspace</small></div></aside><main class="main"><header class="top"><button type="button" class="menu-toggle" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">☰</button><a class="top-brand" href="#/dashboard"><img src="/assets/mh-logo.jpg" alt="M&H shield" width="40" height="40"><strong>M&amp;H CRM</strong></a><nav class="quick-tools" aria-label="CRM quick tools">${TOOLS.map(([key, label, short, hint]) => `<button type="button" class="quick-tool" data-tool="${key}" title="${esc(hint)}" aria-label="${esc(label)}" aria-haspopup="dialog">${icon(key)}<strong>${esc(short)}</strong></button>`).join('')}</nav></header><div class="content"><div class="page-heading"><div><span class="eyebrow">M&amp;H WORKSPACE</span><h1>${esc(label)}</h1></div><button type="button" class="btn primary" data-add-client aria-haspopup="dialog">+ Add Client</button></div>${!connected ? '<div class="framework-banner"><strong>Framework • Database not connected</strong><span>No client data is stored. Please do not enter real client information yet.</span></div>' : ''}${body}</div></main></div>`;
}
