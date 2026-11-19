-- Proves owner review: a closed visit's draft carries every cost line,
-- removing / putting back / editing lines moves the totals, a tech can't
-- edit or approve, a question flags the draft and the tech can answer,
-- and approve numbers it, bills the customer and moves the job to Invoiced.
-- Runs after multi_repair_proof.sql (bundles CAP and DRAIN exist).
\set ON_ERROR_STOP on

begin;

insert into public.bundles (
  id, code, title, narrative, pricing_kind, target_price_cents, labor_hours,
  one_shot, requires_model_serial, status
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1', 'REV-CAP', 'AHU - Capacitor - Replace',
  'Replaced the failed run capacitor.', 'fixed', 26500, 1.00, false, false, 'active'
), (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2', 'REV-DRAIN', 'AHU - Cond Lines - Clear',
  'Cleared the condensate line.', 'fixed', 19500, 1.00, false, false, 'active'
);
insert into public.bundle_lines (bundle_id, kind, description, qty, unit_cost_cents) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1', 'part', 'Capacitor - Single', 1, 1000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1', 'material', 'Materials - Standard', 1, 2000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2', 'material', 'Materials - Minimal', 1, 500);

insert into public.service_requests (id, customer_id, property_id, unit_id, contact_id, issue, source)
values (
  '99990000-0000-4000-8000-000000000091',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  'Owner review proof', 'phone'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  req uuid := '99990000-0000-4000-8000-000000000091';
  tech uuid;
  inv public.invoice_records;
  n integer;
  total integer;
  cap_line uuid;
  drain_line uuid;
  labor uuid;
  profit uuid;
  added uuid;
  result jsonb;
  board text;
  rate integer;
  before_number integer;
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  select labor_rate_cents into rate from public.app_config where id = 1;
  perform public.assign_request(req, tech);

  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);
  perform public.mark_on_site(req, 'tap');
  perform public.start_job(req);
  perform public.add_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1');
  perform public.add_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2');
  perform public.close_visit(request_id => req, outcome => 'easy', tech_note => '');

  select * into inv from public.invoice_records where request_id = req;
  if inv.total_cents <> inv.subtotal_cents + inv.tax_cents or inv.subtotal_cents <> 46000 then
    raise exception 'FAIL: draft should start at 46000 subtotal, got %', inv.subtotal_cents;
  end if;

  -- Every repair has its cost lines: labor, part, material, profit for the capacitor.
  select l.id into cap_line from public.invoice_lines l
  join public.visit_bundle_selections s on s.id = l.visit_selection_id
  where l.invoice_id = inv.id and s.bundle_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1';
  select l.id into drain_line from public.invoice_lines l
  join public.visit_bundle_selections s on s.id = l.visit_selection_id
  where l.invoice_id = inv.id and s.bundle_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2';
  select count(*), sum(amount_cents) into n, total from public.invoice_cost_lines where invoice_line_id = cap_line;
  if n <> 4 or total <> 26500 then
    raise exception 'FAIL: capacitor should have 4 cost lines adding to 26500, got % / %', n, total;
  end if;
  if (select kind from public.invoice_cost_lines where invoice_line_id = cap_line and sort = 1) <> 'labor'
    or (select amount_cents from public.invoice_cost_lines where invoice_line_id = cap_line and sort = 1) <> rate then
    raise exception 'FAIL: labor should be first at one hour';
  end if;

  -- A tech can see the cost lines but can't change them or approve.
  select id into labor from public.invoice_cost_lines where invoice_line_id = drain_line and kind = 'labor';
  begin
    perform public.set_invoice_cost_line(labor, true, null);
    raise exception 'FAIL: tech removed a cost line';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.approve_invoice(inv.id, null);
    raise exception 'FAIL: tech approved an invoice';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  update public.invoice_cost_lines set removed = true where id = labor;
  if exists (select 1 from public.invoice_cost_lines where id = labor and removed) then
    raise exception 'FAIL: tech wrote a cost line directly';
  end if;

  -- Owner: take the second repair's labor off (travel is already on the first).
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.set_invoice_cost_line(labor, true, null);
  select amount_cents into total from public.invoice_lines where id = drain_line;
  if total <> 19500 - rate then
    raise exception 'FAIL: removing labor should drop the drain line to %, got %', 19500 - rate, total;
  end if;
  select * into inv from public.invoice_records where id = inv.id;
  if inv.subtotal_cents <> 46000 - rate or inv.total_cents <> inv.subtotal_cents + inv.tax_cents then
    raise exception 'FAIL: invoice totals did not follow, subtotal %', inv.subtotal_cents;
  end if;

  -- Put it back, then trim profit instead.
  perform public.set_invoice_cost_line(labor, false, null);
  select id into profit from public.invoice_cost_lines where invoice_line_id = drain_line and kind = 'profit';
  perform public.set_invoice_cost_line(profit, null, 5000);
  select amount_cents into total from public.invoice_lines where id = drain_line;
  if total <> rate + 500 + 5000 then
    raise exception 'FAIL: profit edit should make the drain line %, got %', rate + 500 + 5000, total;
  end if;
  if (select internal_profit_cents from public.invoice_lines where id = drain_line) <> 5000 then
    raise exception 'FAIL: internal profit should be 5000';
  end if;

  -- A cost can't go below zero.
  begin
    perform public.set_invoice_cost_line(labor, null, -1);
    raise exception 'FAIL: negative cost accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- Add a discount line, rename it, then take it off.
  added := public.add_invoice_line(inv.id, 'Second repair, same trip', -2000);
  select subtotal_cents into total from public.invoice_records where id = inv.id;
  if total <> 26500 + rate + 500 + 5000 - 2000 then
    raise exception 'FAIL: added line not in subtotal, got %', total;
  end if;
  perform public.update_invoice_line(added, 'Same-trip discount', -2500);
  if (select amount_cents from public.invoice_lines where id = added) <> -2500 then
    raise exception 'FAIL: added line amount did not change';
  end if;
  begin
    perform public.update_invoice_line(cap_line, 'Capacitor', 1);
    raise exception 'FAIL: repair amount set directly';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  perform public.remove_invoice_line(added);
  if exists (select 1 from public.invoice_lines where id = added) then
    raise exception 'FAIL: added line still there';
  end if;

  -- Question to the tech: flagged, text queued, job stays Complete.
  result := public.ask_about_invoice(inv.id, 'Was the drain line on the same unit?');
  if (select status from public.invoice_records where id = inv.id) <> 'flagged' then
    raise exception 'FAIL: question should flag the draft';
  end if;
  if result ->> 'sms' <> 'queued' or not exists (
    select 1 from public.outbound_messages where request_id = req and template = 'flag_back' and status = 'queued'
  ) then
    raise exception 'FAIL: question text should be queued, got %', result;
  end if;
  select board_status into board from public.service_requests where id = req;
  if board <> 'complete' then raise exception 'FAIL: job should stay Complete, got %', board; end if;

  -- The tech answers; the draft returns to the owner.
  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.answer_invoice_question(inv.id, 'Yes, same air handler.');
  select * into inv from public.invoice_records where id = inv.id;
  if inv.status <> 'in_review' or inv.flag_answer <> 'Yes, same air handler.' then
    raise exception 'FAIL: answer not saved, status %', inv.status;
  end if;

  -- Owner approves: numbered, billed to the customer's billing contact, Invoiced.
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  begin
    perform public.approve_invoice(inv.id, inv.updated_at - interval '1 hour');
    raise exception 'FAIL: approved a draft that changed after it was opened';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  select next_invoice_number into before_number from public.app_config where id = 1;
  result := public.approve_invoice(inv.id, inv.updated_at);
  select * into inv from public.invoice_records where id = inv.id;
  if inv.status <> 'approved_sent' or inv.number <> before_number::text or inv.reviewed_by is null
    or inv.invoice_date is null or inv.due_date <> inv.invoice_date + inv.terms_days_snap then
    raise exception 'FAIL: approve did not finish the invoice: %', row_to_json(inv);
  end if;
  if (select next_invoice_number from public.app_config where id = 1) <> before_number + 1 then
    raise exception 'FAIL: next invoice number did not move';
  end if;
  if inv.bill_to_contact_id <> (select billing_contact_id from public.customers where id = inv.bill_to_customer_id) then
    raise exception 'FAIL: invoice should bill the customer''s billing contact';
  end if;
  select board_status into board from public.service_requests where id = req;
  if board <> 'invoiced' then raise exception 'FAIL: job should be Invoiced, got %', board; end if;

  -- Approved is final.
  begin
    perform public.set_invoice_cost_line(labor, true, null);
    raise exception 'FAIL: changed an approved invoice';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform public.record_invoice_email(inv.id, 'billing@example.com', 'sent', 'test-id', 'Invoice ' || inv.number);
  if not exists (select 1 from public.outbound_messages where request_id = req and template = 'invoice' and status = 'sent') then
    raise exception 'FAIL: email not recorded';
  end if;
end;
$proof$;

rollback;

-- "no issue" finds SYS - MIN - None once it exists (search words column).
begin;
insert into public.bundles (code, title, narrative, pricing_kind, target_price_cents, labor_hours, status, search_terms)
values ('SYS - MIN - None', 'SYS - MIN - None', 'Checked the system; no issue found.', 'fixed', 16500, 0.75, 'active', 'no issue found');
do $terms$
begin
  if not exists (select 1 from public.bundles where search_terms ilike '%no issue%') then
    raise exception 'FAIL: search words not saved';
  end if;
end;
$terms$;
rollback;
