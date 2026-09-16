import { requireCrmUser } from '../server/communications.js';

const ZIP_RE = /^\d{5}$/;
const TIGER_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer';
const trimCounty = value => String(value || '')
  .replace(/\s+(County|Parish|Borough|Census Area|Municipality)$/i, '')
  .replace(/\s+City and Borough$/i, '')
  .trim();

async function fetchJson(url, timeoutMs = 6000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function tigerCounties(zip) {
  try {
    const zctaParams = new URLSearchParams({
      where: `ZCTA5='${zip}'`,
      outFields: 'ZCTA5',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
    });
    const zcta = await fetchJson(`${TIGER_BASE}/84/query?${zctaParams.toString()}`, 8000);
    const geometry = Array.isArray(zcta?.features) ? zcta.features[0]?.geometry : null;
    if (!geometry) return [];

    const countyParams = new URLSearchParams({
      geometry: JSON.stringify(geometry),
      geometryType: 'esriGeometryPolygon',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'BASENAME,NAME,GEOID',
      returnGeometry: 'false',
      f: 'json',
    });
    const countyData = await fetchJson(`${TIGER_BASE}/82/query`, 10000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: countyParams.toString(),
    });
    const names = (Array.isArray(countyData?.features) ? countyData.features : [])
      .map(feature => trimCounty(feature?.attributes?.BASENAME || feature?.attributes?.NAME || ''))
      .filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
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

    const [area, intersectingCounties] = await Promise.all([
      fetchJson(`https://geo.fcc.gov/api/census/area?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=json`),
      tigerCounties(zip),
    ]);
    const result = Array.isArray(area?.results) ? area.results[0] : null;
    const primaryCounty = trimCounty(result?.county_name || result?.county || '');
    const counties = [...new Set([primaryCounty, ...intersectingCounties].filter(Boolean))];
    if (!counties.length) return Response.json({ error: 'County could not be determined for this ZIP code.' }, { status: 404 });

    // Keep the centroid/primary county first, then list any additional intersecting counties alphabetically.
    const primary = primaryCounty || counties[0];
    const orderedCounties = [primary, ...counties.filter(name => name !== primary).sort((a, b) => a.localeCompare(b))];

    return Response.json({
      zip,
      county: primary,
      counties: orderedCounties,
      state: String(place?.['state abbreviation'] || ''),
      city: String(place?.['place name'] || ''),
    }, { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800' } });
  } catch (error) {
    const status = Number(error?.status) || (error?.name === 'AbortError' ? 504 : 500);
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to look up ZIP code.' }, { status });
  }
}
