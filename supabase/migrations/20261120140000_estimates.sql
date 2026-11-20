-- Stage 4: estimates (Matt, Nov 20).
--
--   tech closes "Needs estimate" → draft estimate with every cost line of
--   every repair (same as a draft invoice) → owner edits and sends it (number,
--   PDF, an email with a link) → the property approves or declines on that
--   link, or the owner records their answer by hand.
--   Approved: if a repair needs a part, the job goes to Parts with a part order
--   (the same order and receipt steps), otherwise straight to Ready. The next
--   visit opens with the approved repairs at the approved prices, and the
--   invoice holds the approved price: on a variable-cost part the receipt is
--   still required and profit takes the difference.
--   Declined: it waits under Needs you until the owner picks Bill the
--   diagnostic (SYS - MIN - None) or Close with no charge.
--
-- Also: a tech can ask an owner to order a part; it shows under Needs you.

-- ---------------------------------------------------------------------------
-- Tables and columns.
-- ---------------------------------------------------------------------------

create table public.estimate_cost_lines (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  estimate_line_id uuid not null references public.estimate_lines (id) on delete cascade,
  sort integer not null,
  kind public.cost_line_kind not null,
  label text not null,
  amount_cents integer not null,
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estimate_cost_lines_sort_unique unique (estimate_line_id, sort),
  constraint estimate_cost_lines_label_not_blank check (length(trim(label)) > 0),
  constraint estimate_cost_lines_cost_nonnegative check (kind = 'profit' or amount_cents >= 0)
);

comment on table public.estimate_cost_lines is
  'Owner-only breakdown of each repair on an estimate. The line amount is the sum of the rows not removed.';

create index estimate_cost_lines_estimate_idx on public.estimate_cost_lines (estimate_id);

create trigger estimate_cost_lines_set_updated_at
  before update on public.estimate_cost_lines
  for each row execute function public.set_updated_at();

alter table public.estimate_cost_lines enable row level security;

create policy estimate_cost_lines_select_member on public.estimate_cost_lines
  for select to authenticated
  using (public.is_active_member());

create policy estimate_cost_lines_write_owner on public.estimate_cost_lines
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy estimate_lines_delete_owner on public.estimate_lines
  for delete to authenticated
  using (public.is_owner());

alter table public.estimates
  add column response_name text,
  add column responded_via text,
  add column decline_settled_at timestamptz,
  add column decline_outcome text,
  add constraint estimates_responded_via_check check (responded_via is null or responded_via in ('link', 'owner')),
  add constraint estimates_decline_outcome_check check (decline_outcome is null or decline_outcome in ('billed', 'no_charge'));

alter table public.app_config
  add column next_estimate_number integer not null default 1001,
  add constraint app_config_next_estimate_positive check (next_estimate_number > 0);

-- A repair carried onto the work visit from an approved estimate.
alter table public.visit_bundle_selections
  add column estimate_line_id uuid references public.estimate_lines (id);

-- A tech asking an owner to order the part.
alter table public.parts_orders
  add column owner_help_at timestamptz,
  add column owner_help_by uuid references public.profiles (id);

-- ---------------------------------------------------------------------------
-- Estimate cost lines from the repair's price snapshot (as for invoices).
-- ---------------------------------------------------------------------------

