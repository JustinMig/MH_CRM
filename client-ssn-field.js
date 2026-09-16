import { Dialogs } from './dialogs.js';

function ensureSsnField(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const dob = form.elements.namedItem('date_of_birth');
  const gender = form.elements.namedItem('gender');
  const dobField = dob instanceof HTMLElement ? dob.closest('label.field') : null;
  const genderField = gender instanceof HTMLElement ? gender.closest('label.field') : null;
  if (!dobField && !genderField) return;

  let ssn = form.elements.namedItem('ssn');
  let ssnField = ssn instanceof HTMLElement ? ssn.closest('label.field') : null;

  if (!ssnField) {
    ssnField = document.createElement('label');
    ssnField.className = 'field span-all';
    ssnField.innerHTML = '<span>Social Security Number</span><input name="ssn" type="text" inputmode="numeric" autocomplete="off" placeholder="###-##-####">';
    ssn = ssnField.querySelector('input[name="ssn"]');
  }

  // Remove the obsolete standalone SSN box from older layouts.
  form.querySelectorAll('[data-intake-section="social"]').forEach(box => {
    if (box.contains(ssnField)) box.removeChild(ssnField);
    box.remove();
  });

  const demographicBox = (genderField || dobField)?.closest?.('[data-intake-section="demographics"]');
  if (demographicBox) {
    ssnField.classList.add('span-all');
    // Keep DOB + Gender on the first row and SSN immediately below them.
    if (ssnField.parentElement !== demographicBox || ssnField !== demographicBox.lastElementChild) {
      demographicBox.append(ssnField);
    }
  } else {
    const anchor = genderField || dobField;
    if (anchor && ssnField.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', ssnField);
  }

  if (ssn instanceof HTMLInputElement) {
    ssn.type = 'text';
    ssn.inputMode = 'numeric';
    ssn.autocomplete = 'off';
    ssn.placeholder = '###-##-####';
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
