import { Dialogs } from './dialogs.js';

const previousOpen = Dialogs.prototype.open;

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
    form = nextForm;
    userChanged = false;
    form.addEventListener('input', markUserChanged, true);
    form.addEventListener('change', markUserChanged, true);
    controller.node.dataset.newClientCleanBaseline = 'true';
  };

  controller.baseline = () => {
    previousBaseline();
    userChanged = false;
  };

  controller.isDirty = () => Boolean(form) && userChanged;

  return controller;
};
