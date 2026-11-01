-- Row level security and write guards.
-- Authenticated techs can read the Board and draft work.
-- They cannot approve invoices, change priority, delete requests, send estimates,
-- or edit the price book. Owners can.
-- service_role and the migration role bypass these session checks. The app uses the anon key
-- as the authenticated role. Do not put the service role key in the browser.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Who is calling
-- ---------------------------------------------------------------------------

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.active
  limit 1
$$;

create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.active
  limit 1
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() = 'owner'
$$;

create or replace function public.is_tech()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() = 'tech'
$$;

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() is not null
$$;

-- True when this session is an app user (RLS applies). Migration and service_role skip guards.
create or replace function public.is_app_session()
returns boolean
language sql
stable
as $$
  select current_user in ('authenticated', 'anon')
$$;

create or replace function public.request_priority_is(
  request_id uuid,
  priority public.request_priority
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.service_requests r
    where r.id = request_id
      and r.priority = request_priority_is.priority
  )
$$;

-- Tech status changes are only the work events in STATE_MACHINES. Owners use the status switch.
create or replace function public.tech_may_change_board_status(
  old_status public.board_status,
  new_status public.board_status,
  assigned_to_self boolean
)
returns boolean
language sql
immutable
as $$
  select case
    when old_status in ('assigned', 'ready')
      and new_status = 'in_progress'
      and assigned_to_self then true
    when old_status = 'in_progress'
      and new_status in ('complete', 'parts', 'to_estimate', 'assigned', 'ready') then true
    when old_status = 'parts' and new_status = 'ready' then true
    else false
  end
$$;

-- ---------------------------------------------------------------------------
-- Triggers. RLS is the API gate. Triggers repeat the rules so a too-wide policy
-- still cannot approve an invoice or raise High.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_app_session() then
    return new;
  end if;

  if tg_op = 'INSERT' and new.role = 'owner' and not public.is_owner() then
    raise exception 'only owners can grant the owner role'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and not public.is_owner() then
    if new.role is distinct from old.role then
      raise exception 'only owners can change roles'
        using errcode = '42501';
    end if;
    if new.active is distinct from old.active
      or new.auth_user_id is distinct from old.auth_user_id then
      raise exception 'only owners can change account standing'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard_write
  before insert or update on public.profiles
  for each row execute function public.guard_profile_write();

create or replace function public.guard_service_request()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor_is_owner boolean;
  assigned_to_self boolean;
begin
  if not public.is_app_session() then
    return new;
  end if;

  actor_is_owner := public.is_owner();

  if not actor_is_owner and not public.is_tech() then
    raise exception 'not an active LSP user'
      using errcode = '42501';
  end if;

  if not actor_is_owner and new.priority = 'high'
    and (tg_op = 'INSERT' or old.priority is distinct from 'high') then
    raise exception 'tech cannot elevate priority to high'
      using errcode = '42501';
  end if;

  if not actor_is_owner and tg_op = 'UPDATE' and new.priority is distinct from old.priority then
    raise exception 'tech cannot change priority'
      using errcode = '42501';
  end if;

  if not actor_is_owner and (
    (tg_op = 'INSERT' and new.deleted_at is not null)
    or (
      tg_op = 'UPDATE'
      and (
        new.deleted_at is distinct from old.deleted_at
        or new.deleted_by is distinct from old.deleted_by
      )
    )
  ) then
    raise exception 'tech cannot delete requests'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and not actor_is_owner and new.board_status <> 'new' then
    raise exception 'tech cannot set board status on create'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.board_status is distinct from old.board_status then
    if not actor_is_owner then
      assigned_to_self :=
        old.assigned_user_id = public.current_profile_id()
        or new.assigned_user_id = public.current_profile_id();
      if not public.tech_may_change_board_status(
        old.board_status,
        new.board_status,
        assigned_to_self
      ) then
        raise exception 'tech cannot change status except through visit work'
          using errcode = '42501';
      end if;
    end if;

    if old.board_status = 'parts' and new.board_status = 'ready' then
      if not exists (
        select 1
        from public.parts_orders po
        where po.request_id = new.id
          and po.status = 'in_hand'
      ) and (
        not actor_is_owner
        or coalesce(current_setting('app.status_override_reason', true), '') = ''
      ) then
        raise exception 'parts cannot move to ready until a part is in hand'
          using errcode = '42501';
      end if;
    end if;

    if actor_is_owner
      and old.board_status = 'closed'
      and coalesce(current_setting('app.status_override_reason', true), '') = '' then
      raise exception 'reopening a closed request requires a reason'
        using errcode = '42501';
    end if;

    if not actor_is_owner and new.board_status = 'invoiced' then
      raise exception 'tech cannot approve invoices'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger service_requests_guard
  before insert or update on public.service_requests
  for each row execute function public.guard_service_request();

