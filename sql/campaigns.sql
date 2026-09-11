-- One Contact stage, explicit outcomes, and shared CRM calendar appointments.
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  topic text not null default 'general' check (topic in ('general','medicare','life','health','retirement','other')),
  description text not null default '' check (length(description) <= 4000),
  owner_id uuid not null default auth.uid() references public.profiles(id),
  assigned_agent_id uuid not null default auth.uid() references public.profiles(id),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  added_by uuid not null default auth.uid() references public.profiles(id),
  added_at timestamptz not null default now(),
  contact_status text not null default 'not_contacted' check (contact_status in ('not_contacted','no_answer','voicemail','declined','appointment','follow_up')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_contacted_at timestamptz,
  last_note text not null default '' check (length(last_note) <= 4000),
  next_action text not null default '' check (length(next_action) <= 500),
  next_event_id uuid references public.appointments(id) on delete set null,
  version integer not null default 0,
  unique(campaign_id,client_id)
);
create table public.campaign_contact_log (
  id uuid primary key,
  member_id uuid not null references public.campaign_members(id) on delete cascade,
  actor_id uuid not null default auth.uid() references public.profiles(id),
  outcome text not null check (outcome in ('no_answer','voicemail','declined','appointment','follow_up')),
  note text not null default '' check (length(note) <= 4000),
  next_action text not null default '' check (length(next_action) <= 500),
  appointment_id uuid references public.appointments(id) on delete set null,
  created_at timestamptz not null default now()
);
create index campaigns_owner_created_idx on public.campaigns(owner_id,created_at desc);
create index campaigns_agent_created_idx on public.campaigns(assigned_agent_id,created_at desc);
create index campaign_members_status_idx on public.campaign_members(campaign_id,contact_status,added_at,id);
create index campaign_members_client_idx on public.campaign_members(client_id);
create index campaign_members_added_by_idx on public.campaign_members(added_by);
create index campaign_members_next_event_idx on public.campaign_members(next_event_id);
create index campaign_contact_log_member_idx on public.campaign_contact_log(member_id,created_at desc);
create index campaign_contact_log_actor_idx on public.campaign_contact_log(actor_id);
create index campaign_contact_log_appointment_idx on public.campaign_contact_log(appointment_id);
create trigger campaigns_updated_at before update on public.campaigns for each row execute function public.set_updated_at();
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.campaign_contact_log enable row level security;
revoke all on public.campaigns, public.campaign_members, public.campaign_contact_log from public, anon, authenticated;
grant select,insert on public.campaigns, public.campaign_members, public.campaign_contact_log to authenticated;
grant update(name,topic,description,status) on public.campaigns to authenticated;
grant update(contact_status,attempt_count,last_contacted_at,last_note,next_action,next_event_id,version) on public.campaign_members to authenticated;
grant all on public.campaigns,public.campaign_members,public.campaign_contact_log to service_role;
create policy campaigns_read on public.campaigns for select to authenticated using (
  (select private.is_active_crm_user()) and (owner_id=(select auth.uid()) or assigned_agent_id=(select auth.uid()) or (select private.is_crm_admin()))
);
create policy campaigns_insert on public.campaigns for insert to authenticated with check (
  (select private.is_active_crm_user()) and owner_id=(select auth.uid()) and
  (assigned_agent_id=(select auth.uid()) or (select private.is_crm_admin())) and
  exists(select 1 from public.profiles p where p.id=assigned_agent_id and p.active)
);
create policy campaigns_update on public.campaigns for update to authenticated using (
  (select private.is_active_crm_user()) and (owner_id=(select auth.uid()) or assigned_agent_id=(select auth.uid()) or (select private.is_crm_admin()))
) with check (
  (select private.is_active_crm_user()) and (owner_id=(select auth.uid()) or assigned_agent_id=(select auth.uid()) or (select private.is_crm_admin()))
);
create policy campaign_members_read on public.campaign_members for select to authenticated using (
  exists(select 1 from public.campaigns c where c.id=campaign_id)
);
create policy campaign_members_insert on public.campaign_members for insert to authenticated with check (
  added_by=(select auth.uid()) and contact_status='not_contacted' and attempt_count=0 and version=0 and
  exists(select 1 from public.campaigns c where c.id=campaign_id and c.status='active') and
  exists(select 1 from public.clients c where c.id=client_id and c.status <> 'deceased')
);
create policy campaign_members_update on public.campaign_members for update to authenticated using (
  exists(select 1 from public.campaigns c where c.id=campaign_id and c.status='active')
) with check (
  exists(select 1 from public.campaigns c where c.id=campaign_id and c.status='active')
);
create policy campaign_contact_log_read on public.campaign_contact_log for select to authenticated using (
  exists(select 1 from public.campaign_members m where m.id=member_id)
);
create policy campaign_contact_log_insert on public.campaign_contact_log for insert to authenticated with check (
  actor_id=(select auth.uid()) and exists(select 1 from public.campaign_members m join public.campaigns c on c.id=m.campaign_id where m.id=member_id and c.status='active')
);
create view public.campaign_summaries with(security_invoker=true) as
select c.*,p.full_name as agent_name,
 count(m.id)::integer as total_count,
 count(m.id) filter(where m.attempt_count>0)::integer as contacted_count,
 count(m.id) filter(where m.contact_status='appointment')::integer as appointment_count,
 count(m.id) filter(where m.contact_status='follow_up')::integer as follow_up_count,
 count(m.id) filter(where m.contact_status='declined')::integer as declined_count
