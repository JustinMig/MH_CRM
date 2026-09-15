alter table public.client_sms_messages add column if not exists hidden_at timestamptz;
alter table public.ringcentral_calls add column if not exists hidden_at timestamptz;

create index if not exists client_sms_messages_visible_client_idx
  on public.client_sms_messages (client_id, occurred_at desc)
  where hidden_at is null;

create index if not exists ringcentral_calls_visible_client_idx
  on public.ringcentral_calls (client_id, started_at desc)
  where hidden_at is null;

grant select, update on public.client_sms_messages to authenticated;
grant select on public.ringcentral_calls to authenticated;
grant update (hidden_at) on public.ringcentral_calls to authenticated;

drop policy if exists client_sms_messages_staff_select on public.client_sms_messages;
create policy client_sms_messages_staff_select
on public.client_sms_messages
for select
to authenticated
using ((select private.is_active_crm_user()) and hidden_at is null);

drop policy if exists ringcentral_calls_staff_select on public.ringcentral_calls;
create policy ringcentral_calls_staff_select
on public.ringcentral_calls
for select
to authenticated
using ((select private.is_active_crm_user()) and hidden_at is null);

drop policy if exists ringcentral_calls_staff_update on public.ringcentral_calls;
create policy ringcentral_calls_staff_update
on public.ringcentral_calls
for update
to authenticated
using ((select private.is_active_crm_user()))
with check ((select private.is_active_crm_user()));
