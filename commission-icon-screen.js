import { Dialogs } from './dialogs.js';
import { mhRepository } from './supabase-repository.js';

const dialogs = new Dialogs();
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const money = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US', { style:'currency', currency:'USD' }) : '—';
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function chicagoPeriod() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone:'America/Chicago', year:'numeric', month:'2-digit'
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return { year:Number(parts.year), month:Number(parts.month) };
}

function yearChoices(selected) {
  const current = chicagoPeriod().year;
  const years = [];
  for (let year = current + 1; year >= current - 7; year -= 1) years.push(year);
  if (Number.isFinite(Number(selected)) && !years.includes(Number(selected))) years.push(Number(selected));
  return years.sort((a,b) => b-a);
}

function options(values, selected, label = value => value) {
  return values.map(value => `<option value="${esc(value)}"${String(value)===String(selected)?' selected':''}>${esc(label(value))}</option>`).join('');
}

function lifeMarkup(data) {
  const rows = (data.months || []).map(row => `<tr${Number(row.month)===Number(data.month)?' class="selected"':''}><td>${esc(row.monthName)}</td><td>${Number(row.sales||0)}</td><td>${money(row.premium)}</td></tr>`).join('');
  return `<section class="commission-tracker-panel life-tracker-panel">
    <header><div><span>Life Insurance</span><h3>Commission / Production Tracker</h3></div><b>${esc(data.year)}</b></header>
    <div class="tracker-metrics four">
      <article><span>Monthly Sales</span><strong>${Number(data.monthlySales||0)}</strong><small>${esc(data.monthName)} ${esc(data.year)}</small></article>
      <article><span>Monthly Premium</span><strong>${money(data.monthly)}</strong><small>${esc(data.monthName)} ${esc(data.year)}</small></article>
      <article><span>Year Sales</span><strong>${Number(data.yearlySales||0)}</strong><small>${esc(data.year)}</small></article>
      <article><span>Year Premium</span><strong>${money(data.yearly)}</strong><small>${esc(data.year)}</small></article>
    </div>
    <div class="commission-month-table-wrap"><table class="commission-month-table"><thead><tr><th>Month</th><th>Sales</th><th>Premium</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="commission-tracker-note">Life totals come directly from the Premium and Effective Date saved in each client's Life policy folder.</p>
  </section>`;
}

function periodCard(name, row, t65 = false) {
  const item = row || { total:0, initial:0, switches:0, t65:0, payout:null };
  return `<article class="medicare-period-card"><header><strong>${esc(name)}</strong><b>${Number(item.total||0)} sale${Number(item.total||0)===1?'':'s'}</b></header>
    <div><span>${t65?'T65 Clients':'New / T65'}</span><strong>${t65?Number(item.t65||0):Number(item.initial||0)}</strong></div>
    ${t65?'':`<div><span>Switches</span><strong>${Number(item.switches||0)}</strong></div>`}
    <footer><span>Commission Est.</span><strong>${item.payout===null?'—':money(item.payout)}</strong></footer></article>`;
}

function medicareMarkup(data) {
  const rates = data.rates;
  return `<section class="commission-tracker-panel medicare-tracker-panel">
    <header><div><span>Medicare</span><h3>Commission Tracker</h3></div><b>${esc(data.contractYear)}</b></header>
    <div class="tracker-metrics three rates">
      <article><span>New / T65 Initial</span><strong>${rates?money(rates.initial):'—'}</strong></article>
      <article><span>MA → MA Switch</span><strong>${rates?money(rates.switch):'—'}</strong></article>
      <article><span>Renewal Monthly Eq.</span><strong>${rates?money(rates.renewalMonthlyEquivalent):'—'}</strong></article>
    </div>
    <div class="tracker-metrics three book">
      <article><span>Current Medicare Book</span><strong>${Number(data.bookCount||0)}</strong><small>active plan clients</small></article>
      <article><span>Monthly Renewal Equivalent</span><strong>${data.monthlyRenewals===null?'—':money(data.monthlyRenewals)}</strong></article>
      <article><span>Annual Renewal Value</span><strong>${data.annualRenewals===null?'—':money(data.annualRenewals)}</strong></article>
    </div>
    <div class="medicare-period-grid">${periodCard('AEP',data.periods?.AEP)}${periodCard('OEP',data.periods?.OEP)}${periodCard('SEP',data.periods?.SEP)}${periodCard('T65 / IEP',data.periods?.['T65 / IEP'],true)}</div>
    <p class="commission-tracker-note">AEP/OEP/SEP/T65 sales are tracked when M&H Medicare plan information is saved or changed.</p>
  </section>`;
}

