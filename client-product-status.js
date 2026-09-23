import { Dialogs } from './dialogs.js';
import { mhRepository, supabase } from './supabase-repository.js';

const statusCache = new Map();
let pendingClientId = null;

function enhanceClientForm(form, currentStatus = '') {
  if (!(form instanceof HTMLFormElement) || form.dataset.productStatusReady === 'true') return;
  const information = form.querySelector('[data-panel="information"]');
  if (!information) return;

  const products = information.querySelector('.product-choices');
  const personal = Array.from(information.querySelectorAll('details.field-group'))
    .find(group => group.querySelector(':scope > summary')?.textContent.trim() === 'Personal & Contact Information') ||
    information.querySelector('details.field-group');
  if (!products || !personal) return;

  form.dataset.productStatusReady = 'true';
  form.dataset.originalClientStatus = currentStatus || 'active';
  products.classList.add('client-product-status-box');
  products.classList.remove('span-all');

  if (!products.querySelector('[data-client-deceased]')) {
    const label = document.createElement('label');
    label.className = 'client-deceased-choice';
    label.innerHTML = '<input type="checkbox" name="deceased" data-client-deceased> Deceased';
    products.append(label);
  }

  const deceased = products.querySelector('[data-client-deceased]');
  const productChecks = Array.from(products.querySelectorAll('input[type="checkbox"][name^="product_"]'));
  if (deceased) deceased.checked = currentStatus === 'deceased';

  const clearProductsForDeceased = () => {
    if (!deceased?.checked) return;
    productChecks.forEach(input => {
      if (input.checked) {
        input.checked = false;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  };

  // A deceased client must never retain active product selections.
  clearProductsForDeceased();

  deceased?.addEventListener('change', () => {
    clearProductsForDeceased();
  });

  productChecks.forEach(input => input.addEventListener('change', () => {
    if (!input.checked || !deceased?.checked) return;
    deceased.checked = false;
    deceased.dispatchEvent(new Event('change', { bubbles: true }));
  }));

  personal.insertAdjacentElement('beforebegin', products);
}

document.addEventListener('click', event => {
  const existing = event.target.closest?.('[data-client-id]');
  const add = event.target.closest?.('[data-add-client]');
  if (existing) pendingClientId = existing.dataset.clientId || null;
  else if (add) pendingClientId = null;
}, true);

const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function patchedOpen(options = {}) {
  const clientId = options.kind === 'client-dialog' ? pendingClientId : null;
  if (options.kind === 'client-dialog') pendingClientId = null;
  const controller = originalOpen.call(this, options);
  if (options.kind === 'client-dialog') {
    const originalAttachForm = controller.attachForm.bind(controller);
    controller.attachForm = form => {
      enhanceClientForm(form, clientId ? (statusCache.get(clientId) || '') : 'active');
      originalAttachForm(form);
    };
  }
  return controller;
};

const baseGetClient = mhRepository.getClient.bind(mhRepository);
mhRepository.getClient = async function patchedGetClient(id) {
  const client = await baseGetClient(id);
  if (!client) return client;
  statusCache.set(id, client.status || 'active');
  return { ...client, deceased: client.status === 'deceased' };
};

const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function patchedSaveClient(record, ...args) {
  const originalStatus = String(record?.status || 'active').toLowerCase();
  const deceased = record?.deceased === true;

  // Never allow stale product flags from the previously saved client record
  // to survive a Deceased save.
  const normalizedRecord = deceased
    ? {
        ...record,
        product_medicare: false,
        product_life: false,
        product_retirement: false
      }
    : record;

  const saved = await baseSaveClient(normalizedRecord, ...args);
  if (!saved?.id) return saved;

  let status;
  if (deceased) status = 'deceased';
  else if (originalStatus === 'deceased') status = 'active';
  else if (['active','inactive','prospect'].includes(originalStatus)) status = originalStatus;
  else status = saved.status || 'active';

  // Update status and products together for deceased clients so the database
  // cannot retain an old Medicare/Life/Retirement selection.
  const mustUpdateProducts = deceased && Array.isArray(saved.products) && saved.products.length > 0;
  if (saved.status !== status || mustUpdateProducts) {
    const updates = { status };
    if (deceased) updates.products = [];

    const { data, error } = await supabase
      .from('clients')
      .update(updates)
      .eq('id', saved.id)
      .select('id,status,products,updated_at')
      .single();
    if (error) throw error;
    statusCache.set(saved.id, data.status || status);
    return {
      ...saved,
      ...data,
      deceased: data.status === 'deceased',
      product_medicare: false,
      product_life: false,
      product_retirement: false
    };
  }

  statusCache.set(saved.id, status);
  return {
    ...saved,
    deceased: status === 'deceased',
    ...(deceased ? {
      products: [],
      product_medicare: false,
      product_life: false,
      product_retirement: false
    } : {})
  };
};
