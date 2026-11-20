-- The part-and-return-trip path (Matt, Nov 19; walked through on the evap
-- coil test, LSP-11).
--
--   diagnosis visit closes to Parts with a part order
--   → order recorded (supplier, order #, part #, quoted cost, expected date)
--   → part in hand: actual cost + receipt photo (required for variable-cost
--     repairs, enforced here so no screen can skip it) → Ready
--   → the return visit carries the repair over; it closes as a normal repair
--   → one invoice. A variable-cost repair's part line uses the actual cost
--     and the price moves with it dollar for dollar; profit stays put
--   → the owner confirms the part cost at review; approve is blocked until
--     every variable-cost repair is confirmed.
--
-- Also: systems.manufactured_year for the age check (10+ years or R-22
-- suggests an estimate; the app decides that on screen).

alter table public.parts_orders
  add column visit_selection_id uuid references public.visit_bundle_selections (id),
  add column part_number text,
  add column quoted_cost_cents integer,
  add column actual_cost_cents integer,
  add column receipt_path text,
  add column cost_entered_by uuid references public.profiles (id),
  add column cost_entered_at timestamptz,
  add constraint parts_orders_quoted_nonnegative check (quoted_cost_cents is null or quoted_cost_cents >= 0),
  add constraint parts_orders_actual_nonnegative check (actual_cost_cents is null or actual_cost_cents >= 0);

alter table public.systems
  add column manufactured_year smallint,
  add constraint systems_manufactured_year_range check (manufactured_year is null or manufactured_year between 1970 and 2100);

alter table public.invoice_lines
  add column part_cost_confirmed_by uuid references public.profiles (id),
  add column part_cost_confirmed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Which repair a part order is for.
-- ---------------------------------------------------------------------------

create or replace function internal.parts_order_selection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visit_selection_id is null then
    select s.id into new.visit_selection_id
    from public.visit_bundle_selections s
    join public.bundles b on b.id = s.bundle_id
    where s.visit_id = new.visit_id and b.one_shot
    order by s.created_at
    limit 1;
  end if;
  return new;
end;
$$;

create trigger parts_orders_link_selection
  before insert or update of visit_id on public.parts_orders
  for each row execute function internal.parts_order_selection();

update public.parts_orders po
set visit_selection_id = (
  select s.id from public.visit_bundle_selections s join public.bundles b on b.id = s.bundle_id
  where s.visit_id = po.visit_id and b.one_shot order by s.created_at limit 1
)
where po.visit_selection_id is null;

create or replace function internal.selection_is_variable(p_selection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select b.pricing_kind = 'variable'
    from public.visit_bundle_selections s
    join public.bundles b on b.id = s.bundle_id
    where s.id = p_selection_id
  ), false)
$$;

-- No path marks a variable-cost part in hand without its actual cost and receipt.
create or replace function internal.guard_part_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'in_hand'
    and (tg_op = 'INSERT' or old.status is distinct from 'in_hand')
    and internal.selection_is_variable(new.visit_selection_id)
    and (new.actual_cost_cents is null or nullif(trim(coalesce(new.receipt_path, '')), '') is null) then
    raise exception 'Enter the actual part cost and photograph the receipt before marking it in hand.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger parts_orders_guard_cost
  before insert or update on public.parts_orders
  for each row execute function internal.guard_part_cost();

-- ---------------------------------------------------------------------------
-- Ordering and receiving.
-- ---------------------------------------------------------------------------

create or replace function internal.part_order_for_actor(p_order_id uuid)
returns public.parts_orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.parts_orders;
  v_req public.service_requests;
begin
  if not public.is_active_member() then
    raise exception 'not an active LSP user' using errcode = '42501';
  end if;
  select * into v_order from public.parts_orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'That part order is gone. Reload the job.' using errcode = '42501';
  end if;
  v_req := internal.lock_call(v_order.request_id);
  if not public.is_owner() and v_req.assigned_user_id is distinct from public.current_profile_id() then
    raise exception 'Only an owner or the tech on this job can change its part order.' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'That part order was cancelled.' using errcode = '42501';
  end if;
  return v_order;
end;
$$;

