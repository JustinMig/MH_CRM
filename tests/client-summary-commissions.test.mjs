import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { centralPremiumPeriod, summarizePremiumProduction } from '../client-summary-model.js';

const source = readFileSync(new URL('../client-summary-commissions.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../client-summary-commissions.css', import.meta.url), 'utf8');

test('Central premium period respects Chicago date across UTC midnight', () => {
  assert.deepEqual(centralPremiumPeriod(new Date('2026-10-01T04:30:00Z')), { year: 2026, month: 9, monthName: 'September' });
  assert.deepEqual(centralPremiumPeriod(new Date('2026-10-01T06:30:00Z')), { year: 2026, month: 10, monthName: 'October' });
});

test('premium production sums selected month and year without inventing a Life commission rate', () => {
  const rows = [
    { effective_year: 2026, effective_month: 9, policy_count: 2, premium_total: '125.50' },
    { effective_year: 2026, effective_month: 8, policy_count: 1, premium_total: 75 },
    { effective_year: 2025, effective_month: 9, policy_count: 4, premium_total: 999 }
  ];
  assert.deepEqual(
    summarizePremiumProduction(rows, { year: 2026, month: 9, monthName: 'September' }),
    { monthly: 125.5, yearly: 200.5, monthlyPolicies: 2, yearlyPolicies: 3, monthName: 'September', year: 2026 }
  );
});

test('invalid aggregate numbers do not poison premium totals', () => {
  const result = summarizePremiumProduction([{ effective_year: 2026, effective_month: 9, policy_count: 'bad', premium_total: 'bad' }], { year: 2026, month: 9, monthName: 'September' });
  assert.equal(result.monthly, 0);
  assert.equal(result.yearly, 0);
});

test('client UI keeps the three requested compact campaign-style metrics', () => {
  for (const label of ['Total Clients', 'Medicare Clients', 'Life Clients']) assert.match(source, new RegExp(label));
  assert.match(source, /client-summary-grid/);
  assert.match(source, /life_premium_dashboard_rollup/);
  assert.match(css, /min-height:64px/);
  assert.match(css, /\.client-summary-icon\{[^}]*width:24px/);
});

test('Life tracker has selectable month/year plus monthly and yearly sales and premium', () => {
  for (const label of ['Monthly Sales', 'Monthly Premium', 'Year Sales', 'Year Premium', 'data-life-month', 'data-life-year']) assert.match(source, new RegExp(label));
  assert.match(source, /monthlySales:summary\.monthlyPolicies/);
  assert.match(source, /yearlySales:summary\.yearlyPolicies/);
  assert.match(source, /Premium and Effective Date saved on each Life policy/);
  assert.doesNotMatch(source, /life[^\n]{0,80}commission\s*(rate|percent|percentage)|premium[^\n]{0,40}\*\s*0\./i);
});

test('Medicare tracker mirrors Mayer rate model and period tracking', () => {
  assert.match(source, /2026:\s*\{ initial: 694, renewal: 347 \}/);
  assert.match(source, /2027:\s*\{ initial: 725, renewal: 363 \}/);
  for (const label of ['Current Medicare Book', 'Monthly Renewal Equivalent', 'Annual Renewal Value', 'AEP', 'OEP', 'SEP', 'T65 / IEP', 'New / T65 Initial', 'MA → MA Switch']) assert.match(source, new RegExp(label));
  assert.match(source, /medicare_commission_events/);
  assert.match(source, /annual \* \(monthsEnrolledInYear\(event\.effective_date\) \/ 12\)/);
});

test('Medicare event migration follows M&H RLS and Mayer classifications', () => {
  const sql = readFileSync(new URL('../sql/medicare-commission-tracking.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.medicare_commission_events enable row level security/i);
  assert.match(sql, /revoke all on public\.medicare_commission_events from anon/i);
  assert.match(sql, /private\.is_active_crm_user\(\)/i);
  assert.match(sql, /IEP\/T65/);
  assert.match(sql, /'AEP'/);
  assert.match(sql, /'OEP'/);
  assert.match(sql, /'SEP'/);
  assert.match(sql, /v_compensation_type := 'initial'/);
  assert.match(sql, /v_compensation_type := 'switch'/);
  assert.match(sql, /after insert or update of carrier, plan_id, effective_date/i);
});

test('Life premium rollup remains invoker-secured and uses actual policy premium/effective date', () => {
  const sql = readFileSync(new URL('../sql/life-premium-dashboard-rollup.sql', import.meta.url), 'utf8');
  assert.match(sql, /security_invoker\s*=\s*true/i);
  assert.match(sql, /sum\(coalesce\(lp\.premium/i);
  assert.match(sql, /extract\(year from lp\.effective_date\)/i);
  assert.match(sql, /revoke all .* anon/i);
});

test('commission tracker mounts once rather than observing and rewriting its own body', () => {
  assert.match(source, /commissionTrackerQueued/);
  assert.match(source, /queueMicrotask\(\(\) => mountCommissionTracker/);
  assert.doesNotMatch(source, /observer\.observe\(body/);
});
