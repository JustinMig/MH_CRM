-- Match Mayer CRM's Life premium-production rollup using M&H life_policies.
-- Premium is summed as entered on each policy and grouped by policy effective date.
create or replace view public.life_premium_dashboard_rollup
with (security_invoker = true)
as
select
  c.assigned_agent_id,
  extract(year from lp.effective_date)::integer as effective_year,
  extract(month from lp.effective_date)::integer as effective_month,
  count(*) filter (where coalesce(lp.premium, 0) <> 0)::bigint as policy_count,
  coalesce(sum(coalesce(lp.premium, 0)), 0)::numeric as premium_total
from public.life_policies lp
join public.clients c on c.id = lp.client_id
where lp.status = 'active'
  and lp.effective_date is not null
  and c.status <> 'deceased'
group by
  c.assigned_agent_id,
  extract(year from lp.effective_date)::integer,
  extract(month from lp.effective_date)::integer;

revoke all on public.life_premium_dashboard_rollup from public, anon;
grant select on public.life_premium_dashboard_rollup to authenticated, service_role;

notify pgrst, 'reload schema';
