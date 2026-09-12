import { Dialogs } from './dialogs.js';

function setExpanded(card, expanded) {
  card.classList.toggle('lead-expanded', expanded);
  const header = card.querySelector('.lead-card-main');
  header?.setAttribute('aria-expanded', String(expanded));
  card.querySelectorAll(':scope > .lead-collapsible-content').forEach(section => {
    section.hidden = !expanded;
  });
}

function prepareLeadCard(card) {
  if (!(card instanceof HTMLElement) || card.dataset.leadCollapseReady === 'true') return;
  const header = card.querySelector(':scope > .lead-card-main');
  if (!(header instanceof HTMLElement)) return;

  card.dataset.leadCollapseReady = 'true';
  header.classList.add('lead-collapse-header');
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-label', 'Expand lead details');

  Array.from(card.children).forEach(child => {
    if (child !== header) child.classList.add('lead-collapsible-content');
  });

  const toggle = () => setExpanded(card, header.getAttribute('aria-expanded') !== 'true');
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  });

  setExpanded(card, false);
}

function installLeadCollapse(list) {
  if (!(list instanceof HTMLElement) || list.dataset.leadCollapseInstalled === 'true') return;
  list.dataset.leadCollapseInstalled = 'true';
  list.querySelectorAll(':scope > .lead-card').forEach(prepareLeadCard);

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches('.lead-card')) prepareLeadCard(node);
      }
    }
  });
  observer.observe(list, { childList: true });
}

const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function patchedLeadCollapseOpen(options = {}) {
  const controller = originalOpen.call(this, options);
  if (options.kind !== 'leads-dialog') return controller;
  queueMicrotask(() => installLeadCollapse(controller.node.querySelector('[data-lead-list]')));
  return controller;
};
