import { mhRepository } from './supabase-repository.js';

const ALL_CLIENTS_SENTINEL = '__mh_all_clients__';
const baseSearchClients = mhRepository.searchClients.bind(mhRepository);

mhRepository.searchClients = async function searchClientsWithAllFallback(criteria = {}, ...args) {
  const normalized = criteria?.query === ALL_CLIENTS_SENTINEL
    ? { ...criteria, query: '' }
    : criteria;
  return baseSearchClients(normalized, ...args);
};

function hasSearchCriteria(form) {
  const query = form.elements.namedItem('query');
  const product = form.elements.namedItem('product');
  const agent = form.elements.namedItem('agent');
  const age = String(form.querySelector('[data-age-filter]')?.value || '').trim();
  return Boolean(
    String(query?.value || '').trim() ||
    String(product?.value || '').trim() ||
    String(agent?.value || '').trim() ||
    age
  );
}

function installBlankSearch(form) {
  if (!(form instanceof HTMLFormElement) || form.id !== 'client-search') return;
  if (form.dataset.blankSearchAllReady === 'true') return;

  const originalSubmit = form.onsubmit;
  if (typeof originalSubmit !== 'function') {
    queueMicrotask(() => installBlankSearch(form));
    return;
  }

  form.dataset.blankSearchAllReady = 'true';
  form.onsubmit = function blankSearchShowsAll(event) {
    const query = form.elements.namedItem('query');
    let injected = false;

    if (!hasSearchCriteria(form) && query instanceof HTMLInputElement) {
      query.value = ALL_CLIENTS_SENTINEL;
      query.dispatchEvent(new Event('input', { bubbles: true }));
      query.dispatchEvent(new Event('change', { bubbles: true }));
      injected = true;
    }

    const result = originalSubmit.call(this, event);

    if (injected && query instanceof HTMLInputElement) {
      queueMicrotask(() => {
        if (!query.isConnected || query.value !== ALL_CLIENTS_SENTINEL) return;
        query.value = '';
        query.dispatchEvent(new Event('input', { bubbles: true }));
        query.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    return result;
  };
}

function scan() {
  const form = document.querySelector('#client-search');
  if (form) installBlankSearch(form);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();
