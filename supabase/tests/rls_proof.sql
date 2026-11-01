-- Proves tech cannot approve an invoice and cannot elevate priority to High.
-- Also checks AppConfig and that an owner can do both.
-- Runs against the local proof database. Every mutation rolls back.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixture. Committed so each assertion can use its own transaction.
-- ---------------------------------------------------------------------------

begin;

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'owner.proof@lsp.test',
    '{"full_name":"Owner Proof","phone":"555-0100"}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'tech.proof@lsp.test',
    '{"full_name":"Tech Proof","phone":"555-0199"}'::jsonb
  );

update public.profiles
set role = 'owner', phone = '555-0100', full_name = 'Owner Proof'
where auth_user_id = '11111111-1111-4111-8111-111111111111';

update public.profiles
set phone = '555-0199', full_name = 'Tech Proof'
where auth_user_id = '22222222-2222-4222-8222-222222222222';

insert into public.customers (
  id,
  name,
  billing_contact_id,
  payment_terms_days,
  addon_approval_mode,
  signoff_requirement,
  resident_report_mode,
  portal_enabled,
  active
) values (
  '33333333-3333-4333-8333-333333333333',
  'Proof Management',
  '44444444-4444-4444-8444-444444444444',
  30,
  'call_first',
  'note_only',
  'confirm_with_property',
  false,
  true
);

insert into public.customer_contacts (
  id, customer_id, name, phone, email, sms_ok, active
) values (
  '44444444-4444-4444-8444-444444444444',
  '33333333-3333-4333-8333-333333333333',
  'Pat Manager',
  '555-0140',
  'pat@proof.test',
  true,
  true
);

insert into public.properties (
  id, customer_id, name, address_line1, city, state, zip, active
) values (
  '55555555-5555-4555-8555-555555555555',
  '33333333-3333-4333-8333-333333333333',
  'Oak Court',
  '100 Oak Court',
  'Richmond',
  'VA',
  '23220',
  true
);

insert into public.units (id, property_id, unit_label, unit_label_norm)
values (
  '66666666-6666-4666-8666-666666666666',
  '55555555-5555-4555-8555-555555555555',
  '12B',
  '12b'
);

insert into public.service_requests (
  id, customer_id, property_id, unit_id, contact_id, issue, source, board_status, priority
) values (
  '77777777-7777-4777-8777-777777777777',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  'No heat',
  'phone',
  'new',
  'normal'
);

insert into public.invoice_records (
  id,
  request_id,
  kind,
  status,
  bill_to_customer_id,
  bill_to_contact_id,
  bill_to_email_snap,
  property_snap,
  unit_snap,
  subtotal_cents,
  tax_rate_bps_snap,
  tax_cents,
  total_cents,
  terms_days_snap
) values (
  '88888888-8888-4888-8888-888888888888',
  '77777777-7777-4777-8777-777777777777',
  'one_off',
  'draft',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  'pat@proof.test',
  'Oak Court',
  '12B',
  10000,
  675,
  675,
  10675,
  30
);

commit;

-- ---------------------------------------------------------------------------
-- AppConfig
-- ---------------------------------------------------------------------------

do $config$
declare
  config public.app_config%rowtype;