from public.campaigns c left join public.profiles p on p.id=c.assigned_agent_id
left join public.campaign_members m on m.campaign_id=c.id group by c.id,p.full_name;
create view public.campaign_member_results with(security_invoker=true) as
select m.*,c.first_name,c.last_name,c.phone,c.county,c.state,c.products,c.status as client_status,
 btrim(concat_ws(' ',c.first_name,c.last_name)) as full_name,
 lower(nullif(btrim(c.last_name),'')) as last_name_sort,
 lower(nullif(btrim(c.first_name),'')) as first_name_sort,
 lower(nullif(btrim(c.county),'')) as county_sort,
 upper(nullif(btrim(c.state),'')) as state_sort,
 e.event_date as next_event_date,e.start_time as next_event_time,e.status as next_event_status,
 e.assigned_agent_id as next_event_agent_id
from public.campaign_members m join public.clients c on c.id=m.client_id left join public.appointments e on e.id=m.next_event_id;
revoke all on public.campaign_summaries,public.campaign_member_results from public,anon,authenticated;
grant select on public.campaign_summaries,public.campaign_member_results to authenticated,service_role;

-- Serialize bookings for the same agent/day, including bookings made outside Campaigns.
-- Existing entries are untouched; only a newly scheduled slot or changed slot is checked.
create function private.check_crm_calendar_slot() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare proposed tsrange;
begin
 if new.status <> 'scheduled' or new.assigned_agent_id is null then return new; end if;
 if tg_op='UPDATE' and (new.event_date,new.start_time,new.end_time,new.assigned_agent_id,new.status) is not distinct from (old.event_date,old.start_time,old.end_time,old.assigned_agent_id,old.status) then return new; end if;
 if new.start_time is not null and new.end_time is not null and new.end_time<=new.start_time then raise exception 'End time must be after start time.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.assigned_agent_id::text || ':' || new.event_date::text,0));
 proposed:=tsrange(new.event_date+coalesce(new.start_time,time '00:00'),
   case when new.start_time is null then (new.event_date+1)::timestamp else new.event_date+coalesce(new.end_time,new.start_time)+case when new.end_time is null then interval '30 minutes' else interval '0' end end,'[)');
 if exists(select 1 from public.appointments a where a.id<>new.id and a.assigned_agent_id=new.assigned_agent_id and a.event_date=new.event_date and a.status='scheduled' and
   tsrange(a.event_date+coalesce(a.start_time,time '00:00'),case when a.start_time is null then (a.event_date+1)::timestamp when a.end_time>a.start_time then a.event_date+a.end_time else a.event_date+a.start_time+interval '30 minutes' end,'[)') && proposed)
 then raise exception 'That time is already booked. Choose another available time.' using errcode='23P01'; end if;
 return new;
end $$;
revoke all on function private.check_crm_calendar_slot() from public,anon;
grant execute on function private.check_crm_calendar_slot() to authenticated;
create trigger appointments_check_calendar_slot before insert or update on public.appointments for each row execute function private.check_crm_calendar_slot();