create or replace function public.guard_invoice()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_app_session() then
    return new;
  end if;

  if public.is_owner() then
    return new;
  end if;

  if not public.is_tech() then
    raise exception 'not an active LSP user'
      using errcode = '42501';
  end if;

  if new.status in ('approved_sent', 'paid', 'void')
    or new.reviewed_by is not null
    or new.sent_at is not null
    or new.paid_at is not null
    or new.paid_marked_by is not null then
    raise exception 'tech cannot approve invoices'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (
    new.subtotal_cents is distinct from old.subtotal_cents
    or new.tax_cents is distinct from old.tax_cents
    or new.total_cents is distinct from old.total_cents
    or new.tax_rate_bps_snap is distinct from old.tax_rate_bps_snap
    or new.number is distinct from old.number
  ) then
    raise exception 'tech cannot adjust invoice amounts'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger invoice_records_guard
  before insert or update on public.invoice_records
  for each row execute function public.guard_invoice();

create or replace function public.guard_invoice_line()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_app_session() or public.is_owner() then
    return new;
  end if;

  if tg_op = 'UPDATE' and (
    new.amount_cents is distinct from old.amount_cents
    or new.internal_cost_cents is distinct from old.internal_cost_cents
    or new.internal_profit_cents is distinct from old.internal_profit_cents
  ) then
    raise exception 'tech cannot adjust invoice lines'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger invoice_lines_guard
  before insert or update on public.invoice_lines
  for each row execute function public.guard_invoice_line();

create or replace function public.guard_estimate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_app_session() or public.is_owner() then
    return new;
  end if;

  if new.status not in ('draft', 'in_review') or new.finalized_by is not null or new.sent_at is not null then
    raise exception 'tech cannot send estimates'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger estimates_guard
  before insert or update on public.estimates
  for each row execute function public.guard_estimate();

create or replace function public.guard_catalog_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_app_session() and not public.is_owner() then
    raise exception 'tech cannot change bundle prices'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger bundles_guard_write
  before insert or update or delete on public.bundles
  for each row execute function public.guard_catalog_write();

create trigger bundle_lines_guard_write
  before insert or update or delete on public.bundle_lines
  for each row execute function public.guard_catalog_write();

create or replace function public.guard_selection_price()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_app_session() or public.is_owner() or tg_op = 'INSERT' then
    return new;
  end if;

  if new.price_cents_snap is distinct from old.price_cents_snap
    or new.labor_rate_cents_snap is distinct from old.labor_rate_cents_snap
    or new.profit_cents_snap is distinct from old.profit_cents_snap
    or new.cost_lines_snap is distinct from old.cost_lines_snap then
    raise exception 'tech cannot change bundle prices'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger visit_bundle_selections_guard_price
  before update on public.visit_bundle_selections
  for each row execute function public.guard_selection_price();

create or replace function public.guard_parts_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_app_session() and not public.is_owner() and new.status = 'cancelled' then
    raise exception 'only owners can cancel a parts order'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger parts_orders_guard
  before insert or update on public.parts_orders
  for each row execute function public.guard_parts_order();

-- ---------------------------------------------------------------------------
-- Policies. Permissive policies are OR'd. Do not add a wide policy beside a narrow one.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.properties enable row level security;
alter table public.contact_properties enable row level security;
alter table public.units enable row level security;
alter table public.attachments enable row level security;
alter table public.systems enable row level security;
alter table public.service_requests enable row level security;
alter table public.service_visits enable row level security;
alter table public.time_segments enable row level security;
alter table public.bundles enable row level security;
alter table public.bundle_lines enable row level security;
alter table public.visit_bundle_selections enable row level security;
alter table public.suppliers enable row level security;
alter table public.parts_orders enable row level security;
alter table public.invoice_records enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_lines enable row level security;
alter table public.reference_docs enable row level security;
alter table public.app_config enable row level security;
alter table public.status_events enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.qbo_weekly_pushes enable row level security;
alter table public.payments enable row level security;

