import { esc } from './core.js';

// One search implementation for the client screen and appointment lookups.
// The view is SECURITY INVOKER: it uses the existing clients table permissions.
export const CLIENT_RESULT_FIELDS = 'id,first_name,last_name,phone,email,date_of_birth,county,state,products,status,created_at,updated_at,assigned_agent_id';
const sorts = new Set(['name', 'state', 'county', 'created_at']);
export function normalizeClientSort(sortBy = 'name', sortDirection) {
  const key = sorts.has(sortBy) ? sortBy : 'name';
  const direction = ['asc', 'desc'].includes(sortDirection) ? sortDirection : key === 'created_at' ? 'desc' : 'asc';
  return { sortBy: key, sortDirection: direction };
}
export function clientSearchOrders(sortBy, sortDirection) {
  const sort = normalizeClientSort(sortBy, sortDirection);
  const ascending = sort.sortDirection === 'asc';
  const order = [];
  if (sort.sortBy === 'state') order.push(['state_sort', ascending], ['county_sort', true]);
  if (sort.sortBy === 'county') order.push(['county_sort', ascending], ['state_sort', true]);
  if (sort.sortBy === 'created_at') order.push(['created_at', ascending]);
  order.push(['last_name_sort', sort.sortBy === 'name' ? ascending : true]);
  order.push(['first_name_sort', sort.sortBy === 'name' ? ascending : true], ['id', true]);
  return order;
}
export function makeClientSearch(db) {
  return async function searchClients({ query = '', product = '', agent = '', birthYear = '', sortBy = 'name', sortDirection, limit = 50, cursor = null } = {}) {
    const pageSize = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 50);
    const offsetValue = Number(cursor);
    const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
    let q = db.from('client_search_results').select(CLIENT_RESULT_FIELDS);
    const term = String(query).replace(/[%_*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (term) {
      // Quoted PostgREST values keep commas/parentheses/apostrophes in names safe.
      const pattern = JSON.stringify(`%${term}%`);
      const columns = ['full_name', 'first_name', 'last_name', 'phone', 'email', 'address1', 'city', 'county', 'state'];
      const clauses = columns.map(column => `${column}.ilike.${pattern}`);
      const digits = term.replace(/\D/g, '');
      if (digits.length >= 3 && /^[\d\s()+.\-]+$/.test(term)) clauses.push(`phone_digits.ilike.${JSON.stringify(`%${digits}%`)}`);
      q = q.or(clauses.join(','));
    }
    const selectedProduct = String(product).trim().toLowerCase();
    if (selectedProduct === 'deceased') q = q.eq('status', 'deceased');
    else if (selectedProduct) q = q.contains('products', [selectedProduct]);
    if (agent) q = q.eq('assigned_agent_id', agent);
    if (birthYear) {
      if (!/^\d{4}$/.test(String(birthYear))) throw new Error('Enter a four-digit birth year.');
      q = q.gte('date_of_birth', `${birthYear}-01-01`).lte('date_of_birth', `${birthYear}-12-31`);
    }
    for (const [column, ascending] of clientSearchOrders(sortBy, sortDirection)) {
      q = q.order(column, { ascending, nullsFirst: false });
    }
    const { data, error } = await q.range(offset, offset + pageSize);
    if (error) throw error;
    const rows = data || [];
    return { rows: rows.slice(0, pageSize), nextCursor: rows.length > pageSize ? String(offset + pageSize) : null };
  };
}
const optionMarkup = (items, current) => items.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(current) ? ' selected' : ''}>${esc(label)}</option>`).join('');
export function clientSearchMarkup(s) {
  return `<section class="panel-card dark-card client-search-panel" aria-label="Client search">
    <form id="client-search" class="search-form">
      <label class="field query-field"><span>Search Clients</span><input name="query" autocomplete="off" value="${esc(s.query)}" placeholder="Search clients…" enterkeyhint="search"></label>
      <label class="field"><span>Product / Status</span><select name="product">${optionMarkup([['', 'All Products / Statuses'], ['medicare', 'Medicare'], ['life', 'Life'], ['retirement', 'Retirement'], ['deceased', 'Deceased']], String(s.product || '').toLowerCase())}</select></label>
      <input type="hidden" name="agent" value="${esc(s.agent || '')}">
      <div class="search-actions"><button type="submit" class="btn primary">Search</button><button type="button" class="btn secondary" data-reset-search>Clear</button></div>
    </form>
  </section>
  <section class="client-result-toolbar" aria-label="Sort client search results" data-client-result-toolbar${s.applied ? '' : ' hidden'}>
    <div class="client-sort-intro"><strong>Search results</strong></div>
    <label class="field"><span>Sort by</span><select name="sortBy" form="client-search" data-client-sort>${optionMarkup([['name','Client Name'],['state','State'],['county','County'],['created_at','Date Added']], s.sortBy || 'name')}</select></label>
    <label class="field"><span>Order</span><select name="sortDirection" form="client-search" data-client-sort-direction>${clientSortDirectionOptions(s.sortBy, s.sortDirection)}</select></label>
  </section>
  <div id="client-results" aria-live="polite"></div>`;
}
export function clientSortDirectionOptions(sortBy, sortDirection) {
  const sort = normalizeClientSort(sortBy, sortDirection);
  return optionMarkup(sort.sortBy === 'created_at' ? [['desc','Newest first'], ['asc','Oldest first']] : [['asc','A–Z'], ['desc','Z–A']], sort.sortDirection);
}
export function clientSortDescription(sortBy, sortDirection) {
  const sort = normalizeClientSort(sortBy, sortDirection);
  const label = { name: 'Client Name', state: 'State', county: 'County', created_at: 'Date Added' }[sort.sortBy];
  return `${label} • ${sort.sortBy === 'created_at' ? (sort.sortDirection === 'asc' ? 'oldest first' : 'newest first') : (sort.sortDirection === 'asc' ? 'A–Z' : 'Z–A')}`;
}
export function clientPhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  // Do not drop extensions or alter international phone numbers.
  if (/^[+\d\s().-]+$/.test(raw) && digits.length === 10) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  if (/^[+\d\s().-]+$/.test(raw) && digits.length === 11 && digits[0] === '1') return `1-${digits.slice(1,4)}-${digits.slice(4,7)}-${digits.slice(7)}`;
  return raw || 'Not entered';
}
const dateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
export function clientAddedDate(value) {
  if (!value) return { date: 'Not recorded', time: '', iso: '' };
  // Date-only imports are calendar dates, not UTC instants.
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const d = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0,10) !== value) return { date: 'Not recorded', time: '', iso: '' };
    return { date: `${String(value).slice(5,7)}/${String(value).slice(8,10)}/${String(value).slice(0,4)}`, time: '', iso: String(value) };
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? { date: 'Not recorded', time: '', iso: '' } : { date: dateFormatter.format(d), time: timeFormatter.format(d), iso: d.toISOString() };
}
export function clientProductsMarkup(client) {
  if (String(client.status || '').toLowerCase() === 'deceased' || client.product_deceased === true) return '<span class="client-product-tag is-deceased">Deceased</span>';
  const names = { medicare: 'Medicare', life: 'Life', retirement: 'Retirement', hospital_indemnity: 'Hospital Indemnity' };
  const products = Array.isArray(client.products) ? [...new Set(client.products.map(p => String(p).trim().toLowerCase()).filter(Boolean))] : [];
  return products.length ? products.map(p => `<span class="client-product-tag">${esc(names[p] || p.replaceAll('_', ' '))}</span>`).join('') : '<span class="client-result-missing">Not selected</span>';
}
export function clientResultContent(client) {
  const added = clientAddedDate(client.created_at);
  return `<span class="client-result-name"><span class="client-detail-label">Client</span><strong data-client-name>${esc([client.first_name,client.last_name].filter(Boolean).join(' ') || 'Client record')}</strong></span>
    <span class="client-result-cell"><span class="client-detail-label">County</span><span data-client-county>${esc(String(client.county || '').trim() || 'Not entered')}</span></span>
    <span class="client-result-cell"><span class="client-detail-label">State</span><span data-client-state>${esc(String(client.state || '').trim().toUpperCase() || 'Not entered')}</span></span>
    <span class="client-result-cell"><span class="client-detail-label">Phone</span><span data-client-phone>${esc(clientPhone(client.phone))}</span></span>
    <span class="client-result-cell"><span class="client-detail-label">Products / Status</span><span class="client-product-tags" data-client-products>${clientProductsMarkup(client)}</span></span>
    <span class="client-result-cell"><span class="client-detail-label">Date Added</span>${added.iso ? `<time data-client-added datetime="${esc(added.iso)}">${esc(added.date)}</time>` : '<span data-client-added>Not recorded</span>'}${added.time ? `<small class="client-added-time">${esc(added.time)}</small>` : ''}</span>
    <span class="client-result-arrow" aria-hidden="true">›</span>`;
}
export function clientResultsMarkup(s) {
  const status = `${s.error ? `<div class="notice error" role="alert">${esc(s.error)}</div>` : ''}${s.message ? `<p class="result-status">${esc(s.message)}</p>` : ''}`;
  if (!s.rows?.length) return status;
  return `${status}<div class="client-results-list client-results-detailed">${s.rows.map(client => `<button type="button" class="client-result client-result-detailed" data-client-id="${esc(client.id)}" aria-haspopup="dialog">${clientResultContent(client)}</button>`).join('')}</div>${s.nextCursor ? `<button class="btn secondary" type="button" data-more${s.loading ? ' disabled' : ''}>${s.loading ? 'Loading…' : 'Load more'}</button>` : ''}`;
}
