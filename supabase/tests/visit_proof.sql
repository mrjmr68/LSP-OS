-- Proves arrival, job start, path gates, parts, attempt, and easy close.
-- Runs after the board proof on the same throwaway database. Every mutation rolls back.
\set ON_ERROR_STOP on

-- Catalog rows stay for the rest of this proof. The database is thrown away after.
begin;
insert into public.bundles (
  id, code, title, narrative, pricing_kind, target_price_cents, labor_hours,
  one_shot, requires_model_serial, status
) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'CAP',
    'AHU - Capacitor - Replace',
    'Replaced the run capacitor.',
    'fixed',
    10000,
    1.00,
    false,
    false,
    'active'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'COIL',
    'AHU - Coil - Replace',
    'Coil on order.',
    'variable',
    25000,
    2.00,
    true,
    true,
    'active'
  );

insert into public.suppliers (id, name, phone, email)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'Johnstone',
  '555-0170',
  'orders@johnstone.test'
);
commit;

-- ---------------------------------------------------------------------------
-- Easy repair: I'm here → start job → bundle → note → Complete + draft invoice.
-- Skipping arrival is rejected. A nameplate photo is not a visit step.
-- ---------------------------------------------------------------------------

begin;

insert into public.service_requests (
  id, customer_id, property_id, unit_id, contact_id, issue, source
)
select
  ('99990000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  'Visit proof ' || n,
  'phone'
from generate_series(1, 1) as n;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech uuid;
  req uuid := '99990000-0000-4000-8000-000000000001';
  result jsonb;
  draft uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
begin
  select id into tech
  from public.profiles
  where auth_user_id = '22222222-2222-4222-8222-222222222222';

  perform public.assign_request(req, tech);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, 12);

  begin
    perform public.start_job(req);
    raise exception 'FAIL: started the job before arrival';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%I''m here%' then
        raise exception 'FAIL: expected the arrival gate, got: %', sqlerrm;
      end if;
  end;

  begin
    update public.service_visits
    set status = 'working'
    where request_id = req
      and status = 'en_route';
    raise exception 'FAIL: skipped on site with a direct update';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%not allowed%' then
        raise exception 'FAIL: expected the step guard, got: %', sqlerrm;
      end if;
  end;

  result := public.mark_on_site(req, 'tap');
  if (result ->> 'visit_status') <> 'on_site' then
    raise exception 'FAIL: I''m here left the visit %', result ->> 'visit_status';
  end if;
  if (
    select end_source from public.time_segments t
    join public.service_visits v on v.id = t.visit_id
    where v.request_id = req and t.kind = 'travel'
  ) <> 'tap' then
    raise exception 'FAIL: I''m here did not end travel as a tap';
  end if;
  if (
    select start_source from public.time_segments t
    join public.service_visits v on v.id = t.visit_id
    where v.request_id = req and t.kind = 'access' and t.ended_at is null
  ) <> 'tap' then
    raise exception 'FAIL: I''m here did not start access';
  end if;

  result := public.start_job(req);
  if (result ->> 'visit_status') <> 'working' then
    raise exception 'FAIL: job start left the visit %', result ->> 'visit_status';
  end if;
  if (
    select end_source from public.time_segments t
    join public.service_visits v on v.id = t.visit_id
    where v.request_id = req and t.kind = 'access'
  ) <> 'tap' then
    raise exception 'FAIL: job start did not end access';
  end if;

  result := public.select_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  if (result ->> 'code') <> 'CAP' or (result ->> 'price_cents')::integer <> 10000 then
    raise exception 'FAIL: bundle pick did not return the price, got %', result;
  end if;
  if result ? 'profit_cents' or result ? 'cost_lines' then
    raise exception 'FAIL: bundle pick returned cost';
  end if;

  begin
    perform public.close_visit(req, 'one_off', '   ');
    raise exception 'FAIL: closed a one-off with a blank note';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%note%' then
        raise exception 'FAIL: expected a note gate, got: %', sqlerrm;
      end if;
  end;

  result := public.close_visit(
    request_id => req,
    outcome => 'easy',
    tech_note => 'Replaced the capacitor.',
    client_draft_id => draft
  );

  if (result ->> 'conflict')::boolean then
    raise exception 'FAIL: easy close reported a conflict';
  end if;
  if (result ->> 'board_status') <> 'complete' or (result ->> 'visit_status') <> 'closed' then
    raise exception 'FAIL: easy close landed on % / %', result ->> 'board_status', result ->> 'visit_status';
  end if;
  if (
    select status from public.invoice_records where request_id = req
  ) <> 'draft' then
    raise exception 'FAIL: easy close did not leave a draft invoice';
  end if;
  if (select kind from public.invoice_records where request_id = req) <> 'bundle' then
    raise exception 'FAIL: easy invoice kind was not bundle';
  end if;
  if (
    select total_cents from public.invoice_records where request_id = req
  ) <> 10675 then
    raise exception 'FAIL: easy invoice total was not 10000 plus 6.75 percent';
  end if;
  if (select number from public.invoice_records where request_id = req) is not null
    or (select sent_at from public.invoice_records where request_id = req) is not null then
    raise exception 'FAIL: draft invoice was sent';
  end if;
  if (
    select trigger from public.status_events
    where request_id = req and to_status = 'complete'
  ) <> 'invoice_drafted' then
    raise exception 'FAIL: easy close did not log invoice_drafted';
  end if;
  if (
    select end_source from public.time_segments t
    join public.service_visits v on v.id = t.visit_id
    where v.request_id = req and t.kind = 'work'
  ) <> 'close' then
    raise exception 'FAIL: close did not end work time';
  end if;
  if (
    select client_draft_id from public.service_visits
    where request_id = req and status = 'closed'
  ) <> draft then
    raise exception 'FAIL: client draft id was not stored';
  end if;
  if (select count(*) from public.invoice_records where request_id = req) <> 1 then
    raise exception 'FAIL: easy close wrote more than one invoice';
  end if;

  -- Replay is a no-op, still one invoice.
  perform public.close_visit(req, 'easy', 'Replaced the capacitor.');
  if (select count(*) from public.invoice_records where request_id = req) <> 1 then
    raise exception 'FAIL: replaying close wrote a second invoice';
  end if;

  raise notice 'PASS: easy close drafts an invoice and moves the call to Complete';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- Parts: typed model and serial, blank order still goes to Parts.
