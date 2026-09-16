import { Dialogs } from './dialogs.js';

function ensureSsnField(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const phone = form.elements.namedItem('phone');
  const phoneField = phone instanceof HTMLElement ? phone.closest('label.field') : null;
  if (!phoneField) return;

  let ssn = form.elements.namedItem('ssn');
  let ssnField = ssn instanceof HTMLElement ? ssn.closest('label.field') : null;

  if (!ssnField) {
    ssnField = document.createElement('label');
    ssnField.className = 'field';
    ssnField.innerHTML = '<span>Social Security Number</span><input name="ssn" type="text" inputmode="numeric" autocomplete="off" placeholder="###-##-####">';
    ssn = ssnField.querySelector('input[name="ssn"]');
  }

  if (ssnField.previousElementSibling !== phoneField) {
    phoneField.insertAdjacentElement('afterend', ssnField);
  }

  if (ssn instanceof HTMLInputElement) {
    ssn.type = 'text';
    ssn.inputMode = 'numeric';
    ssn.autocomplete = 'off';
    if (!ssn.placeholder) ssn.placeholder = '###-##-####';
    ssn.disabled = false;
  }

  const label = ssnField.querySelector(':scope > span');
  if (label) label.textContent = 'Social Security Number';
}

const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function patchedSsnField(options = {}) {
  const controller = originalOpen.call(this, options);
  if (options.kind !== 'client-dialog') return controller;

  const previousAttach = controller.attachForm.bind(controller);
  controller.attachForm = form => {
    previousAttach(form);
    ensureSsnField(form);
    controller.baseline?.();
  };
  return controller;
};
