-- Proves the estimate path (Matt, Nov 20):
--   A. Evap coil: tech closes "Needs estimate" → owner edits (discount, an
--      added line) and sends → the property approves on the link (signed out)
--      → Parts with a part order → receipt → Ready → the work visit carries the
--      coil at the approved price → the invoice holds that price when the coil
--      costs more (profit takes it), even after the owner confirms the cost.
--   B. A repair with no part: the owner records the approval → Ready.
--   C. Declined on the link → owner bills the diagnostic (draft invoice $165).
--   D. Declined → owner closes with no charge.
\set ON_ERROR_STOP on

begin;

insert into public.bundles (
  id, code, title, narrative, pricing_kind, target_price_cents, labor_hours,
  reference_part_cost_cents, one_shot, requires_model_serial, status
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1', 'EST-EVAP', 'AHU - Evap Coil - Replace',
   'Replaced the evaporator coil.', 'variable', 167500, 6.00, 35000, true, true, 'active'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae2', 'EST-CAP', 'CU - Capacitor - Replace',
   'Replaced the run capacitor.', 'fixed', 30000, 1.00, null, false, false, 'active');
insert into public.bundle_lines (bundle_id, kind, description, qty, unit_cost_cents) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1', 'part', 'Coil - Evaporator', 1, 35000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1', 'material', 'Materials - Brazing', 1, 4000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae2', 'part', 'Capacitor', 1, 2000);
insert into public.bundles (code, title, narrative, pricing_kind, target_price_cents, labor_hours, status)
values ('SYS - MIN - None', 'SYS - MIN - None', 'Checked the system; diagnosed the problem.', 'fixed', 16500, 0.75, 'active');

insert into public.service_requests (id, customer_id, property_id, unit_id, contact_id, issue, source)
select v.id::uuid,
  '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444',
  v.issue, 'phone'
from (values
  ('99990000-0000-4000-8000-0000000000e1', 'Estimate proof A'),
  ('99990000-0000-4000-8000-0000000000e2', 'Estimate proof B'),
  ('99990000-0000-4000-8000-0000000000e3', 'Estimate proof C'),
  ('99990000-0000-4000-8000-0000000000e4', 'Estimate proof D')
) v(id, issue);