-- Owner fills the order. Part in hand goes to Ready and floats.
-- ---------------------------------------------------------------------------

begin;
insert into public.service_requests (
  id, customer_id, property_id, unit_id, contact_id, issue, source
) values (
  '99990000-0000-4000-8000-000000000002',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  'Needs a capacitor',
  'phone'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech uuid;
  owner uuid;
  req uuid := '99990000-0000-4000-8000-000000000002';
  result jsonb;
  order_id uuid;
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  select id into owner from public.profiles where auth_user_id = '11111111-1111-4111-8111-111111111111';

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.assign_request(req, tech);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);
  perform public.mark_on_site(req, 'tap');
  perform public.start_job(req);
  perform public.select_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  perform public.attach_visit_file(req, 'nameplate', 'local-nameplate', null);

  begin
    perform public.close_visit(
      request_id => req,
      outcome => 'parts',
      tech_note => 'Need a capacitor.',
      part_description => '45/5 capacitor'
    );
    raise exception 'FAIL: parts close allowed a missing model';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%model and serial%' then
        raise exception 'FAIL: expected the model gate, got: %', sqlerrm;
      end if;
  end;

  if (select board_status from public.service_requests where id = req) <> 'in_progress' then
    raise exception 'FAIL: a rejected parts close moved the board';
  end if;

  result := public.close_visit(
    request_id => req,
    outcome => 'parts',
    tech_note => 'Need a capacitor.',
    model_typed => 'GSX140241',
    serial_typed => '1234567890',
    part_description => '45/5 capacitor'
  );

  if (result ->> 'board_status') <> 'parts' or (result ->> 'visit_status') <> 'closed' then
    raise exception 'FAIL: blank parts order did not land on Parts, got %', result;
  end if;
  if exists (select 1 from public.invoice_records where request_id = req) then
    raise exception 'FAIL: parts close drafted an invoice';
  end if;
  if (
    select status from public.parts_orders where request_id = req
  ) <> 'needed' then
    raise exception 'FAIL: a blank order was marked ordered';
  end if;
  if (
    select count(*) from public.status_events
    where request_id = req and to_status = 'parts' and trigger = 'parts_order_entered'
  ) <> 1 then
    raise exception 'FAIL: parts close did not log one parts_order_entered event';
  end if;

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  result := public.save_parts_order(
    request_id => req,
    part_description => '45/5 capacitor',
    supplier_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    order_number => 'PO-200',
    expected_delivery => '2026-11-10'
  );
  if (result ->> 'board_status') <> 'parts' then
    raise exception 'FAIL: owner edit left Parts, got %', result ->> 'board_status';
  end if;
  select id into order_id from public.parts_orders where request_id = req;
  if (select last_updated_by from public.parts_orders where id = order_id) <> owner then
    raise exception 'FAIL: owner edit did not record last_updated_by';
  end if;
  if (select status from public.parts_orders where id = order_id) <> 'ordered' then
    raise exception 'FAIL: supplier and order number did not mark the order ordered';
  end if;

  result := public.mark_part_in_hand(order_id);
  if (result ->> 'board_status') <> 'ready' then
    raise exception 'FAIL: part in hand did not move to Ready';
  end if;
  if (select board_sort_bumped_at from public.service_requests where id = req) is null then
    raise exception 'FAIL: part in hand did not float the call';
  end if;
  if (select status from public.parts_orders where id = order_id) <> 'in_hand' then
    raise exception 'FAIL: part was not marked in hand';
  end if;
  if (
    select trigger from public.status_events
    where request_id = req and to_status = 'ready'
  ) <> 'part_in_hand' then
    raise exception 'FAIL: part in hand trigger was not part_in_hand';
  end if;

  raise notice 'PASS: parts close, owner order, and part in hand';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- Attempt keeps the call open on the column it left. The next trip is a return.
