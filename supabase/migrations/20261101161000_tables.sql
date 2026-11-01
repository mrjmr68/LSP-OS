-- LSP OS tables. Authority: docs/DATA_MODEL.md (Nov 1, 2026).
-- Money is integer cents. Timestamps are UTC. Every table has id, created_at, updated_at.
-- Customer = management company. Residents are never customers.
-- ServiceRequest 1 → N ServiceVisit. One invoice per request.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('auth.users') is null then
    raise exception
      'auth.users is missing. Apply these migrations on Supabase, or create the local auth stub first (scripts/prove-rls.sh).';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'auth.uid() is missing. Supabase provides it; local proofs create it in scripts/sql/auth_stub.sql.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.normalize_unit_label()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- v1 norm is lower + trim. Fuller unit-number normalization is still open (SPEC §18).
  new.unit_label_norm := lower(trim(new.unit_label));
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity. Spec entity "User" lives in public.profiles, linked to auth.users.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'tech',
  phone text not null,
  email text not null,
  truck_label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_not_blank check (length(trim(full_name)) > 0),
  constraint profiles_email_unique unique (email)
);

comment on table public.profiles is
  'LSP person. Owner-technicians are role owner; employees are role tech. New auth users start as tech until an owner promotes them.';

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (auth_user_id, full_name, role, phone, email, active)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'New user'
    ),
    'tech',
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'phone'), ''), 'unset'),
    coalesce(new.email, ''),
    true
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Customer (management company) and contacts.
-- billing_contact_id is required. The FK is deferred so customer and contact
-- can be inserted in one transaction.
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  billing_contact_id uuid not null,
  billing_email_override text,
  payment_terms_days integer not null,
  site_access_text text,
  addon_approval_mode public.addon_approval_mode not null,
  addon_approval_limit_cents integer,
  addon_approval_notes text,
  signoff_requirement public.signoff_requirement not null,
  signoff_notes text,
  resident_report_mode public.resident_report_mode not null,
  resident_report_notes text,
  requires_estimate_over_cents integer,
  portal_enabled boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_not_blank check (length(trim(name)) > 0),
  constraint customers_terms_nonnegative check (payment_terms_days >= 0),
  constraint customers_addon_limit check (
    addon_approval_mode <> 'do_under_limit'
    or addon_approval_limit_cents is not null
  ),
  constraint customers_addon_limit_nonnegative check (
    addon_approval_limit_cents is null or addon_approval_limit_cents >= 0
  ),
  constraint customers_estimate_threshold_nonnegative check (
    requires_estimate_over_cents is null or requires_estimate_over_cents >= 0
  )
);

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) deferrable initially deferred,
  name text not null,
  title text,
  phone text,
  email text,
  sms_ok boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_contacts_name_not_blank check (length(trim(name)) > 0)
);

alter table public.customers
  add constraint customers_billing_contact_id_fkey
  foreign key (billing_contact_id) references public.customer_contacts (id)
  deferrable initially deferred;

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  name text not null,
  address_line1 text not null,
  city text not null,
  state text not null,
  zip text not null,
  lat numeric(9, 6),
  lng numeric(9, 6),
  geofence_radius_m integer not null default 150,
  tax_rate_bps integer not null default 675,
  site_access_text text,
  lockbox_info text,
  payment_terms_days_override integer,
  addon_approval_mode_override public.addon_approval_mode,
  addon_approval_limit_cents_override integer,
  addon_approval_notes_override text,
  signoff_requirement_override public.signoff_requirement,
  signoff_notes_override text,
  resident_report_mode_override public.resident_report_mode,
  resident_report_notes_override text,
  requires_estimate_over_cents_override integer,
  portal_username text,
  portal_password_hash text,
  portal_password_set_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_name_not_blank check (length(trim(name)) > 0),
  constraint properties_geofence_positive check (geofence_radius_m > 0),
  constraint properties_tax_nonnegative check (tax_rate_bps >= 0),
  constraint properties_terms_override_nonnegative check (
    payment_terms_days_override is null or payment_terms_days_override >= 0
  ),
  constraint properties_addon_limit_override check (
    addon_approval_mode_override is distinct from 'do_under_limit'
    or addon_approval_limit_cents_override is not null
  ),
  constraint properties_portal_username_unique unique (portal_username)
);

