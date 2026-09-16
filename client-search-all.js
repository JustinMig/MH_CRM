import { mhRepository } from './supabase-repository.js';

const ALL_CLIENTS_SENTINEL = '__mh_all_clients__';
const baseSearchClients = mhRepository.searchClients.bind(mhRepository);

mhRepository.searchClients = async function searchClientsWithAllFallback(criteria = {}, ...args) {
  const normalized = criteria?.query === ALL_CLIENTS_SENTINEL
    ? { ...criteria, query: '' }
    : criteria;
  return baseSearchClients(normalized, ...args);
};

document.addEventListener('submit', event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'client-search') return;

  const query = form.elements.namedItem('query');
  const product = form.elements.namedItem('product');
  const agent = form.elements.namedItem('agent');
  if (!(query instanceof HTMLInputElement)) return;

  const age = String(form.querySelector('[data-age-filter]')?.value || '').trim();
  const hasCriteria = Boolean(
    String(query.value || '').trim() ||
    String(product?.value || '').trim() ||
    String(agent?.value || '').trim() ||
    age
  );
  if (hasCriteria) return;

  // The workspace intentionally keeps Clients empty until Search is pressed.
  // Use an internal sentinel only for that submit so a blank Search means
  // "show all clients" again without changing the visible search box.
  query.value = ALL_CLIENTS_SENTINEL;
  query.dispatchEvent(new Event('input', { bubbles: true }));

  queueMicrotask(() => {
    if (!query.isConnected || query.value !== ALL_CLIENTS_SENTINEL) return;
    query.value = '';
    query.dispatchEvent(new Event('input', { bubbles: true }));
  });
}, true);