begin
  select * into config from public.app_config where id = 1;
  if config.labor_rate_cents <> 9000 then
    raise exception 'FAIL: labor rate is % cents, expected 9000', config.labor_rate_cents;
  end if;
  if config.profit_per_hour_floor_cents <> 10000 then
    raise exception 'FAIL: profit floor is % cents, expected 10000', config.profit_per_hour_floor_cents;
  end if;
  if config.daily_burn_cents <> 240000 then
    raise exception 'FAIL: daily burn is % cents, expected 240000', config.daily_burn_cents;
  end if;
  if config.burn_day_basis <> 'business_days' or config.timezone <> 'America/New_York' then
    raise exception 'FAIL: burn basis or timezone is wrong';
  end if;
  if config.default_tax_rate_bps <> 675
    or config.repeat_unit_window_days <> 14
    or config.history_window_months <> 6
    or config.qbo_week_start_dow <> 1
    or config.qbo_week_days <> '{1,2,3,4,5}'::integer[] then
    raise exception 'FAIL: tax, windows, or QBO week config is wrong';
  end if;
  if cardinality(config.non_business_dates) < 100 then
    raise exception 'FAIL: federal holiday list is too short (%)', cardinality(config.non_business_dates);
  end if;
  if not ('2026-01-19' = any (config.non_business_dates)) then
    raise exception 'FAIL: MLK Day 2026 missing from holidays';
  end if;
  if not ('2026-07-03' = any (config.non_business_dates)) then
    raise exception 'FAIL: Independence Day 2026 should be observed Friday July 3';
  end if;
  if '2026-07-04' = any (config.non_business_dates) then
    raise exception 'FAIL: July 4 2026 is Saturday and should not be listed separately';
  end if;
  if not ('2026-11-26' = any (config.non_business_dates)) then
    raise exception 'FAIL: Thanksgiving 2026 missing';
  end if;
  if not ('2027-06-18' = any (config.non_business_dates)) then
    raise exception 'FAIL: Juneteenth 2027 should be observed Friday June 18';
  end if;
  if not ('2027-12-31' = any (config.non_business_dates)) then
    raise exception 'FAIL: New Year 2028 should be observed Friday December 31 2027';
  end if;
  if public.is_business_day('2026-07-03') or public.is_business_day('2026-07-04') or public.is_business_day('2026-07-05') then
    raise exception 'FAIL: July 3–5 2026 should not be business days';
  end if;
  if not public.is_business_day('2026-07-06') then
    raise exception 'FAIL: Monday July 6 2026 should be a business day';
  end if;
  if not public.is_business_day('2026-11-25') or public.is_business_day('2026-11-26') then
    raise exception 'FAIL: Thanksgiving week business-day check failed';
  end if;
  raise notice 'PASS: AppConfig labor, burn, tax, and federal holidays';
end
$config$;

-- ---------------------------------------------------------------------------
-- RLS alone: guard triggers disabled. A too-wide trigger must not be the only lock.
-- ---------------------------------------------------------------------------

begin;
alter table public.invoice_records disable trigger invoice_records_guard;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $proof$
declare
  invoice_status public.invoice_status;
  n integer;
begin
  if (select count(*) from public.invoice_records where id = '88888888-8888-4888-8888-888888888888') <> 1 then
    raise exception 'FAIL: tech cannot see the draft invoice';
  end if;

  begin
    update public.invoice_records
    set
      status = 'approved_sent',
      number = 'LSP-PROOF-1',
      reviewed_by = (
        select id from public.profiles
        where auth_user_id = '22222222-2222-4222-8222-222222222222'
      ),
      sent_at = now()
    where id = '88888888-8888-4888-8888-888888888888';
    get diagnostics n = row_count;
    if n > 0 then
      raise exception 'FAIL: tech approved an invoice with the guard trigger off (% rows)', n;
    end if;
    raise exception 'FAIL: tech invoice update no-opped; RLS should reject the new row';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if sqlerrm like '%permission denied%' then
        raise exception 'FAIL: missing grant, not an RLS rejection: %', sqlerrm;
      end if;
      if sqlerrm not like '%row-level security%' then
        raise exception 'FAIL: expected row-level security rejection, got: %', sqlerrm;
      end if;
  end;

  select status into invoice_status
  from public.invoice_records
  where id = '88888888-8888-4888-8888-888888888888';
  if invoice_status <> 'draft' then
    raise exception 'FAIL: invoice status changed to %', invoice_status;
  end if;
  raise notice 'PASS: RLS rejected tech invoice approval';
end
$proof$;
rollback;

begin;
alter table public.service_requests disable trigger service_requests_guard;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $proof$
declare
  n integer;
  seen public.request_priority;