comment on column public.properties.portal_username is
  'One shared portal login per property. No per-person portal accounts in v1.';
comment on column public.properties.lockbox_info is
  'Shown to techs on the job. Not a customer-facing field.';

create table public.contact_properties (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.customer_contacts (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_properties_unique unique (contact_id, property_id)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id),
  unit_label text not null,
  unit_label_norm text not null,
  building text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_label_not_blank check (length(trim(unit_label)) > 0),
  constraint units_property_label_unique unique (property_id, unit_label_norm)
);

create trigger units_normalize_label
  before insert or update of unit_label on public.units
  for each row execute function public.normalize_unit_label();

-- Polymorphic photos and PDFs. owner_id is not a foreign key.
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_type public.attachment_owner_type not null,
  owner_id uuid not null,
  kind public.attachment_kind not null,
  storage_path text not null,
  caption text,
  taken_at timestamptz,
  uploaded_by uuid not null references public.profiles (id),
  upload_state public.upload_state not null default 'local',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index attachments_owner_idx
  on public.attachments (owner_type, owner_id);

create table public.systems (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id),
  kind public.system_kind not null,
  brand text,
  model text,
  serial text,
  tonnage numeric(3, 1),
  refrigerant text,
  installed_on date,
  nameplate_photo_id uuid references public.attachments (id),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index systems_unit_idx on public.systems (unit_id);

-- ---------------------------------------------------------------------------
-- The Board card and its visits.
-- ---------------------------------------------------------------------------

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  number integer generated always as identity,
  display_number text generated always as ('LSP-' || number::text) stored,
  customer_id uuid not null references public.customers (id),
  property_id uuid not null references public.properties (id),
  unit_id uuid not null references public.units (id),
  contact_id uuid not null references public.customer_contacts (id),
  issue text not null,
  source public.request_source not null,
  reported_by_resident boolean not null default false,
  submitted_by_name text,
  submitted_by_phone text,
  board_status public.board_status not null default 'new',
  priority public.request_priority not null default 'normal',
  assigned_user_id uuid references public.profiles (id),
  billable boolean not null default true,
  duplicate_of_request_id uuid references public.service_requests (id),
  parent_request_id uuid references public.service_requests (id),
  board_sort_bumped_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_requests_issue_not_blank check (length(trim(issue)) > 0),
  constraint service_requests_portal_submitter check (
    source <> 'portal'
    or (
      submitted_by_name is not null
      and length(trim(submitted_by_name)) > 0
      and submitted_by_phone is not null
      and length(trim(submitted_by_phone)) > 0
    )
  ),
  constraint service_requests_delete_pair check (
    (deleted_at is null and deleted_by is null)
    or (deleted_at is not null and deleted_by is not null)
  )
);

comment on table public.service_requests is
  'Board card. High priority is owner judgment only. Soft-delete is owner only.';
comment on column public.service_requests.priority is
  'normal or high. Techs cannot change this. High is a visual flag, not a notification.';

create index service_requests_board_idx
  on public.service_requests (board_status, priority, created_at)
  where deleted_at is null;

create index service_requests_assignee_idx
  on public.service_requests (assigned_user_id)
  where deleted_at is null;

create index service_requests_unit_created_idx
  on public.service_requests (unit_id, created_at desc);

create table public.service_visits (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests (id),
  visit_seq integer not null,
  tech_user_id uuid not null references public.profiles (id),
  assist_user_ids uuid[] not null default '{}',
  visit_type public.visit_type not null,
  status public.visit_status not null default 'planned',
  outcome_path public.outcome_path,
  tech_note text,
  attempt_reason public.attempt_reason,
  model_typed text,
  serial_typed text,
  equipment_size_text text,
  readings jsonb not null default '{}'::jsonb,
  signoff_name text,
  signoff_signature_attachment_id uuid references public.attachments (id),
  attempt_flag_for_review boolean not null default false,
  offline_conflict boolean not null default false,
  sync_state public.sync_state not null default 'synced',
  client_draft_id uuid,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_visits_seq_positive check (visit_seq >= 1),
  constraint service_visits_request_seq_unique unique (request_id, visit_seq),
  constraint service_visits_attempt_reason check (
    status <> 'attempt' or attempt_reason is not null
  )
);

create unique index service_visits_client_draft_id_key
  on public.service_visits (client_draft_id)
  where client_draft_id is not null;

