import { mhRepository, supabase } from './supabase-repository.js';
import { centralPremiumPeriod, summarizePremiumProduction } from './client-summary-model.js';

const ICONS = {
  total: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M2 21v-2a6 6 0 0 1 12 0v2m0-6a5 5 0 0 1 8 4v2"/></svg>',
  medicare: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.2-8 11-8 11Z"/><path d="M12 9v6m-3-3h6"/></svg>',
  life: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c5-3 8-6.3 8-11V5l-8-3-8 3v6c0 4.7 3 8 8 11Z"/><path d="M8 12h8m-4-4v8"/></svg>'
};
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CMS_MA_RATES = Object.freeze({ 2026: { initial: 694, renewal: 347 }, 2027: { initial: 725, renewal: 363 } });
let statsToken = 0;

const money = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '—';
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));

function agentScope() {
  const role = String(mhRepository.profile?.role || '').toLowerCase();
  return role === 'agent' ? (mhRepository.user?.id || '') : '';
}
function countQuery(product = '') {
  let query = supabase.from('clients').select('id', { count: 'exact', head: true }).neq('status', 'deceased');
  const scopedAgent = agentScope();
  if (scopedAgent) query = query.eq('assigned_agent_id', scopedAgent);
  if (product) query = query.contains('products', [product]);
  return query;
}
mhRepository.clientSummaryCounts = async function clientSummaryCounts() {
  const [totalResult, medicareResult, lifeResult] = await Promise.all([countQuery(), countQuery('medicare'), countQuery('life')]);
  for (const result of [totalResult, medicareResult, lifeResult]) if (result.error) throw result.error;
  return { total:Number(totalResult.count||0), medicare:Number(medicareResult.count||0), life:Number(lifeResult.count||0) };
};

function currentContractYear() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', year:'numeric', month:'2-digit' }).formatToParts(new Date()).map(p => [p.type,p.value]));
  return Number(parts.month) >= 6 ? Number(parts.year) + 1 : Number(parts.year);
}
function monthsEnrolledInYear(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? 13 - month : 0;
}
function eventCommission(event, rates) {
  if (!rates) return null;
  const annual = event.compensation_type === 'initial' ? rates.initial : rates.renewal;
  return annual * (monthsEnrolledInYear(event.effective_date) / 12);
}
function summarizeEvents(events, period, rates) {
  const rows = events.filter(event => event.election_period === period);
  const payoutValues = rows.map(event => eventCommission(event, rates));
  return {
    total: rows.length,
    initial: rows.filter(event => event.compensation_type === 'initial').length,
    switches: rows.filter(event => event.compensation_type === 'switch').length,
    t65: rows.filter(event => event.likely_t65).length,
    payout: rates ? payoutValues.reduce((sum, value) => sum + Number(value || 0), 0) : null
  };
}

mhRepository.lifeProductionTracker = async function lifeProductionTracker({ agent = '', year, month } = {}) {
  const period = centralPremiumPeriod();
  const selectedYear = Number(year) || period.year;
  const selectedMonth = Math.min(12, Math.max(1, Number(month) || period.month));
  let query = supabase.from('life_premium_dashboard_rollup').select('assigned_agent_id,effective_year,effective_month,policy_count,premium_total');
  const scopedAgent = agent || agentScope();
  if (scopedAgent) query = query.eq('assigned_agent_id', scopedAgent);
  const { data, error } = await query;
  if (error) throw error;
  const allRows = data || [];
  const rows = allRows.filter(row => Number(row.effective_year) === selectedYear);
  const summary = summarizePremiumProduction(rows, { year:selectedYear, month:selectedMonth, monthName:MONTHS[selectedMonth - 1] });
  const yearlySales = rows.reduce((sum,row) => sum + Number(row.policy_count || 0), 0);
  const monthRows = Array.from({ length:12 }, (_,index) => {
    const m = index + 1;
    const matches = rows.filter(row => Number(row.effective_month) === m);
    return { month:m, monthName:MONTHS[index], sales:matches.reduce((s,row)=>s+Number(row.policy_count||0),0), premium:matches.reduce((s,row)=>s+Number(row.premium_total||0),0) };
  });
  const years = [...new Set([period.year, ...allRows.map(row => Number(row.effective_year)).filter(Number.isFinite)])].sort((a,b)=>b-a);
  return { ...summary, monthlySales:summary.monthlyPolicyCount, yearlySales, years, months:monthRows };
};

