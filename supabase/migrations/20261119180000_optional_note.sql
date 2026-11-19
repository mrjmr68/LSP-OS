-- Notes are optional on a simple repair (Nov 18 decision: "Notes and photos
-- should be optional unless required for parts orders or for estimates").
-- Same close_visit as 20261104120000_active_visit.sql; only the note check
-- changes: a note is still required for parts, estimate and one-off.

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
  v_model := nullif(trim(coalesce(model_typed, '')), '');
  v_serial := nullif(trim(coalesce(serial_typed, '')), '');
  v_size := nullif(trim(coalesce(equipment_size_text, '')), '');
  v_sign_name := nullif(trim(coalesce(signoff_name, '')), '');
  v_narrative := nullif(trim(coalesce(one_off_narrative, '')), '');
  v_materials := nullif(trim(coalesce(materials_text, '')), '');

  if v_note is null and outcome <> 'easy' then
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

  if outcome = 'easy' and exists (
    select 1
    from public.visit_bundle_selections s
    join public.bundles b on b.id = s.bundle_id
    where s.visit_id = v_visit.id
      and b.one_shot
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
