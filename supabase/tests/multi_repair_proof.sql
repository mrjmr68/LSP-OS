-- Proves several repairs on one visit: add keeps earlier picks, the same
-- repair twice is ignored, remove takes one off, and closing invoices all.
-- Runs after visit_proof.sql (bundles aaaa…1 CAP and aaaa…2 COIL exist).
\set ON_ERROR_STOP on

begin;

insert into public.bundles (
  id, code, title, narrative, pricing_kind, target_price_cents, labor_hours,
  one_shot, requires_model_serial, status
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'DRAIN', 'AHU - Cond Lines - Clear',
  'Cleared the condensate line.', 'fixed', 16500, 0.50, false, false, 'active'
);

insert into public.service_requests (id, customer_id, property_id, unit_id, contact_id, issue, source)
values (
  '99990000-0000-4000-8000-000000000077',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444',
  'Multi repair proof', 'phone'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  req uuid := '99990000-0000-4000-8000-000000000077';
  tech uuid;
  n integer;
  sel uuid;
  result jsonb;
  total integer;
begin
  select id into tech from public.profiles where auth_user_id = '22222222-2222-4222-8222-222222222222';
  perform public.assign_request(req, tech);

  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.go_en_route(req, null);
  perform public.mark_on_site(req, 'tap');
  perform public.start_job(req);

  perform public.add_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  perform public.add_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
  select count(*) into n from public.visit_bundle_selections s
  join public.service_visits v on v.id = s.visit_id where v.request_id = req;
  if n <> 2 then raise exception 'FAIL: expected 2 repairs on the visit, got %', n; end if;

  result := public.add_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
  select count(*) into n from public.visit_bundle_selections s
  join public.service_visits v on v.id = s.visit_id where v.request_id = req;
  if n <> 2 then raise exception 'FAIL: the same repair was added twice'; end if;

  -- A part-needing repair sets the parts path; removing it clears that.
  perform public.add_visit_bundle(req, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
  select s.id into sel from public.visit_bundle_selections s
  join public.service_visits v on v.id = s.visit_id
  where v.request_id = req and s.bundle_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  perform public.remove_visit_bundle(req, sel);
  select count(*) into n from public.visit_bundle_selections s
  join public.service_visits v on v.id = s.visit_id where v.request_id = req;
  if n <> 2 then raise exception 'FAIL: remove left % repairs', n; end if;
  if exists (select 1 from public.service_visits where request_id = req and outcome_path = 'parts') then
    raise exception 'FAIL: parts path stayed after the part repair came off';
  end if;

  -- Only the assigned tech can remove.
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  begin
    perform public.remove_visit_bundle(req, sel);
    raise exception 'FAIL: someone else removed a repair';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform public.close_visit(request_id => req, outcome => 'easy', tech_note => '');
  select count(*), sum(l.amount_cents) into n, total
  from public.invoice_lines l join public.invoice_records i on i.id = l.invoice_id
  where i.request_id = req;
  if n <> 2 or total <> 26500 then
    raise exception 'FAIL: invoice should have 2 lines totaling 26500, got % lines, %', n, total;
  end if;
end;
$proof$;

rollback;
