-- Add a correction action without changing the five normal contact outcomes.
-- Existing history, attempt totals, client information and calendar items are retained.
alter table public.campaign_contact_log drop constraint campaign_contact_log_outcome_check;
alter table public.campaign_contact_log add constraint campaign_contact_log_outcome_check
  check (outcome in ('no_answer','voicemail','declined','appointment','follow_up','return_step1'));

create or replace function public.campaign_return_to_step_one(
  p_member_id uuid, p_operation_id uuid, p_expected_version integer, p_note text default ''
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  m public.campaign_members%rowtype;
  c public.campaigns%rowtype;
  prior public.campaign_contact_log%rowtype;
  previous_label text;
begin
  if auth.uid() is null or not private.is_active_crm_user() then
    raise exception 'Sign in with an active CRM account.' using errcode='42501';
  end if;
  if p_operation_id is null then raise exception 'An update identifier is required.'; end if;
  -- RLS scopes the member to campaigns this user may manage.
  select * into m from public.campaign_members where id=p_member_id for update;
  if not found then raise exception 'Campaign client not found or access denied.' using errcode='42501'; end if;
  select * into prior from public.campaign_contact_log where id=p_operation_id;
  if found then
    if prior.member_id<>m.id or prior.outcome<>'return_step1' then
      raise exception 'This update identifier was already used.';
    end if;
    return jsonb_build_object('saved',true,'already_saved',true,'member_id',m.id);
  end if;
  select * into c from public.campaigns where id=m.campaign_id for share;
  if not found or c.status<>'active' then raise exception 'Reopen this campaign before returning a client to Step 1.'; end if;
  if not exists(select 1 from public.clients where id=m.client_id and status<>'deceased') then
    raise exception 'Contact is disabled for a deceased or unavailable client.' using errcode='42501';
  end if;
  if p_expected_version is null or m.version<>p_expected_version then
    raise exception 'This campaign client was updated in another session. Refresh the campaign and try again.' using errcode='40001';
  end if;
  if length(coalesce(p_note,''))>3800 then raise exception 'The correction note is too long.'; end if;
  previous_label:=case m.contact_status when 'no_answer' then 'No Answer' when 'voicemail' then 'Voicemail Left'
    when 'declined' then 'Declined' when 'appointment' then 'Appointment' when 'follow_up' then 'Follow Up / More Info Needed' else 'Not Contacted' end;
  insert into public.campaign_contact_log(id,member_id,actor_id,outcome,note,appointment_id)
  values(p_operation_id,m.id,auth.uid(),'return_step1',
    concat_ws(E'\n','Returned to Step 1 from '||previous_label||'.',nullif(btrim(p_note),'')),m.next_event_id);
  -- Reset only campaign placement. A correction is not a contact attempt.
  update public.campaign_members set contact_status='not_contacted',version=version+1 where id=m.id;
  if not found then raise exception 'The correction could not be saved.' using errcode='42501'; end if;
  return jsonb_build_object('saved',true,'already_saved',false,'member_id',m.id,'contact_status','not_contacted');
end $$;
revoke all on function public.campaign_return_to_step_one(uuid,uuid,integer,text) from public,anon;
grant execute on function public.campaign_return_to_step_one(uuid,uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
