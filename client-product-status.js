import { Dialogs } from './dialogs.js';
import { mhRepository, supabase } from './supabase-repository.js';

function enhanceClientForm(form) {
  if (!(form instanceof HTMLFormElement) || form.dataset.productStatusReady === 'true') return;
  const information = form.querySelector('[data-panel="information"]');
  if (!information) return;

  const products = information.querySelector('.product-choices');
  const personal = Array.from(information.querySelectorAll('details.field-group'))
    .find(group => group.querySelector(':scope > summary')?.textContent.trim() === 'Personal & Contact Information') ||
    information.querySelector('details.field-group');
  if (!products || !personal) return;

  form.dataset.productStatusReady = 'true';
  products.classList.add('client-product-status-box');
  products.classList.remove('span-all');

  if (!products.querySelector('[data-client-deceased]')) {
    const label = document.createElement('label');
    label.className = 'client-deceased-choice';
    label.innerHTML = '<input type="checkbox" name="deceased" data-client-deceased> Deceased';
    products.append(label);
  }

  personal.insertAdjacentElement('beforebegin', products);
}

const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function patchedOpen(options = {}) {
  const controller = originalOpen.call(this, options);
  if (options.kind === 'client-dialog') {
    const originalAttachForm = controller.attachForm.bind(controller);
    controller.attachForm = form => {
      enhanceClientForm(form);
      originalAttachForm(form);
    };
  }
  return controller;
};

const baseGetClient = mhRepository.getClient.bind(mhRepository);
mhRepository.getClient = async function patchedGetClient(id) {
  const client = await baseGetClient(id);
  if (!client) return client;
  return { ...client, deceased: client.status === 'deceased' };
};

const baseSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function patchedSaveClient(record, ...args) {
  const saved = await baseSaveClient(record, ...args);
  if (!saved?.id) return saved;

  const status = record?.deceased ? 'deceased' : 'active';
  if (saved.status !== status) {
    const { data, error } = await supabase
      .from('clients')
      .update({ status })
      .eq('id', saved.id)
      .select('id,status,updated_at')
      .single();
    if (error) throw error;
    return { ...saved, ...data, deceased: data.status === 'deceased' };
  }

  return { ...saved, deceased: status === 'deceased' };
};