create or replace function public.order_part(
  parts_order_id uuid,
  supplier_id uuid default null,
  supplier_contact_text text default null,
  order_number text default null,
  part_number text default null,
  quoted_cost_cents integer default null,
  expected_delivery date default null,
  part_description text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.parts_orders;
  v_has boolean;
begin
  v_order := internal.part_order_for_actor(parts_order_id);
  if v_order.status = 'in_hand' then
    raise exception 'That part is already in hand.' using errcode = '42501';
  end if;
  if quoted_cost_cents is not null and quoted_cost_cents < 0 then
    raise exception 'The cost can''t be below zero.' using errcode = '22023';
  end if;

  v_has := supplier_id is not null
    or nullif(trim(coalesce(order_number, '')), '') is not null
    or nullif(trim(coalesce(supplier_contact_text, '')), '') is not null;

  update public.parts_orders po
  set
    part_description = coalesce(nullif(trim(coalesce(order_part.part_description, '')), ''), po.part_description),
    supplier_id = order_part.supplier_id,
    supplier_contact_text = nullif(trim(coalesce(order_part.supplier_contact_text, '')), ''),
    order_number = nullif(trim(coalesce(order_part.order_number, '')), ''),
    part_number = nullif(trim(coalesce(order_part.part_number, '')), ''),
    quoted_cost_cents = order_part.quoted_cost_cents,
    expected_delivery_date = order_part.expected_delivery,
    status = case when v_has then 'ordered'::public.parts_order_status else 'needed'::public.parts_order_status end,
    last_updated_by = public.current_profile_id()
  where po.id = v_order.id;

  return jsonb_build_object('parts_order_id', v_order.id, 'status', case when v_has then 'ordered' else 'needed' end);
end;
$$;

create or replace function public.receive_part(
  parts_order_id uuid,
  actual_cost_cents integer,
  receipt_path text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.parts_orders;
  v_receipt text := nullif(trim(coalesce(receipt_path, '')), '');
begin
  v_order := internal.part_order_for_actor(parts_order_id);
  if actual_cost_cents is null or actual_cost_cents < 0 then
    raise exception 'Enter what the part actually cost.' using errcode = '22023';
  end if;
  if v_receipt is not null and v_receipt not like v_order.id::text || '/%' then
    raise exception 'That receipt belongs to another order.' using errcode = '22023';
  end if;

  update public.parts_orders po
  set
    actual_cost_cents = receive_part.actual_cost_cents,
    receipt_path = coalesce(v_receipt, po.receipt_path),
    cost_entered_by = public.current_profile_id(),
    cost_entered_at = now(),
    status = 'in_hand',
    in_hand_at = coalesce(po.in_hand_at, now()),
    in_hand_by = coalesce(po.in_hand_by, public.current_profile_id()),
    last_updated_by = public.current_profile_id()
  where po.id = v_order.id;

  return jsonb_build_object('parts_order_id', v_order.id, 'status', 'in_hand');
end;
$$;

-- ---------------------------------------------------------------------------
-- The return visit carries the repair over from the visit that ordered the part.
-- ---------------------------------------------------------------------------

create or replace function internal.carry_repairs_to_return()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev public.service_visits;
begin
  if new.visit_type <> 'return' then
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

create trigger service_visits_carry_repairs
  after insert on public.service_visits
  for each row execute function internal.carry_repairs_to_return();

-- ---------------------------------------------------------------------------
-- close_visit: a part repair closes as a normal repair once its part is in
-- hand. Otherwise the same as 20261119190000_parts_note_optional.sql.
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

  if outcome in ('easy', 'parts') and not exists (
    select 1 from public.visit_bundle_selections s where s.visit_id = v_visit.id
  ) then
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
-- Cost lines: a variable-cost repair's part uses the actual cost.
-- Otherwise the same as in 20261120120000_owner_review.sql.
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
    if (v_item.item ->> 'kind') = 'labor' then
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
    else
      update public.invoice_cost_lines set sort = v_sort + 2 where invoice_line_id = v_line.id and kind = 'profit';
      insert into public.invoice_cost_lines (invoice_id, invoice_line_id, sort, kind, label, amount_cents)
      values (v_line.invoice_id, v_line.id, v_sort + 1, 'part', 'Parts · receipt', v_actual);
    end if;
    perform internal.recompute_invoice(v_line.invoice_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner confirms the part cost at review (changing it if the bill says so).
-- ---------------------------------------------------------------------------

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
begin
  select * into v_line from public.invoice_lines l where l.id = confirm_part_cost.line_id;
  if v_line.id is null then
    raise exception 'That line is gone. Reload the invoice.' using errcode = '42501';
  end if;
  perform internal.owner_draft(v_line.invoice_id);
  if actual_cost_cents is null or actual_cost_cents < 0 then
    raise exception 'Enter the actual part cost.' using errcode = '22023';
  end if;

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
  else
    update public.invoice_cost_lines
    set amount_cents = actual_cost_cents, removed = false
    where invoice_line_id = v_line.id and sort = v_sort;
  end if;

  update public.invoice_lines
  set part_cost_confirmed_by = public.current_profile_id(), part_cost_confirmed_at = now()
  where id = v_line.id;

  perform internal.recompute_invoice(v_line.invoice_id);
end;
$$;

-- Approve: number it, bill the customer's billing contact, date it, mark it sent.
-- seen_at guards against approving a draft someone changed after it was opened.
create or replace function public.approve_invoice(invoice_id uuid, seen_at timestamptz default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv public.invoice_records;
  v_number integer;
  v_tz text;
  v_today date;
  v_contact uuid;
  v_email text;
begin
  v_inv := internal.owner_draft(approve_invoice.invoice_id);

  if seen_at is not null and v_inv.updated_at > seen_at + interval '1 second' then
    raise exception 'This invoice changed since you opened it. Look it over again.'
      using errcode = '40001';
  end if;
  if not exists (select 1 from public.invoice_lines where invoice_lines.invoice_id = v_inv.id) then
    raise exception 'An invoice needs at least one line.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.invoice_lines l
    join public.visit_bundle_selections s on s.id = l.visit_selection_id
    join public.bundles b on b.id = s.bundle_id
    where l.invoice_id = v_inv.id
      and b.pricing_kind = 'variable'
      and l.part_cost_confirmed_at is null
  ) then
    raise exception 'Confirm the actual part cost on each variable-cost repair first.'
      using errcode = '22023';
  end if;
  if v_inv.total_cents < 0 then
    raise exception 'The total can''t be below zero.'
      using errcode = '22023';
  end if;

  update public.app_config
  set next_invoice_number = next_invoice_number + 1
  where id = 1
  returning next_invoice_number - 1, timezone into v_number, v_tz;
  v_today := (now() at time zone coalesce(v_tz, 'America/New_York'))::date;

  select c.billing_contact_id,
    coalesce(nullif(trim(c.billing_email_override), ''), nullif(trim(ct.email), ''), nullif(v_inv.bill_to_email_snap, 'unset'))
  into v_contact, v_email
  from public.customers c
  left join public.customer_contacts ct on ct.id = c.billing_contact_id
  where c.id = v_inv.bill_to_customer_id;

  update public.invoice_records
  set
    status = 'approved_sent',
    number = v_number::text,
    invoice_date = v_today,
    due_date = v_today + terms_days_snap,
    reviewed_by = public.current_profile_id(),
    sent_at = now(),
    bill_to_contact_id = coalesce(v_contact, bill_to_contact_id),
    bill_to_email_snap = coalesce(v_email, 'unset')
  where id = v_inv.id;

  return jsonb_build_object('id', v_inv.id, 'number', v_number::text, 'email', v_email);
end;
$$;


revoke all on function internal.parts_order_selection() from public, anon, authenticated;
revoke all on function internal.selection_is_variable(uuid) from public, anon;
revoke all on function internal.guard_part_cost() from public, anon, authenticated;
revoke all on function internal.carry_repairs_to_return() from public, anon, authenticated;
revoke all on function internal.part_order_for_actor(uuid) from public, anon;
grant execute on function internal.selection_is_variable(uuid) to authenticated;
grant execute on function internal.part_order_for_actor(uuid) to authenticated;

revoke all on function public.order_part(uuid, uuid, text, text, text, integer, date, text) from public, anon;
revoke all on function public.receive_part(uuid, integer, text) from public, anon;
revoke all on function public.confirm_part_cost(uuid, integer) from public, anon;
grant execute on function public.order_part(uuid, uuid, text, text, text, integer, date, text) to authenticated;
grant execute on function public.receive_part(uuid, integer, text) to authenticated;
grant execute on function public.confirm_part_cost(uuid, integer) to authenticated;