mhRepository.medicareCommissionTracker = async function medicareCommissionTracker({ agent = '', contractYear } = {}) {
  const selectedYear = Number(contractYear) || currentContractYear();
  const rates = CMS_MA_RATES[selectedYear] || null;
  const scopedAgent = agent || agentScope();
  let clientsQuery = supabase.from('clients').select('id,assigned_agent_id').neq('status','deceased').contains('products',['medicare']);
  if (scopedAgent) clientsQuery = clientsQuery.eq('assigned_agent_id', scopedAgent);
  const { data:clients, error:clientsError } = await clientsQuery;
  if (clientsError) throw clientsError;
  const clientIds = (clients || []).map(row => row.id);
  let plans = [];
  if (clientIds.length) {
    const { data, error } = await supabase.from('health_plans').select('client_id,carrier,plan_id,effective_date,status').in('client_id', clientIds);
    if (error) throw error;
    plans = data || [];
  }
  const bookClients = new Set(plans.filter(plan => {
    const carrier = String(plan.carrier || '').trim().toLowerCase();
    const status = String(plan.status || 'active').trim().toLowerCase();
    return carrier && !carrier.includes('original medicare') && !['cancelled','terminated','inactive'].includes(status);
  }).map(plan => plan.client_id));

  let eventsQuery = supabase.from('medicare_commission_events').select('assigned_agent_id,election_period,compensation_type,likely_t65,effective_date,contract_year').eq('contract_year', selectedYear);
  if (scopedAgent) eventsQuery = eventsQuery.eq('assigned_agent_id', scopedAgent);
  const { data:events, error:eventsError } = await eventsQuery;
  if (eventsError) throw eventsError;
  const rows = events || [];
  const annualRenewal = rates ? bookClients.size * rates.renewal : null;
  const years = [...new Set([2026, 2027, currentContractYear(), ...rows.map(row => Number(row.contract_year)).filter(Number.isFinite)])].sort((a,b)=>b-a);
  return {
    contractYear:selectedYear,
    years,
    rates: rates ? { initial:rates.initial, switch:rates.renewal, renewalMonthlyEquivalent:rates.renewal/12 } : null,
    bookCount:bookClients.size,
    monthlyRenewals:annualRenewal === null ? null : annualRenewal / 12,
    annualRenewals:annualRenewal,
    trackedSales:rows.length,
    periods:{
      AEP:summarizeEvents(rows,'AEP',rates),
      OEP:summarizeEvents(rows,'OEP',rates),
      SEP:summarizeEvents(rows,'SEP',rates),
      'T65 / IEP':summarizeEvents(rows,'IEP/T65',rates)
    }
  };
};

// Keep the older workspace call compatible while the richer tracker takes over the dialog on the next microtask.
const baseCommissions = mhRepository.commissions.bind(mhRepository);
mhRepository.commissions = async function commissionsCompat({ type, agent } = {}) {
  if (type === 'life') {
    const data = await mhRepository.lifeProductionTracker({ agent });
    return { monthly:data.monthly, yearly:data.yearly };
  }
  if (type === 'medicare') return mhRepository.medicareCommissionTracker({ agent });
  return baseCommissions({ type, agent });
};

function statCard(kind, label) {
  return `<article class="client-summary-card is-${kind}"><span class="client-summary-icon">${ICONS[kind]}</span><strong data-client-summary="${kind}">—</strong><span class="client-summary-label">${label}</span></article>`;
}
function ensureClientStats(panel) {
  if (!panel?.isConnected || panel.previousElementSibling?.matches?.('[data-client-summary-grid]')) return;
  const grid = document.createElement('section');
  grid.className = 'client-summary-grid';
  grid.dataset.clientSummaryGrid = 'true';
  grid.setAttribute('aria-label','Client totals');
  grid.setAttribute('aria-live','polite');
  grid.innerHTML = [statCard('total','Total Clients'),statCard('medicare','Medicare Clients'),statCard('life','Life Clients')].join('');
  panel.before(grid);
  void refreshClientStats(grid);
}
async function refreshClientStats(existing = null) {
  const grid = existing?.isConnected ? existing : document.querySelector('[data-client-summary-grid]');
  if (!grid) return;
  const token = ++statsToken;
  grid.classList.add('is-loading');
  try {
    const counts = await mhRepository.clientSummaryCounts();
    if (token !== statsToken || !grid.isConnected) return;
    for (const key of ['total','medicare','life']) {
      const node = grid.querySelector(`[data-client-summary="${key}"]`);
      const next = Number(counts[key] || 0).toLocaleString('en-US');
      if (node && node.textContent !== next) node.textContent = next;
    }
    grid.removeAttribute('data-error');
  } catch (error) {
    if (token !== statsToken || !grid.isConnected) return;
    grid.dataset.error = 'true';
    grid.title = error?.message || 'Client totals could not load.';
  } finally { if (token === statsToken && grid.isConnected) grid.classList.remove('is-loading'); }
}