create index service_visits_request_idx on public.service_visits (request_id);

create table public.time_segments (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.service_visits (id),
  user_id uuid not null references public.profiles (id),
  kind public.time_segment_kind not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  start_source public.time_source not null,
  end_source public.time_source,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_segments_end_after_start check (
    ended_at is null or ended_at >= started_at
  ),
  constraint time_segments_end_source_pair check (
    (ended_at is null and end_source is null)
    or (ended_at is not null and end_source is not null)
  )
);

comment on table public.time_segments is
  'Background clocks only. Owners read them. Techs do not watch a timer.';

create index time_segments_visit_idx on public.time_segments (visit_id);

-- ---------------------------------------------------------------------------
-- Price book. Snapshots copy money off the catalog at selection time.
-- ---------------------------------------------------------------------------

create table public.bundles (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  narrative text not null,
  pricing_kind public.pricing_kind not null,
  target_price_cents integer not null,
  reference_part_cost_cents integer,
  labor_hours numeric(5, 2) not null,
  one_shot boolean not null default false,
  quick_select_rank integer,
  requires_model_serial boolean not null default false,
  status public.bundle_status not null default 'active',
  difference_note text,
  promoted_from_invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bundles_code_unique unique (code),
  constraint bundles_code_not_blank check (length(trim(code)) > 0),
  constraint bundles_title_not_blank check (length(trim(title)) > 0),
  constraint bundles_price_nonnegative check (target_price_cents >= 0),
  constraint bundles_labor_nonnegative check (labor_hours >= 0),
  constraint bundles_reference_part_nonnegative check (
    reference_part_cost_cents is null or reference_part_cost_cents >= 0
  )
);

create table public.bundle_lines (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.bundles (id) on delete cascade,
  kind public.bundle_line_kind not null,
  description text not null,
  qty numeric(10, 2) not null,
  unit_cost_cents integer not null,
  is_placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bundle_lines_description_not_blank check (length(trim(description)) > 0),
  constraint bundle_lines_qty_positive check (qty > 0),
  constraint bundle_lines_cost_nonnegative check (unit_cost_cents >= 0)
);

create index bundle_lines_bundle_idx on public.bundle_lines (bundle_id);

create table public.visit_bundle_selections (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.service_visits (id),
  bundle_id uuid references public.bundles (id),
  code_snap text not null,
  title_snap text not null,
  narrative_snap text not null,
  price_cents_snap integer not null,
  labor_hours_snap numeric(5, 2) not null,
  labor_rate_cents_snap integer not null,
  cost_lines_snap jsonb not null,
  profit_cents_snap integer not null,
  qty integer not null default 1,
  selected_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_bundle_selections_qty_positive check (qty >= 1),
  constraint visit_bundle_selections_price_nonnegative check (price_cents_snap >= 0),
  constraint visit_bundle_selections_labor_nonnegative check (labor_hours_snap >= 0),
  constraint visit_bundle_selections_rate_nonnegative check (labor_rate_cents_snap >= 0)
);

comment on table public.visit_bundle_selections is
  'Price snapshot at selection. Later catalog edits must not rewrite this row.';

create index visit_bundle_selections_visit_idx
  on public.visit_bundle_selections (visit_id);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  branch text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_not_blank check (length(trim(name)) > 0)
);

create table public.parts_orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests (id),
  visit_id uuid not null references public.service_visits (id),
  part_description text not null,
  supplier_id uuid references public.suppliers (id),
  supplier_contact_text text,
  order_number text,
  expected_delivery_date date,
  status public.parts_order_status not null default 'needed',
  in_hand_at timestamptz,
  in_hand_by uuid references public.profiles (id),
  entered_by uuid not null references public.profiles (id),
  last_updated_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parts_orders_description_not_blank check (length(trim(part_description)) > 0),
  constraint parts_orders_in_hand_pair check (
    status <> 'in_hand'
    or (in_hand_at is not null and in_hand_by is not null)
  )
);

create index parts_orders_request_idx on public.parts_orders (request_id);

-- ---------------------------------------------------------------------------
-- Invoices and estimates. One invoice per request. Money is snapshotted.
-- reviewed_by may be an owner who also worked the call (SPEC §17.15).
-- ---------------------------------------------------------------------------