-- ---------------------------------------------------------------------------

begin;
insert into public.service_requests (
  id, customer_id, property_id, unit_id, contact_id, issue, source
) values (
  '99990000-0000-4000-8000-000000000003',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  'No access',
  'phone'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech uuid;
  req uuid := '99990000-0000-4000-8000-000000000003';
  result jsonb;
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.assign_request(req, tech);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);
  perform public.mark_on_site(req, 'tap');

  begin
    perform public.record_attempt(req, 'no_access', '  ');
    raise exception 'FAIL: attempt closed without a note';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%what happened%' then
        raise exception 'FAIL: expected an attempt note, got: %', sqlerrm;
      end if;
  end;

  result := public.record_attempt(req, 'no_access', 'Lockbox was empty.');
  if (result ->> 'board_status') <> 'assigned' or (result ->> 'visit_status') <> 'attempt' then
    raise exception 'FAIL: attempt landed on % / %', result ->> 'board_status', result ->> 'visit_status';
  end if;
  if (select assigned_user_id from public.service_requests where id = req) <> tech then
    raise exception 'FAIL: attempt cleared the tech';
  end if;
  if exists (select 1 from public.invoice_records where request_id = req) then
    raise exception 'FAIL: attempt drafted an invoice';
  end if;
  if (
    select attempt_reason from public.service_visits
    where request_id = req and status = 'attempt'
  ) <> 'no_access' then
    raise exception 'FAIL: attempt reason was not stored';
  end if;
  if (
    select count(*) from public.time_segments t
    join public.service_visits v on v.id = t.visit_id
    where v.request_id = req and t.ended_at is null
  ) <> 0 then
    raise exception 'FAIL: attempt left a clock running';
  end if;

  result := public.go_en_route(req, null);
  if (
    select visit_type from public.service_visits
    where id = (result ->> 'visit_id')::uuid
  ) <> 'return' then
    raise exception 'FAIL: the trip after an attempt was not a return visit';
  end if;
  if (select board_status from public.service_requests where id = req) <> 'in_progress' then
    raise exception 'FAIL: return trip did not go in progress';
  end if;

  raise notice 'PASS: attempt stays open and the next trip is a return';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- Estimate drafts an estimate and moves to To Estimate. One-off drafts a $0 invoice.
-- ---------------------------------------------------------------------------

