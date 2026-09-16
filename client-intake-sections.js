import { Dialogs } from './dialogs.js';
import { supabase } from './supabase-client.js';

const GROUPS = [
  { key: 'name', title: 'Client Name', fields: ['first_name', 'last_name'] },
  { key: 'demographics', title: 'Date of Birth & Gender', fields: ['date_of_birth', 'gender', 'ssn'] },
  { key: 'contact', title: 'Email & Phone', fields: ['email', 'phone'] },
  // Desktop row: City → State → ZIP → County. Street address remains above it.
  { key: 'address', title: 'Address', fields: ['address', 'city', 'state', 'zip', 'county'] },
  { key: 'household', title: 'Client Assignment & Household', fields: ['assigned_agent_id', 'spouse'] }
];

const zipLookupCache = new Map();

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

function ensureSsnControl(form, personalGrid) {
  let ssn = form.elements.namedItem('ssn');
  let ssnField = ssn instanceof HTMLElement ? ssn.closest('label.field') : null;
  if (!ssnField) {
    ssnField = document.createElement('label');
    ssnField.className = 'field span-all';
    ssnField.innerHTML = '<span>Social Security Number</span><input name="ssn" type="text" inputmode="numeric" autocomplete="off" placeholder="###-##-####">';
    personalGrid.append(ssnField);
    ssn = ssnField.querySelector('input[name="ssn"]');
  }
  if (ssn instanceof HTMLInputElement) {
    ssn.type = 'text';
    ssn.inputMode = 'numeric';
    ssn.autocomplete = 'off';
    ssn.placeholder = '###-##-####';
    ssn.disabled = false;
  }
  ssnField.classList.add('span-all');
  const label = ssnField.querySelector(':scope > span');
  if (label) label.textContent = 'Social Security Number';
  return ssnField;
}