-- Profiles: everyone on the crew can see names. Only owners change roles.
create policy profiles_select_member on public.profiles
  for select to authenticated
  using (public.is_active_member());

create policy profiles_insert_owner on public.profiles
  for insert to authenticated
  with check (public.is_owner());

create policy profiles_update_owner on public.profiles
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (auth_user_id = auth.uid() and public.is_active_member())
  with check (
    auth_user_id = auth.uid()
    and role = public.current_profile_role()
  );

-- Customer contract. Crew can read. Owners write companies and properties.
create policy customers_select_member on public.customers
  for select to authenticated
  using (public.is_active_member());

create policy customers_write_owner on public.customers
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy contacts_select_member on public.customer_contacts
  for select to authenticated
  using (public.is_active_member());

create policy contacts_insert_member on public.customer_contacts
  for insert to authenticated
  with check (public.is_active_member());

create policy contacts_update_owner on public.customer_contacts
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy properties_select_member on public.properties
  for select to authenticated
  using (public.is_active_member());

create policy properties_write_owner on public.properties
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy contact_properties_select_member on public.contact_properties
  for select to authenticated
  using (public.is_active_member());

create policy contact_properties_insert_member on public.contact_properties
  for insert to authenticated
  with check (public.is_active_member());

create policy contact_properties_update_owner on public.contact_properties
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy units_select_member on public.units
  for select to authenticated
  using (public.is_active_member());

create policy units_insert_member on public.units
  for insert to authenticated
  with check (public.is_active_member());

create policy units_update_owner on public.units
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy attachments_member on public.attachments
  for all to authenticated
  using (public.is_active_member())
  with check (public.is_active_member());

create policy systems_member on public.systems
  for all to authenticated
  using (public.is_active_member())
  with check (public.is_active_member());

-- Board. Techs may open a call as New with normal priority. They cannot raise High.
create policy requests_select_member on public.service_requests
  for select to authenticated
  using (public.is_active_member());

create policy requests_insert_owner on public.service_requests
  for insert to authenticated
  with check (public.is_owner());

create policy requests_insert_tech on public.service_requests
  for insert to authenticated
  with check (
    public.is_tech()
    and priority = 'normal'
    and board_status = 'new'
    and deleted_at is null
  );

create policy requests_update_owner on public.service_requests
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy requests_update_tech on public.service_requests
  for update to authenticated
  using (public.is_tech() and deleted_at is null)
  with check (
    public.is_tech()
    and deleted_at is null
    and public.request_priority_is(id, priority)
  );

create policy visits_member on public.service_visits
  for all to authenticated
  using (public.is_active_member())
  with check (public.is_active_member());

-- Time segments: a tech writes their own clocks. Owners read all of them.
create policy time_select_owner on public.time_segments
  for select to authenticated
  using (public.is_owner() or user_id = public.current_profile_id());

create policy time_insert_self on public.time_segments
  for insert to authenticated
  with check (public.is_owner() or user_id = public.current_profile_id());

create policy time_update_self on public.time_segments
  for update to authenticated
  using (public.is_owner() or user_id = public.current_profile_id())
  with check (public.is_owner() or user_id = public.current_profile_id());

create policy bundles_select_member on public.bundles
  for select to authenticated
  using (public.is_active_member());

create policy bundles_write_owner on public.bundles
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy bundle_lines_select_member on public.bundle_lines
  for select to authenticated
  using (public.is_active_member());

create policy bundle_lines_write_owner on public.bundle_lines
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy selections_select_member on public.visit_bundle_selections
  for select to authenticated
  using (public.is_active_member());

create policy selections_insert_member on public.visit_bundle_selections
  for insert to authenticated
  with check (public.is_active_member());

create policy selections_update_owner on public.visit_bundle_selections
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy suppliers_select_member on public.suppliers
  for select to authenticated
  using (public.is_active_member());

create policy suppliers_write_owner on public.suppliers
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy parts_select_member on public.parts_orders
  for select to authenticated
  using (public.is_active_member());

