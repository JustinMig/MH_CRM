function enhanceCampaignCallButton(card) {
  if (!(card instanceof Element) || card.dataset.cmpCallPlaceholder === 'true') return;
  const person = card.querySelector('.cmp-person');
  const name = person?.querySelector('strong');
  if (!person || !name) return;

  card.dataset.cmpCallPlaceholder = 'true';

  const line = document.createElement('div');
  line.className = 'cmp-name-call-line';
  name.before(line);
  line.append(name);

  const call = document.createElement('button');
  call.type = 'button';
  call.className = 'cmp-call-placeholder';
  call.dataset.cmpCallPlaceholderButton = 'true';
  call.setAttribute('aria-label', `Call ${name.textContent?.trim() || 'client'}`);
  call.title = 'Calling integration will be connected later';
  call.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h4l2 5-3 2a14 14 0 0 0 3 3l2-3 5 2v4c0 2-2 3-4 3C9 20 4 15 4 8c0-2 1-4 3-4Z"/></svg><span>Call</span>';
  call.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  line.append(call);
}

function scanCampaignCallButtons(root = document) {
  if (root instanceof Element && root.matches('.cmp-member')) enhanceCampaignCallButton(root);
  root.querySelectorAll?.('.campaigns-root .cmp-member').forEach(enhanceCampaignCallButton);
}

let queued = false;
function queueScan() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    scanCampaignCallButtons();
  });
}

new MutationObserver(mutations => {
  if (mutations.some(mutation => [...mutation.addedNodes].some(node => node instanceof Element && (node.matches?.('.cmp-member,.cmp-members,.campaigns-root') || node.querySelector?.('.cmp-member'))))) {
    queueScan();
  }
}).observe(document.body, { childList: true, subtree: true });

scanCampaignCallButtons();