create or replace function internal.build_estimate_cost_lines(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.estimate_lines;
  v_sel public.visit_bundle_selections;
  v_sort integer := 0;
  v_sum integer := 0;
  v_amount integer;
  v_qty numeric;
  v_label text;
  v_item record;
begin
  select * into v_line from public.estimate_lines where id = p_line_id;
  if v_line.id is null or v_line.visit_selection_id is null then
    return;
  end if;
  if exists (select 1 from public.estimate_cost_lines where estimate_line_id = p_line_id) then
    return;
  end if;
  select * into v_sel from public.visit_bundle_selections where id = v_line.visit_selection_id;
  if v_sel.id is null then
    return;
  end if;

  for v_item in
    select e.value as item, e.ordinality as n
    from jsonb_array_elements(coalesce(v_sel.cost_lines_snap, '[]'::jsonb)) with ordinality as e
    order by (e.value ->> 'kind') <> 'labor', e.ordinality
  loop
    if (v_item.item ->> 'kind') not in ('labor', 'part', 'equipment', 'material', 'consumable', 'refrigerant') then
      continue;
    end if;
    v_qty := coalesce((v_item.item ->> 'qty')::numeric, 1);
    v_amount := round(v_qty * coalesce((v_item.item ->> 'unit_cost_cents')::numeric, 0))::integer * v_sel.qty;
    if (v_item.item ->> 'kind') = 'labor' then
      v_label := 'Labor ' || trim_scale(v_qty * v_sel.qty) || ' hr';
    else
      v_label := coalesce(nullif(trim(v_item.item ->> 'description'), ''), initcap(v_item.item ->> 'kind'));
      if v_qty * v_sel.qty <> 1 then
        v_label := v_label || ' × ' || trim_scale(v_qty * v_sel.qty);
      end if;
    end if;
    v_sort := v_sort + 1;
    insert into public.estimate_cost_lines (estimate_id, estimate_line_id, sort, kind, label, amount_cents)
    values (v_line.estimate_id, v_line.id, v_sort, (v_item.item ->> 'kind')::public.cost_line_kind, v_label, v_amount);
    v_sum := v_sum + v_amount;
  end loop;

  insert into public.estimate_cost_lines (estimate_id, estimate_line_id, sort, kind, label, amount_cents)
  values (v_line.estimate_id, v_line.id, v_sort + 1, 'profit', 'Profit', v_line.amount_cents - v_sum);
end;
$$;

create or replace function internal.estimate_line_cost_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform internal.build_estimate_cost_lines(new.id);
  return new;
end;
$$;

create trigger estimate_lines_build_cost_lines
  after insert on public.estimate_lines
  for each row execute function internal.estimate_line_cost_lines();

do $backfill$
declare
  v_id uuid;
begin
  for v_id in
    select l.id
    from public.estimate_lines l
    join public.estimates e on e.id = l.estimate_id
    where e.status in ('draft', 'in_review')
  loop
    perform internal.build_estimate_cost_lines(v_id);
  end loop;
end;
$backfill$;

-- ---------------------------------------------------------------------------
-- Owner edits on a draft estimate.
-- ---------------------------------------------------------------------------

create or replace function internal.owner_estimate_draft(p_estimate_id uuid)
returns public.estimates
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_est public.estimates;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can change an estimate.' using errcode = '42501';
  end if;
  select * into v_est from public.estimates where id = p_estimate_id for update;
  if v_est.id is null then
    raise exception 'That estimate is gone. Go back to Review.' using errcode = '42501';
  end if;
  if v_est.status not in ('draft', 'in_review') then
    raise exception 'That estimate was already sent.' using errcode = '42501';
  end if;
  return v_est;
end;
$$;

create or replace function internal.recompute_estimate(p_estimate_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_subtotal integer;
  v_bps integer;
  v_tax integer;
begin
  update public.estimate_lines l
  set
    amount_cents = c.amount,
    internal_cost_cents = c.cost,
    internal_profit_cents = c.profit
  from (
    select
      estimate_line_id,
      coalesce(sum(amount_cents) filter (where not removed), 0)::integer as amount,
      coalesce(sum(amount_cents) filter (where not removed and kind <> 'profit'), 0)::integer as cost,
      coalesce(sum(amount_cents) filter (where not removed and kind = 'profit'), 0)::integer as profit
    from public.estimate_cost_lines
    where estimate_id = p_estimate_id
    group by estimate_line_id
  ) c
  where l.id = c.estimate_line_id
    and (l.amount_cents, l.internal_cost_cents, l.internal_profit_cents)
      is distinct from (c.amount, c.cost, c.profit);

  select coalesce(sum(amount_cents), 0)::integer into v_subtotal
  from public.estimate_lines where estimate_id = p_estimate_id;
  select tax_rate_bps_snap into v_bps from public.estimates where id = p_estimate_id;
  v_tax := case when v_subtotal > 0 then ((v_subtotal * v_bps) + 5000) / 10000 else 0 end;

  update public.estimates
  set subtotal_cents = v_subtotal, tax_cents = v_tax, total_cents = v_subtotal + v_tax
  where id = p_estimate_id;
end;
$$;

create or replace function public.set_estimate_cost_line(
  cost_line_id uuid,
  removed boolean default null,
  amount_cents integer default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cost public.estimate_cost_lines;
begin
  select * into v_cost from public.estimate_cost_lines c where c.id = set_estimate_cost_line.cost_line_id;
  if v_cost.id is null then
    raise exception 'That line is gone. Reload the estimate.' using errcode = '42501';
  end if;
  perform internal.owner_estimate_draft(v_cost.estimate_id);
  if amount_cents is not null and amount_cents < 0 and v_cost.kind <> 'profit' then
    raise exception 'A cost can''t be below zero.' using errcode = '22023';
  end if;

  update public.estimate_cost_lines c
  set
    removed = coalesce(set_estimate_cost_line.removed, c.removed),
    amount_cents = coalesce(set_estimate_cost_line.amount_cents, c.amount_cents)
  where c.id = v_cost.id;

  perform internal.recompute_estimate(v_cost.estimate_id);
end;
$$;

create or replace function public.update_estimate_line(
  line_id uuid,
  description text,
  amount_cents integer default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line public.estimate_lines;
  v_text text := nullif(trim(coalesce(description, '')), '');
begin
  select * into v_line from public.estimate_lines l where l.id = update_estimate_line.line_id;
  if v_line.id is null then
    raise exception 'That line is gone. Reload the estimate.' using errcode = '42501';
  end if;
  perform internal.owner_estimate_draft(v_line.estimate_id);
  if v_text is null then
    raise exception 'Write what the property reads for this line.' using errcode = '22023';
  end if;
  if amount_cents is not null and exists (
    select 1 from public.estimate_cost_lines c where c.estimate_line_id = v_line.id
  ) then
    raise exception 'Change this repair''s price through its cost lines.' using errcode = '22023';
  end if;

  update public.estimate_lines l
  set
    description_customer = v_text,
    amount_cents = coalesce(update_estimate_line.amount_cents, l.amount_cents),
    internal_profit_cents = case
      when update_estimate_line.amount_cents is null then l.internal_profit_cents
      else update_estimate_line.amount_cents - coalesce(l.internal_cost_cents, 0)
    end
  where l.id = v_line.id;

  perform internal.recompute_estimate(v_line.estimate_id);
end;
$$;

create or replace function public.add_estimate_line(
  estimate_id uuid,
  description text,
  amount_cents integer
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_est public.estimates;
  v_text text := nullif(trim(coalesce(description, '')), '');
  v_id uuid;
begin
  v_est := internal.owner_estimate_draft(add_estimate_line.estimate_id);
  if v_text is null then
    raise exception 'Write what the property reads for this line.' using errcode = '22023';
  end if;
  if amount_cents is null then
    raise exception 'Put in an amount.' using errcode = '22023';
  end if;

  insert into public.estimate_lines (
    estimate_id, sort, source, description_customer, amount_cents,
    internal_cost_cents, internal_profit_cents, added_by
  )
  values (
    v_est.id,
    coalesce((select max(sort) from public.estimate_lines where estimate_lines.estimate_id = v_est.id), 0) + 1,
    'adjustment',
    v_text,
    add_estimate_line.amount_cents,
    0,
    add_estimate_line.amount_cents,
    public.current_profile_id()
  )
  returning id into v_id;

  perform internal.recompute_estimate(v_est.id);
  return v_id;
end;
$$;

create or replace function public.remove_estimate_line(line_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line public.estimate_lines;
begin
  select * into v_line from public.estimate_lines l where l.id = remove_estimate_line.line_id;
  if v_line.id is null then
    return;
  end if;
  perform internal.owner_estimate_draft(v_line.estimate_id);
  if (select count(*) from public.estimate_lines where estimate_id = v_line.estimate_id) <= 1 then
    raise exception 'An estimate needs at least one line.' using errcode = '22023';
  end if;
  delete from public.estimate_lines where id = v_line.id;
  perform internal.recompute_estimate(v_line.estimate_id);
end;
$$;

-- The reason the property reads, and the equipment size.
create or replace function public.update_estimate_details(
  estimate_id uuid,
  narrative text,
  equipment_size text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_est public.estimates;
  v_text text := nullif(trim(coalesce(narrative, '')), '');
begin
  v_est := internal.owner_estimate_draft(update_estimate_details.estimate_id);
  if v_text is null then
    raise exception 'Write why this needs an estimate.' using errcode = '22023';
  end if;
  update public.estimates
  set narrative = v_text,
      equipment_size_text = nullif(trim(coalesce(update_estimate_details.equipment_size, '')), '')
  where id = v_est.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Send: number it, address it, mark it sent, move the job to Out to property.
-- ---------------------------------------------------------------------------

create or replace function public.send_estimate(estimate_id uuid, seen_at timestamptz default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_est public.estimates;
  v_number integer;
  v_email text;
  v_board public.board_status;
begin
  v_est := internal.owner_estimate_draft(send_estimate.estimate_id);

  if seen_at is not null and v_est.updated_at > seen_at + interval '1 second' then
    raise exception 'This estimate changed since you opened it. Look it over again.' using errcode = '40001';
  end if;
  if not exists (select 1 from public.estimate_lines l where l.estimate_id = v_est.id) then
    raise exception 'An estimate needs at least one line.' using errcode = '22023';
  end if;
  if v_est.total_cents <= 0 then
    raise exception 'The total has to be more than zero.' using errcode = '22023';
  end if;

  update public.app_config
  set next_estimate_number = next_estimate_number + 1
  where id = 1
  returning next_estimate_number - 1 into v_number;

  -- The person who called it in, else the customer's billing email.
  select coalesce(
    nullif(trim(ct.email), ''),
    nullif(trim(c.billing_email_override), ''),
    nullif(trim(bc.email), '')
  )
  into v_email
  from public.service_requests r
  join public.customers c on c.id = r.customer_id
  left join public.customer_contacts ct on ct.id = coalesce(v_est.bill_to_contact_id, r.contact_id)
  left join public.customer_contacts bc on bc.id = c.billing_contact_id
  where r.id = v_est.request_id;

  update public.estimates
  set
    status = 'sent',
    number = 'E' || v_number::text,
    sent_at = now(),
    finalized_by = public.current_profile_id(),
    bill_to_email_snap = coalesce(v_email, 'unset'),
    public_token = coalesce(public_token, gen_random_uuid()::text)
  where id = v_est.id;

  select board_status into v_board from public.service_requests where id = v_est.request_id;
  if v_board = 'to_estimate' then
    perform internal.move_board_status(v_est.request_id, 'estimate_out', 'system', null, null, false);
  end if;

  return jsonb_build_object(
    'id', v_est.id,
    'number', 'E' || v_number::text,
    'email', v_email,
    'token', (select public_token from public.estimates where id = v_est.id)
  );
end;
$$;

create or replace function public.record_estimate_email(
  estimate_id uuid,
  to_address text,
  status public.outbound_status,
  provider_id text default null,
  body text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_request uuid;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can send an estimate.' using errcode = '42501';
  end if;
  select request_id into v_request from public.estimates e where e.id = record_estimate_email.estimate_id;
  insert into public.outbound_messages (request_id, channel, to_address, template, body, status, provider_id, sent_at)
  values (
    v_request, 'email', coalesce(nullif(trim(to_address), ''), 'unset'), 'estimate',
    coalesce(body, 'Estimate email'), record_estimate_email.status, provider_id,
    case when record_estimate_email.status = 'sent' then now() else null end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The property's answer.
-- ---------------------------------------------------------------------------

-- Approved: Parts first if a repair needs one, else Ready.
create or replace function internal.accept_estimate(p_estimate_id uuid, p_via text, p_name text, p_note text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_est public.estimates;
  v_part record;
  v_actor uuid;
  v_board public.board_status;
begin
  select * into v_est from public.estimates where id = p_estimate_id for update;
  if v_est.status not in ('sent', 'viewed') then
    raise exception 'That estimate isn''t waiting on an answer.' using errcode = '42501';
  end if;

  update public.estimates
  set status = 'accepted', accepted_at = now(), responded_via = p_via,
      response_name = nullif(trim(coalesce(p_name, '')), ''),
      response_note = nullif(trim(coalesce(p_note, '')), '')
  where id = v_est.id;

  select board_status into v_board from public.service_requests where id = v_est.request_id for update;
  if v_board not in ('to_estimate', 'estimate_out') then
    return v_board::text;
  end if;

  -- The first approved repair that needs a part.
  select s.visit_id, s.title_snap
  into v_part
  from public.estimate_lines l
  join public.visit_bundle_selections s on s.id = l.visit_selection_id
  join public.bundles b on b.id = s.bundle_id
  where l.estimate_id = v_est.id and b.one_shot
  order by l.sort
  limit 1;

  if v_part.visit_id is not null then
    v_actor := coalesce(public.current_profile_id(), v_est.finalized_by, v_est.created_by);
    perform internal.upsert_parts_order(v_est.request_id, v_part.visit_id, v_actor, v_part.title_snap, null, null, null, null);
    perform internal.move_board_status(v_est.request_id, 'parts', 'system', null, null, false);
    return 'parts';
  end if;

  perform internal.move_board_status(v_est.request_id, 'ready', 'system', null, null, true);
  return 'ready';
end;
$$;

create or replace function internal.decline_estimate(p_estimate_id uuid, p_via text, p_name text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_est public.estimates;
begin
  select * into v_est from public.estimates where id = p_estimate_id for update;
  if v_est.status not in ('sent', 'viewed') then
    raise exception 'That estimate isn''t waiting on an answer.' using errcode = '42501';
  end if;
  update public.estimates
  set status = 'declined', declined_at = now(), responded_via = p_via,
      response_name = nullif(trim(coalesce(p_name, '')), ''),
      response_note = nullif(trim(coalesce(p_note, '')), '')
  where id = v_est.id;
end;
$$;

-- What the property's link shows. The property opening it marks it viewed
-- (not an owner checking what they see).
create or replace function public.estimate_by_token(token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_est public.estimates;
begin
  if token is null or length(token) < 20 then
    return null;
  end if;
  select * into v_est from public.estimates e where e.public_token = estimate_by_token.token;
  if v_est.id is null or v_est.status in ('draft', 'in_review') then
    return null;
  end if;
  if v_est.status = 'sent' and not coalesce(public.is_active_member(), false) then
    update public.estimates set status = 'viewed', viewed_at = now() where id = v_est.id;
    v_est.status := 'viewed';
  end if;
  return jsonb_build_object(
    'number', v_est.number,
    'status', v_est.status,
    'property', v_est.property_snap,
    'unit', v_est.unit_snap,
    'narrative', v_est.narrative,
    'equipment_size', v_est.equipment_size_text,
    'sent_at', v_est.sent_at,
    'accepted_at', v_est.accepted_at,
    'declined_at', v_est.declined_at,
    'response_name', v_est.response_name,
    'subtotal_cents', v_est.subtotal_cents,
    'tax_rate_bps', v_est.tax_rate_bps_snap,
    'tax_cents', v_est.tax_cents,
    'total_cents', v_est.total_cents,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('description', l.description_customer, 'amount_cents', l.amount_cents) order by l.sort)
      from public.estimate_lines l where l.estimate_id = v_est.id
    ), '[]'::jsonb)
  );
end;
$$;

-- The property answers on the link. A name is required to approve.
create or replace function public.respond_to_estimate(token text, approve boolean, name text default null, note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_est public.estimates;
begin
  select * into v_est from public.estimates e where e.public_token = respond_to_estimate.token;
  if v_est.id is null or token is null or length(token) < 20 then
    raise exception 'That estimate link isn''t valid.' using errcode = '42501';
  end if;
  if v_est.status in ('accepted', 'declined') then
    return jsonb_build_object('status', v_est.status, 'already', true);
  end if;
  if v_est.status not in ('sent', 'viewed') then
    raise exception 'That estimate isn''t open for an answer. Call us at the office.' using errcode = '42501';
  end if;
  if approve and nullif(trim(coalesce(name, '')), '') is null then
    raise exception 'Type your name to approve.' using errcode = '22023';
  end if;
  if approve then
    perform internal.accept_estimate(v_est.id, 'link', name, note);
    return jsonb_build_object('status', 'accepted');
  end if;
  perform internal.decline_estimate(v_est.id, 'link', name, note);
  return jsonb_build_object('status', 'declined');
end;
$$;

-- An owner records the answer they got by phone or text.
create or replace function public.record_estimate_response(estimate_id uuid, approve boolean, note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_where text;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can record the property''s answer.' using errcode = '42501';
  end if;
  if approve then
    v_where := internal.accept_estimate(estimate_id, 'owner', null, note);
    return jsonb_build_object('status', 'accepted', 'board', v_where);
  end if;
  perform internal.decline_estimate(estimate_id, 'owner', null, note);
  return jsonb_build_object('status', 'declined');
end;
$$;

-- Declined: bill the diagnostic (a draft invoice for review) or close with no charge.
create or replace function public.settle_declined_estimate(estimate_id uuid, bill boolean)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_est public.estimates;
  v_req public.service_requests;
  v_bundle public.bundles;
  v_invoice uuid;
  v_line uuid;
  v_email text;
  v_property text;
  v_unit text;
  v_terms integer;
  v_bps integer;
  v_rate integer;
  v_sort integer := 0;
  v_sum integer := 0;
  v_item record;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can do that.' using errcode = '42501';
  end if;
  select * into v_est from public.estimates e where e.id = settle_declined_estimate.estimate_id for update;
  if v_est.id is null or v_est.status <> 'declined' then
    raise exception 'That estimate wasn''t declined.' using errcode = '42501';
  end if;
  if v_est.decline_settled_at is not null then
    raise exception 'That was already handled.' using errcode = '42501';
  end if;
  select * into v_req from public.service_requests r where r.id = v_est.request_id for update;

  if not bill then
    if v_req.board_status in ('to_estimate', 'estimate_out') then
      perform internal.move_board_status(v_req.id, 'closed', 'manual', null, null, false);
    end if;
    update public.estimates set decline_settled_at = now(), decline_outcome = 'no_charge' where id = v_est.id;
    return jsonb_build_object('outcome', 'no_charge');
  end if;

  if exists (select 1 from public.invoice_records i where i.request_id = v_req.id) then
    raise exception 'This job already has an invoice.' using errcode = '42501';
  end if;
  select * into v_bundle from public.bundles b where b.code = 'SYS - MIN - None' and b.status = 'active';
  if v_bundle.id is null then
    raise exception 'The diagnostic charge (SYS - MIN - None) isn''t in the price book.' using errcode = '22023';
  end if;

  if v_req.board_status in ('to_estimate', 'estimate_out') then
    perform internal.move_board_status(v_req.id, 'complete', 'manual', null, null, false);
  end if;

  select
    coalesce(nullif(trim(ct.email), ''), 'unset'), p.name, u.unit_label, pc.payment_terms_days, p.tax_rate_bps
  into v_email, v_property, v_unit, v_terms, v_bps
  from public.service_requests r
  join public.customer_contacts ct on ct.id = r.contact_id
  join public.properties p on p.id = r.property_id
  join public.units u on u.id = r.unit_id
  join public.property_contract pc on pc.property_id = p.id
  where r.id = v_req.id;

  insert into public.invoice_records (
    request_id, kind, status, bill_to_customer_id, bill_to_contact_id, bill_to_email_snap,
    property_snap, unit_snap, subtotal_cents, tax_rate_bps_snap, tax_cents, total_cents, terms_days_snap
  )
  values (
    v_req.id, 'bundle', 'draft', v_req.customer_id, v_req.contact_id, v_email,
    v_property, v_unit, 0, v_bps, 0, 0, v_terms
  )
  returning id into v_invoice;

  insert into public.invoice_lines (
    invoice_id, sort, source, description_customer, amount_cents,
    internal_cost_cents, internal_profit_cents, added_by
  )
  values (
    v_invoice, 1, 'bundle', coalesce(nullif(trim(v_bundle.narrative), ''), v_bundle.title),
    v_bundle.target_price_cents, 0, v_bundle.target_price_cents, public.current_profile_id()
  )
  returning id into v_line;

  -- Its cost lines from the price book: labor, then the rest, then profit.
  select labor_rate_cents into v_rate from public.app_config where id = 1;
  if coalesce(v_bundle.labor_hours, 0) > 0 then
    v_sort := 1;
    v_sum := round(v_bundle.labor_hours * v_rate)::integer;
    insert into public.invoice_cost_lines (invoice_id, invoice_line_id, sort, kind, label, amount_cents)
    values (v_invoice, v_line, 1, 'labor', 'Labor ' || trim_scale(v_bundle.labor_hours) || ' hr', v_sum);
  end if;
  for v_item in
    select bl.kind::text as kind, bl.description, round(bl.qty * bl.unit_cost_cents)::integer as amount
    from public.bundle_lines bl
    where bl.bundle_id = v_bundle.id
      and bl.kind::text in ('part', 'equipment', 'material', 'consumable', 'refrigerant')
  loop
    v_sort := v_sort + 1;
    insert into public.invoice_cost_lines (invoice_id, invoice_line_id, sort, kind, label, amount_cents)
    values (v_invoice, v_line, v_sort, v_item.kind::public.cost_line_kind,
      coalesce(nullif(trim(v_item.description), ''), initcap(v_item.kind)), v_item.amount);
    v_sum := v_sum + v_item.amount;
  end loop;
  insert into public.invoice_cost_lines (invoice_id, invoice_line_id, sort, kind, label, amount_cents)
  values (v_invoice, v_line, v_sort + 1, 'profit', 'Profit', v_bundle.target_price_cents - v_sum);

  perform internal.recompute_invoice(v_invoice);
  update public.estimates set decline_settled_at = now(), decline_outcome = 'billed' where id = v_est.id;
  return jsonb_build_object('outcome', 'billed', 'invoice_id', v_invoice);
end;
$$;

-- ---------------------------------------------------------------------------
-- A tech asks an owner to order the part.
-- ---------------------------------------------------------------------------

create or replace function public.ask_owner_for_part(parts_order_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.parts_orders;
begin
  v_order := internal.part_order_for_actor(parts_order_id);
  if v_order.status <> 'needed' then
    raise exception 'That part is already ordered.' using errcode = '42501';
  end if;
  update public.parts_orders
  set owner_help_at = now(), owner_help_by = public.current_profile_id(), last_updated_by = public.current_profile_id()
  where id = v_order.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- close_visit: the work visit after an approved estimate. Written lines on the
-- estimate come onto the invoice; a written-lines-only estimate closes without
-- picking a repair. Otherwise the same as 20261120130000_parts_return.sql.
-- ---------------------------------------------------------------------------

create or replace function public.close_visit(
  request_id uuid,
  outcome public.outcome_path,
  tech_note text,
  model_typed text default null,
  serial_typed text default null,
  equipment_size_text text default null,
  readings jsonb default null,
  signoff_name text default null,
  one_off_narrative text default null,
  materials_text text default null,
  part_description text default null,
  supplier_id uuid default null,
  supplier_contact_text text default null,
  order_number text default null,
  expected_delivery date default null,
  client_draft_id uuid default null,
  seen_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_req public.service_requests;
  v_visit public.service_visits;
  v_actor uuid;
  v_note text;
  v_model text;
  v_serial text;
  v_size text;
  v_sign_name text;
  v_narrative text;
  v_materials text;
  v_signoff public.signoff_requirement;
  v_photos integer;
  v_subtotal integer;
  v_tax integer;
  v_terms integer;
  v_bps integer;
  v_email text;
  v_property text;
  v_unit text;
  v_invoice uuid;
  v_estimate uuid;
  v_board public.board_status;
  v_sort integer;
  v_selection record;
  v_accepted uuid;
  v_last integer := 0;
begin
  if outcome is null or outcome not in ('easy', 'parts', 'estimate', 'one_off') then
    raise exception 'Pick Easy repair, Needs parts, Needs estimate, or One-off.'
      using errcode = '42501';
  end if;

  v_req := internal.lock_call(request_id);
  v_actor := public.current_profile_id();
  if v_req.assigned_user_id is distinct from v_actor then
    raise exception 'Only the assigned tech can do that on this call.'
      using errcode = '42501';
  end if;

  v_visit := internal.visit_for_call(request_id);
  if v_visit.id is null then
    raise exception 'Put tools on the equipment before closing.'
      using errcode = '42501';
  end if;

  if internal.board_overridden(request_id, seen_at) then
    perform internal.flag_offline_conflict(v_visit.id);
    return internal.conflict_result(request_id);
  end if;

  if v_visit.status = 'closed' then
    select id into v_invoice from public.invoice_records where invoice_records.request_id = close_visit.request_id;
    select id into v_estimate
    from public.estimates
    where estimates.request_id = close_visit.request_id
      and status <> 'void'
    limit 1;
    return internal.visit_result(request_id, 'That visit is already closed.') || jsonb_build_object(
      'invoice_id', v_invoice,
      'estimate_id', v_estimate
    );
  end if;

  select e.id into v_accepted
  from public.estimates e
  where e.request_id = close_visit.request_id and e.status = 'accepted'
  order by e.accepted_at desc
  limit 1;

  if v_visit.status <> 'working' then
    raise exception 'Put tools on the equipment before closing.'
      using errcode = '42501';
  end if;

  -- A parts order can move the card to Parts before close. Anything else has to
  -- still be In Progress. An owner pull-off is not a visit close.
  if outcome = 'parts' and v_req.board_status not in ('in_progress', 'parts') then
    raise exception 'This call is no longer in progress. Check the board.'
      using errcode = '42501';
  elsif outcome <> 'parts' and v_req.board_status <> 'in_progress' then
    raise exception 'This call is no longer in progress. Check the board.'
      using errcode = '42501';
  end if;

  v_note := nullif(trim(coalesce(tech_note, '')), '');
  -- Fall back to what's already on the visit (a return visit carries them over).
  v_model := coalesce(nullif(trim(coalesce(model_typed, '')), ''), nullif(trim(coalesce(v_visit.model_typed, '')), ''));
  v_serial := coalesce(nullif(trim(coalesce(serial_typed, '')), ''), nullif(trim(coalesce(v_visit.serial_typed, '')), ''));
  v_size := nullif(trim(coalesce(equipment_size_text, '')), '');
  v_sign_name := nullif(trim(coalesce(signoff_name, '')), '');
  v_narrative := nullif(trim(coalesce(one_off_narrative, '')), '');
  v_materials := nullif(trim(coalesce(materials_text, '')), '');

  if v_note is null and outcome not in ('easy', 'parts') then
    raise exception 'Write a note before closing.'
      using errcode = '42501';
  end if;

  -- An approved estimate made only of written lines has no repair to pick.
  if outcome in ('easy', 'parts') and not exists (
    select 1 from public.visit_bundle_selections s where s.visit_id = v_visit.id
  ) and not (outcome = 'easy' and v_accepted is not null and exists (
    select 1 from public.estimate_lines l where l.estimate_id = v_accepted
  )) then
    raise exception 'Pick a repair before closing.'
      using errcode = '42501';
  end if;

  if outcome = 'estimate' and v_narrative is null and not exists (
    select 1 from public.visit_bundle_selections s where s.visit_id = v_visit.id
  ) then
    -- The note is the narrative when they did not type a separate one.
    v_narrative := v_note;
  end if;

  if outcome = 'one_off' then
    v_narrative := coalesce(v_narrative, v_note);
  end if;

  -- A part repair closes as a normal repair once its part is in hand (the return visit).
  if outcome = 'easy' and exists (
    select 1
    from public.visit_bundle_selections s
    join public.bundles b on b.id = s.bundle_id
    where s.visit_id = v_visit.id
      and b.one_shot
      and not exists (
        select 1
        from public.parts_orders po
        join public.visit_bundle_selections ps on ps.id = po.visit_selection_id
        where po.request_id = close_visit.request_id
          and po.status = 'in_hand'
          and ps.bundle_id = s.bundle_id
      )
  ) then
    raise exception 'That repair needs a part. Choose Needs parts.'
      using errcode = '42501';
  end if;

  if outcome = 'parts' and (v_model is null or v_serial is null) then
    raise exception 'Type the model and serial before leaving. A photo of the nameplate is not enough.'
      using errcode = '42501';
  end if;

  if v_model is null or v_serial is null then
    if exists (
      select 1
      from public.visit_bundle_selections s
      join public.bundles b on b.id = s.bundle_id
      where s.visit_id = v_visit.id
        and b.requires_model_serial
    ) then
      raise exception 'This repair needs the model and serial typed in.'
        using errcode = '42501';
    end if;
  end if;

  if outcome = 'parts' and nullif(trim(coalesce(part_description, '')), '') is null then
    raise exception 'Say what part you need.'
      using errcode = '42501';
  end if;

  select pc.signoff_requirement
  into v_signoff
  from public.property_contract pc
  where pc.property_id = v_req.property_id;

  if v_signoff = 'walkthrough_signature' and (
    v_sign_name is null or v_visit.signoff_signature_attachment_id is null
  ) then
    raise exception 'This property needs a name and a signature.'
      using errcode = '42501';
  end if;

  if v_signoff = 'photos' then
    select count(*)
    into v_photos
    from public.attachments a
    where a.owner_type = 'visit'
      and a.owner_id = v_visit.id
      and a.kind = 'photo';
    if v_photos < 1 then
      raise exception 'This property needs a photo before closing.'
        using errcode = '42501';
    end if;
  end if;

  if outcome = 'parts' then
    -- The typed model has to be on the visit before the order is saved.
    update public.service_visits
    set model_typed = v_model, serial_typed = v_serial
    where id = v_visit.id;

    perform internal.upsert_parts_order(
      request_id,
      v_visit.id,
      v_actor,
      part_description,
      supplier_id,
      supplier_contact_text,
      order_number,
      expected_delivery
    );
  end if;

  select r.board_status
  into v_board
  from public.service_requests r
  where r.id = close_visit.request_id;

  if outcome = 'parts' and v_board = 'in_progress' then
    perform set_config('app.auto_rule', 'A4', true);
    perform internal.move_board_status(
      request_id, 'parts', 'parts_order_entered', null, null, false
    );
    perform set_config('app.auto_rule', '', true);
  elsif outcome = 'estimate' and v_board = 'in_progress' then
    if not exists (
      select 1 from public.estimates e
      where e.request_id = close_visit.request_id
        and e.status <> 'void'
    ) then
      select
        coalesce(nullif(trim(ct.email), ''), 'unset'),
        p.name,
        u.unit_label,
        pc.payment_terms_days,
        p.tax_rate_bps
      into v_email, v_property, v_unit, v_terms, v_bps
      from public.service_requests r
      join public.customer_contacts ct on ct.id = r.contact_id
      join public.properties p on p.id = r.property_id
      join public.units u on u.id = r.unit_id
      join public.property_contract pc on pc.property_id = p.id
      where r.id = close_visit.request_id;

      select coalesce(sum(s.price_cents_snap * s.qty), 0)
      into v_subtotal
      from public.visit_bundle_selections s
      where s.visit_id = v_visit.id;

      v_tax := ((v_subtotal * v_bps) + 5000) / 10000;

      insert into public.estimates (
        request_id,
        status,
        created_by,
        narrative,
        equipment_size_text,
        bill_to_contact_id,
        bill_to_email_snap,
        property_snap,
        unit_snap,
        subtotal_cents,
        tax_rate_bps_snap,
        tax_cents,
        total_cents,
        public_token
      )
      values (
        request_id,
        'draft',
        v_actor,
        coalesce(v_narrative, v_note),
        v_size,
        v_req.contact_id,
        v_email,
        v_property,
        v_unit,
        v_subtotal,
        v_bps,
        v_tax,
        v_subtotal + v_tax,
        gen_random_uuid()::text
      )
      returning id into v_estimate;

      v_sort := 0;
      for v_selection in
        select s.id, s.narrative_snap, s.price_cents_snap, s.qty, s.profit_cents_snap
        from public.visit_bundle_selections s
        where s.visit_id = v_visit.id
        order by s.created_at
      loop
        v_sort := v_sort + 1;
        insert into public.estimate_lines (
          estimate_id,
          sort,
          source,
          visit_selection_id,
          description_customer,
          amount_cents,
          internal_cost_cents,
          internal_profit_cents,
          added_by
        )
        values (
          v_estimate,
          v_sort,
          'bundle',
          v_selection.id,
          v_selection.narrative_snap,
          v_selection.price_cents_snap * v_selection.qty,
          (v_selection.price_cents_snap - v_selection.profit_cents_snap) * v_selection.qty,
          v_selection.profit_cents_snap * v_selection.qty,
          v_actor
        );
      end loop;
    end if;

    perform set_config('app.auto_rule', 'VISIT_ESTIMATE', true);
    perform internal.move_board_status(
      request_id, 'to_estimate', 'system', null, null, false
    );
    perform set_config('app.auto_rule', '', true);
  elsif outcome in ('easy', 'one_off') and v_req.billable and v_board = 'in_progress' then
    if not exists (
      select 1 from public.invoice_records i where i.request_id = close_visit.request_id
    ) then
      select
        coalesce(nullif(trim(ct.email), ''), 'unset'),
        p.name,
        u.unit_label,
        pc.payment_terms_days,
        p.tax_rate_bps
      into v_email, v_property, v_unit, v_terms, v_bps
      from public.service_requests r
      join public.customer_contacts ct on ct.id = r.contact_id
      join public.properties p on p.id = r.property_id
      join public.units u on u.id = r.unit_id
      join public.property_contract pc on pc.property_id = p.id
      where r.id = close_visit.request_id;

      select coalesce(sum(s.price_cents_snap * s.qty), 0)
      into v_subtotal
      from public.visit_bundle_selections s
      where s.visit_id = v_visit.id;

      -- Written lines on an approved estimate (a discount, extra work) come along.
      if outcome = 'easy' and v_accepted is not null then
        v_subtotal := v_subtotal + coalesce((
          select sum(l.amount_cents) from public.estimate_lines l
          where l.estimate_id = v_accepted and l.visit_selection_id is null
        ), 0);
      end if;

      if outcome = 'one_off' and v_subtotal = 0 then
        v_subtotal := 0;
      end if;

      v_tax := ((v_subtotal * v_bps) + 5000) / 10000;

      insert into public.invoice_records (
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
        terms_days_snap,
        tech_one_off_narrative,
        materials_text
      )
      values (
        request_id,
        case when outcome = 'one_off' then 'one_off'::public.invoice_kind else 'bundle'::public.invoice_kind end,
        'draft',
        v_req.customer_id,
        v_req.contact_id,
        v_email,
        v_property,
        v_unit,
        v_subtotal,
        v_bps,
        v_tax,
        v_subtotal + v_tax,
        v_terms,
        case when outcome = 'one_off' then v_narrative else null end,
        v_materials
      )
      returning id into v_invoice;

      -- Written lines from an approved estimate go in first (sorted after the
      -- repairs) so a receipt-cost recalculation on a repair counts them.
      if outcome = 'easy' and v_accepted is not null then
        select count(*) into v_last from public.visit_bundle_selections s where s.visit_id = v_visit.id;
        for v_selection in
          select l.description_customer, l.amount_cents, l.internal_cost_cents, l.internal_profit_cents
          from public.estimate_lines l
          where l.estimate_id = v_accepted and l.visit_selection_id is null
          order by l.sort
        loop
          v_last := v_last + 1;
          insert into public.invoice_lines (
            invoice_id, sort, source, description_customer, amount_cents,
            internal_cost_cents, internal_profit_cents, added_by
          )
          values (
            v_invoice, v_last, 'adjustment', v_selection.description_customer, v_selection.amount_cents,
            coalesce(v_selection.internal_cost_cents, 0),
            coalesce(v_selection.internal_profit_cents, v_selection.amount_cents),
            v_actor
          );
        end loop;
      end if;

      v_sort := 0;
      for v_selection in
        select s.id, s.narrative_snap, s.price_cents_snap, s.qty, s.profit_cents_snap
        from public.visit_bundle_selections s
        where s.visit_id = v_visit.id
        order by s.created_at
      loop
        v_sort := v_sort + 1;
        insert into public.invoice_lines (
          invoice_id,
          sort,
          source,
          visit_selection_id,
          description_customer,
          amount_cents,
          internal_cost_cents,
          internal_profit_cents,
          added_by
        )
        values (
          v_invoice,
          v_sort,
          case when outcome = 'one_off' then 'one_off'::public.invoice_line_source else 'bundle'::public.invoice_line_source end,
          v_selection.id,
          v_selection.narrative_snap,
          v_selection.price_cents_snap * v_selection.qty,
          (v_selection.price_cents_snap - v_selection.profit_cents_snap) * v_selection.qty,
          v_selection.profit_cents_snap * v_selection.qty,
          v_actor
        );
      end loop;

      v_sort := greatest(v_sort, v_last);
      if v_sort = 0 then
        insert into public.invoice_lines (
          invoice_id,
          sort,
          source,
          description_customer,
          amount_cents,
          internal_cost_cents,
          internal_profit_cents,
          added_by
        )
        values (
          v_invoice,
          1,
          'one_off',
          v_narrative,
          0,
          0,
          0,
          v_actor
        );
      end if;
    end if;
  elsif outcome in ('easy', 'one_off') and not v_req.billable and v_board = 'in_progress' then
    perform set_config('app.auto_rule', 'VISIT_NONBILLABLE', true);
    perform internal.move_board_status(
      request_id, 'complete', 'system', null, null, false
    );
    perform set_config('app.auto_rule', '', true);
  end if;

  perform set_config('app.visit_step', 'closed', true);
  update public.service_visits
  set
    status = 'closed',
    outcome_path = close_visit.outcome,
    tech_note = v_note,
    model_typed = coalesce(v_model, service_visits.model_typed),
    serial_typed = coalesce(v_serial, service_visits.serial_typed),
    equipment_size_text = coalesce(v_size, service_visits.equipment_size_text),
    readings = coalesce(close_visit.readings, service_visits.readings),
    signoff_name = coalesce(v_sign_name, service_visits.signoff_name),
    client_draft_id = coalesce(close_visit.client_draft_id, service_visits.client_draft_id),
    closed_at = coalesce(service_visits.closed_at, now()),
    sync_state = 'synced'
  where id = v_visit.id;
  perform set_config('app.visit_step', '', true);

  perform internal.end_clock(v_visit.id, null, 'close');

  select id into v_invoice from public.invoice_records where invoice_records.request_id = close_visit.request_id;
  select id into v_estimate
  from public.estimates
  where estimates.request_id = close_visit.request_id
    and status <> 'void'
  limit 1;

  return internal.visit_result(request_id, 'Visit closed.') || jsonb_build_object(
    'invoice_id', v_invoice,
    'estimate_id', v_estimate
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The return visit after an approved estimate carries its repairs at the
-- approved prices. Otherwise the same as 20261120130000_parts_return.sql.
-- ---------------------------------------------------------------------------

create or replace function internal.carry_repairs_to_return()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev public.service_visits;
  v_est public.estimates;
begin
  if new.visit_type <> 'return' then
    return new;
  end if;
  if exists (select 1 from public.visit_bundle_selections where visit_id = new.id) then
    return new;
  end if;

  -- An approved estimate: its repairs at the approved prices and wording.
  select * into v_est
  from public.estimates
  where request_id = new.request_id and status = 'accepted'
  order by accepted_at desc
  limit 1;
  if v_est.id is not null and not exists (
    select 1 from public.invoice_records i where i.request_id = new.request_id
  ) then
    insert into public.visit_bundle_selections (
      visit_id, bundle_id, code_snap, title_snap, narrative_snap, price_cents_snap,
      labor_hours_snap, labor_rate_cents_snap, cost_lines_snap, profit_cents_snap, qty, selected_by,
      estimate_line_id
    )
    select
      new.id, s.bundle_id, s.code_snap, s.title_snap, l.description_customer, l.amount_cents,
      s.labor_hours_snap, s.labor_rate_cents_snap,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', c.kind, 'description', c.label, 'label', c.label, 'qty', 1, 'unit_cost_cents', c.amount_cents
        ) order by c.sort)
        from public.estimate_cost_lines c
        where c.estimate_line_id = l.id and not c.removed and c.kind <> 'profit'
      ), '[]'::jsonb),
      l.amount_cents - coalesce((
        select sum(c.amount_cents) from public.estimate_cost_lines c
        where c.estimate_line_id = l.id and not c.removed and c.kind <> 'profit'
      ), 0)::integer,
      1, s.selected_by, l.id
    from public.estimate_lines l
    join public.visit_bundle_selections s on s.id = l.visit_selection_id
    where l.estimate_id = v_est.id
    order by l.sort;

    select * into v_prev
    from public.service_visits
    where request_id = new.request_id and visit_seq < new.visit_seq and status = 'closed'
    order by visit_seq desc
    limit 1;
    if v_prev.id is not null then
      update public.service_visits
      set model_typed = coalesce(model_typed, v_prev.model_typed),
          serial_typed = coalesce(serial_typed, v_prev.serial_typed)
      where id = new.id;
    end if;
    return new;
  end if;
  select * into v_prev
  from public.service_visits
  where request_id = new.request_id
    and visit_seq < new.visit_seq
    and status = 'closed'
    and outcome_path = 'parts'
  order by visit_seq desc
  limit 1;
  if v_prev.id is null then
    return new;
  end if;
  if exists (select 1 from public.visit_bundle_selections where visit_id = new.id) then
    return new;
  end if;
  -- Not if a later visit already closed the job out.
  if exists (
    select 1 from public.service_visits v
    where v.request_id = new.request_id and v.visit_seq > v_prev.visit_seq and v.visit_seq < new.visit_seq
      and v.status = 'closed' and v.outcome_path in ('easy', 'one_off')
  ) then
    return new;
  end if;

  insert into public.visit_bundle_selections (
    visit_id, bundle_id, code_snap, title_snap, narrative_snap, price_cents_snap,
    labor_hours_snap, labor_rate_cents_snap, cost_lines_snap, profit_cents_snap, qty, selected_by
  )
  select
    new.id, s.bundle_id, s.code_snap, s.title_snap, s.narrative_snap, s.price_cents_snap,
    s.labor_hours_snap, s.labor_rate_cents_snap, s.cost_lines_snap, s.profit_cents_snap, s.qty, s.selected_by
  from public.visit_bundle_selections s
  where s.visit_id = v_prev.id
  order by s.created_at;

  update public.service_visits
  set model_typed = coalesce(model_typed, v_prev.model_typed),
      serial_typed = coalesce(serial_typed, v_prev.serial_typed)
  where id = new.id;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cost lines keep an approved estimate's wording and price. Otherwise the same
-- as 20261120130000_parts_return.sql.
-- ---------------------------------------------------------------------------

create or replace function internal.build_invoice_cost_lines(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.invoice_lines;
  v_sel public.visit_bundle_selections;
  v_sort integer := 0;
  v_sum integer := 0;
  v_amount integer;
  v_qty numeric;
  v_label text;
  v_item record;
  v_actual integer;
  v_variable boolean;
  v_part_sort integer;
  v_part_amount integer;
  v_delta integer;
begin
  select * into v_line from public.invoice_lines where id = p_line_id;
  if v_line.id is null or v_line.visit_selection_id is null then
    return;
  end if;
  if exists (select 1 from public.invoice_cost_lines where invoice_line_id = p_line_id) then
    return;
  end if;

  select * into v_sel from public.visit_bundle_selections where id = v_line.visit_selection_id;
  if v_sel.id is null then
    return;
  end if;

  -- A variable-cost repair whose part is in hand uses the actual cost from the receipt.
  select b.pricing_kind = 'variable' into v_variable from public.bundles b where b.id = v_sel.bundle_id;
  if coalesce(v_variable, false) then
    select po.actual_cost_cents
    into v_actual
    from public.parts_orders po
    join public.visit_bundle_selections ps on ps.id = po.visit_selection_id
    join public.invoice_records i on i.id = v_line.invoice_id
    where po.request_id = i.request_id
      and po.status = 'in_hand'
      and po.actual_cost_cents is not null
      and ps.bundle_id = v_sel.bundle_id
    order by po.in_hand_at desc
    limit 1;
  end if;

  -- Labor first, then the rest in price-book order.
  for v_item in
    select e.value as item, e.ordinality as n
    from jsonb_array_elements(coalesce(v_sel.cost_lines_snap, '[]'::jsonb)) with ordinality as e
    order by (e.value ->> 'kind') <> 'labor', e.ordinality
  loop
    v_qty := coalesce((v_item.item ->> 'qty')::numeric, 1);
    v_amount := round(v_qty * coalesce((v_item.item ->> 'unit_cost_cents')::numeric, 0))::integer * v_sel.qty;
    if nullif(trim(coalesce(v_item.item ->> 'label', '')), '') is not null then
      -- Carried from an approved estimate: keep the owner's wording.
      v_label := trim(v_item.item ->> 'label');
    elsif (v_item.item ->> 'kind') = 'labor' then
      v_label := 'Labor ' || trim_scale(v_qty * v_sel.qty) || ' hr';
    else
      v_label := coalesce(nullif(trim(v_item.item ->> 'description'), ''), initcap(v_item.item ->> 'kind'));
      if v_qty * v_sel.qty <> 1 then
        v_label := v_label || ' × ' || trim_scale(v_qty * v_sel.qty);
      end if;
    end if;
    if (v_item.item ->> 'kind') not in ('labor', 'part', 'equipment', 'material', 'consumable', 'refrigerant') then
      continue;
    end if;
    v_sort := v_sort + 1;
    insert into public.invoice_cost_lines (invoice_id, invoice_line_id, sort, kind, label, amount_cents)
    values (v_line.invoice_id, v_line.id, v_sort, (v_item.item ->> 'kind')::public.cost_line_kind, v_label, v_amount);
    v_sum := v_sum + v_amount;
    if v_part_sort is null and (v_item.item ->> 'kind') in ('part', 'equipment') then
      v_part_sort := v_sort;
      v_part_amount := v_amount;
    end if;
  end loop;

  -- Profit is whatever is left of the price-book price, so it doesn't move with the part cost.
  insert into public.invoice_cost_lines (invoice_id, invoice_line_id, sort, kind, label, amount_cents)
  values (v_line.invoice_id, v_line.id, v_sort + 1, 'profit', 'Profit', v_line.amount_cents - v_sum);

  -- Price moves with the real part cost, dollar for dollar (Matt, Nov 19).
  if v_actual is not null then
    if v_part_sort is not null then
      update public.invoice_cost_lines
      set amount_cents = v_actual, label = label || ' · receipt'
      where invoice_line_id = v_line.id and sort = v_part_sort;
      v_delta := v_actual - v_part_amount;
    else
      update public.invoice_cost_lines set sort = v_sort + 2 where invoice_line_id = v_line.id and kind = 'profit';
      insert into public.invoice_cost_lines (invoice_id, invoice_line_id, sort, kind, label, amount_cents)
      values (v_line.invoice_id, v_line.id, v_sort + 1, 'part', 'Parts · receipt', v_actual);
      v_delta := v_actual;
    end if;
    -- An approved estimate holds its price: profit takes the difference (Matt, Nov 20).
    if v_sel.estimate_line_id is not null then
      update public.invoice_cost_lines
      set amount_cents = amount_cents - v_delta
      where invoice_line_id = v_line.id and kind = 'profit';
    end if;
    perform internal.recompute_invoice(v_line.invoice_id);
  end if;
end;
$$;

-- Confirming the part cost holds an approved estimate's price.
-- Otherwise the same as 20261120130000_parts_return.sql.
create or replace function public.confirm_part_cost(line_id uuid, actual_cost_cents integer)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line public.invoice_lines;
  v_sort integer;
  v_profit_sort integer;
  v_hold boolean;
  v_old integer;
begin
  select * into v_line from public.invoice_lines l where l.id = confirm_part_cost.line_id;
  if v_line.id is null then
    raise exception 'That line is gone. Reload the invoice.' using errcode = '42501';
  end if;
  perform internal.owner_draft(v_line.invoice_id);
  if actual_cost_cents is null or actual_cost_cents < 0 then
    raise exception 'Enter the actual part cost.' using errcode = '22023';
  end if;

  select s.estimate_line_id is not null into v_hold
  from public.visit_bundle_selections s where s.id = v_line.visit_selection_id;

  select min(sort) into v_sort
  from public.invoice_cost_lines
  where invoice_line_id = v_line.id and kind in ('part', 'equipment');

  if v_sort is null then
    select sort into v_profit_sort from public.invoice_cost_lines where invoice_line_id = v_line.id and kind = 'profit';
    if v_profit_sort is null then
      raise exception 'This line has no cost lines to put a part on.' using errcode = '22023';
    end if;
    update public.invoice_cost_lines set sort = v_profit_sort + 1 where invoice_line_id = v_line.id and kind = 'profit';
    insert into public.invoice_cost_lines (invoice_id, invoice_line_id, sort, kind, label, amount_cents)
    values (v_line.invoice_id, v_line.id, v_profit_sort, 'part', 'Parts · confirmed', actual_cost_cents);
    v_old := 0;
  else
    select case when removed then 0 else amount_cents end into v_old
    from public.invoice_cost_lines where invoice_line_id = v_line.id and sort = v_sort;
    update public.invoice_cost_lines
    set amount_cents = actual_cost_cents, removed = false
    where invoice_line_id = v_line.id and sort = v_sort;
  end if;

  -- An approved estimate holds its price: profit takes the difference.
  if coalesce(v_hold, false) then
    update public.invoice_cost_lines
    set amount_cents = amount_cents - (actual_cost_cents - v_old)
    where invoice_line_id = v_line.id and kind = 'profit';
  end if;

  update public.invoice_lines
  set part_cost_confirmed_by = public.current_profile_id(), part_cost_confirmed_at = now()
  where id = v_line.id;

  perform internal.recompute_invoice(v_line.invoice_id);
end;
$$;

revoke all on function internal.build_estimate_cost_lines(uuid) from public, anon, authenticated;
revoke all on function internal.estimate_line_cost_lines() from public, anon, authenticated;
revoke all on function internal.accept_estimate(uuid, text, text, text) from public, anon, authenticated;
revoke all on function internal.decline_estimate(uuid, text, text, text) from public, anon, authenticated;
revoke all on function internal.owner_estimate_draft(uuid) from public, anon;
revoke all on function internal.recompute_estimate(uuid) from public, anon;
grant execute on function internal.owner_estimate_draft(uuid) to authenticated;
grant execute on function internal.recompute_estimate(uuid) to authenticated;

revoke all on function public.set_estimate_cost_line(uuid, boolean, integer) from public, anon;
revoke all on function public.update_estimate_line(uuid, text, integer) from public, anon;
revoke all on function public.add_estimate_line(uuid, text, integer) from public, anon;
revoke all on function public.remove_estimate_line(uuid) from public, anon;
revoke all on function public.update_estimate_details(uuid, text, text) from public, anon;
revoke all on function public.send_estimate(uuid, timestamptz) from public, anon;
revoke all on function public.record_estimate_email(uuid, text, public.outbound_status, text, text) from public, anon;
revoke all on function public.record_estimate_response(uuid, boolean, text) from public, anon;
revoke all on function public.settle_declined_estimate(uuid, boolean) from public, anon;
revoke all on function public.ask_owner_for_part(uuid) from public, anon;
grant execute on function public.set_estimate_cost_line(uuid, boolean, integer) to authenticated;
grant execute on function public.update_estimate_line(uuid, text, integer) to authenticated;
grant execute on function public.add_estimate_line(uuid, text, integer) to authenticated;
grant execute on function public.remove_estimate_line(uuid) to authenticated;
grant execute on function public.update_estimate_details(uuid, text, text) to authenticated;
grant execute on function public.send_estimate(uuid, timestamptz) to authenticated;
grant execute on function public.record_estimate_email(uuid, text, public.outbound_status, text, text) to authenticated;
grant execute on function public.record_estimate_response(uuid, boolean, text) to authenticated;
grant execute on function public.settle_declined_estimate(uuid, boolean) to authenticated;
grant execute on function public.ask_owner_for_part(uuid) to authenticated;

-- The property's link works without signing in.
revoke all on function public.estimate_by_token(text) from public;
revoke all on function public.respond_to_estimate(text, boolean, text, text) from public;
grant execute on function public.estimate_by_token(text) to anon, authenticated;
grant execute on function public.respond_to_estimate(text, boolean, text, text) to anon, authenticated;
