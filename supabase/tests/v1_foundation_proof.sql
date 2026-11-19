-- Proves the v1 foundation rules: county tax, tech position, My Jobs order.
-- Uses the owner, tech, property and contact from rls_proof.sql.
-- Every mutation rolls back.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- County tax table is loaded and flows to a property.
-- ---------------------------------------------------------------------------

begin;

do $proof$
declare
  n integer;
  bps integer;
begin
  select count(*) into n from public.nc_county_tax_rates;
  if n <> 100 then
    raise exception 'FAIL: expected 100 NC counties, found %', n;
  end if;

  select rate_bps into bps from public.nc_county_tax_rates where county = 'Guilford';
  if bps <> 675 then
    raise exception 'FAIL: Guilford should be 675 bps, got %', bps;
  end if;

  select rate_bps into bps from public.nc_county_tax_rates where county = 'Mecklenburg';
  if bps <> 825 then
    raise exception 'FAIL: Mecklenburg should be 825 bps, got %', bps;
  end if;

  update public.properties set county = 'Durham'
  where id = '55555555-5555-4555-8555-555555555555';
  select tax_rate_bps into bps from public.properties
  where id = '55555555-5555-4555-8555-555555555555';
  if bps <> 750 then
    raise exception 'FAIL: setting county Durham should set 750 bps, got %', bps;
  end if;

  update public.nc_county_tax_rates set rate_bps = 775 where county = 'Durham';
  select tax_rate_bps into bps from public.properties
  where id = '55555555-5555-4555-8555-555555555555';
  if bps <> 775 then
    raise exception 'FAIL: a county rate change should reach its properties, got %', bps;
  end if;

  select tax_rate_bps_snap into bps from public.invoice_records
  where id = '88888888-8888-4888-8888-888888888888';
  if bps <> 675 then
    raise exception 'FAIL: an invoice snapshot changed with the county rate (%)', bps;
  end if;
end;
$proof$;

rollback;

-- ---------------------------------------------------------------------------
-- A tech cannot change a county rate. An owner can.
-- ---------------------------------------------------------------------------

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $proof$
declare
  n integer;
begin
  select count(*) into n from public.nc_county_tax_rates;
  if n <> 100 then
    raise exception 'FAIL: tech should read all 100 counties, saw %', n;
  end if;

  update public.nc_county_tax_rates set rate_bps = 0 where county = 'Guilford';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: tech changed a county tax rate';
  end if;
end;
$proof$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  n integer;
begin
  update public.nc_county_tax_rates set rate_bps = 680 where county = 'Guilford';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: owner could not change a county tax rate';
  end if;
end;
$proof$;

rollback;

-- ---------------------------------------------------------------------------
-- Tech position: each person writes only their own row; owners read all.
-- ---------------------------------------------------------------------------

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select public.report_my_position(36.072600, -79.791900, 12);
select public.report_my_position(36.080000, -79.800000, 8);

do $proof$
declare
  n integer;
  tech_id uuid := public.current_profile_id();
begin
  select count(*) into n from public.tech_positions;
  if n <> 1 then
    raise exception 'FAIL: tech should see exactly their own position, saw %', n;
  end if;

  if (select lat from public.tech_positions where profile_id = tech_id) <> 36.080000 then
    raise exception 'FAIL: report_my_position did not keep the latest point';
  end if;

  begin
    insert into public.tech_positions (profile_id, lat, lng)
    select id, 35.0, -80.0 from public.profiles where role = 'owner' limit 1;
    raise exception 'FAIL: tech wrote a position for someone else';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%row-level security%' then
        raise exception 'FAIL: expected row-level security rejection, got: %', sqlerrm;
      end if;
  end;
end;
$proof$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
begin
  if (select count(*) from public.tech_positions) <> 1 then
    raise exception 'FAIL: owner should read the tech position';
  end if;
end;
$proof$;

rollback;

-- ---------------------------------------------------------------------------
-- My Jobs order: a tech orders only their own jobs.
-- ---------------------------------------------------------------------------

begin;

insert into public.service_requests (
  id, customer_id, property_id, unit_id, contact_id, issue, source,
  board_status, priority, assigned_user_id
)
select ids.id,
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  ids.issue, 'phone', 'new', 'normal',
  (select id from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222')
from (values
  ('a1111111-1111-4111-8111-111111111111'::uuid, 'Proof job one'),
  ('a2222222-2222-4222-8222-222222222222'::uuid, 'Proof job two')
) as ids(id, issue);

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select public.set_my_jobs_order(array[
  'a2222222-2222-4222-8222-222222222222'::uuid,
  'a1111111-1111-4111-8111-111111111111'::uuid
]);

do $proof$
begin
  if (select my_jobs_position from public.service_requests
      where id = 'a2222222-2222-4222-8222-222222222222') <> 1
    or (select my_jobs_position from public.service_requests
      where id = 'a1111111-1111-4111-8111-111111111111') <> 2 then
    raise exception 'FAIL: tech reorder did not save';
  end if;

  begin
    perform public.set_my_jobs_order(array['77777777-7777-4777-8777-777777777777'::uuid]);
    raise exception 'FAIL: tech reordered a job that is not theirs';
  exception
    when insufficient_privilege then null;
  end;
end;
$proof$;

rollback;
