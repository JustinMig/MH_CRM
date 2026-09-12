import { Dialogs } from './dialogs.js';

const GROUPS = [
  { key: 'name', title: 'Client Name', fields: ['first_name', 'last_name'] },
  { key: 'demographics', title: 'Date of Birth & Gender', fields: ['date_of_birth', 'gender'] },
  { key: 'contact', title: 'Email & Phone', fields: ['email', 'phone'] },
  { key: 'address', title: 'Address', fields: ['address', 'city', 'county', 'state', 'zip'] },
  { key: 'social', title: 'Social Security', fields: ['ssn'] },
  { key: 'household', title: 'Client Assignment & Household', fields: ['assigned_agent_id', 'spouse'] }
];

function fieldFor(form, name) {
  const control = form.elements.namedItem(name);
  if (!(control instanceof HTMLElement)) return null;
  return control.closest('label.field');
}

function sectionBox({ key, title }, fields) {
  const box = document.createElement('section');
  box.className = `intake-section-box intake-section-${key} span-all`;
  box.dataset.intakeSection = key;
  box.setAttribute('aria-label', title);
  const heading = document.createElement('div');
  heading.className = 'intake-section-title span-all';
  heading.innerHTML = `<strong>${title}</strong>`;
  box.append(heading, ...fields);
  return box;
}

function organizePersonalContact(form) {
  if (!form || form.dataset.intakeSectionsOrganized === 'true') return;
  const informationPanel = form.querySelector('[data-panel="information"]');
  const personalDetails = informationPanel?.querySelector('details.field-group');
  const personalGrid = personalDetails?.querySelector(':scope > .form-grid');
  if (!personalGrid) return;

  const boxes = [];
  for (const group of GROUPS) {
    const fields = group.fields.map(name => fieldFor(form, name)).filter(Boolean);
    if (fields.length) boxes.push(sectionBox(group, fields));
  }

  const underwriting = personalGrid.querySelector('[data-personal-underwriting]');
  if (underwriting) {
    underwriting.classList.add('intake-section-underwriting');
    const addressIndex = Math.max(0, boxes.findIndex(box => box.dataset.intakeSection === 'address'));
    boxes.splice(addressIndex + 1, 0, underwriting);
  }

  const products = personalGrid.querySelector('.product-choices');
  if (products) {
    products.classList.add('intake-products-box');
    boxes.push(products);
  }

  personalGrid.replaceChildren(...boxes);

  const identification = informationPanel.querySelectorAll('details.field-group')[1];
  const identificationSummary = identification?.querySelector(':scope > summary');
  if (identificationSummary && identification.querySelector('[name="license_number"]')) {
    identificationSummary.textContent = 'Driver’s License Identification';
  }

  form.dataset.intakeSectionsOrganized = 'true';
}

const originalOpen = Dialogs.prototype.open;
Dialogs.prototype.open = function patchedClientIntakeSections(options = {}) {
  const controller = originalOpen.call(this, options);
  if (options.kind !== 'client-dialog') return controller;

  const previousAttach = controller.attachForm.bind(controller);
  controller.attachForm = form => {
    previousAttach(form);
    organizePersonalContact(form);
    controller.baseline?.();
  };
  return controller;
};
