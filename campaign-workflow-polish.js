const MAX_CAMPAIGN_SELECTION = 500;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function selectedCount(host) {
  const text = host?.querySelector('[data-cmp-selectionbar] span')?.textContent || '';
  const match = text.match(/(\d+)\s+selected/i);
  return match ? Number(match[1]) : 0;
}

async function waitForSearchSettled(host, previousCount) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!host?.isConnected) return false;
    const busy = host.getAttribute('aria-busy') === 'true';
    const count = host.querySelectorAll('button.client-result[data-client-id]').length;
    const selectionCount = host.querySelectorAll('.cmp-search-checkbox input[type="checkbox"]').length;
    const more = host.querySelector('[data-more]');
    const resultSetChanged = count > previousCount || !more;
    const selectionReady = count === 0 || selectionCount >= count;
    if (!busy && resultSetChanged && selectionReady) return true;
    await sleep(75);
  }
  return false;
}

async function selectAllMatchingAndSend(trigger) {
  if (trigger.dataset.busy === 'true') return;
  trigger.dataset.busy = 'true';
  trigger.disabled = true;
  const originalText = trigger.textContent;
  trigger.textContent = 'Selecting…';

  try {
    let host = document.querySelector('#client-results');
    if (!host) throw new Error('Client results are not available.');

    const start = host.querySelector('[data-cmp-start-selection]');
    if (start) {
      start.click();
      await sleep(0);
    }

    for (let pass = 0; pass < 20; pass += 1) {
      host = document.querySelector('#client-results');
      if (!host?.isConnected) throw new Error('Client results changed. Run the search again.');

      const checkboxes = [...host.querySelectorAll('.cmp-search-checkbox input[type="checkbox"]:not(:disabled)')];
      for (const checkbox of checkboxes) {
        if (selectedCount(host) >= MAX_CAMPAIGN_SELECTION) break;
        if (!checkbox.checked) checkbox.click();
      }

      if (selectedCount(host) >= MAX_CAMPAIGN_SELECTION) break;
      const more = host.querySelector('[data-more]:not(:disabled)');
      if (!more) break;

      const previousCount = host.querySelectorAll('button.client-result[data-client-id]').length;
      more.click();
      const settled = await waitForSearchSettled(host, previousCount);
      if (!settled) throw new Error('The remaining client results did not finish loading.');
    }

    host = document.querySelector('#client-results');
    const count = selectedCount(host);
    if (!count) throw new Error('No eligible clients are available in these results.');

    const assign = host.querySelector('[data-cmp-assign]');
    if (!assign || assign.disabled) throw new Error('The selected clients could not be prepared for a campaign.');

    if (count >= MAX_CAMPAIGN_SELECTION && host.querySelector('[data-more]')) {
      alert(`The campaign selection limit is ${MAX_CAMPAIGN_SELECTION} clients. The first ${MAX_CAMPAIGN_SELECTION} matching clients were selected.`);
    }
    assign.click();
  } catch (error) {
    alert(error?.message || 'Unable to select these clients for a campaign.');
  } finally {
    trigger.dataset.busy = 'false';
    trigger.disabled = false;
    trigger.textContent = originalText;
  }
}

function ensureSelectAllButton() {
  const bar = document.querySelector('#client-results [data-cmp-selectionbar]');
  if (!bar || bar.querySelector('[data-cmp-select-all-results]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn cmp-select-all-results';
  button.dataset.cmpSelectAllResults = 'true';
  button.textContent = 'Select All Results → Campaign';
  button.title = 'Select every eligible client matching the current search, filter, and sort, up to 500 clients';
  button.addEventListener('click', () => selectAllMatchingAndSend(button));

  const start = bar.querySelector('[data-cmp-start-selection]');
  const assign = bar.querySelector('[data-cmp-assign]');
  if (start) bar.insertBefore(button, start);
  else if (assign) bar.insertBefore(button, assign);
  else bar.append(button);
}

function campaignTone(card, index) {
  for (let i = 0; i < 8; i += 1) card.classList.remove(`cmp-tone-${i}`);
  card.classList.add(`cmp-tone-${index % 8}`);
}

function decorateCampaignHost(host) {
  if (!host?.isConnected) return;

  const create = host.querySelector('[data-cmp-new]');
  if (create && create.dataset.iconTileReady !== 'true') {
    create.dataset.iconTileReady = 'true';
    create.classList.remove('btn', 'primary');
    create.classList.add('cmp-new-campaign-tile');
    create.innerHTML = '<span class="cmp-new-campaign-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 5.5h10a2 2 0 0 1 2 2v11H5z"/><path d="M8 9h6M8 12h6M8 15h4M18.5 5v6M15.5 8h6"/></svg></span><strong>New Campaign</strong>';
  }

  [...host.querySelectorAll('.cmp-campaign-card')].forEach((card, index) => campaignTone(card, index));
}

function watchCampaignHost(host) {
  if (!host || host.dataset.uniformCampaignWatch === 'true') return;
  host.dataset.uniformCampaignWatch = 'true';
  decorateCampaignHost(host);
  const observer = new MutationObserver(() => decorateCampaignHost(host));
  observer.observe(host, { childList: true, subtree: true });
}

function scan() {
  ensureSelectAllButton();
  watchCampaignHost(document.querySelector('#campaigns-host'));
}

const app = document.getElementById('app');
if (app) {
  scan();
  const observer = new MutationObserver(mutations => {
    const relevant = mutations.some(mutation => [...mutation.addedNodes].some(node =>
      node instanceof Element && (
        node.matches?.('#campaigns-host, #client-results, .cmp-selectionbar') ||
        node.querySelector?.('#campaigns-host, #client-results, .cmp-selectionbar')
      )
    ));
    if (relevant) queueMicrotask(scan);
  });
  observer.observe(app, { childList: true, subtree: true });
}
