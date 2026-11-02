-- Historical calls from the old workbook.
-- These are not Board cards and not invoices. Financial Pulse sums invoice_records
-- only. counts_toward_pulse is constrained false so this table cannot be marked
-- as revenue by mistake.

create table public.legacy_imports (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_file text not null,
  source_row integer not null,
  customer_id uuid references public.customers (id),
  property_id uuid references public.properties (id),
  unit_id uuid references public.units (id),
  bundle_id uuid references public.bundles (id),
  customer_name text not null,
  property_name text not null,
  unit_label text,
  job_on date not null,
  occurred_at timestamptz,
  diagnosis_code text,
  diagnosis_raw text,
  subtotal_cents integer,
  tax_rate_bps integer,
  tax_cents integer,
  total_cents integer,
  match_notes text,
  counts_toward_pulse boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legacy_imports_source_key_unique unique (source_key),
  constraint legacy_imports_source_file_not_blank check (length(trim(source_file)) > 0),
  constraint legacy_imports_source_row_positive check (source_row > 0),
  constraint legacy_imports_customer_name_not_blank check (length(trim(customer_name)) > 0),
  constraint legacy_imports_property_name_not_blank check (length(trim(property_name)) > 0),
  constraint legacy_imports_excluded_from_pulse check (counts_toward_pulse = false),
  constraint legacy_imports_money_nonnegative check (
    (subtotal_cents is null or subtotal_cents >= 0)
    and (tax_cents is null or tax_cents >= 0)
    and (total_cents is null or total_cents >= 0)
    and (tax_rate_bps is null or tax_rate_bps >= 0)
  )
);

comment on table public.legacy_imports is
  'One old workbook call. Not a service request and not an invoice. Financial Pulse must not sum this table. A later import run updates customer, property, unit, and bundle links only.';

comment on column public.legacy_imports.counts_toward_pulse is
  'Always false. Kept so a future query cannot treat imported history as revenue.';

comment on column public.legacy_imports.occurred_at is
  'Clock time from the workbook, read as America/New_York and stored in UTC.';

comment on column public.legacy_imports.job_on is
  'Calendar date from the workbook. This is the business date in America/New_York.';

create index legacy_imports_property_job_idx
  on public.legacy_imports (property_id, job_on);

create index legacy_imports_unit_idx
  on public.legacy_imports (unit_id);

create index legacy_imports_bundle_idx
  on public.legacy_imports (bundle_id);

create trigger legacy_imports_set_updated_at
  before update on public.legacy_imports
  for each row execute function public.set_updated_at();

alter table public.legacy_imports enable row level security;

-- Default privileges from the earlier migration grant writes to authenticated.
-- History is loaded by the database owner, not by a signed-in tech.
revoke all on table public.legacy_imports from public, anon, authenticated;
grant select on table public.legacy_imports to authenticated;
grant select, insert, update, delete on table public.legacy_imports to service_role;

create policy legacy_imports_select_member on public.legacy_imports
  for select to authenticated
  using (public.is_active_member());