create temp table proof_state (k text primary key, v text);
grant all on proof_state to authenticated, anon;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- Each job: the tech diagnoses it and closes it as Needs estimate.
do $proof$
declare
  tech uuid;
  r record;
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  for r in
    select * from (values
      ('99990000-0000-4000-8000-0000000000e1'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae1'::uuid),
      ('99990000-0000-4000-8000-0000000000e2'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae2'::uuid),
      ('99990000-0000-4000-8000-0000000000e3'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae2'::uuid),
      ('99990000-0000-4000-8000-0000000000e4'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae2'::uuid)
    ) t(req, bundle)
  loop
    perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
    perform public.assign_request(r.req, tech);
    perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
    perform public.go_en_route(r.req, null);
    perform public.mark_on_site(r.req, 'tap');
    perform public.start_job(r.req);
    perform public.add_visit_bundle(r.req, r.bundle);
    perform public.close_visit(
      request_id => r.req, outcome => 'estimate', tech_note => 'System is 14 years old; repair or replace.',
      model_typed => 'ARUF37C14', serial_typed => '1012345678'
    );
  end loop;
end;
$proof$;

-- A: owner edits and sends.
do $proof$
declare
  req uuid := '99990000-0000-4000-8000-0000000000e1';
  est public.estimates;
  line public.estimate_lines;
  profit public.estimate_cost_lines;
  board text;
  n integer;
  sent jsonb;
begin
  select * into est from public.estimates where request_id = req;
  select board_status into board from public.service_requests where id = req;
  if est.status <> 'draft' or board <> 'to_estimate' then
    raise exception 'FAIL: expected a draft estimate in To estimate, got % / %', est.status, board;
  end if;
  select * into line from public.estimate_lines where estimate_id = est.id;
  select sum(amount_cents) into n from public.estimate_cost_lines where estimate_line_id = line.id;
  if n <> 167500 or line.amount_cents <> 167500 then
    raise exception 'FAIL: cost lines should add up to the price, got %', n;
  end if;

  -- The tech can't edit or send it.
  begin
    perform public.send_estimate(est.id, null);
    raise exception 'FAIL: tech sent an estimate';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  -- $100 off the profit, plus a written line.
  select * into profit from public.estimate_cost_lines where estimate_line_id = line.id and kind = 'profit';
  perform public.set_estimate_cost_line(profit.id, null, profit.amount_cents - 10000);
  perform public.add_estimate_line(est.id, 'Haul away the old coil', 5000);
  perform public.update_estimate_details(est.id, 'The coil is leaking. Replace it with a matching coil.', '3 ton');
  select * into est from public.estimates where id = est.id;
  if est.subtotal_cents <> 157500 + 5000 then
    raise exception 'FAIL: subtotal should follow the edits, got %', est.subtotal_cents;
  end if;

  sent := public.send_estimate(est.id, null);
  select * into est from public.estimates where id = est.id;
  select board_status into board from public.service_requests where id = req;
  if est.status <> 'sent' or est.number is null or board <> 'estimate_out' or est.public_token is null then
    raise exception 'FAIL: send did not stick: % % %', est.status, est.number, board;
  end if;
  if sent ->> 'number' <> est.number then raise exception 'FAIL: number not returned'; end if;
  begin
    perform public.add_estimate_line(est.id, 'Late change', 100);
    raise exception 'FAIL: edited a sent estimate';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  insert into proof_state values ('tokenA', est.public_token);
end;
$proof$;

-- A: the property approves on the link, signed out.
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $proof$
declare
  tok text := (select v from proof_state where k = 'tokenA');
  shown jsonb;
  res jsonb;
begin
  if public.estimate_by_token('not-a-real-token-at-all-xx') is not null then
    raise exception 'FAIL: a made-up token showed an estimate';
  end if;
  shown := public.estimate_by_token(tok);
  if shown ->> 'status' <> 'viewed' or (shown ->> 'total_cents')::int <= 0
     or jsonb_array_length(shown -> 'lines') <> 2 then
    raise exception 'FAIL: link should show the estimate, got %', shown;
  end if;
  if shown::text like '%Profit%' or shown::text like '%cost%' and shown::text not like '%total_cents%' then
    raise exception 'FAIL: the link must not show cost lines';
  end if;
  begin
    perform public.respond_to_estimate(tok, true, '', null);
    raise exception 'FAIL: approved without a name';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  res := public.respond_to_estimate(tok, true, 'Dana Property Manager', 'Go ahead.');
  if res ->> 'status' <> 'accepted' then raise exception 'FAIL: not accepted: %', res; end if;
  res := public.respond_to_estimate(tok, false, null, null);
  if (res ->> 'already')::boolean is not true or res ->> 'status' <> 'accepted' then
    raise exception 'FAIL: a second answer changed it: %', res;
  end if;
  -- Signed out can't reach the owner functions.
  begin
    perform public.send_estimate('00000000-0000-4000-8000-000000000000', null);
    raise exception 'FAIL: anon reached send_estimate';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end;
$proof$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- A: Parts → receipt → Ready → work visit at the approved price.
do $proof$
declare
  req uuid := '99990000-0000-4000-8000-0000000000e1';
  est public.estimates;
  ord public.parts_orders;
  board text;
  ret_visit public.service_visits;
  sel public.visit_bundle_selections;
  inv public.invoice_records;
  line public.invoice_lines;
  est_profit integer;
  profit integer;
  part integer;
  n integer;
begin
  select * into est from public.estimates where request_id = req;
  if est.response_name <> 'Dana Property Manager' or est.responded_via <> 'link' then
    raise exception 'FAIL: who approved was not kept';
  end if;
  select board_status into board from public.service_requests where id = req;
  if board <> 'parts' then raise exception 'FAIL: approved coil should go to Parts, got %', board; end if;
  select * into ord from public.parts_orders where request_id = req;
  if ord.id is null or ord.status <> 'needed' or ord.visit_selection_id is null then
    raise exception 'FAIL: approval should open a linked part order';
  end if;

  -- The tech asks an owner to order it.
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.ask_owner_for_part(ord.id);
  if (select owner_help_at from public.parts_orders where id = ord.id) is null then
    raise exception 'FAIL: ask for help not recorded';
  end if;

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.order_part(ord.id, null, 'Johnstone', 'SO-77', 'CAPF3743', 35800, current_date + 1, null);
  perform public.receive_part(ord.id, 41200, ord.id::text || '/receipt.jpg');
  select board_status into board from public.service_requests where id = req;
  if board <> 'ready' then raise exception 'FAIL: in hand should make it Ready, got %', board; end if;

  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);
  select * into ret_visit from public.service_visits where request_id = req order by visit_seq desc limit 1;
  select count(*) into n from public.visit_bundle_selections where visit_id = ret_visit.id;
  select * into sel from public.visit_bundle_selections where visit_id = ret_visit.id;
  if n <> 1 or sel.price_cents_snap <> 157500 or sel.estimate_line_id is null then
    raise exception 'FAIL: the work visit should carry the coil at the approved $1,575, got % at %', n, sel.price_cents_snap;
  end if;
  if sel.narrative_snap <> (select description_customer from public.estimate_lines where id = sel.estimate_line_id) then
    raise exception 'FAIL: approved wording should carry';
  end if;
  if ret_visit.model_typed <> 'ARUF37C14' then raise exception 'FAIL: model should carry'; end if;
  perform public.mark_on_site(req, 'tap');
  perform public.start_job(req);
  perform public.close_visit(request_id => req, outcome => 'easy', tech_note => '');

  select * into inv from public.invoice_records where request_id = req;
  select count(*) into n from public.invoice_lines where invoice_id = inv.id;
  if n <> 2 then raise exception 'FAIL: invoice should have the coil and the haul-away line, got %', n; end if;
  select * into line from public.invoice_lines where invoice_id = inv.id and visit_selection_id is not null;
  if line.amount_cents <> 157500 then
    raise exception 'FAIL: approved price should hold, got %', line.amount_cents;
  end if;
  select amount_cents into part from public.invoice_cost_lines where invoice_line_id = line.id and kind = 'part';
  select amount_cents into profit from public.invoice_cost_lines where invoice_line_id = line.id and kind = 'profit';
  select c.amount_cents into est_profit
  from public.estimate_cost_lines c join public.estimate_lines l on l.id = c.estimate_line_id
  where l.estimate_id = est.id and c.kind = 'profit' and l.visit_selection_id is not null;
  if part <> 41200 or profit <> est_profit - (41200 - 35000) then
    raise exception 'FAIL: part should be the receipt and profit take the $62, got part % profit % (est %)', part, profit, est_profit;
  end if;
  if inv.subtotal_cents <> 157500 + 5000 then
    raise exception 'FAIL: invoice subtotal should match the estimate, got %', inv.subtotal_cents;
  end if;
  if (select string_agg(label, '|' order by sort) from public.invoice_cost_lines where invoice_line_id = line.id) not like 'Labor 6 hr|%' then
    raise exception 'FAIL: labor wording should carry from the estimate';
  end if;

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.confirm_part_cost(line.id, 40500);
  select * into line from public.invoice_lines where id = line.id;
  select amount_cents into profit from public.invoice_cost_lines where invoice_line_id = line.id and kind = 'profit';
  if line.amount_cents <> 157500 or profit <> est_profit - (40500 - 35000) then
    raise exception 'FAIL: confirm should hold the price and move profit, got % / %', line.amount_cents, profit;
  end if;
  perform public.approve_invoice(inv.id, null);
  select board_status into board from public.service_requests where id = req;
  if board <> 'invoiced' then raise exception 'FAIL: should be Invoiced, got %', board; end if;
end;
$proof$;

-- B: no part; the owner records the yes. C and D: sent for the link.
do $proof$
declare
  est public.estimates;
  res jsonb;
  board text;
  sel public.visit_bundle_selections;
begin
  select * into est from public.estimates where request_id = '99990000-0000-4000-8000-0000000000e2';
  begin
    perform public.record_estimate_response(est.id, true, null);
    raise exception 'FAIL: recorded a yes on an unsent estimate';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  perform public.send_estimate(est.id, null);
  res := public.record_estimate_response(est.id, true, 'Called in a yes');
  select board_status into board from public.service_requests where id = est.request_id;
  if res ->> 'board' <> 'ready' or board <> 'ready' then
    raise exception 'FAIL: approved repair with no part should go to Ready, got %', board;
  end if;
  if exists (select 1 from public.parts_orders where request_id = est.request_id) then
    raise exception 'FAIL: no part order for a repair without a part';
  end if;

  select * into est from public.estimates where request_id = '99990000-0000-4000-8000-0000000000e3';
  perform public.send_estimate(est.id, null);
  insert into proof_state values ('tokenC', (select public_token from public.estimates where id = est.id));
  select * into est from public.estimates where request_id = '99990000-0000-4000-8000-0000000000e4';
  perform public.send_estimate(est.id, null);
  perform public.record_estimate_response(est.id, false, 'Replacing it themselves');
end;
$proof$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select public.respond_to_estimate((select v from proof_state where k = 'tokenC'), false, 'Dana', 'Too much');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  est public.estimates;
  res jsonb;
  board text;
  inv public.invoice_records;
  n integer;
begin
  -- C: bill the diagnostic.
  select * into est from public.estimates where request_id = '99990000-0000-4000-8000-0000000000e3';
  if est.status <> 'declined' or est.responded_via <> 'link' then
    raise exception 'FAIL: link decline not recorded';
  end if;
  res := public.settle_declined_estimate(est.id, true);
  select * into inv from public.invoice_records where request_id = est.request_id;
  select board_status into board from public.service_requests where id = est.request_id;
  if inv.status <> 'draft' or inv.subtotal_cents <> 16500 or board <> 'complete' then
    raise exception 'FAIL: diagnostic should be a $165 draft in Complete, got % % %', inv.status, inv.subtotal_cents, board;
  end if;
  select sum(c.amount_cents) into n from public.invoice_cost_lines c where c.invoice_id = inv.id;
  if n <> 16500 then raise exception 'FAIL: diagnostic cost lines should add up, got %', n; end if;
  begin
    perform public.settle_declined_estimate(est.id, false);
    raise exception 'FAIL: settled twice';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- D: close with no charge.
  select * into est from public.estimates where request_id = '99990000-0000-4000-8000-0000000000e4';
  if est.responded_via <> 'owner' then raise exception 'FAIL: owner decline not recorded'; end if;
  perform public.settle_declined_estimate(est.id, false);
  select board_status into board from public.service_requests where id = est.request_id;
  if board <> 'closed' or exists (select 1 from public.invoice_records where request_id = est.request_id) then
    raise exception 'FAIL: no charge should close the job without an invoice, got %', board;
  end if;
end;
$proof$;

rollback;