function selectorOptions(values, current, labeler = value => value) {
  return values.map(value => `<option value="${esc(value)}"${String(value)===String(current)?' selected':''}>${esc(labeler(value))}</option>`).join('');
}
function agentOptions(current) {
  const agents = Array.isArray(mhRepository.agents) ? mhRepository.agents.filter(agent => agent.active !== false) : [];
  if (agents.length <= 1) return '';
  return `<label class="commission-filter-field"><span>Agent</span><select data-tracker-agent><option value="">All Agents</option>${agents.map(agent=>`<option value="${esc(agent.id)}"${agent.id===current?' selected':''}>${esc(agent.full_name||'Agent')}</option>`).join('')}</select></label>`;
}
function trackerShell() {
  const period = centralPremiumPeriod();
  return `<div class="commission-tracker" data-commission-tracker>
    <div class="commission-tracker-tabs" role="tablist" aria-label="Commission tracker type">
      <button type="button" class="active" data-tracker-tab="life" role="tab" aria-selected="true"><span>$</span><b>Life Insurance</b><small>Premium production</small></button>
      <button type="button" data-tracker-tab="medicare" role="tab" aria-selected="false"><span>M</span><b>Medicare</b><small>Sales & commission estimates</small></button>
    </div>
    <div class="commission-filter-row">${agentOptions('')}<label class="commission-filter-field" data-life-month-wrap><span>Month</span><select data-life-month>${selectorOptions(Array.from({length:12},(_,i)=>i+1),period.month,m=>MONTHS[m-1])}</select></label><label class="commission-filter-field" data-life-year-wrap><span>Year</span><select data-life-year><option value="${period.year}">${period.year}</option></select></label><label class="commission-filter-field" data-medicare-year-wrap hidden><span>Contract Year</span><select data-medicare-year>${selectorOptions([2027,2026],currentContractYear())}</select></label></div>
    <div class="commission-tracker-state" data-tracker-state>Loading commission tracker…</div>
    <div data-tracker-panel></div>
  </div>`;
}
function lifePanel(data) {
  const monthRows = data.months.map(row => `<tr${row.month===data.month?' class="selected"':''}><td>${esc(row.monthName)}</td><td>${row.sales}</td><td>${money(row.premium)}</td></tr>`).join('');
  return `<section class="commission-tracker-panel life-tracker-panel"><header><div><span>Life Insurance</span><h3>Premium Production</h3></div><b>${data.year}</b></header><div class="tracker-metrics four"><article><span>Monthly Sales</span><strong>${data.monthlySales}</strong><small>${esc(data.monthName)} ${data.year}</small></article><article><span>Monthly Premium</span><strong>${money(data.monthly)}</strong><small>${esc(data.monthName)} ${data.year}</small></article><article><span>Year Sales</span><strong>${data.yearlySales}</strong><small>${data.year}</small></article><article><span>Year Premium</span><strong>${money(data.yearly)}</strong><small>${data.year}</small></article></div><div class="commission-month-table-wrap"><table class="commission-month-table"><thead><tr><th>Month</th><th>Sales</th><th>Premium</th></tr></thead><tbody>${monthRows}</tbody></table></div><p class="commission-tracker-note">Live totals come from the Premium and Effective Date saved on each Life policy in the client file.</p></section>`;
}
function periodCard(title, summary, t65 = false) {
  return `<article class="medicare-period-card"><header><strong>${esc(title)}</strong><b>${summary.total} sale${summary.total===1?'':'s'}</b></header><div><span>${t65?'T65 Clients':'New / T65'}</span><strong>${t65?summary.t65:summary.initial}</strong></div>${t65?'':`<div><span>Switches</span><strong>${summary.switches}</strong></div>`}<footer><span>Commission Est.</span><strong>${summary.payout===null?'—':money(summary.payout)}</strong></footer></article>`;
}
function medicarePanel(data) {
  const r = data.rates;
  return `<section class="commission-tracker-panel medicare-tracker-panel"><header><div><span>Medicare</span><h3>Commission Tracker</h3></div><b>${data.contractYear}</b></header><div class="tracker-metrics three rates"><article><span>New / T65 Initial</span><strong>${r?money(r.initial):'Rate unavailable'}</strong></article><article><span>MA → MA Switch</span><strong>${r?money(r.switch):'Rate unavailable'}</strong></article><article><span>Renewal Monthly Eq.</span><strong>${r?money(r.renewalMonthlyEquivalent):'Rate unavailable'}</strong></article></div><div class="tracker-metrics three book"><article><span>Current Medicare Book</span><strong>${data.bookCount}</strong><small>active plan clients</small></article><article><span>Monthly Renewal Equivalent</span><strong>${data.monthlyRenewals===null?'—':money(data.monthlyRenewals)}</strong></article><article><span>Annual Renewal Value</span><strong>${data.annualRenewals===null?'—':money(data.annualRenewals)}</strong></article></div><div class="medicare-period-grid">${periodCard('AEP',data.periods.AEP)}${periodCard('OEP',data.periods.OEP)}${periodCard('SEP',data.periods.SEP)}${periodCard('T65 / IEP',data.periods['T65 / IEP'],true)}</div><p class="commission-tracker-note">Book values use current saved Medicare plans. AEP/OEP/SEP/T65 sales are recorded automatically when an M&H health plan is saved or changed. Estimates use the same CMS-maximum rate model as Mayer CRM; actual carrier compensation can differ.</p></section>`;
}

