-- Proves the part-and-return-trip path on a variable-cost repair (evap coil):
-- close to Parts → order with quoted cost → in hand only with actual cost and
-- receipt → Ready → the return visit carries the repair → it closes as a normal
-- repair → the invoice uses the actual part cost (price moves dollar for
-- dollar, profit stays) → approve is blocked until the owner confirms the cost.
\set ON_ERROR_STOP on

begin;

insert into public.bundles (
  id, code, title, narrative, pricing_kind, target_price_cents, labor_hours,
  reference_part_cost_cents, one_shot, requires_model_serial, status
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1', 'RET-EVAP', 'AHU - Evap Coil - Replace',
  'Replaced the evaporator coil.', 'variable', 167500, 6.00, 35000, true, true, 'active'
);
insert into public.bundle_lines (bundle_id, kind, description, qty, unit_cost_cents) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1', 'part', 'Coil - Evaporator', 1, 35000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1', 'material', 'Materials - Brazing', 1, 4000);

insert into public.service_requests (id, customer_id, property_id, unit_id, contact_id, issue, source)
values (
  '99990000-0000-4000-8000-0000000000a1',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  'Parts return proof', 'phone'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  req uuid := '99990000-0000-4000-8000-0000000000a1';
  tech uuid;
  ord public.parts_orders;
  board text;
  inv public.invoice_records;
  line public.invoice_lines;
  part_amount integer;
  ret_visit public.service_visits;
  n integer;
  rate integer;
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  select labor_rate_cents into rate from public.app_config where id = 1;
  perform public.assign_request(req, tech);

  -- Diagnosis visit: coil picked, closed to Parts.
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);
  perform public.mark_on_site(req, 'tap');
  perform public.start_job(req);
  perform public.add_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1');
  perform public.close_visit(
    request_id => req, outcome => 'parts', tech_note => '',
    model_typed => 'ARUF37C14', serial_typed => '1712345678', part_description => 'Coil - Evaporator'
  );
  select board_status into board from public.service_requests where id = req;
  if board <> 'parts' then raise exception 'FAIL: should be in Parts, got %', board; end if;
  if exists (select 1 from public.invoice_records where request_id = req) then
    raise exception 'FAIL: the diagnosis trip must not be invoiced';
  end if;
  select * into ord from public.parts_orders where request_id = req;
  if ord.visit_selection_id is null then raise exception 'FAIL: order not linked to the repair'; end if;

  -- No path to In hand without the cost and receipt.
  begin
    update public.parts_orders set status = 'in_hand', in_hand_at = now(), in_hand_by = tech where id = ord.id;
    raise exception 'FAIL: marked in hand directly without cost';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.mark_part_in_hand(ord.id, null);
    raise exception 'FAIL: old in-hand path skipped the cost';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.receive_part(ord.id, 41200, null);
    raise exception 'FAIL: in hand without a receipt';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.receive_part(ord.id, 41200, 'some-other-order/receipt.jpg');
    raise exception 'FAIL: accepted another order''s receipt';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- Order it, then receive it with the receipt.
  perform public.order_part(ord.id, null, 'Johnstone, counter', 'SO-5521', 'CAPF3743', 35800, current_date + 2, null);
  select * into ord from public.parts_orders where id = ord.id;
  if ord.status <> 'ordered' or ord.quoted_cost_cents <> 35800 or ord.part_number <> 'CAPF3743' then
    raise exception 'FAIL: order not recorded: %', row_to_json(ord);
  end if;
  perform public.receive_part(ord.id, 41200, ord.id::text || '/receipt.jpg');
  select * into ord from public.parts_orders where id = ord.id;
  if ord.status <> 'in_hand' or ord.actual_cost_cents <> 41200 then raise exception 'FAIL: not received'; end if;
  select board_status into board from public.service_requests where id = req;
  if board <> 'ready' then raise exception 'FAIL: in hand should make it Ready, got %', board; end if;

  -- Return visit carries the coil over and closes as a normal repair.
  perform public.go_en_route(req, null);
  select * into ret_visit from public.service_visits where request_id = req order by visit_seq desc limit 1;
  if ret_visit.visit_type <> 'return' then raise exception 'FAIL: second trip should be a return visit'; end if;
  select count(*) into n from public.visit_bundle_selections where visit_id = ret_visit.id;
  if n <> 1 then raise exception 'FAIL: the coil should carry to the return visit, got % repairs', n; end if;
  if ret_visit.model_typed <> 'ARUF37C14' then raise exception 'FAIL: model should carry over'; end if;
  perform public.mark_on_site(req, 'tap');
  perform public.start_job(req);
  perform public.close_visit(request_id => req, outcome => 'easy', tech_note => '');

  -- One invoice, priced on the actual coil: $1,675 + ($412 − $350) = $1,737.
  select * into inv from public.invoice_records where request_id = req;
  select * into line from public.invoice_lines where invoice_id = inv.id;
  if line.amount_cents <> 167500 + (41200 - 35000) then
    raise exception 'FAIL: price should move with the coil cost, got %', line.amount_cents;
  end if;
  select amount_cents into part_amount from public.invoice_cost_lines where invoice_line_id = line.id and kind = 'part';
  if part_amount <> 41200 then raise exception 'FAIL: part cost line should be the receipt, got %', part_amount; end if;
  if (select amount_cents from public.invoice_cost_lines where invoice_line_id = line.id and kind = 'profit')
     <> 167500 - 35000 - 4000 - 6 * rate then
    raise exception 'FAIL: profit should not move with the part cost';
  end if;
  if inv.subtotal_cents <> line.amount_cents then raise exception 'FAIL: invoice total did not follow'; end if;

  -- Owner: approve is blocked until the part cost is confirmed.
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  begin
    perform public.approve_invoice(inv.id, null);
    raise exception 'FAIL: approved without confirming the part cost';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  -- The supplier bill said $405: confirm that; the price follows.
  perform public.confirm_part_cost(line.id, 40500);
  select * into line from public.invoice_lines where id = line.id;
  if line.amount_cents <> 167500 + (40500 - 35000) or line.part_cost_confirmed_at is null then
    raise exception 'FAIL: confirm should set the cost and move the price, got %', line.amount_cents;
  end if;
  perform public.approve_invoice(inv.id, null);
  select board_status into board from public.service_requests where id = req;
  if board <> 'invoiced' then raise exception 'FAIL: should be Invoiced, got %', board; end if;
end;
$proof$;

rollback;