function openCommissionIconScreen() {
  const period = chicagoPeriod();
  const body = `<div class="commission-tracker commission-icon-screen" data-icon-commission-screen>
    <div class="commission-tracker-tabs" role="tablist" aria-label="Commission type">
      <button type="button" class="active" data-icon-commission-tab="life" aria-selected="true"><span>$</span><b>Life Insurance</b><small>Month &amp; year</small></button>
      <button type="button" data-icon-commission-tab="medicare" aria-selected="false"><span>M</span><b>Medicare</b><small>Sales &amp; commissions</small></button>
    </div>
    <div class="commission-filter-row" data-life-filters>
      <label class="commission-filter-field"><span>Month</span><select data-icon-life-month>${options(Array.from({length:12},(_,i)=>i+1),period.month,value=>MONTHS[value-1])}</select></label>
      <label class="commission-filter-field"><span>Year</span><select data-icon-life-year>${options(yearChoices(period.year),period.year)}</select></label>
    </div>
    <div class="commission-filter-row" data-medicare-filters hidden>
      <label class="commission-filter-field"><span>Contract Year</span><select data-icon-medicare-year>${options([period.year+1,period.year],period.year+1)}</select></label>
    </div>
    <div class="commission-tracker-state" data-icon-commission-state>Loading…</div>
    <div data-icon-commission-panel></div>
  </div>`;
  const dialog = dialogs.open({
    title:'Commissions',
    hint:'Life Insurance and Medicare tracking',
    kind:'commission-icon-dialog',
    body
  });
  const root = dialog.node.querySelector('[data-icon-commission-screen]');
  const panel = root.querySelector('[data-icon-commission-panel]');
  const state = root.querySelector('[data-icon-commission-state]');
  const lifeMonth = root.querySelector('[data-icon-life-month]');
  const lifeYear = root.querySelector('[data-icon-life-year]');
  const medicareYear = root.querySelector('[data-icon-medicare-year]');
  const lifeFilters = root.querySelector('[data-life-filters]');
  const medicareFilters = root.querySelector('[data-medicare-filters]');
  let view = 'life';
  let token = 0;

  async function loadLife() {
    const request = ++token;
    state.hidden = false; state.textContent = 'Loading Life commissions…'; panel.innerHTML = '';
    try {
      if (typeof mhRepository.lifeProductionTracker !== 'function') throw new Error('Life commission tracking is not available.');
      const data = await mhRepository.lifeProductionTracker({ year:Number(lifeYear.value), month:Number(lifeMonth.value) });
      if (request !== token || !root.isConnected) return;
      const selectedYear = Number(lifeYear.value);
      lifeYear.innerHTML = options([...new Set([...yearChoices(selectedYear), ...(data.years||[])])].sort((a,b)=>b-a), selectedYear);
      panel.innerHTML = lifeMarkup(data);
      state.hidden = true;
    } catch (error) {
      if (request === token && root.isConnected) { state.hidden=false; state.textContent=error?.message || 'Life commissions could not load.'; }
    }
  }

  async function loadMedicare() {
    const request = ++token;
    state.hidden = false; state.textContent = 'Loading Medicare commissions…'; panel.innerHTML = '';
    try {
      if (typeof mhRepository.medicareCommissionTracker !== 'function') throw new Error('Medicare commission tracking is not available.');
      const data = await mhRepository.medicareCommissionTracker({ contractYear:Number(medicareYear.value) });
      if (request !== token || !root.isConnected) return;
      medicareYear.innerHTML = options(data.years || [data.contractYear], data.contractYear);
      panel.innerHTML = medicareMarkup(data);
      state.hidden = true;
    } catch (error) {
      if (request === token && root.isConnected) { state.hidden=false; state.textContent=error?.message || 'Medicare commissions could not load.'; }
    }
  }

  root.querySelectorAll('[data-icon-commission-tab]').forEach(button => {
    button.onclick = () => {
      view = button.dataset.iconCommissionTab;
      root.querySelectorAll('[data-icon-commission-tab]').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      lifeFilters.hidden = view !== 'life';
      medicareFilters.hidden = view !== 'medicare';
      if (view === 'life') loadLife(); else loadMedicare();
    };
  });
  lifeMonth.onchange = loadLife;
  lifeYear.onchange = loadLife;
  medicareYear.onchange = loadMedicare;
  loadLife();
}

const app = document.getElementById('app');
if (app) {
  app.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-tool="commissions"]');
    if (!button || !app.contains(button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCommissionIconScreen();
  }, true);
}
