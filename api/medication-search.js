import { adminRest, requireCrmUser } from '../server/communications.js';

function cleanSearch(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s\-'.()]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

async function searchRxTerms(query) {
  const url = new URL('https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search');
  url.searchParams.set('terms', query);
  url.searchParams.set('ef', 'STRENGTHS_AND_FORMS,RXCUIS');
  url.searchParams.set('maxList', '20');
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'force-cache',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`NLM RxTerms returned ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) return [];
  const names = Array.isArray(payload[1]) ? payload[1] : [];
  const extra = payload[2] && typeof payload[2] === 'object' ? payload[2] : {};
  const strengths = Array.isArray(extra.STRENGTHS_AND_FORMS) ? extra.STRENGTHS_AND_FORMS : [];
  const rxcuis = Array.isArray(extra.RXCUIS) ? extra.RXCUIS : [];
  return names.map((rawName, index) => ({
    name: typeof rawName === 'string' ? rawName.trim() : '',
    strengths: [...new Set(stringArray(strengths[index]))],
    rxcuis: stringArray(rxcuis[index]),
    source: 'rxterms',
  })).filter(item => item.name);
}

async function searchCrmFallback(query) {
  try {
    const encoded = encodeURIComponent(`${query}%`);
    const rows = await adminRest(`/rest/v1/client_medications?medication_name=ilike.${encoded}&select=medication_name,strength&order=medication_name.asc&limit=80`);
    const byName = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const name = String(row?.medication_name || '').trim();
      if (!name) continue;
      const key = name.toLocaleLowerCase('en-US');
      if (!byName.has(key)) byName.set(key, { name, strengths: [], rxcuis: [], source: 'crm' });
      const strength = String(row?.strength || '').trim();
      if (strength && !byName.get(key).strengths.includes(strength)) byName.get(key).strengths.push(strength);
    }
    return [...byName.values()].slice(0, 12);
  } catch {
    return [];
  }
}

export async function GET(request) {
  try {
    await requireCrmUser(request);
    const query = cleanSearch(new URL(request.url).searchParams.get('q'));
    if (query.length < 2) return Response.json({ suggestions: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
    try {
      const suggestions = await searchRxTerms(query);
      return Response.json({ suggestions, source: 'NLM RxTerms' }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch {
      const suggestions = await searchCrmFallback(query);
      return Response.json({ suggestions, source: 'CRM fallback' }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
  } catch (error) {
    const status = Number(error?.status) || 500;
    return Response.json({ error: error instanceof Error ? error.message : 'Medication lookup failed.', suggestions: [] }, { status });
  }
}
