import { supabase } from './supabase-client.js';

const suggestionCache = new Map();
const states = new WeakMap();

const isMedicationName = input => input instanceof HTMLInputElement && /^medication_\d+_medication_name$/.test(input.name);
const cardFor = input => input.closest?.('[data-health-card][data-kind="medication"]') || null;

function stateFor(input) {
  let state = states.get(input);
  if (!state) {
    state = { timer: 0, controller: null, request: 0, menu: null, status: null };
    states.set(input, state);
  }
  return state;
}

function prepareCard(card) {
  if (!card || card.dataset.medicationLookupReady === 'true') return;
  card.dataset.medicationLookupReady = 'true';
  const name = card.querySelector('input[name$="_medication_name"]');
  const strength = card.querySelector('[name$="_strength"]');
  const dosage = card.querySelector('input[name$="_dosage"]');
  if (name instanceof HTMLInputElement) {
    name.autocomplete = 'off';
    name.spellcheck = false;
    name.placeholder = 'Start typing a medication name';
    name.setAttribute('aria-autocomplete', 'list');
    name.setAttribute('aria-expanded', 'false');
    name.closest('label.field')?.classList.add('medication-name-field');
  }
  const strengthLabel = strength?.closest?.('label.field')?.querySelector(':scope > span');
  if (strengthLabel) strengthLabel.textContent = 'Dosage / Strength';
  const dosageLabel = dosage?.closest?.('label.field')?.querySelector(':scope > span');
  if (dosageLabel) dosageLabel.textContent = 'How Taken / Directions';
  if (dosage instanceof HTMLInputElement && !dosage.placeholder) dosage.placeholder = 'Example: 1 tablet twice daily';
}

function closeMenu(input) {
  const state = stateFor(input);
  state.menu?.remove();
  state.menu = null;
  state.status?.remove();
  state.status = null;
  input.setAttribute('aria-expanded', 'false');
}

function showStatus(input, text, className = '') {
  const state = stateFor(input);
  state.status?.remove();
  const note = document.createElement('small');
  note.className = `medication-lookup-status ${className}`.trim();
  note.textContent = text;
  input.closest('label.field')?.append(note);
  state.status = note;
}

function makeManualStrength(card, value = '') {
  if (!card) return null;
  const current = card.querySelector('[name$="_strength"]');
  if (!current) return null;
  if (current instanceof HTMLInputElement) return current;
  const input = document.createElement('input');
  input.name = current.name;
  input.value = value;
  input.autocomplete = 'off';
  input.placeholder = 'Example: 10 mg tablet';
  current.replaceWith(input);
  return input;
}

function installStrengthChoices(card, strengths) {
  const current = card?.querySelector('[name$="_strength"]');
  if (!current) return;
  const unique = [...new Set((strengths || []).map(value => String(value || '').trim()).filter(Boolean))];
  if (!unique.length) {
    makeManualStrength(card, current.value || '');
    return;
  }
  const previous = String(current.value || '').trim();
  const select = document.createElement('select');
  select.name = current.name;
  select.className = current.className;
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Choose dosage / strength';
  select.append(blank);
  for (const strength of unique) {
    const option = document.createElement('option');
    option.value = strength;
    option.textContent = strength;
    if (strength.toLocaleLowerCase('en-US') === previous.toLocaleLowerCase('en-US')) option.selected = true;
    select.append(option);
  }
  const manual = document.createElement('option');
  manual.value = '__manual__';
  manual.textContent = 'Other / enter manually';
  select.append(manual);
  select.addEventListener('change', () => {
    if (select.value === '__manual__') {
      const input = makeManualStrength(card, '');
      input?.focus();
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    select.dispatchEvent(new Event('input', { bubbles: true }));
  });
  current.replaceWith(select);
}

async function searchMedication(query, signal) {
  const key = query.toLocaleLowerCase('en-US');
  if (suggestionCache.has(key)) return suggestionCache.get(key);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your session expired.');
  const response = await fetch(`/api/medication-search?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'Medication lookup failed.');
  const suggestions = Array.isArray(payload?.suggestions)
    ? payload.suggestions.filter(item => item && typeof item.name === 'string').map(item => ({
        name: item.name.trim(),
        strengths: Array.isArray(item.strengths) ? item.strengths.map(value => String(value || '').trim()).filter(Boolean) : [],
      })).filter(item => item.name)
    : [];
  suggestionCache.set(key, suggestions);
  return suggestions;
}

function showSuggestions(input, suggestions) {
  closeMenu(input);
  if (!suggestions.length) {
    showStatus(input, 'No catalog match. You can still enter it manually.', 'no-results');
    return;
  }
  const state = stateFor(input);
  const menu = document.createElement('div');
  menu.className = 'medication-autocomplete-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Medication suggestions');
  for (const suggestion of suggestions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'medication-autocomplete-option';
    button.setAttribute('role', 'option');
    const name = document.createElement('span');
    name.textContent = suggestion.name;
    button.append(name);
    if (suggestion.strengths.length) {
      const count = document.createElement('small');
      count.textContent = `${suggestion.strengths.length} strength${suggestion.strengths.length === 1 ? '' : 's'}`;
      button.append(count);
    }
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', () => {
      input.dataset.rxSelecting = 'true';
      input.value = suggestion.name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      delete input.dataset.rxSelecting;
      installStrengthChoices(cardFor(input), suggestion.strengths);
      closeMenu(input);
    });
    menu.append(button);
  }
  input.closest('label.field')?.append(menu);
  state.menu = menu;
  input.setAttribute('aria-expanded', 'true');
}

function scheduleSearch(input) {
  const state = stateFor(input);
  clearTimeout(state.timer);
  state.controller?.abort();
  state.controller = null;
  closeMenu(input);
  const query = input.value.trim();
  if (query.length < 2) return;
  const request = ++state.request;
  state.timer = window.setTimeout(async () => {
    const controller = new AbortController();
    state.controller = controller;
    showStatus(input, 'Searching…');
    try {
      const suggestions = await searchMedication(query, controller.signal);
      if (request !== state.request || !input.isConnected || input.value.trim() !== query) return;
      showSuggestions(input, suggestions);
    } catch (error) {
      if (error?.name !== 'AbortError' && request === state.request) showStatus(input, 'Medication lookup unavailable. Manual entry is still available.', 'no-results');
    } finally {
      if (state.controller === controller) state.controller = null;
    }
  }, 160);
}

function prepareVisibleMedicationCards(root = document) {
  root.querySelectorAll?.('[data-health-card][data-kind="medication"]').forEach(prepareCard);
}

document.addEventListener('input', event => {
  const input = event.target;
  if (!isMedicationName(input)) return;
  prepareCard(cardFor(input));
  if (input.dataset.rxSelecting === 'true') return;
  const card = cardFor(input);
  const strength = card?.querySelector('[name$="_strength"]');
  if (strength instanceof HTMLSelectElement) makeManualStrength(card, '');
  scheduleSearch(input);
}, true);

document.addEventListener('focusin', event => {
  if (!isMedicationName(event.target)) return;
  prepareCard(cardFor(event.target));
}, true);

document.addEventListener('focusout', event => {
  if (!isMedicationName(event.target)) return;
  window.setTimeout(() => closeMenu(event.target), 150);
}, true);

document.addEventListener('click', event => {
  if (event.target.closest?.('[data-add-health-record="medications"], [data-tab="medications"]')) {
    requestAnimationFrame(() => prepareVisibleMedicationCards());
  }
}, true);

prepareVisibleMedicationCards();