create table public.invoice_records (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.service_requests (id),
  number text,
  kind public.invoice_kind not null,
  status public.invoice_status not null default 'draft',
  bill_to_customer_id uuid not null references public.customers (id),
  bill_to_contact_id uuid not null references public.customer_contacts (id),
  bill_to_email_snap text not null,
  property_snap text not null,
  unit_snap text not null,
  subtotal_cents integer not null,
  tax_rate_bps_snap integer not null,
  tax_cents integer not null,
  total_cents integer not null,
  invoice_date date,
  due_date date,
  terms_days_snap integer not null,
  reviewed_by uuid references public.profiles (id),
  flag_question text,
  tech_one_off_narrative text,
  materials_text text,
  pdf_attachment_id uuid references public.attachments (id),
  sent_at timestamptz,
  paid_at timestamptz,
  paid_marked_by uuid references public.profiles (id),
  qbo_week_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_records_number_unique unique (number),
  constraint invoice_records_tax_rate_nonnegative check (tax_rate_bps_snap >= 0),
  constraint invoice_records_terms_nonnegative check (terms_days_snap >= 0),
  constraint invoice_records_final_fields check (
    status not in ('approved_sent', 'paid')
    or (
      number is not null
      and reviewed_by is not null
      and sent_at is not null
    )
  )
);

comment on table public.invoice_records is
  'One invoice per request. Techs may draft. Only an owner can move status to approved_sent, paid, or void.';

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoice_records (id) on delete cascade,
  sort integer not null,
  source public.invoice_line_source not null,
  visit_selection_id uuid references public.visit_bundle_selections (id),
  description_customer text not null,
  amount_cents integer not null,
  internal_cost_cents integer,
  internal_profit_cents integer,
  added_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_lines_sort_unique unique (invoice_id, sort),
  constraint invoice_lines_description_not_blank check (length(trim(description_customer)) > 0)
);

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests (id),
  number text,
  status public.estimate_status not null default 'draft',
  created_by uuid not null references public.profiles (id),
  finalized_by uuid references public.profiles (id),
  narrative text not null,
  equipment_size_text text,
  bill_to_contact_id uuid references public.customer_contacts (id),
  bill_to_email_snap text,
  property_snap text,
  unit_snap text,
  subtotal_cents integer not null default 0,
  tax_rate_bps_snap integer not null default 675,
  tax_cents integer not null default 0,
  total_cents integer not null default 0,
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  response_by_contact_id uuid references public.customer_contacts (id),
  response_note text,
  pdf_attachment_id uuid references public.attachments (id),
  public_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estimates_number_unique unique (number),
  constraint estimates_public_token_unique unique (public_token),
  constraint estimates_narrative_not_blank check (length(trim(narrative)) > 0),
  constraint estimates_tax_rate_nonnegative check (tax_rate_bps_snap >= 0)
);

comment on table public.estimates is
  'Mirrors invoices. Techs draft. Only an owner can send. One non-void estimate per request.';

create unique index estimates_one_active_per_request
  on public.estimates (request_id)
  where status <> 'void';

create table public.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  sort integer not null,
  source public.invoice_line_source not null,
  visit_selection_id uuid references public.visit_bundle_selections (id),
  description_customer text not null,
  amount_cents integer not null,
  internal_cost_cents integer,
  internal_profit_cents integer,
  added_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estimate_lines_sort_unique unique (estimate_id, sort),
  constraint estimate_lines_description_not_blank check (length(trim(description_customer)) > 0)
);

alter table public.bundles
  add constraint bundles_promoted_from_invoice_id_fkey
  foreign key (promoted_from_invoice_id) references public.invoice_records (id);

-- ---------------------------------------------------------------------------
-- Reference docs, config, audit, and downstream stubs.
-- ---------------------------------------------------------------------------

create table public.reference_docs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  brand public.reference_brand not null,
  category public.reference_category not null,
  attachment_id uuid not null references public.attachments (id),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_docs_title_not_blank check (length(trim(title)) > 0)
);