async function lookupZip(zip) {
  if (zipLookupCache.has(zip)) return zipLookupCache.get(zip);
  const request = (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Your session expired.');
    const response = await fetch(`/api/zip-location?zip=${encodeURIComponent(zip)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.county) throw new Error(data?.error || 'County lookup failed.');
    return data;
  })();
  zipLookupCache.set(zip, request);
  try {
    return await request;
  } catch (error) {
    zipLookupCache.delete(zip);
    throw error;
  }
}

function replaceCountyControl(form, counties, preferredCounty = '', primaryCounty = '') {
  const current = form.elements.namedItem('county');
  if (!(current instanceof HTMLInputElement || current instanceof HTMLSelectElement)) return null;
  const field = current.closest('label.field');
  if (!field) return current;

  const unique = [...new Set((counties || []).map(value => String(value || '').trim()).filter(Boolean))];
  const preferred = String(preferredCounty || '').trim();
  const primary = String(primaryCounty || '').trim();

  if (unique.length <= 1) {
    const value = unique[0] || primary || preferred;
    if (current instanceof HTMLInputElement) {
      current.value = value;
      current.removeAttribute('aria-describedby');
      return current;
    }
    const input = document.createElement('input');
    input.name = 'county';
    input.type = 'text';
    input.autocomplete = 'address-level2';
    input.value = value;
    current.replaceWith(input);
    return input;
  }

  const selected = unique.includes(preferred) ? preferred : (unique.includes(primary) ? primary : unique[0]);
  if (current instanceof HTMLSelectElement) {
    current.replaceChildren(...unique.map(county => {
      const option = document.createElement('option');
      option.value = county;
      option.textContent = county;
      option.selected = county === selected;
      return option;
    }));
    current.value = selected;
    current.setAttribute('aria-label', 'County — select the correct county for this ZIP code');
    return current;
  }

  const select = document.createElement('select');
  select.name = 'county';
  select.setAttribute('aria-label', 'County — select the correct county for this ZIP code');
  for (const county of unique) {
    const option = document.createElement('option');
    option.value = county;
    option.textContent = county;
    option.selected = county === selected;
    select.append(option);
  }
  current.replaceWith(select);
  return select;
}

function wireZipCounty(form) {
  if (!(form instanceof HTMLFormElement) || form.dataset.zipCountyReady === 'true') return;
  const zipInput = form.elements.namedItem('zip');
  if (!(zipInput instanceof HTMLInputElement)) return;
  if (!(form.elements.namedItem('county') instanceof HTMLElement)) return;

  form.dataset.zipCountyReady = 'true';
  zipInput.inputMode = 'numeric';
  zipInput.maxLength = 10;
  let timer = 0;
  let requestToken = 0;

  const run = async ({ initial = false } = {}) => {
    const zip = String(zipInput.value || '').replace(/\D/g, '').slice(0, 5);
    if (zip.length !== 5) return;
    const countyBefore = form.elements.namedItem('county');
    const existingCounty = countyBefore instanceof HTMLInputElement || countyBefore instanceof HTMLSelectElement
      ? String(countyBefore.value || '').trim()
      : '';
    const token = ++requestToken;
    try {
      const result = await lookupZip(zip);
      const currentZip = String(zipInput.value || '').replace(/\D/g, '').slice(0, 5);
      if (token !== requestToken || currentZip !== zip || !form.isConnected) return;
      const counties = Array.isArray(result.counties) && result.counties.length ? result.counties : [result.county].filter(Boolean);
      const control = replaceCountyControl(form, counties, existingCounty, result.county);
      if (!control) return;

      // User-entered ZIP changes should register as a form change. Initial hydration should not
      // mark an unchanged saved county dirty merely because an input became a select.
      if (!initial || !existingCounty) {
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch {
      // Leave manually entered/saved county untouched if lookup is unavailable.
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void run(), 250);
  };
  zipInput.addEventListener('input', schedule);
  zipInput.addEventListener('change', () => void run());

  // Existing records are checked too, so a saved county becomes a dropdown when its ZIP spans counties.
  void run({ initial: true });
}

function organizePersonalContact(form) {
  if (!form || form.dataset.intakeSectionsOrganized === 'true') {
    wireZipCounty(form);
    return;
  }
  const informationPanel = form.querySelector('[data-panel="information"]');
  const personalDetails = informationPanel?.querySelector('details.field-group');
  const personalGrid = personalDetails?.querySelector(':scope > .form-grid');
  if (!personalGrid) return;

  informationPanel?.querySelectorAll('[data-intake-section="social"]').forEach(node => node.remove());
  ensureSsnControl(form, personalGrid);

  const originalChildren = Array.from(personalGrid.children);
  const boxes = [];
  const moved = new Set();

  for (const group of GROUPS) {
    const fields = group.fields.map(name => fieldFor(form, name)).filter(Boolean);
    fields.forEach(field => moved.add(field));
    if (fields.length) boxes.push(sectionBox(group, fields));
  }

  const underwriting = personalGrid.querySelector('[data-personal-underwriting]');
  if (underwriting) {
    moved.add(underwriting);
    underwriting.classList.add('intake-section-underwriting');
    const addressIndex = Math.max(0, boxes.findIndex(box => box.dataset.intakeSection === 'address'));
    boxes.splice(addressIndex + 1, 0, underwriting);
  }

  const products = personalGrid.querySelector('.product-choices');
  if (products) {
    moved.add(products);
    products.classList.add('intake-products-box');
    boxes.push(products);
  }

  const leftovers = originalChildren.filter(child => !moved.has(child) && child.isConnected);
  if (leftovers.length) boxes.push(sectionBox({ key: 'other', title: 'Additional Client Details' }, leftovers));

  personalGrid.replaceChildren(...boxes);

  const demographics = personalGrid.querySelector('[data-intake-section="demographics"]');
  const ssnField = fieldFor(form, 'ssn');
  if (demographics && ssnField) {
    ssnField.classList.add('span-all');
    demographics.append(ssnField);
  }

  const identification = informationPanel.querySelectorAll('details.field-group')[1];
  const identificationSummary = identification?.querySelector(':scope > summary');
  if (identificationSummary && identification.querySelector('[name="license_number"]')) {
    identificationSummary.textContent = 'Driver’s License Identification';
  }

  form.dataset.intakeSectionsOrganized = 'true';
  wireZipCounty(form);
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
