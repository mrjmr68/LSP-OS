-- Proves refrigerant pounds (Matt, Nov 20): the tech's pounds are the rule.
--   A visit with two refrigerant repairs closes with 10 lb of R-410A → the
--   first repair's refrigerant line is 10 lb × $15 and its price moves with it;
--   the second repair's refrigerant comes off (counted once). The owner
--   corrects it to 6 lb; the tech can't. Blank pounds change nothing.
\set ON_ERROR_STOP on

begin;

insert into public.bundles (
  id, code, title, narrative, pricing_kind, target_price_cents, labor_hours, one_shot, status
) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf1', 'REF-TXV', 'CU - TXV - Replace', 'Replaced the TXV.', 'fixed', 130500, 4.00, false, 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf2', 'REF-LEAK', 'SYS - REF - Leak - Easy', 'Repaired a leak.', 'fixed', 42500, 1.00, false, 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf3', 'REF-CAP', 'CU - Capacitor - Replace', 'Replaced the capacitor.', 'fixed', 30000, 1.00, false, 'active');
insert into public.bundle_lines (bundle_id, kind, description, qty, unit_cost_cents) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf1', 'part', 'TXV', 1, 9000),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf1', 'refrigerant', 'Refrigerant', 8, 1500),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf2', 'refrigerant', 'Refrigerant', 3, 1500),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf3', 'part', 'Capacitor', 1, 2000);

insert into public.service_requests (id, customer_id, property_id, unit_id, contact_id, issue, source)
select v.id::uuid,
  '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444',
  v.issue, 'phone'
from (values
  ('99990000-0000-4000-8000-0000000000f1', 'Refrigerant proof A'),
  ('99990000-0000-4000-8000-0000000000f2', 'Refrigerant proof B')
) v(id, issue);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  tech uuid;
  req uuid := '99990000-0000-4000-8000-0000000000f1';
  inv public.invoice_records;
  txv public.invoice_lines;
  leak public.invoice_lines;
  ref public.invoice_cost_lines;
  n integer;
  txv_base integer;
  leak_base integer;
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.assign_request(req, tech);

  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);
  perform public.mark_on_site(req, 'tap');
  perform public.start_job(req);
  perform public.add_visit_bundle(req, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf1');
  perform public.add_visit_bundle(req, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf2');
  perform public.close_visit(
    request_id => req, outcome => 'easy', tech_note => '',
    readings => '{"returnAir":"75","refrigerantType":"R-410A","refrigerantLbs":"10"}'::jsonb
  );

  select * into inv from public.invoice_records where request_id = req;
  if inv.refrigerant_lbs <> 10 or inv.refrigerant_type <> 'R-410A' then
    raise exception 'FAIL: invoice should take the tech''s 10 lb R-410A, got % %', inv.refrigerant_lbs, inv.refrigerant_type;
  end if;
  select l.* into txv from public.invoice_lines l join public.visit_bundle_selections s on s.id = l.visit_selection_id
  where l.invoice_id = inv.id and s.bundle_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf1';
  select l.* into leak from public.invoice_lines l join public.visit_bundle_selections s on s.id = l.visit_selection_id
  where l.invoice_id = inv.id and s.bundle_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf2';
  select price_cents_snap into txv_base from public.visit_bundle_selections where id = txv.visit_selection_id;
  select price_cents_snap into leak_base from public.visit_bundle_selections where id = leak.visit_selection_id;

  -- One refrigerant line carries all 10 lb at $15; the other comes off.
  select * into ref from public.invoice_cost_lines where invoice_id = inv.id and kind = 'refrigerant' and not removed;
  if ref.amount_cents <> 15000 or ref.label <> 'Refrigerant R-410A · 10 lb' then
    raise exception 'FAIL: refrigerant should be one 10 lb line at $15, got % "%"', ref.amount_cents, ref.label;
  end if;
  if (select count(*) from public.invoice_cost_lines where invoice_id = inv.id and kind = 'refrigerant' and removed) <> 1 then
    raise exception 'FAIL: the other repair''s refrigerant should come off (counted once)';
  end if;
  -- Book had 8 + 3 = 11 lb ($165); now 10 lb ($150): the total drops $15.
  if (select subtotal_cents from public.invoice_records where id = inv.id) <> txv_base + leak_base - 1500 then
    raise exception 'FAIL: subtotal should follow the pounds, got %', (select subtotal_cents from public.invoice_records where id = inv.id);
  end if;
  select count(*) into n from public.invoice_lines l
  where l.invoice_id = inv.id and l.amount_cents <> (
    select coalesce(sum(c.amount_cents), 0) from public.invoice_cost_lines c where c.invoice_line_id = l.id and not c.removed);
  if n <> 0 then raise exception 'FAIL: every line''s cost lines should add up to its price'; end if;

  -- The tech can't change it after closing.
  begin
    perform public.set_invoice_refrigerant(inv.id, 'R-410A', 2);
    raise exception 'FAIL: tech changed refrigerant on an invoice';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- The owner corrects it to 6 lb.
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.set_invoice_refrigerant(inv.id, 'R-410A', 6);
  -- 6 lb ($90) against the book's 11 lb ($165): the total drops $75.
  if (select subtotal_cents from public.invoice_records where id = inv.id) <> txv_base + leak_base - 7500 then
    raise exception 'FAIL: 6 lb should put the total $75 under the book, got %', (select subtotal_cents from public.invoice_records where id = inv.id);
  end if;
  if (select label from public.invoice_cost_lines where invoice_id = inv.id and kind = 'refrigerant' and not removed) <> 'Refrigerant R-410A · 6 lb' then
    raise exception 'FAIL: label should say 6 lb';
  end if;
  begin
    perform public.set_invoice_refrigerant(inv.id, 'R-410A', 500);
    raise exception 'FAIL: accepted 500 lb';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- B: no pounds entered → the price book stands.
  req := '99990000-0000-4000-8000-0000000000f2';
  perform public.assign_request(req, tech);
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);
  perform public.mark_on_site(req, 'tap');
  perform public.start_job(req);
  perform public.add_visit_bundle(req, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbf1');
  perform public.close_visit(request_id => req, outcome => 'easy', tech_note => '',
    readings => '{"refrigerantLbs":""}'::jsonb);
  select * into inv from public.invoice_records where request_id = req;
  if inv.refrigerant_lbs is not null or inv.subtotal_cents <> txv_base then
    raise exception 'FAIL: blank pounds should leave the book price, got % %', inv.refrigerant_lbs, inv.subtotal_cents;
  end if;
end;
$proof$;

rollback;
