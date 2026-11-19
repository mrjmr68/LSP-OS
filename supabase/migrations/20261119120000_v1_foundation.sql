-- v1 foundation (LSP App v1 Build Brief, "Data changes").
-- Additive only. No column is dropped and no existing row is rewritten
-- except properties.tax_rate_bps, and only when an owner sets a county.

-- ---------------------------------------------------------------------------
-- 1. NC county sales tax. Every invoice line is taxable.
-- Source: NC Department of Revenue, current sales and use tax rates,
-- effective 2026-07-01 (read 2026-11-18). Rates are basis points (675 = 6.75%).
-- ---------------------------------------------------------------------------

create table public.nc_county_tax_rates (
  county text primary key,
  rate_bps integer not null check (rate_bps between 0 and 2000),
  effective_date date not null,
  updated_at timestamptz not null default now()
);

comment on table public.nc_county_tax_rates is
  'Combined state + county sales tax per NC county. Owners edit a rate when NCDOR changes it. Properties copy the rate into tax_rate_bps.';

insert into public.nc_county_tax_rates (county, rate_bps, effective_date) values
  ('Alamance', 675, date '2026-07-01'),
  ('Alexander', 700, date '2026-07-01'),
  ('Alleghany', 700, date '2026-07-01'),
  ('Anson', 700, date '2026-07-01'),
  ('Ashe', 700, date '2026-07-01'),
  ('Avery', 675, date '2026-07-01'),
  ('Beaufort', 675, date '2026-07-01'),
  ('Bertie', 700, date '2026-07-01'),
  ('Bladen', 675, date '2026-07-01'),
  ('Brunswick', 675, date '2026-07-01'),
  ('Buncombe', 700, date '2026-07-01'),
  ('Burke', 675, date '2026-07-01'),
  ('Cabarrus', 700, date '2026-07-01'),
  ('Caldwell', 675, date '2026-07-01'),
  ('Camden', 675, date '2026-07-01'),
  ('Carteret', 675, date '2026-07-01'),
  ('Caswell', 675, date '2026-07-01'),
  ('Catawba', 700, date '2026-07-01'),
  ('Chatham', 700, date '2026-07-01'),
  ('Cherokee', 700, date '2026-07-01'),
  ('Chowan', 675, date '2026-07-01'),
  ('Clay', 700, date '2026-07-01'),
  ('Cleveland', 675, date '2026-07-01'),
  ('Columbus', 675, date '2026-07-01'),
  ('Craven', 675, date '2026-07-01'),
  ('Cumberland', 700, date '2026-07-01'),
  ('Currituck', 675, date '2026-07-01'),
  ('Dare', 675, date '2026-07-01'),
  ('Davidson', 700, date '2026-07-01'),
  ('Davie', 675, date '2026-07-01'),
  ('Duplin', 700, date '2026-07-01'),
  ('Durham', 750, date '2026-07-01'),
  ('Edgecombe', 700, date '2026-07-01'),
  ('Forsyth', 700, date '2026-07-01'),
  ('Franklin', 675, date '2026-07-01'),
  ('Gaston', 700, date '2026-07-01'),
  ('Gates', 675, date '2026-07-01'),
  ('Graham', 700, date '2026-07-01'),
  ('Granville', 675, date '2026-07-01'),
  ('Greene', 700, date '2026-07-01'),
  ('Guilford', 675, date '2026-07-01'),
  ('Halifax', 700, date '2026-07-01'),
  ('Harnett', 700, date '2026-07-01'),
  ('Haywood', 700, date '2026-07-01'),
  ('Henderson', 675, date '2026-07-01'),
  ('Hertford', 700, date '2026-07-01'),
  ('Hoke', 675, date '2026-07-01'),
  ('Hyde', 675, date '2026-07-01'),
  ('Iredell', 675, date '2026-07-01'),
  ('Jackson', 700, date '2026-07-01'),
  ('Johnston', 675, date '2026-07-01'),
  ('Jones', 700, date '2026-07-01'),
  ('Lee', 700, date '2026-07-01'),
  ('Lenoir', 675, date '2026-07-01'),
  ('Lincoln', 700, date '2026-07-01'),
  ('Macon', 675, date '2026-07-01'),
  ('Madison', 700, date '2026-07-01'),
  ('Martin', 700, date '2026-07-01'),
  ('McDowell', 675, date '2026-07-01'),
  ('Mecklenburg', 825, date '2026-07-01'),
  ('Mitchell', 675, date '2026-07-01'),
  ('Montgomery', 700, date '2026-07-01'),
  ('Moore', 700, date '2026-07-01'),
  ('Nash', 675, date '2026-07-01'),
  ('New Hanover', 700, date '2026-07-01'),
  ('Northampton', 675, date '2026-07-01'),
  ('Onslow', 700, date '2026-07-01'),
  ('Orange', 750, date '2026-07-01'),
  ('Pamlico', 675, date '2026-07-01'),
  ('Pasquotank', 700, date '2026-07-01'),
  ('Pender', 675, date '2026-07-01'),
  ('Perquimans', 675, date '2026-07-01'),
  ('Person', 675, date '2026-07-01'),
  ('Pitt', 700, date '2026-07-01'),
  ('Polk', 675, date '2026-07-01'),
  ('Randolph', 700, date '2026-07-01'),
  ('Richmond', 675, date '2026-07-01'),
  ('Robeson', 700, date '2026-07-01'),
  ('Rockingham', 700, date '2026-07-01'),
  ('Rowan', 700, date '2026-07-01'),
  ('Rutherford', 700, date '2026-07-01'),
  ('Sampson', 700, date '2026-07-01'),
  ('Scotland', 675, date '2026-07-01'),
  ('Stanly', 700, date '2026-07-01'),
  ('Stokes', 675, date '2026-07-01'),
  ('Surry', 700, date '2026-07-01'),
  ('Swain', 700, date '2026-07-01'),
  ('Transylvania', 675, date '2026-07-01'),
  ('Tyrrell', 675, date '2026-07-01'),
  ('Union', 675, date '2026-07-01'),
  ('Vance', 675, date '2026-07-01'),
  ('Wake', 725, date '2026-07-01'),
  ('Warren', 675, date '2026-07-01'),
  ('Washington', 700, date '2026-07-01'),
  ('Watauga', 675, date '2026-07-01'),
  ('Wayne', 675, date '2026-07-01'),
  ('Wilkes', 700, date '2026-07-01'),
  ('Wilson', 675, date '2026-07-01'),
  ('Yadkin', 675, date '2026-07-01'),
  ('Yancey', 675, date '2026-07-01')