begin
  if (select count(*) from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 1 then
    raise exception 'FAIL: tech cannot see the request';
  end if;

  begin
    update public.service_requests
    set priority = 'high'
    where id = '77777777-7777-4777-8777-777777777777';
    get diagnostics n = row_count;
    if n > 0 then
      raise exception 'FAIL: tech elevated priority with the guard trigger off (% rows)', n;
    end if;
    raise exception 'FAIL: priority update no-opped; RLS should reject High';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if sqlerrm like '%permission denied%' then
        raise exception 'FAIL: missing grant, not an RLS rejection: %', sqlerrm;
      end if;
      if sqlerrm not like '%row-level security%' then
        raise exception 'FAIL: expected row-level security rejection, got: %', sqlerrm;
      end if;
  end;

  select priority into seen
  from public.service_requests
  where id = '77777777-7777-4777-8777-777777777777';
  if seen <> 'normal' then
    raise exception 'FAIL: priority changed to %', seen;
  end if;
  raise notice 'PASS: RLS rejected tech elevating High';
end
$proof$;
rollback;

begin;
alter table public.profiles disable trigger profiles_guard_write;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $proof$
declare
  n integer;
  seen public.user_role;
begin
  begin
    update public.profiles
    set role = 'owner'
    where auth_user_id = '22222222-2222-4222-8222-222222222222';
    get diagnostics n = row_count;
    if n > 0 then
      raise exception 'FAIL: tech granted themselves owner (% rows)', n;
    end if;
    raise exception 'FAIL: role update no-opped; RLS should reject it';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if sqlerrm not like '%row-level security%' then
        raise exception 'FAIL: expected row-level security rejection, got: %', sqlerrm;
      end if;
  end;

  select role into seen
  from public.profiles
  where auth_user_id = '22222222-2222-4222-8222-222222222222';
  if seen <> 'tech' then
    raise exception 'FAIL: role changed to %', seen;
  end if;
  raise notice 'PASS: RLS rejected tech role escalation';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- Triggers on, as the app will run. Owner can. Tech still cannot.
-- A tech can still edit the call text.
-- ---------------------------------------------------------------------------

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $proof$
declare
  n integer;
begin
  update public.service_requests
  set issue = 'No heat in 12B'
  where id = '77777777-7777-4777-8777-777777777777';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: tech could not update the call text (% rows)', n;
  end if;

  begin
    update public.service_requests
    set board_status = 'invoiced'
    where id = '77777777-7777-4777-8777-777777777777';
    get diagnostics n = row_count;
    if n > 0 then
      raise exception 'FAIL: tech moved the call to invoiced';
    end if;
    raise exception 'FAIL: status update no-opped; expected a rejection';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if sqlerrm not like '%tech cannot%' and sqlerrm not like '%row-level security%' then
        raise exception 'FAIL: unexpected status error: %', sqlerrm;
      end if;
  end;

  if (select board_status from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'new' then
    raise exception 'FAIL: board status changed';
  end if;
  if (select priority from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'normal' then
    raise exception 'FAIL: priority changed during the tech edit';
  end if;
  raise notice 'PASS: tech can edit the call and cannot jump it to invoiced';
end
$proof$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  n integer;
begin
  update public.service_requests
  set priority = 'high'
  where id = '77777777-7777-4777-8777-777777777777';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: owner could not elevate High (% rows)', n;
  end if;
  if (select priority from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'high' then
    raise exception 'FAIL: owner High update did not stick';
  end if;

  update public.invoice_records
  set
    status = 'approved_sent',
    number = 'LSP-PROOF-1',
    reviewed_by = (
      select id from public.profiles
      where auth_user_id = '11111111-1111-4111-8111-111111111111'
    ),
    sent_at = now()
  where id = '88888888-8888-4888-8888-888888888888';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL: owner could not approve the invoice (% rows)', n;
  end if;
  if (select status from public.invoice_records where id = '88888888-8888-4888-8888-888888888888') <> 'approved_sent' then
    raise exception 'FAIL: owner approval did not stick';
  end if;
  raise notice 'PASS: owner elevated High and approved the invoice';
end
$proof$;
rollback;

-- Fixture is unchanged after the rollbacks.
do $final$
begin
  if (select priority from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'normal' then
    raise exception 'FAIL: fixture priority was left elevated';
  end if;
  if (select status from public.invoice_records where id = '88888888-8888-4888-8888-888888888888') <> 'draft' then
    raise exception 'FAIL: fixture invoice was left approved';
  end if;
  if (select role from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222') <> 'tech' then
    raise exception 'FAIL: tech profile was left as owner';
  end if;
  raise notice 'PASS: RLS proof finished. Tech cannot approve invoices or elevate High.';
end
$final$;
