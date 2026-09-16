export function recoveryContext(href) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const requested = url.searchParams.get('recovery') === '1' || hash.get('type') === 'recovery';
  const error = hash.get('error') || hash.get('error_code') || url.searchParams.get('error') || url.searchParams.get('error_code');
  return { requested: requested || Boolean(error), invalid: Boolean(error), tokenCallback: hash.get('type') === 'recovery' && Boolean(hash.get('access_token')), code: url.searchParams.get('code') || '' };
}
export async function withTimeout(promise, ms = 12000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The connection timed out. Please try again.')), ms); })]); }
  finally { clearTimeout(timer); }
}