begin;
insert into public.service_requests (
  id, customer_id, property_id, unit_id, contact_id, issue, source
) values
  (
    '99990000-0000-4000-8000-000000000004',
    '33333333-3333-4333-8333-333333333333',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
    '44444444-4444-4444-8444-444444444444',
    'Needs a price',
    'phone'
  ),
  (
    '99990000-0000-4000-8000-000000000005',
    '33333333-3333-4333-8333-333333333333',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
    '44444444-4444-4444-8444-444444444444',
    'Odd repair',
    'phone'
  );
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech uuid;
  estimate_req uuid := '99990000-0000-4000-8000-000000000004';
  one_off_req uuid := '99990000-0000-4000-8000-000000000005';
  result jsonb;
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.assign_request(estimate_req, tech);
  perform public.assign_request(one_off_req, tech);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

  perform public.go_en_route(estimate_req, null);
  perform public.mark_on_site(estimate_req, 'tap');
  perform public.start_job(estimate_req);
  result := public.close_visit(
    request_id => estimate_req,
    outcome => 'estimate',
    tech_note => 'Compressor is grounded. Property wants a price.',
    equipment_size_text => '2.5 ton'
  );
  if (result ->> 'board_status') <> 'to_estimate' then
    raise exception 'FAIL: estimate close landed on %', result ->> 'board_status';
  end if;
  if (
    select status from public.estimates where request_id = estimate_req
  ) <> 'draft' then
    raise exception 'FAIL: estimate was not left in draft';
  end if;
  if exists (select 1 from public.invoice_records where request_id = estimate_req) then
    raise exception 'FAIL: estimate close drafted an invoice';
  end if;

  perform public.go_en_route(one_off_req, null);
  perform public.mark_on_site(one_off_req, 'tap');
  perform public.start_job(one_off_req);
  result := public.close_visit(
    request_id => one_off_req,
    outcome => 'one_off',
    tech_note => 'Patched a duct the book does not cover.',
    one_off_narrative => 'Sealed a torn supply duct in the closet.',
    materials_text => 'Foil tape, one roll'
  );
  if (result ->> 'board_status') <> 'complete' then
    raise exception 'FAIL: one-off close landed on %', result ->> 'board_status';
  end if;
  if (
    select kind from public.invoice_records where request_id = one_off_req
  ) <> 'one_off' then
    raise exception 'FAIL: one-off invoice kind was wrong';
  end if;
  if (select status from public.invoice_records where request_id = one_off_req) <> 'draft' then
    raise exception 'FAIL: one-off invoice was not a draft';
  end if;
  if (select total_cents from public.invoice_records where request_id = one_off_req) <> 0 then
    raise exception 'FAIL: one-off draft total was not left for the owner';
  end if;

  raise notice 'PASS: estimate draft and one-off draft invoice';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- GPS fence. Tap still works when the pin is missing. A far point does not arrive.
-- ---------------------------------------------------------------------------

begin;
update public.properties
set lat = 37.540700, lng = -77.436000, geofence_radius_m = 150
where id = '55555555-5555-4555-8555-555555555555';

insert into public.service_requests (
  id, customer_id, property_id, unit_id, contact_id, issue, source
) values (
  '99990000-0000-4000-8000-000000000006',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  'GPS arrival',
  'phone'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech uuid;
  req uuid := '99990000-0000-4000-8000-000000000006';
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.assign_request(req, tech);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);

  begin
    perform public.mark_on_site(req, 'gps', 37.55, -77.436);
    raise exception 'FAIL: a far GPS point counted as arrival';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%not at the property%' then
        raise exception 'FAIL: expected the fence, got: %', sqlerrm;
      end if;
  end;

  perform public.mark_on_site(req, 'gps', 37.540800, -77.436000);
  if (select status from public.service_visits where request_id = req and status = 'on_site') <> 'on_site' then
    raise exception 'FAIL: inside the fence did not arrive';
  end if;
  if (
    select end_source from public.time_segments t
    join public.service_visits v on v.id = t.visit_id
    where v.request_id = req and t.kind = 'travel'
  ) <> 'gps' then
    raise exception 'FAIL: GPS arrival did not end travel as gps';
  end if;
  if (
    select start_source from public.time_segments t
    join public.service_visits v on v.id = t.visit_id
    where v.request_id = req and t.kind = 'access'
  ) <> 'gps' then
    raise exception 'FAIL: GPS arrival did not start access as gps';
  end if;

  raise notice 'PASS: GPS fence and I''m here sources';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- Owner moves the card while the phone is offline. The board wins.
