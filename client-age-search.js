import { CLIENT_RESULT_FIELDS, clientAgeBounds, clientSearchOrders } from './client-search.js';

function decodeProductAndAge(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 't65' || raw === '65plus') return { product: '', age: raw };
  const marker = '::age=';
  const index = raw.indexOf(marker);
  if (index < 0) return { product: raw, age: '' };
  return {
    product: raw.slice(0, index),
    age: raw.slice(index + marker.length)
  };
}

function applyProductFilter(query, product) {
  if (product === 'deceased') return query.eq('status', 'deceased');
  if (product === 'non_medicare') return query.not('products', 'cs', '{medicare}');
  if (product === 'non_life') return query.not('products', 'cs', '{life}');
  if (product === 'non_life_medicare') return query.not('products', 'cs', '{life}').not('products', 'cs', '{medicare}');
  if (product) return query.contains('products', [product]);
  return query;
}

export function makeClientSearch(db, { now = () => new Date() } = {}) {
  return async function searchClients({ query = '', product = '', agent = '', birthYear = '', sortBy = 'name', sortDirection, limit = 50, cursor = null } = {}) {
    const pageSize = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 50);
    const offsetValue = Number(cursor);
    const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
    let q = db.from('client_search_results').select(CLIENT_RESULT_FIELDS);

    const term = String(query).replace(/[%_*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (term) {
      const columns = ['full_name', 'first_name', 'last_name', 'phone', 'email', 'address1', 'city', 'county', 'state'];
      const digits = term.replace(/\D/g, '');
      const isPhoneLike = digits.length >= 3 && /^[\d\s()+.\-]+$/.test(term);

      if (isPhoneLike) {
        q = q.or(`phone.ilike.${JSON.stringify(`%${term}%`)},phone_digits.ilike.${JSON.stringify(`%${digits}%`)}`);
      } else {
        // Treat each word as a required search token, but allow it to match any
        // searchable text field. This lets "Paula Flanagan" match
        // "Paula A Flanagan" without requiring the middle initial.
        for (const token of term.split(' ').filter(Boolean)) {
          const pattern = JSON.stringify(`%${token}%`);
          q = q.or(columns.map(column => `${column}.ilike.${pattern}`).join(','));
        }
      }
    }

    const decoded = decodeProductAndAge(product);
    q = applyProductFilter(q, decoded.product);

    if (decoded.age === 't65' || decoded.age === '65plus') {
      const bounds = clientAgeBounds(decoded.age, now());
      if (bounds.min) q = q.gte('date_of_birth', bounds.min);
      q = q.lte('date_of_birth', bounds.max);
    }

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
