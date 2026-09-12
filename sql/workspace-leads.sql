create table if not exists public.workspace_leads (
  id uuid primary key default gen_random_uuid(),
  assigned_agent_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  phone text,
  product_type text not null check (product_type in ('medicare','life','retirement')),
  is_medicare boolean not null default false,
  is_life boolean not null default false,
  is_retirement boolean not null default false,
  notes text,
  status text not null default 'lead' check (status in ('lead','converted')),
  client_id uuid references public.clients(id) on delete set null,
  converted_at timestamptz,
  photo_storage_path text,
  photo_file_name text,
  photo_mime_type text,
  photo_uploaded_at timestamptz,
  source_system text not null default 'mh',
  source_record_id uuid,
  source_photo_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_leads_one_product check (is_medicare or is_life or is_retirement)
);
create unique index if not exists workspace_leads_source_record_uidx on public.workspace_leads(source_system, source_record_id) where source_record_id is not null;
create index if not exists workspace_leads_owner_status_idx on public.workspace_leads(assigned_agent_id, status, created_at desc);
create index if not exists workspace_leads_phone_idx on public.workspace_leads(phone) where phone is not null;
create index if not exists workspace_leads_client_idx on public.workspace_leads(client_id) where client_id is not null;
drop trigger if exists workspace_leads_set_updated_at on public.workspace_leads;
create trigger workspace_leads_set_updated_at before update on public.workspace_leads for each row execute function public.set_updated_at();
alter table public.workspace_leads enable row level security;
revoke all on public.workspace_leads from anon;
revoke all on public.workspace_leads from public;
grant select, insert, update, delete on public.workspace_leads to authenticated;
drop policy if exists workspace_leads_select on public.workspace_leads;
create policy workspace_leads_select on public.workspace_leads for select to authenticated using (private.is_active_crm_user());
drop policy if exists workspace_leads_insert on public.workspace_leads;
create policy workspace_leads_insert on public.workspace_leads for insert to authenticated with check (private.is_active_crm_user() and created_by = auth.uid());
drop policy if exists workspace_leads_update on public.workspace_leads;
create policy workspace_leads_update on public.workspace_leads for update to authenticated using (private.is_active_crm_user()) with check (private.is_active_crm_user());
drop policy if exists workspace_leads_delete on public.workspace_leads;
create policy workspace_leads_delete on public.workspace_leads for delete to authenticated using (private.is_active_crm_user());
