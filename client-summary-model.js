export function centralPremiumPeriod(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('Invalid date');
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit'
    }).formatToParts(now).map(part => [part.type, part.value])
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const monthName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'long' }).format(now);
  return { year, month, monthName };
}

export function summarizePremiumProduction(rows = [], period = centralPremiumPeriod()) {
  let monthly = 0, yearly = 0, monthlyPolicies = 0, yearlyPolicies = 0;
  for (const row of rows || []) {
    const year = Number(row?.effective_year), month = Number(row?.effective_month);
    if (year !== Number(period.year)) continue;
    const premium = Number(row?.premium_total || 0);
    const policies = Number(row?.policy_count || 0);
    if (Number.isFinite(premium)) yearly += premium;
    if (Number.isFinite(policies)) yearlyPolicies += policies;
    if (month === Number(period.month)) {
      if (Number.isFinite(premium)) monthly += premium;
      if (Number.isFinite(policies)) monthlyPolicies += policies;
    }
  }
  return { monthly, yearly, monthlyPolicies, yearlyPolicies, monthName: period.monthName, year: period.year };
}
