-- Mayer-style Medicare commission tracking for M&H CRM.
-- Future health-plan inserts/changes create a read-only commission event for authenticated CRM users.
-- No historical events are fabricated because application dates/election periods are not recoverable reliably.

create table if not exists public.medicare_commission_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  assigned_agent_id uuid references public.profiles(id) on delete set null,
  company_name text,
  plan_id text,
  application_date date not null,
  effective_date date not null,
  contract_year integer not null,
  election_period text not null check (election_period in ('AEP','OEP','SEP','IEP/T65')),
  compensation_type text not null check (compensation_type in ('initial','switch')),
  likely_t65 boolean not null default false,
  source text not null default 'health_plan_change',
  created_at timestamptz not null default now()
);

create index if not exists medicare_commission_events_agent_year_idx
  on public.medicare_commission_events (assigned_agent_id, contract_year, election_period, effective_date);
create unique index if not exists medicare_commission_events_unique_plan_change
  on public.medicare_commission_events (client_id, effective_date, coalesce(company_name,''), coalesce(plan_id,''));

alter table public.medicare_commission_events enable row level security;
drop policy if exists medicare_commission_events_staff_select on public.medicare_commission_events;
create policy medicare_commission_events_staff_select
  on public.medicare_commission_events for select to authenticated
  using (private.is_active_crm_user());

revoke all on public.medicare_commission_events from anon;
revoke insert, update, delete on public.medicare_commission_events from authenticated;
grant select on public.medicare_commission_events to authenticated;
grant all on public.medicare_commission_events to service_role;

create or replace function private.capture_medicare_commission_event()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_client public.clients%rowtype;
  v_medicare public.medicare_details%rowtype;
  v_application_date date := (now() at time zone 'America/Chicago')::date;
  v_effective_date date;
  v_likely_t65 boolean := false;
  v_compensation_type text;
  v_election_period text;
begin
  if new.effective_date is null or nullif(trim(coalesce(new.carrier, '')), '') is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (new.carrier is not distinct from old.carrier)
       and (new.plan_id is not distinct from old.plan_id)
       and (new.effective_date is not distinct from old.effective_date) then
      return new;
    end if;
  end if;

  select * into v_client from public.clients where id = new.client_id;
  if v_client.id is null or lower(coalesce(v_client.status, 'active')) = 'deceased' then
    return new;
  end if;

  select * into v_medicare from public.medicare_details where client_id = new.client_id limit 1;
  v_effective_date := new.effective_date;

  v_likely_t65 := (
    (v_medicare.part_a_date is not null and date_trunc('month', v_medicare.part_a_date) = date_trunc('month', v_effective_date))
    or (v_medicare.part_b_date is not null and date_trunc('month', v_medicare.part_b_date) = date_trunc('month', v_effective_date))
    or (
      v_client.date_of_birth is not null
      and extract(year from v_effective_date)::int = extract(year from v_client.date_of_birth)::int + 65
      and extract(month from v_effective_date)::int = extract(month from v_client.date_of_birth)::int
    )
  );

  if v_likely_t65 or tg_op = 'INSERT' then
    v_compensation_type := 'initial';
  else
    v_compensation_type := 'switch';
  end if;

  if v_likely_t65 then
    v_election_period := 'IEP/T65';
  elsif v_application_date between make_date(extract(year from v_application_date)::int, 10, 15)
        and make_date(extract(year from v_application_date)::int, 12, 7)
        and extract(month from v_effective_date)::int = 1
        and extract(day from v_effective_date)::int = 1
        and extract(year from v_effective_date)::int = extract(year from v_application_date)::int + 1 then
    v_election_period := 'AEP';
  elsif v_application_date between make_date(extract(year from v_application_date)::int, 1, 1)
        and make_date(extract(year from v_application_date)::int, 3, 31) then
    v_election_period := 'OEP';
  else
    v_election_period := 'SEP';
  end if;

  insert into public.medicare_commission_events (
    client_id, assigned_agent_id, company_name, plan_id, application_date,
    effective_date, contract_year, election_period, compensation_type, likely_t65, source
  ) values (
    v_client.id, v_client.assigned_agent_id, new.carrier, new.plan_id, v_application_date,
    v_effective_date, extract(year from v_effective_date)::int,
    v_election_period, v_compensation_type, v_likely_t65, 'health_plan_change'
  ) on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.capture_medicare_commission_event() from public, anon, authenticated;

drop trigger if exists health_plan_commission_event on public.health_plans;
create trigger health_plan_commission_event
  after insert or update of carrier, plan_id, effective_date on public.health_plans
  for each row execute function private.capture_medicare_commission_event();
