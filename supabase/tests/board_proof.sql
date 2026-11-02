-- Proves Quick Add, My Jobs en route, owner Board controls, and auto rules A1–A5.
-- Runs after supabase/tests/rls_proof.sql on the same throwaway database.
-- Every mutation rolls back. The RLS fixture stays as that proof left it.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Quick Add: four fields, New, source, status event, duplicate still creates.
-- ---------------------------------------------------------------------------

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $proof$
declare
  result jsonb;
  created_id uuid;
begin
  begin
    perform public.create_quick_add(
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
      null,
      'No cool',
      'phone',
      false,
      false
    );
    raise exception 'FAIL: unlinked contact saved without confirmation';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if sqlerrm not like '%Link this contact%' then
        raise exception 'FAIL: expected a link error, got: %', sqlerrm;
      end if;
  end;

  result := public.create_quick_add(
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
    null,
    'No cool',
    'phone',
    false,
    true
  );
  created_id := (result ->> 'id')::uuid;

  if (result ->> 'display_number') is null then
    raise exception 'FAIL: quick add did not return a display number';
  end if;
  if (select board_status from public.service_requests where id = created_id) <> 'new' then
    raise exception 'FAIL: quick add status is not new';
  end if;
  if (select source from public.service_requests where id = created_id) <> 'phone' then
    raise exception 'FAIL: quick add source was not tagged';
  end if;
  if (select priority from public.service_requests where id = created_id) <> 'normal' then
    raise exception 'FAIL: quick add raised priority';
  end if;
  if (result ->> 'duplicate_of') <> '77777777-7777-4777-8777-777777777777' then
    raise exception 'FAIL: recent unit call was not flagged, got %', result ->> 'duplicate_of';
  end if;
  if (select duplicate_of_request_id from public.service_requests where id = created_id)
    is distinct from '77777777-7777-4777-8777-777777777777' then
    raise exception 'FAIL: duplicate was flagged but the request was not created';
  end if;
  if (
    select count(*) from public.status_events
    where status_events.request_id = created_id and from_status is null and to_status = 'new' and trigger = 'system'
  ) <> 1 then
    raise exception 'FAIL: quick add did not write the creation status event';
  end if;

  result := public.create_quick_add(
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    null,
    '14C',
    'Thermostat blank',
    'text',
    true,
    false
  );
  if (select unit_label from public.units where id = (
    select unit_id from public.service_requests where id = (result ->> 'id')::uuid
  )) <> '14C' then
    raise exception 'FAIL: typed unit was not created';
  end if;
  if (select reported_by_resident from public.service_requests where id = (result ->> 'id')::uuid) is not true then
    raise exception 'FAIL: resident-reported flag was dropped';
  end if;
  raise notice 'PASS: Quick Add creates New, tags source, warns, and still saves';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- Tech cannot switch status or set High. Owner High sends nothing.