create table public.app_config (
  id integer primary key default 1,
  labor_rate_cents integer not null default 9000,
  profit_per_hour_floor_cents integer not null default 10000,
  daily_burn_cents integer not null default 240000,
  burn_day_basis public.burn_day_basis not null default 'business_days',
  non_business_dates date[] not null default '{}',
  default_tax_rate_bps integer not null default 675,
  repeat_unit_window_days integer not null default 14,
  history_window_months integer not null default 6,
  qbo_week_start_dow integer not null default 1,
  qbo_week_days integer[] not null default '{1,2,3,4,5}',
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_config_singleton check (id = 1),
  constraint app_config_labor_nonnegative check (labor_rate_cents >= 0),
  constraint app_config_floor_nonnegative check (profit_per_hour_floor_cents >= 0),
  constraint app_config_burn_nonnegative check (daily_burn_cents >= 0),
  constraint app_config_tax_nonnegative check (default_tax_rate_bps >= 0),
  constraint app_config_windows_positive check (
    repeat_unit_window_days > 0 and history_window_months > 0
  ),
  constraint app_config_qbo_dow check (qbo_week_start_dow between 0 and 6),
  constraint app_config_qbo_weekdays check (qbo_week_days = '{1,2,3,4,5}'::integer[])
);

comment on table public.app_config is
  'Singleton. Labor rate is internal cost, not a billing rate. Burn counts Mon–Fri minus US federal holidays.';

create table public.status_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests (id),
  from_status public.board_status,
  to_status public.board_status not null,
  actor_id uuid references public.profiles (id),
  trigger public.status_trigger not null,
  reason text,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.status_events.reason is
  'Required when an owner skips a forward gate or reopens a closed request.';

create index status_events_request_idx on public.status_events (request_id, at);

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.service_requests (id),
  channel public.message_channel not null,
  to_address text not null,
  template public.message_template not null,
  body text not null,
  provider_id text,
  status public.outbound_status not null default 'queued',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.qbo_weekly_pushes (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  week_end date not null,
  gross_cents integer not null,
  tax_cents integer not null,
  invoice_count integer not null,
  status public.qbo_push_status not null default 'pending',
  qbo_ref text,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qbo_weekly_pushes_week_unique unique (week_start, week_end),
  constraint qbo_weekly_pushes_week_order check (week_end >= week_start),
  constraint qbo_weekly_pushes_count_nonnegative check (invoice_count >= 0)
);

comment on table public.qbo_weekly_pushes is
  'Future. One company-wide gross sales total per Mon–Fri week. Not per invoice.';

alter table public.invoice_records
  add constraint invoice_records_qbo_week_id_fkey
  foreign key (qbo_week_id) references public.qbo_weekly_pushes (id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoice_records (id),
  amount_cents integer not null,
  received_on date not null,
  method text,
  ref text,
  entered_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_amount_positive check (amount_cents > 0)
);

-- Effective contract: property override, otherwise the customer value.
create view public.property_contract
with (security_invoker = true) as
select
  p.id as property_id,
  p.customer_id,
  coalesce(p.payment_terms_days_override, c.payment_terms_days) as payment_terms_days,
  coalesce(p.site_access_text, c.site_access_text) as site_access_text,
  p.lockbox_info,
  coalesce(p.addon_approval_mode_override, c.addon_approval_mode) as addon_approval_mode,
  case
    when p.addon_approval_mode_override is null then c.addon_approval_limit_cents
    else p.addon_approval_limit_cents_override
  end as addon_approval_limit_cents,
  coalesce(p.addon_approval_notes_override, c.addon_approval_notes) as addon_approval_notes,
  coalesce(p.signoff_requirement_override, c.signoff_requirement) as signoff_requirement,
  coalesce(p.signoff_notes_override, c.signoff_notes) as signoff_notes,
  coalesce(p.resident_report_mode_override, c.resident_report_mode) as resident_report_mode,
  coalesce(p.resident_report_notes_override, c.resident_report_notes) as resident_report_notes,
  case
    when p.requires_estimate_over_cents_override is null then c.requires_estimate_over_cents
    else p.requires_estimate_over_cents_override
  end as requires_estimate_over_cents,
  p.tax_rate_bps
from public.properties p
join public.customers c on c.id = p.customer_id;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'customers',
    'customer_contacts',
    'properties',
    'contact_properties',
    'units',
    'attachments',
    'systems',
    'service_requests',
    'service_visits',
    'time_segments',
    'bundles',
    'bundle_lines',
    'visit_bundle_selections',
    'suppliers',
    'parts_orders',
    'invoice_records',
    'invoice_lines',
    'estimates',
    'estimate_lines',
    'reference_docs',
    'app_config',
    'status_events',
    'outbound_messages',
    'qbo_weekly_pushes',
    'payments'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end $$;