-- ---------------------------------------------------------------------------

begin;
insert into public.service_requests (
  id, customer_id, property_id, unit_id, contact_id, issue, source
) values (
  '99990000-0000-4000-8000-000000000007',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  'Offline conflict',
  'phone'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech uuid;
  req uuid := '99990000-0000-4000-8000-000000000007';
  seen timestamptz;
  result jsonb;
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.assign_request(req, tech);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);
  perform public.mark_on_site(req, 'tap');
  perform public.start_job(req);
  perform public.select_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  select updated_at into seen from public.service_requests where id = req;

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.set_board_status(req, 'ready', 'Pulled the tech off');
  -- now() is frozen for the whole transaction. Status events are not updatable
  -- by the app role, so the session user stamps this owner event later than seen_at.
  reset role;
  update public.status_events
  set at = now() + interval '1 minute'
  where request_id = req
    and trigger = 'manual'
    and to_status = 'ready';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  result := public.close_visit(
    request_id => req,
    outcome => 'easy',
    tech_note => 'I finished it offline.',
    seen_at => seen
  );

  if (result ->> 'conflict')::boolean is not true then
    raise exception 'FAIL: offline close overwrote the board, got %', result;
  end if;
  if (select board_status from public.service_requests where id = req) <> 'ready' then
    raise exception 'FAIL: conflict did not keep the board status';
  end if;
  if (
    select status from public.service_visits
    where request_id = req
    order by visit_seq desc
    limit 1
  ) <> 'working' then
    raise exception 'FAIL: conflict closed the visit';
  end if;
  if (
    select offline_conflict from public.service_visits
    where request_id = req
    order by visit_seq desc
    limit 1
  ) is not true then
    raise exception 'FAIL: conflict did not flag the visit';
  end if;
  if exists (select 1 from public.invoice_records where request_id = req) then
    raise exception 'FAIL: conflict drafted an invoice';
  end if;

  raise notice 'PASS: offline conflict keeps the board and flags the visit';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- Walk-through sign-off needs a name and a signature. Photos rule needs a photo.
-- ---------------------------------------------------------------------------

begin;
insert into public.service_requests (
  id, customer_id, property_id, unit_id, contact_id, issue, source
) values
  (
    '99990000-0000-4000-8000-000000000008',
    '33333333-3333-4333-8333-333333333333',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
    '44444444-4444-4444-8444-444444444444',
    'Sign walkthrough',
    'phone'
  ),
  (
    '99990000-0000-4000-8000-000000000009',
    '33333333-3333-4333-8333-333333333333',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
    '44444444-4444-4444-8444-444444444444',
    'Sign photos',
    'phone'
  );
update public.customers
set signoff_requirement = 'walkthrough_signature'
where id = '33333333-3333-4333-8333-333333333333';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech uuid;
  req uuid := '99990000-0000-4000-8000-000000000008';
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.assign_request(req, tech);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);
  perform public.mark_on_site(req, 'tap');
  perform public.start_job(req);
  perform public.select_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');

  begin
    perform public.close_visit(
      request_id => req,
      outcome => 'easy',
      tech_note => 'Capacitor replaced.',
      signoff_name => 'Pat Manager'
    );
    raise exception 'FAIL: walkthrough closed without a signature';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%signature%' then
        raise exception 'FAIL: expected the signature gate, got: %', sqlerrm;
      end if;
  end;

  perform public.attach_visit_file(req, 'signature', 'local-signature-1', 'Pat Manager');
  perform public.close_visit(
    request_id => req,
    outcome => 'easy',
    tech_note => 'Capacitor replaced.',
    signoff_name => 'Pat Manager'
  );
  if (select board_status from public.service_requests where id = req) <> 'complete' then
    raise exception 'FAIL: signed close did not complete';
  end if;
  if (
    select signoff_name from public.service_visits where request_id = req and status = 'closed'
  ) <> 'Pat Manager' then
    raise exception 'FAIL: sign-off name was not stored';
  end if;

  raise notice 'PASS: walkthrough sign-off requires a name and a signature';
end
$proof$;
rollback;

