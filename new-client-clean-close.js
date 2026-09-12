import { Dialogs } from './dialogs.js';
import { snapshot, stable } from './core.js';

const previousOpen = Dialogs.prototype.open;

Dialogs.prototype.open = function newClientCleanClose(options = {}) {
  const controller = previousOpen.call(this, options);
  const isNewClient = options.kind === 'client-dialog' && String(options.hint || '').startsWith('New client');
  if (!isNewClient) return controller;

  let form = null;
  let cleanBaseline = '';
  const previousAttachForm = controller.attachForm.bind(controller);
  const previousBaseline = controller.baseline.bind(controller);

  controller.attachForm = nextForm => {
    previousAttachForm(nextForm);
    form = nextForm;
    cleanBaseline = stable(snapshot(form));
    controller.node.dataset.newClientCleanBaseline = 'true';
  };

  controller.baseline = () => {
    previousBaseline();
    if (form) cleanBaseline = stable(snapshot(form));
  };

  controller.isDirty = () => Boolean(form) && cleanBaseline !== stable(snapshot(form));

  return controller;
};