-- ---------------------------------------------------------------------------

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $proof$
begin
  begin
    perform public.set_board_status(
      '77777777-7777-4777-8777-777777777777',
      'assigned',
      'because'
    );
    raise exception 'FAIL: tech changed status from the board';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if sqlerrm not like '%Only an owner%' then
        raise exception 'FAIL: expected owner rejection, got: %', sqlerrm;
      end if;
  end;

  begin
    perform public.set_request_priority('77777777-7777-4777-8777-777777777777', 'high');
    raise exception 'FAIL: tech set High';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if sqlerrm not like '%Only an owner%' then
        raise exception 'FAIL: expected High rejection, got: %', sqlerrm;
      end if;
  end;

  if (select board_status from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'new' then
    raise exception 'FAIL: tech status switch stuck';
  end if;
  if (select priority from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'normal' then
    raise exception 'FAIL: tech High stuck';
  end if;
  raise notice 'PASS: tech status switch and High are rejected';
end
$proof$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  before_count integer;
  after_count integer;
begin
  select count(*) into before_count from public.outbound_messages;
  perform public.set_request_priority('77777777-7777-4777-8777-777777777777', 'high');
  select count(*) into after_count from public.outbound_messages;
  if (select priority from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'high' then
    raise exception 'FAIL: owner could not set High';
  end if;
  if after_count <> before_count then
    raise exception 'FAIL: High sent a message';
  end if;

  begin
    perform public.set_board_status('77777777-7777-4777-8777-777777777777', 'in_progress', null);
    raise exception 'FAIL: owner skipped to in progress without a reason';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if sqlerrm not like '%needs a reason%' then
        raise exception 'FAIL: expected a reason error, got: %', sqlerrm;
      end if;
  end;

  perform public.set_board_status(
    '77777777-7777-4777-8777-777777777777',
    'ready',
    null
  );
  if (
    select count(*) from public.status_events
    where request_id = '77777777-7777-4777-8777-777777777777'
      and from_status = 'new'
      and to_status = 'ready'
      and trigger = 'manual'
  ) <> 1 then
    raise exception 'FAIL: owner status switch did not log a status event';
  end if;
  raise notice 'PASS: owner High sends nothing; status switch is logged; skips need a reason';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- A1. Assign, then the tech goes en route: in progress, travel, ETA text.
-- ---------------------------------------------------------------------------

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech_id uuid;
  result jsonb;
  visit_status public.visit_status;
begin
  select id into tech_id
  from public.profiles
  where auth_user_id = '22222222-2222-4222-8222-222222222222';

  perform public.assign_request('77777777-7777-4777-8777-777777777777', tech_id);

  if (select board_status from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'assigned' then
    raise exception 'FAIL: assign did not move New to Assigned';
  end if;
  if (select assigned_user_id from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> tech_id then
    raise exception 'FAIL: assign did not keep the tech';
  end if;
  if (
    select status from public.service_visits
    where request_id = '77777777-7777-4777-8777-777777777777'
      and tech_user_id = tech_id
  ) <> 'planned' then
    raise exception 'FAIL: assignment did not create a planned visit';
  end if;

  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  result := public.go_en_route('77777777-7777-4777-8777-777777777777', 18);

  if (select board_status from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'in_progress' then
    raise exception 'FAIL: My Jobs tap did not move the call to in progress';
  end if;
  select status into visit_status
  from public.service_visits
  where request_id = '77777777-7777-4777-8777-777777777777'
    and tech_user_id = tech_id;
  if visit_status <> 'en_route' then
    raise exception 'FAIL: visit stayed %', visit_status;
  end if;
  if (
    select count(*) from public.time_segments t
    join public.service_visits v on v.id = t.visit_id
    where v.request_id = '77777777-7777-4777-8777-777777777777'
      and t.kind = 'travel'
      and t.ended_at is null
      and t.start_source = 'tap'
  ) <> 1 then
    raise exception 'FAIL: travel clock did not start';
  end if;
  if (result ->> 'sms') <> 'queued' then
    raise exception 'FAIL: ETA text was not queued (%).', result ->> 'sms';
  end if;
  if (
    select body from public.outbound_messages
    where request_id = '77777777-7777-4777-8777-777777777777'
      and template = 'eta'
  ) not like '%ETA about 18 min.%' then
    raise exception 'FAIL: ETA text did not include the drive time';
  end if;
  if (
    select count(*) from public.status_events
    where request_id = '77777777-7777-4777-8777-777777777777'
      and to_status = 'in_progress'
      and trigger = 'my_jobs_tap'
  ) <> 1 then
    raise exception 'FAIL: My Jobs tap did not log my_jobs_tap';
  end if;
  if (result ->> 'address') not like '%100 Oak Court%' then
    raise exception 'FAIL: en route did not return the property address';
  end if;
  raise notice 'PASS: My Jobs tap moves to in progress, starts travel, and queues the ETA';
end
$proof$;
rollback;

begin;
update public.customer_contacts
set phone = null
where id = '44444444-4444-4444-8444-444444444444';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech_id uuid;
  result jsonb;
begin
  select id into tech_id
  from public.profiles
  where auth_user_id = '22222222-2222-4222-8222-222222222222';
  perform public.assign_request('77777777-7777-4777-8777-777777777777', tech_id);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  result := public.go_en_route('77777777-7777-4777-8777-777777777777', 10);
  if (result ->> 'notice') <> 'No ETA text sent — no phone.' then
    raise exception 'FAIL: missing-phone notice was %', result ->> 'notice';
  end if;
  if (select board_status from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'in_progress' then
    raise exception 'FAIL: missing phone blocked the status move';
  end if;
  if (select count(*) from public.outbound_messages where template = 'eta') <> 0 then
    raise exception 'FAIL: an ETA text was queued without a phone';
  end if;
  raise notice 'PASS: no phone still goes en route and does not text';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- A2 draft invoice on an in-progress call → complete.
-- A3 sent invoice on a complete call → invoiced.
-- ---------------------------------------------------------------------------

begin;
update public.service_requests
set board_status = 'in_progress'
where id = '77777777-7777-4777-8777-777777777777';
delete from public.invoice_records
where id = '88888888-8888-4888-8888-888888888888';
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $proof$
begin
  insert into public.invoice_records (
    request_id, kind, status, bill_to_customer_id, bill_to_contact_id,
    bill_to_email_snap, property_snap, unit_snap, subtotal_cents,
    tax_rate_bps_snap, tax_cents, total_cents, terms_days_snap
  ) values (
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
  if (select board_status from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'complete' then
    raise exception 'FAIL: A2 did not move the call to complete';
  end if;
  if (
    select count(*) from public.status_events
    where request_id = '77777777-7777-4777-8777-777777777777'
      and from_status = 'in_progress'
      and to_status = 'complete'
      and trigger = 'invoice_drafted'
  ) <> 1 then
    raise exception 'FAIL: A2 did not log invoice_drafted';
  end if;
  raise notice 'PASS: A2 invoice draft moves in progress to complete';
end
$proof$;
rollback;

begin;
update public.service_requests
set board_status = 'complete'
where id = '77777777-7777-4777-8777-777777777777';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
begin
  update public.invoice_records
  set
    status = 'approved_sent',
    number = 'LSP-PROOF-A3',
    reviewed_by = (
      select id from public.profiles
      where auth_user_id = '11111111-1111-4111-8111-111111111111'
    ),
    sent_at = now()
  where id = '88888888-8888-4888-8888-888888888888';

  if (select board_status from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'invoiced' then
    raise exception 'FAIL: A3 did not move the call to invoiced';
  end if;
  if (
    select count(*) from public.status_events
    where request_id = '77777777-7777-4777-8777-777777777777'
      and from_status = 'complete'
      and to_status = 'invoiced'
      and trigger = 'invoice_sent'
  ) <> 1 then
    raise exception 'FAIL: A3 did not log invoice_sent';
  end if;
  raise notice 'PASS: A3 sent invoice moves complete to invoiced';
end
$proof$;
rollback;

-- A draft on a New call must not steal the card off the board. The RLS fixture
-- already inserted that invoice; this repeats it on a fresh new request.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  result jsonb;
  created_id uuid;
begin
  result := public.create_quick_add(
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    null,
    '9A',
    'No heat',
    'phone',
    false,
    true
  );
  created_id := (result ->> 'id')::uuid;
  insert into public.invoice_records (
    request_id, kind, status, bill_to_customer_id, bill_to_contact_id,
    bill_to_email_snap, property_snap, unit_snap, subtotal_cents,
    tax_rate_bps_snap, tax_cents, total_cents, terms_days_snap
  ) values (
    created_id, 'one_off', 'draft',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    'pat@proof.test', 'Oak Court', '9A',
    10000, 675, 675, 10675, 30
  );
  if (select board_status from public.service_requests where id = created_id) <> 'new' then
    raise exception 'FAIL: a draft invoice moved a New call';
  end if;
  raise notice 'PASS: A2 does not run unless the call is in progress';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- A4 order info → parts. A blank parts row does not. A5 in hand → ready, top.
-- ---------------------------------------------------------------------------

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $proof$
declare
  tech_id uuid;
  visit_id uuid;
  order_id uuid;
begin
  select id into tech_id
  from public.profiles
  where auth_user_id = '22222222-2222-4222-8222-222222222222';

  insert into public.service_visits (
    request_id, visit_seq, tech_user_id, visit_type, status
  ) values (
    '77777777-7777-4777-8777-777777777777',
    1,
    tech_id,
    'service',
    'working'
  )
  returning id into visit_id;

  insert into public.parts_orders (
    request_id, visit_id, part_description, status, entered_by, last_updated_by
  ) values (
    '77777777-7777-4777-8777-777777777777',
    visit_id,
    'Capacitor',
    'needed',
    tech_id,
    tech_id
  )
  returning id into order_id;

  if (select board_status from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'new' then
    raise exception 'FAIL: a blank parts row moved the call';
  end if;

  update public.parts_orders
  set order_number = 'PO-100', supplier_contact_text = 'Johnstone'
  where id = order_id;

  if (select board_status from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'parts' then
    raise exception 'FAIL: A4 did not move the call to parts';
  end if;
  if (
    select trigger from public.status_events
    where request_id = '77777777-7777-4777-8777-777777777777'
      and to_status = 'parts'
  ) <> 'parts_order_entered' then
    raise exception 'FAIL: A4 trigger was not parts_order_entered';
  end if;

  update public.parts_orders
  set status = 'in_hand', in_hand_at = now(), in_hand_by = tech_id
  where id = order_id;

  if (select board_status from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'ready' then
    raise exception 'FAIL: A5 did not move the call to ready';
  end if;
  if (select board_sort_bumped_at from public.service_requests where id = '77777777-7777-4777-8777-777777777777') is null then
    raise exception 'FAIL: A5 did not float the call';
  end if;
  if (
    select trigger from public.status_events
    where request_id = '77777777-7777-4777-8777-777777777777'
      and to_status = 'ready'
  ) <> 'part_in_hand' then
    raise exception 'FAIL: A5 trigger was not part_in_hand';
  end if;
  raise notice 'PASS: A4 order info moves to parts; A5 in hand moves to the top of ready';
end
$proof$;
rollback;

do $final$
begin
  if (select board_status from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'new' then
    raise exception 'FAIL: board proof left the fixture status changed';
  end if;
  if (select priority from public.service_requests where id = '77777777-7777-4777-8777-777777777777') <> 'normal' then
    raise exception 'FAIL: board proof left the fixture High';
  end if;
  if (select status from public.invoice_records where id = '88888888-8888-4888-8888-888888888888') <> 'draft' then
    raise exception 'FAIL: board proof left the fixture invoice changed';
  end if;
  if (select phone from public.customer_contacts where id = '44444444-4444-4444-8444-444444444444') is distinct from '555-0140' then
    raise exception 'FAIL: board proof cleared the contact phone';
  end if;
  raise notice 'PASS: Board proof finished. Quick Add, en route, and A1–A5 hold.';
end
$final$;