begin;
insert into public.service_requests (
  id, customer_id, property_id, unit_id, contact_id, issue, source
) values (
  '99990000-0000-4000-8000-000000000009',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  'Sign photos',
  'phone'
);
update public.customers
set signoff_requirement = 'photos'
where id = '33333333-3333-4333-8333-333333333333';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech uuid;
  req uuid := '99990000-0000-4000-8000-000000000009';
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.assign_request(req, tech);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);
  perform public.mark_on_site(req, 'tap');
  perform public.start_job(req);
  perform public.select_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');

  begin
    perform public.close_visit(req, 'easy', 'Capacitor replaced.');
    raise exception 'FAIL: photo rule closed without a photo';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%photo%' then
        raise exception 'FAIL: expected the photo gate, got: %', sqlerrm;
      end if;
  end;

  perform public.attach_visit_file(req, 'nameplate', 'local-plate', null);
  begin
    perform public.close_visit(req, 'easy', 'Capacitor replaced.');
    raise exception 'FAIL: a nameplate photo satisfied the photo rule';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%photo%' then
        raise exception 'FAIL: expected the photo gate after a nameplate, got: %', sqlerrm;
      end if;
  end;

  perform public.attach_visit_file(req, 'photo', 'local-photo-1', null);
  perform public.close_visit(req, 'easy', 'Capacitor replaced.');
  if (select board_status from public.service_requests where id = req) <> 'complete' then
    raise exception 'FAIL: photo close did not complete';
  end if;

  raise notice 'PASS: photo sign-off ignores a nameplate and accepts a photo';
end
$proof$;
rollback;

-- ---------------------------------------------------------------------------
-- The assigned owner can arrive and start. Someone else cannot.
-- A one-shot repair cannot close as Easy.
-- ---------------------------------------------------------------------------

begin;
insert into public.service_requests (
  id, customer_id, property_id, unit_id, contact_id, issue, source
) values
  (
    '99990000-0000-4000-8000-000000000010',
    '33333333-3333-4333-8333-333333333333',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
    '44444444-4444-4444-8444-444444444444',
    'Owner on site',
    'phone'
  ),
  (
    '99990000-0000-4000-8000-000000000011',
    '33333333-3333-4333-8333-333333333333',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
    '44444444-4444-4444-8444-444444444444',
    'One shot',
    'phone'
  );
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech uuid;
  owner uuid;
  owner_req uuid := '99990000-0000-4000-8000-000000000010';
  shot_req uuid := '99990000-0000-4000-8000-000000000011';
  result jsonb;
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  select id into owner from public.profiles where auth_user_id = '11111111-1111-4111-8111-111111111111';

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.assign_request(owner_req, owner);
  perform public.go_en_route(owner_req, null);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  begin
    perform public.mark_on_site(owner_req, 'tap');
    raise exception 'FAIL: a different tech marked arrival';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%assigned tech%' then
        raise exception 'FAIL: expected the assignment check, got: %', sqlerrm;
      end if;
  end;

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.mark_on_site(owner_req, 'tap');
  result := public.start_job(owner_req);
  if (result ->> 'visit_status') <> 'working' then
    raise exception 'FAIL: assigned owner could not start the job';
  end if;

  perform public.assign_request(shot_req, tech);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(shot_req, null);
  perform public.mark_on_site(shot_req, 'tap');
  perform public.start_job(shot_req);
  result := public.select_visit_bundle(shot_req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
  if (result ->> 'one_shot')::boolean is not true then
    raise exception 'FAIL: one-shot bundle was not flagged';
  end if;
  if (
    select outcome_path from public.service_visits
    where request_id = shot_req and status = 'working'
  ) <> 'parts' then
    raise exception 'FAIL: one-shot bundle did not arm the parts path';
  end if;
  begin
    perform public.close_visit(
      request_id => shot_req,
      outcome => 'easy',
      tech_note => 'Tried to bill the coil today.',
      model_typed => 'RH1T2417',
      serial_typed => '998877'
    );
    raise exception 'FAIL: one-shot closed as Easy';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      if sqlerrm not like '%Needs parts%' then
        raise exception 'FAIL: expected the one-shot gate, got: %', sqlerrm;
      end if;
  end;

  raise notice 'PASS: assigned owner can start; one-shot cannot close as Easy';
end
$proof$;
rollback;
