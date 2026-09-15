create table public.client_sms_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  direction text not null check (direction in ('inbound','outbound')),
  body text not null default '' check (length(body) <= 5000),
  from_number text,
  to_number text,
  twilio_message_sid text unique,
  status text not null default 'queued',
  error_code text,
  error_message text,
  read_at timestamptz,
  origin text not null default 'twilio_sync',
  occurred_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index client_sms_messages_client_time_idx
  on public.client_sms_messages (client_id, occurred_at desc);
create index client_sms_messages_unread_idx
  on public.client_sms_messages (client_id, occurred_at desc)
  where direction = 'inbound' and read_at is null;
create index client_sms_messages_phone_idx
  on public.client_sms_messages (from_number, to_number);
create index client_sms_messages_user_id_idx
  on public.client_sms_messages (user_id);

alter table public.client_sms_messages enable row level security;

revoke all on table public.client_sms_messages from anon;
revoke all on table public.client_sms_messages from authenticated;
grant select, update on table public.client_sms_messages to authenticated;
grant select, insert, update, delete on table public.client_sms_messages to service_role;

create policy client_sms_messages_staff_select
  on public.client_sms_messages
  for select
  to authenticated
  using ((select private.is_active_crm_user()));

create policy client_sms_messages_staff_update
  on public.client_sms_messages
  for update
  to authenticated
  using ((select private.is_active_crm_user()))
  with check ((select private.is_active_crm_user()));
