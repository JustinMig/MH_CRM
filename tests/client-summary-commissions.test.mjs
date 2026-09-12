import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { centralPremiumPeriod, summarizePremiumProduction } from '../client-summary-model.js';

test('Central premium period respects Chicago date across UTC midnight', () => {
  assert.deepEqual(centralPremiumPeriod(new Date('2026-10-01T04:30:00Z')), { year: 2026, month: 9, monthName: 'September' });
  assert.deepEqual(centralPremiumPeriod(new Date('2026-10-01T06:30:00Z')), { year: 2026, month: 10, monthName: 'October' });
});

test('premium production sums the current month and year without inventing a commission rate', () => {
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
  const result = summarizePremiumProduction([
    { effective_year: 2026, effective_month: 9, policy_count: 'bad', premium_total: 'bad' }
  ], { year: 2026, month: 9, monthName: 'September' });
  assert.equal(result.monthly, 0);
  assert.equal(result.yearly, 0);
});

test('client UI contains the three requested campaign-style metrics', () => {
  const source = readFileSync(new URL('../client-summary-commissions.js', import.meta.url), 'utf8');
  for (const label of ['Total Clients', 'Medicare Clients', 'Life Clients']) assert.match(source, new RegExp(label));
  assert.match(source, /client-summary-grid/);
  assert.match(source, /life_premium_dashboard_rollup/);
});

test('life commission display is explicitly premium production', () => {
  const source = readFileSync(new URL('../client-summary-commissions.js', import.meta.url), 'utf8');
  for (const label of ['Premium production', 'Monthly Premium', 'Yearly Total', 'policy effective date']) assert.match(source, new RegExp(label, 'i'));
  assert.doesNotMatch(source, /commission\s*(rate|percent|percentage)|\*\s*0\./i);
});

test('rollup SQL uses invoker security and actual policy premium/effective date', () => {
  const sql = readFileSync(new URL('../sql/life-premium-dashboard-rollup.sql', import.meta.url), 'utf8');
  assert.match(sql, /security_invoker\s*=\s*true/i);
  assert.match(sql, /sum\(coalesce\(lp\.premium/i);
  assert.match(sql, /extract\(year from lp\.effective_date\)/i);
  assert.match(sql, /revoke all .* anon/i);
});
