import { makeClientSearch } from './client-age-search.js';
import { createCampaignRepository } from './campaigns-repository.js';
import { createWorkspace } from './workspace.js';
import { mhRepository, supabase } from './supabase-repository.js';
import './username-user-access.js?v=1';
import { installAdminUsers } from './admin-users.js';
import { installPullToRefresh } from './pull-to-refresh.js';
import { installDashboardCleanup } from './dashboard-cleanup.js';
import { installAppointmentSingleAgent } from './appointment-ui.js';
import { installCarrierVault } from './carriers-ui.js';
import { installMayerJustinCalendar } from './calendar-sync.js?v=justin-calendar-1';
import { installClientAgeFilter } from './client-age-filter.js';
import { installClientDelete } from './client-delete.js';
import { installSimpleDashboardNote } from './dashboard-note-simple.js';
import { installClientDateAndDragDrop } from './client-date-dragdrop.js';
import { installClientDuplicateCheck } from './client-duplicate-check.js?v=1';
import { installFastNavigation } from './navigation-speed.js?v=2';

const root = document.querySelector('#app');
installPullToRefresh();

mhRepository.searchClients = makeClientSearch(supabase);
mhRepository.campaigns = createCampaignRepository(supabase);

function applyCurrentUserToClientSearch(form = root.querySelector('#client-search')) {
  if (!form || !mhRepository.user?.id) return;
  if (['owner','admin'].includes(mhRepository.profile?.role) && mhRepository.agents.length > 1) return;
  const agent = form.elements.namedItem('agent');
  if (!agent || agent.value === mhRepository.user.id) return;
  agent.value = mhRepository.user.id;
  agent.dispatchEvent(new Event('input', { bubbles: true }));
  agent.dispatchEvent(new Event('change', { bubbles: true }));
}

root.addEventListener('submit', event => {
  if (event.target?.id === 'client-search') applyCurrentUserToClientSearch(event.target);
}, true);
root.addEventListener('click', event => {
  if (event.target?.closest?.('[data-reset-search]')) setTimeout(() => applyCurrentUserToClientSearch(), 0);
}, true);

export async function startWorkspace() {
  const signedIn = await mhRepository.initialize();
  if (!signedIn) throw new Error('Your session expired. Please sign in again.');
  document.body.dataset.crmRole = mhRepository.profile.role;
  document.body.dataset.singleAgent = String(mhRepository.agents.length <= 1);
  if (!location.hash || location.hash === '#/' || location.hash === '#') history.replaceState(null, '', '#/dashboard');
  if (['owner','admin'].includes(mhRepository.profile?.role)) installMayerJustinCalendar();
  await import('./workspace-extensions.js?v=medication-add-bottom-1');
  installClientDuplicateCheck();
  await import('./input-formatting.js?v=2');
  await import('./campaigns-smooth-load.js?v=1');
  installFastNavigation(root);
  createWorkspace(root, mhRepository);
  await import('./top-add-client.js?v=4');
  installClientAgeFilter(root);
  installClientDelete(root, mhRepository);
  installSimpleDashboardNote(root);
  installClientDateAndDragDrop(root);
  installDashboardCleanup(root);
  installAppointmentSingleAgent(root, mhRepository);
  installAdminUsers(root, mhRepository);
  installCarrierVault(root);
  applyCurrentUserToClientSearch();

  void import('./communications-ui.js?v=communications-perf-3')
    .then(() => import('./ringcentral-readonly.js?v=readonly-calls-3'))
    .then(() => import('./ringcentral-ui-adjustments.js?v=footer-call-data-2'))
    .then(() => import('./communications-layout-fix.js?v=communications-layout-2'))
    .then(() => import('./communications-delete.js?v=communications-delete-2'))
    .then(() => import('./communications-open-client.js?v=communications-open-client-2'))
    .catch(error => console.error('Communications UI failed to load.', error));
}