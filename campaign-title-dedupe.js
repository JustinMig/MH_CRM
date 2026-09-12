function campaignTitleLine(pageHeading) {
  const group = pageHeading?.querySelector(':scope > div:first-child');
  const heading = group?.querySelector('h1');
  if (!group || !heading) return null;
  let line = group.querySelector(':scope > .campaign-page-titleline');
  if (!line) {
    line = document.createElement('div');
    line.className = 'campaign-page-titleline';
    heading.insertAdjacentElement('beforebegin', line);
    line.append(heading);
  }
  return line;
}

function simplifyCampaignTitle() {
  const host = document.querySelector('#campaigns-host');
  const pageHeading = document.querySelector('.page-heading');
  if (!host?.isConnected || !pageHeading?.isConnected) return;

  const listMode = Boolean(host.querySelector('.cmp-campaign-grid, .cmp-list-filter'));
  const moved = pageHeading.querySelector('[data-cmp-new].campaign-page-new');
  const create = host.querySelector('[data-cmp-new]');

  if (!listMode) {
    moved?.remove();
    return;
  }

  if (!create) return;

  const oldMoved = pageHeading.querySelector('[data-cmp-new].campaign-page-new');
  if (oldMoved && oldMoved !== create) oldMoved.remove();

  const innerTitlebar = create.closest('.cmp-titlebar');
  const line = campaignTitleLine(pageHeading);
  if (!line) return;

  create.classList.add('campaign-page-new');
  line.append(create);
  innerTitlebar?.remove();
}

function relevantCampaignMutation(mutation) {
  return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
    node instanceof Element && (
      node.matches?.('#campaigns-host, .cmp-titlebar, [data-cmp-new], .cmp-campaign-grid, .cmp-list-filter, .cmp-members') ||
      node.querySelector?.('#campaigns-host, .cmp-titlebar, [data-cmp-new], .cmp-campaign-grid, .cmp-list-filter, .cmp-members')
    )
  );
}

const app = document.getElementById('app');
if (app) {
  simplifyCampaignTitle();
  new MutationObserver(mutations => {
    if (mutations.some(relevantCampaignMutation)) queueMicrotask(simplifyCampaignTitle);
  }).observe(app, { childList: true, subtree: true });
}