function mountCommissionTracker(dialog) {
  if (!dialog?.isConnected || dialog.dataset.fullCommissionTracker === 'true') return;
  dialog.dataset.fullCommissionTracker = 'true';
  const body = dialog.querySelector('.modal-body');
  if (!body) return;
  body.innerHTML = trackerShell();
  const root = body.querySelector('[data-commission-tracker]');
  const state = root.querySelector('[data-tracker-state]');
  const panel = root.querySelector('[data-tracker-panel]');
  const agent = root.querySelector('[data-tracker-agent]');
  const lifeMonth = root.querySelector('[data-life-month]');
  const lifeYear = root.querySelector('[data-life-year]');
  const medicareYear = root.querySelector('[data-medicare-year]');
  let view = 'life', request = 0;

  async function loadLife() {
    const token = ++request; state.hidden = false; state.textContent = 'Loading Life production…'; panel.innerHTML = '';
    try {
      const data = await mhRepository.lifeProductionTracker({ agent:agent?.value||'', year:lifeYear.value, month:lifeMonth.value });
      if (token!==request || !root.isConnected) return;
      const previous = lifeYear.value;
      lifeYear.innerHTML = selectorOptions(data.years,data.year);
      if (data.years.includes(Number(previous))) lifeYear.value = previous;
      panel.innerHTML = lifePanel(data); state.hidden = true;
    } catch (error) { if (token===request && root.isConnected) { state.hidden=false; state.textContent=error?.message||'Life production could not load.'; } }
  }
  async function loadMedicare() {
    const token = ++request; state.hidden=false; state.textContent='Loading Medicare tracking…'; panel.innerHTML='';
    try {
      const data = await mhRepository.medicareCommissionTracker({ agent:agent?.value||'', contractYear:medicareYear.value });
      if (token!==request || !root.isConnected) return;
      medicareYear.innerHTML = selectorOptions(data.years,data.contractYear);
      panel.innerHTML = medicarePanel(data); state.hidden=true;
    } catch (error) { if (token===request && root.isConnected) { state.hidden=false; state.textContent=error?.message||'Medicare tracking could not load.'; } }
  }
  function load() { return view==='life' ? loadLife() : loadMedicare(); }
  root.querySelectorAll('[data-tracker-tab]').forEach(button => button.onclick = () => {
    view = button.dataset.trackerTab;
    root.querySelectorAll('[data-tracker-tab]').forEach(item => { item.classList.toggle('active',item===button); item.setAttribute('aria-selected',String(item===button)); });
    root.querySelector('[data-life-month-wrap]').hidden = view!=='life';
    root.querySelector('[data-life-year-wrap]').hidden = view!=='life';
    root.querySelector('[data-medicare-year-wrap]').hidden = view!=='medicare';
    load();
  });
  lifeMonth.onchange = loadLife;
  lifeYear.onchange = loadLife;
  medicareYear.onchange = loadMedicare;
  if (agent) agent.onchange = load;
  loadLife();
}
function bindCommissionDialog(dialog) {
  if (!dialog || dialog.dataset.commissionTrackerQueued === 'true') return;
  dialog.dataset.commissionTrackerQueued = 'true';
  queueMicrotask(() => mountCommissionTracker(dialog));
}
function enhance(root = document) {
  root.querySelectorAll?.('.client-search-panel').forEach(ensureClientStats);
  root.querySelectorAll?.('dialog.commissions-dialog').forEach(bindCommissionDialog);
}

const savedSaveClient = mhRepository.saveClient.bind(mhRepository);
mhRepository.saveClient = async function saveClientAndRefreshSummary(...args) {
  const saved = await savedSaveClient(...args);
  queueMicrotask(() => void refreshClientStats());
  return saved;
};
const app = document.getElementById('app');
if (app) new MutationObserver(mutations => {
  if (mutations.some(mutation => [...mutation.addedNodes].some(node => node instanceof Element && (node.matches?.('.client-search-panel,dialog.commissions-dialog') || node.querySelector?.('.client-search-panel,dialog.commissions-dialog'))))) enhance(app);
}).observe(app,{childList:true,subtree:true});
enhance();
