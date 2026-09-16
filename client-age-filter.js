export function installClientAgeFilter(root) {
  if (!root || root.dataset.clientAgeFilterInstalled === 'true') return;
  root.dataset.clientAgeFilterInstalled = 'true';

  let currentAge = '';

  const style = document.createElement('style');
  style.id = 'client-age-filter-style';
  style.textContent = `
    #client-search.search-form{grid-template-columns:minmax(0,1fr) minmax(180px,230px) minmax(120px,160px) auto}
    @media(max-width:1050px){#client-search.search-form{grid-template-columns:minmax(0,1fr) minmax(170px,1fr) minmax(130px,.75fr)}#client-search .search-actions{grid-column:1/-1;justify-content:flex-end}}
    @media(max-width:900px){#client-search.search-form{grid-template-columns:minmax(0,1fr) minmax(170px,1fr)}#client-search [data-age-filter-field]{grid-column:1/-1}}
    @media(max-width:620px){#client-search.search-form{grid-template-columns:minmax(0,1fr)}#client-search [data-age-filter-field]{grid-column:auto}}
  `;
  document.head.append(style);

  function baseProduct(value = '') {
    const raw = String(value || '');
    const marker = '::age=';
    const index = raw.indexOf(marker);
    return index >= 0 ? raw.slice(0, index) : raw;
  }

  function decorate() {
    const form = root.querySelector('#client-search');
    if (!form || form.dataset.ageFilterReady === 'true') return;
    form.dataset.ageFilterReady = 'true';

    const product = form.elements.namedItem('product');
    if (!product) return;

    Array.from(product.options).forEach(option => {
      if (option.value === 't65' || option.value === '65plus') option.remove();
    });

    const field = document.createElement('label');
    field.className = 'field';
    field.dataset.ageFilterField = 'true';
    field.innerHTML = `<span>Age</span><select data-age-filter><option value="">All Ages</option><option value="t65">T65</option><option value="65plus">65+</option></select>`;
    product.closest('.field')?.insertAdjacentElement('afterend', field);
    const age = field.querySelector('[data-age-filter]');
    age.value = currentAge;
    age.addEventListener('change', () => { currentAge = age.value; });
  }

  root.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'client-search') return;
    decorate();
    const product = form.elements.namedItem('product');
    const age = form.querySelector('[data-age-filter]');
    if (!product || !age) return;

    currentAge = age.value;
    const base = baseProduct(product.value);
    if (!currentAge) return;

    const encoded = `${base}::age=${currentAge}`;
    let temporary = Array.from(product.options).find(option => option.value === encoded);
    if (!temporary) {
      temporary = document.createElement('option');
      temporary.value = encoded;
      temporary.textContent = encoded;
      temporary.hidden = true;
      product.append(temporary);
    }

    product.value = encoded;
    product.dispatchEvent(new Event('input', { bubbles:true }));
    product.dispatchEvent(new Event('change', { bubbles:true }));

    setTimeout(() => {
      if (!product.isConnected) return;
      product.value = base;
      product.dispatchEvent(new Event('input', { bubbles:true }));
      product.dispatchEvent(new Event('change', { bubbles:true }));
      temporary?.remove();
    }, 0);
  }, true);

  root.addEventListener('click', event => {
    if (!event.target?.closest?.('[data-reset-search]')) return;
    currentAge = '';
    const age = root.querySelector('#client-search [data-age-filter]');
    if (age) age.value = '';
  }, true);

  const observer = new MutationObserver(() => decorate());
  observer.observe(root, { childList:true, subtree:true });
  decorate();
}
