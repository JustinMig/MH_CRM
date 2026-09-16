import { requireCrmUser } from '../server/communications.js';

const ZIP_RE = /^\d{5}$/;
const trimCounty = value => String(value || '')
  .replace(/\s+(County|Parish|Borough|Census Area|Municipality)$/i, '')
  .replace(/\s+City and Borough$/i, '')
  .trim();

async function fetchJson(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request) {
  try {
    await requireCrmUser(request);
    const url = new URL(request.url);
    const zip = String(url.searchParams.get('zip') || '').replace(/\D/g, '').slice(0, 5);
    if (!ZIP_RE.test(zip)) return Response.json({ error: 'Enter a valid 5-digit ZIP code.' }, { status: 400 });

    const postal = await fetchJson(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`);
    const place = Array.isArray(postal?.places) ? postal.places[0] : null;
    const lat = Number(place?.latitude);
    const lon = Number(place?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return Response.json({ error: 'ZIP code not found.' }, { status: 404 });
    }

    const area = await fetchJson(`https://geo.fcc.gov/api/census/area?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=json`);
    const result = Array.isArray(area?.results) ? area.results[0] : null;
    const county = trimCounty(result?.county_name || result?.county || '');
    if (!county) return Response.json({ error: 'County could not be determined for this ZIP code.' }, { status: 404 });

    return Response.json({
      zip,
      county,
      state: String(place?.['state abbreviation'] || ''),
      city: String(place?.['place name'] || ''),
    }, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' } });
  } catch (error) {
    const status = Number(error?.status) || (error?.name === 'AbortError' ? 504 : 500);
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to look up ZIP code.' }, { status });
  }
}