create function public.campaign_record_contact(
 p_member_id uuid,p_operation_id uuid,p_expected_version integer,p_outcome text,
 p_note text default '',p_next_action text default '',p_event_date date default null,
 p_start_time time default null,p_duration_minutes integer default 30,p_agent_id uuid default null,
 p_replace_event boolean default false
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare m public.campaign_members%rowtype; c public.campaigns%rowtype; person public.clients%rowtype;
 prior public.campaign_contact_log%rowtype; event_id uuid; target_agent uuid; finish timestamp;
begin
 if auth.uid() is null or not private.is_active_crm_user() then raise exception 'Sign in with an active CRM account.' using errcode='42501'; end if;
 select * into m from public.campaign_members where id=p_member_id for update;
 if not found then raise exception 'Campaign client not found or access denied.' using errcode='42501'; end if;
 select * into prior from public.campaign_contact_log where id=p_operation_id;
 if found then
   if prior.member_id<>m.id then raise exception 'This update identifier was already used.'; end if;
   return jsonb_build_object('saved',true,'already_saved',true,'event_id',prior.appointment_id,'member_id',m.id);
 end if;
 if p_operation_id is null then raise exception 'An update identifier is required.'; end if;
 select * into c from public.campaigns where id=m.campaign_id;
 if c.status<>'active' then raise exception 'Reopen this campaign before recording contact.'; end if;
 select * into person from public.clients where id=m.client_id;
 if not found or person.status='deceased' then raise exception 'Contact is disabled for a deceased or unavailable client.'; end if;
 if p_expected_version is null or m.version<>p_expected_version then raise exception 'This campaign client was updated in another session. Refresh the campaign and try again.' using errcode='40001'; end if;
 if p_outcome is null or p_outcome not in ('no_answer','voicemail','declined','appointment','follow_up') then raise exception 'Choose a valid contact result.'; end if;
 if length(coalesce(p_note,''))>4000 or length(coalesce(p_next_action,''))>500 then raise exception 'The notes or next action are too long.'; end if;
 if p_outcome in ('appointment','follow_up') then
   if p_event_date is null or p_start_time is null then raise exception 'Choose a valid date and appointment time.'; end if;
   if p_event_date < (now() at time zone 'America/Chicago')::date then raise exception 'Choose today or a future date.'; end if;
   if p_duration_minutes is null or p_duration_minutes not in (15,30,45,60,90,120) then raise exception 'Choose a valid duration.'; end if;
   finish:=p_event_date+p_start_time+make_interval(mins=>p_duration_minutes);
   if finish::date<>p_event_date then raise exception 'The appointment must end on the selected day.'; end if;
   target_agent:=coalesce(p_agent_id,c.assigned_agent_id);
   if target_agent<>c.assigned_agent_id and target_agent<>auth.uid() and not private.is_crm_admin() then raise exception 'You cannot book another agent calendar.' using errcode='42501'; end if;
   if not exists(select 1 from public.profiles where id=target_agent and active) then raise exception 'Choose an active agent.'; end if;
   if p_replace_event and m.next_event_id is not null then
     update public.appointments set status='cancelled' where id=m.next_event_id and client_id=m.client_id and status='scheduled';
   end if;
   insert into public.appointments(client_id,assigned_agent_id,title,event_type,event_date,start_time,end_time,status,notes)
   values(m.client_id,target_agent,
     (case when p_outcome='follow_up' then 'Follow Up: ' else 'Appointment: ' end)||btrim(concat_ws(' ',person.first_name,person.last_name)),
     case when p_outcome='follow_up' then 'follow_up' else 'appointment' end,p_event_date,p_start_time,finish::time,'scheduled',
     concat_ws(E'\n','Campaign: '||c.name,nullif(btrim(p_next_action),''),nullif(btrim(p_note),''))) returning id into event_id;
 end if;
 insert into public.campaign_contact_log(id,member_id,actor_id,outcome,note,next_action,appointment_id)
 values(p_operation_id,m.id,auth.uid(),p_outcome,coalesce(btrim(p_note),''),coalesce(btrim(p_next_action),''),event_id);
 update public.campaign_members set contact_status=p_outcome,attempt_count=attempt_count+1,last_contacted_at=now(),
   last_note=coalesce(btrim(p_note),''),next_action=case when event_id is not null then coalesce(btrim(p_next_action),'') else next_action end,
   next_event_id=coalesce(event_id,next_event_id),version=version+1 where id=m.id;
 return jsonb_build_object('saved',true,'already_saved',false,'event_id',event_id,'member_id',m.id);
end $$;
revoke all on function public.campaign_record_contact(uuid,uuid,integer,text,text,text,date,time,integer,uuid,boolean) from public,anon;
grant execute on function public.campaign_record_contact(uuid,uuid,integer,text,text,text,date,time,integer,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
