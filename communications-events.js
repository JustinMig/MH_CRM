// Render notifications carry identity, never fetch a second list to infer row IDs.
export function communicationsRendered(host) {
  if (host?.isConnected) window.dispatchEvent(new CustomEvent('mig:communications-rendered', { detail: { host } }));
}
export function communicationsChanged(kind, clientId = '') {
  window.dispatchEvent(new CustomEvent('mig:communications-changed', { detail: { kind, clientId } }));
}
export function releaseRecordings(host) {
  host?.querySelectorAll?.('audio').forEach(audio => {
    audio.pause();
    const src = audio.getAttribute('src') || '';
    audio.removeAttribute('src');
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
  });
}
