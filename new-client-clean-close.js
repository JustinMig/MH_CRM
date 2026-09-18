import { Dialogs } from './dialogs.js';

const previousOpen = Dialogs.prototype.open;

function clearNewClientData(form) {
  if (!(form instanceof HTMLFormElement)) return;
  form.reset();

  for (const control of Array.from(form.elements)) {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) continue;
    if (control.name === 'assigned_agent_id') continue;

    if (control instanceof HTMLInputElement) {
      if (control.type === 'checkbox' || control.type === 'radio') control.checked = false;
      else if (control.type !== 'file') control.value = '';
      continue;
    }

    if (control instanceof HTMLSelectElement) {
      const blank = Array.from(control.options).find(option => option.value === '');
      if (blank) control.value = '';
      else if (control.options.length) control.selectedIndex = 0;
      continue;
    }

    control.value = '';
  }
}

Dialogs.prototype.open = function newClientCleanClose(options = {}) {
  const controller = previousOpen.call(this, options);
  const isNewClient = options.kind === 'client-dialog' && String(options.hint || '').startsWith('New client');
  if (!isNewClient) return controller;

  let form = null;
  let userChanged = false;
  const previousAttachForm = controller.attachForm.bind(controller);
  const previousBaseline = controller.baseline.bind(controller);

  const markUserChanged = event => {
    // Enhancers dispatch synthetic input/change events while building the form.
    // Only a real keyboard/touch/mouse edit should make a brand-new client dirty.
    if (event.isTrusted) userChanged = true;
  };

  controller.attachForm = nextForm => {
    previousAttachForm(nextForm);
    clearNewClientData(nextForm);
    form = nextForm;
    userChanged = false;
    form.addEventListener('input', markUserChanged, true);
    form.addEventListener('change', markUserChanged, true);
    previousBaseline();
    controller.node.dataset.newClientCleanBaseline = 'true';
  };

  controller.baseline = () => {
    previousBaseline();
    userChanged = false;
  };

  controller.isDirty = () => Boolean(form) && userChanged;

  return controller;
};
