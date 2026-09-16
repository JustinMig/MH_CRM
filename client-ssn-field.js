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
    ssnField.className = 'field';
    ssnField.innerHTML = '<span>Social Security Number</span><input name="ssn" type="text" inputmode="numeric" autocomplete="off" placeholder="###-##-####">';
    ssn = ssnField.querySelector('input[name="ssn"]');
  }

  const demographicBox = (genderField || dobField)?.closest?.('[data-intake-section="demographics"]');
  const existingSocialBox = form.querySelector('[data-intake-section="social"]');
  if (demographicBox) {
    let socialBox = existingSocialBox;
    if (!socialBox) {
      socialBox = document.createElement('section');
      socialBox.className = 'intake-section-box intake-section-social span-all';
      socialBox.dataset.intakeSection = 'social';
      socialBox.setAttribute('aria-label', 'Social Security Number');
      socialBox.innerHTML = '<div class="intake-section-title span-all"><strong>Social Security Number</strong></div>';
    }
    if (ssnField.parentElement !== socialBox) socialBox.append(ssnField);
    if (socialBox.previousElementSibling !== demographicBox) demographicBox.insertAdjacentElement('afterend', socialBox);
  } else {
    const anchor = genderField || dobField;
    if (anchor && ssnField.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', ssnField);
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