create policy parts_write_member on public.parts_orders
  for insert to authenticated
  with check (public.is_active_member());

create policy parts_update_member on public.parts_orders
  for update to authenticated
  using (public.is_active_member())
  with check (public.is_active_member());

-- Invoices. Techs can see and draft. They cannot approve, send, void, or mark paid.
create policy invoices_select_member on public.invoice_records
  for select to authenticated
  using (public.is_active_member());

create policy invoices_insert_owner on public.invoice_records
  for insert to authenticated
  with check (public.is_owner());

create policy invoices_insert_tech on public.invoice_records
  for insert to authenticated
  with check (
    public.is_tech()
    and status in ('draft', 'in_review')
    and reviewed_by is null
    and sent_at is null
    and paid_at is null
    and paid_marked_by is null
    and number is null
  );

create policy invoices_update_owner on public.invoice_records
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy invoices_update_tech on public.invoice_records
  for update to authenticated
  using (
    public.is_tech()
    and status in ('draft', 'in_review', 'flagged')
  )
  with check (
    public.is_tech()
    and status in ('draft', 'in_review', 'flagged')
    and reviewed_by is null
    and sent_at is null
    and paid_at is null
    and paid_marked_by is null
    and number is null
  );

create policy invoice_lines_select_member on public.invoice_lines
  for select to authenticated
  using (public.is_active_member());

create policy invoice_lines_insert_member on public.invoice_lines
  for insert to authenticated
  with check (public.is_active_member());

create policy invoice_lines_update_owner on public.invoice_lines
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy estimates_select_member on public.estimates
  for select to authenticated
  using (public.is_active_member());

create policy estimates_insert_tech on public.estimates
  for insert to authenticated
  with check (
    public.is_owner()
    or (
      public.is_tech()
      and status in ('draft', 'in_review')
      and finalized_by is null
      and sent_at is null
    )
  );

create policy estimates_update_owner on public.estimates
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy estimates_update_tech on public.estimates
  for update to authenticated
  using (public.is_tech() and status in ('draft', 'in_review'))
  with check (
    public.is_tech()
    and status in ('draft', 'in_review')
    and finalized_by is null
    and sent_at is null
  );

create policy estimate_lines_select_member on public.estimate_lines
  for select to authenticated
  using (public.is_active_member());

create policy estimate_lines_insert_member on public.estimate_lines
  for insert to authenticated
  with check (public.is_active_member());

create policy estimate_lines_update_owner on public.estimate_lines
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy reference_docs_select_member on public.reference_docs
  for select to authenticated
  using (public.is_active_member());

create policy reference_docs_write_owner on public.reference_docs
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy app_config_select_member on public.app_config
  for select to authenticated
  using (public.is_active_member());

create policy app_config_write_owner on public.app_config
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy status_events_select_member on public.status_events
  for select to authenticated
  using (public.is_active_member());

create policy status_events_insert_member on public.status_events
  for insert to authenticated
  with check (public.is_active_member());

create policy messages_select_member on public.outbound_messages
  for select to authenticated
  using (public.is_active_member());

create policy messages_insert_member on public.outbound_messages
  for insert to authenticated
  with check (public.is_active_member());

create policy qbo_owner on public.qbo_weekly_pushes
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy payments_owner on public.payments
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on public.property_contract to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

revoke all on function public.current_profile_id() from public;
revoke all on function public.current_profile_role() from public;
revoke all on function public.is_owner() from public;
revoke all on function public.is_tech() from public;
revoke all on function public.is_active_member() from public;
revoke all on function public.request_priority_is(uuid, public.request_priority) from public;

grant execute on function public.current_profile_id() to authenticated, service_role;
grant execute on function public.current_profile_role() to authenticated, service_role;
grant execute on function public.is_owner() to authenticated, service_role;
grant execute on function public.is_tech() to authenticated, service_role;
grant execute on function public.is_active_member() to authenticated, service_role;
grant execute on function public.request_priority_is(uuid, public.request_priority) to authenticated, service_role;
grant execute on function public.tech_may_change_board_status(public.board_status, public.board_status, boolean) to authenticated, service_role;
grant execute on function public.is_app_session() to authenticated, service_role;
