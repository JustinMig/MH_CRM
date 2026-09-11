-- Applied through Supabase MCP, migration version 20260911155935.
create view public.client_search_results with (security_invoker = true) as
select id, first_name, last_name, phone, email, date_of_birth, county, state, products, status, created_at, updated_at, assigned_agent_id, address1, city,
  nullif(upper(btrim(state)), '') as state_sort,
  nullif(lower(btrim(county)), '') as county_sort,
  nullif(lower(btrim(last_name)), '') as last_name_sort,
  nullif(lower(btrim(first_name)), '') as first_name_sort,
  btrim(concat_ws(' ', first_name, last_name)) as full_name,
  regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') as phone_digits
from public.clients;
revoke all on public.client_search_results from public, anon, authenticated;
grant select on public.client_search_results to authenticated, service_role;
comment on view public.client_search_results is 'Read-only client search projection. SECURITY INVOKER enforces clients RLS. Original creation timestamps are preserved; normalized sort keys do not modify client data.';