on conflict (county) do nothing;

create trigger nc_county_tax_rates_updated_at
  before update on public.nc_county_tax_rates
  for each row execute function public.set_updated_at();

alter table public.nc_county_tax_rates enable row level security;

create policy county_tax_select_member on public.nc_county_tax_rates
  for select to authenticated
  using (public.is_active_member());

create policy county_tax_update_owner on public.nc_county_tax_rates
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

grant select, update on public.nc_county_tax_rates to authenticated, service_role;

alter table public.properties
  add column county text references public.nc_county_tax_rates (county);

comment on column public.properties.county is
  'NC county. Setting it copies that county''s rate into tax_rate_bps. Null keeps the rate typed on the property.';

-- A property with a county takes the county rate.
create or replace function public.apply_county_tax_rate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.county is not null
    and (tg_op = 'INSERT' or new.county is distinct from old.county) then
    select c.rate_bps into new.tax_rate_bps
    from public.nc_county_tax_rates c
    where c.county = new.county;
  end if;
  return new;
end;
$$;

create trigger properties_county_tax
  before insert or update of county on public.properties
  for each row execute function public.apply_county_tax_rate();

-- A county rate change flows to its properties. Invoices keep their own
-- tax_rate_bps_snap, so sent invoices never change.
create or replace function public.push_county_tax_rate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.rate_bps is distinct from old.rate_bps then
    update public.properties
    set tax_rate_bps = new.rate_bps
    where county = new.county;
  end if;
  return new;
end;
$$;

create trigger nc_county_tax_rates_push
  after update of rate_bps on public.nc_county_tax_rates
  for each row execute function public.push_county_tax_rate();

-- ---------------------------------------------------------------------------
-- 2. Tech position. Latest point only, one row per person.
-- Feeds the Board crew strip and closest-first assigning.
-- ---------------------------------------------------------------------------

create table public.tech_positions (
  profile_id uuid primary key references public.profiles (id),
  lat numeric(9, 6) not null check (lat between -90 and 90),
  lng numeric(9, 6) not null check (lng between -180 and 180),
  accuracy_m integer check (accuracy_m is null or accuracy_m >= 0),
  recorded_at timestamptz not null default now()
);

comment on table public.tech_positions is
  'Latest phone position per crew member during the working day. Owners read all. Each person writes only their own row.';

alter table public.tech_positions enable row level security;

create policy tech_positions_select on public.tech_positions
  for select to authenticated
  using (profile_id = public.current_profile_id() or public.is_owner());

create policy tech_positions_insert_self on public.tech_positions
  for insert to authenticated
  with check (profile_id = public.current_profile_id());

create policy tech_positions_update_self on public.tech_positions
  for update to authenticated
  using (profile_id = public.current_profile_id())
  with check (profile_id = public.current_profile_id());

grant select, insert, update on public.tech_positions to authenticated, service_role;

create or replace function public.report_my_position(
  p_lat numeric,
  p_lng numeric,
  p_accuracy_m integer default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  me uuid := public.current_profile_id();
begin
  if me is null then
    raise exception 'not an active LSP user' using errcode = '42501';
  end if;
  insert into public.tech_positions (profile_id, lat, lng, accuracy_m, recorded_at)
  values (me, p_lat, p_lng, p_accuracy_m, now())
  on conflict (profile_id) do update
    set lat = excluded.lat,
        lng = excluded.lng,
        accuracy_m = excluded.accuracy_m,
        recorded_at = excluded.recorded_at;
end;
$$;

revoke all on function public.report_my_position(numeric, numeric, integer) from public;
grant execute on function public.report_my_position(numeric, numeric, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A tech's own job order (My Jobs drag to reorder). Owners see it.
-- ---------------------------------------------------------------------------

alter table public.service_requests
  add column my_jobs_position integer;

comment on column public.service_requests.my_jobs_position is
  'Order on the assigned tech''s My Jobs. Lower first. Null sorts after numbered jobs.';

create or replace function public.set_my_jobs_order(p_request_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.current_profile_id();
  owner_session boolean := public.is_owner();
begin
  if me is null then
    raise exception 'not an active LSP user' using errcode = '42501';
  end if;

  if exists (
    select 1
    from unnest(p_request_ids) as ids(id)
    where not exists (
      select 1
      from public.service_requests r
      where r.id = ids.id
        and r.deleted_at is null
        and (owner_session or r.assigned_user_id = me)
    )
  ) then
    raise exception 'you can only order jobs assigned to you' using errcode = '42501';
  end if;

  update public.service_requests r
  set my_jobs_position = o.ord
  from unnest(p_request_ids) with ordinality as o(id, ord)
  where r.id = o.id;
end;
$$;

revoke all on function public.set_my_jobs_order(uuid[]) from public;
grant execute on function public.set_my_jobs_order(uuid[]) to authenticated, service_role;
