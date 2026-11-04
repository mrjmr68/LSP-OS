-- M4 active visit. Arrival, job start, path gates, parts, attempt, and close.
-- Authority: STATE_MACHINES.md §2 and §6, SPEC.md §6–§11, ACCEPTANCE AC-G*, AC-P*, AC-D3, AC-I0, AC-I6.
-- app.visit_step is set only by these functions. The app cannot set it through the API.
-- app.visit_fixture is for proofs that plant a visit without walking the steps. The app never sets it.

create or replace function internal.auto_rule_allows(
  old_status public.board_status,
  new_status public.board_status,
  rule text
)
returns boolean
language sql
immutable
as $$
  select case rule
    when 'A1' then new_status = 'in_progress'
      and old_status in ('assigned', 'ready')
    when 'A2' then old_status = 'in_progress' and new_status = 'complete'
    when 'A3' then old_status = 'complete' and new_status = 'invoiced'
    when 'A4' then new_status = 'parts'
      and old_status in (
        'new', 'assigned', 'ready', 'in_progress', 'to_estimate', 'estimate_out'
      )
    when 'A5' then new_status = 'ready'
      and old_status in (
        'new', 'assigned', 'ready', 'in_progress', 'to_estimate', 'estimate_out', 'parts'
      )
    when 'VISIT_ESTIMATE' then old_status = 'in_progress' and new_status = 'to_estimate'
    when 'VISIT_ATTEMPT' then old_status = 'in_progress'
      and new_status in ('assigned', 'ready')
    when 'VISIT_NONBILLABLE' then old_status = 'in_progress' and new_status = 'complete'
    else false
  end
$$;

create or replace function internal.distance_meters(
  lat1 numeric,
  lng1 numeric,
  lat2 numeric,
  lng2 numeric
)
returns numeric
language sql
immutable
as $$
  select (
    6371000 * 2 * asin(least(1.0, sqrt(
      power(sin(radians((lat2 - lat1)::float8) / 2), 2)
      + cos(radians(lat1::float8)) * cos(radians(lat2::float8))
        * power(sin(radians((lng2 - lng1)::float8) / 2), 2)
    )))
  )::numeric
$$;

create or replace function internal.board_overridden(
  p_request_id uuid,
  p_seen_at timestamptz
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select p_seen_at is not null and exists (
    select 1
    from public.status_events e
    where e.request_id = p_request_id
      and e.trigger = 'manual'
      and e.at > p_seen_at
  )
$$;

create or replace function internal.flag_offline_conflict(p_visit_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.service_visits
  set offline_conflict = true, sync_state = 'pending'
  where id = p_visit_id
$$;

create or replace function internal.lock_call(p_request_id uuid)
returns public.service_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.service_requests;
begin
  if not public.is_active_member() then
    raise exception 'not an active LSP user'
      using errcode = '42501';
  end if;

  select *
  into v_row
  from public.service_requests
  where id = p_request_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'That call is not on the board.'
      using errcode = '42501';
  end if;

  return v_row;
end;
$$;

create or replace function internal.end_clock(
  p_visit_id uuid,
  p_kind public.time_segment_kind,
  p_source public.time_source
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.time_segments
  set ended_at = now(), end_source = p_source
  where visit_id = p_visit_id
    and ended_at is null
    and (p_kind is null or kind = p_kind)
$$;

create or replace function internal.start_clock(
  p_visit_id uuid,
  p_user_id uuid,
  p_kind public.time_segment_kind,
  p_source public.time_source
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.time_segments
    where visit_id = p_visit_id
      and kind = p_kind
      and ended_at is null
  ) then
    return;
  end if;

  insert into public.time_segments (
    visit_id, user_id, kind, started_at, start_source
  )
  values (p_visit_id, p_user_id, p_kind, now(), p_source);
end;
$$;

create or replace function internal.visit_result(
  p_request_id uuid,
  p_notice text
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'conflict', false,
    'board_status', r.board_status,
    'visit_status', v.status,
    'visit_id', v.id,
    'request_updated_at', r.updated_at,
    'offline_conflict', coalesce(v.offline_conflict, false),
    'notice', p_notice
  )
  from public.service_requests r
  left join lateral (
    select id, status, offline_conflict
    from public.service_visits
    where request_id = r.id
    order by visit_seq desc
    limit 1
  ) v on true
  where r.id = p_request_id
$$;

create or replace function internal.conflict_result(p_request_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'conflict', true,
    'board_status', r.board_status,
    'visit_status', v.status,
    'visit_id', v.id,
    'request_updated_at', r.updated_at,
    'offline_conflict', true,
    'notice',
    'The board changed this call while you were offline. The board stands. Tell an owner what you saved on the phone.'
  )
  from public.service_requests r
  left join lateral (
    select id, status, offline_conflict
    from public.service_visits
    where request_id = r.id
    order by visit_seq desc
    limit 1
  ) v on true
  where r.id = p_request_id
$$;

-- Latest visit the tech is still on, or the newest one if the call is already finished.
create or replace function internal.visit_for_call(p_request_id uuid)
returns public.service_visits
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_row public.service_visits;
begin
  select *
  into v_row
  from public.service_visits
  where request_id = p_request_id
    and status in ('planned', 'en_route', 'on_site', 'working')
  order by visit_seq desc
  limit 1;

  if found then
    return v_row;
  end if;

  select *
  into v_row
  from public.service_visits
  where request_id = p_request_id
  order by visit_seq desc
  limit 1;

  return v_row;
end;
$$;

create or replace function internal.upsert_parts_order(
  p_request_id uuid,
  p_visit_id uuid,
  p_actor uuid,
  p_description text,
  p_supplier_id uuid,
  p_contact text,
  p_order text,
  p_eta date
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_status public.parts_order_status;
  v_description text;
  v_contact text;
  v_order text;
  v_has boolean;
  v_next public.parts_order_status;
begin
  v_description := nullif(trim(coalesce(p_description, '')), '');
  if v_description is null then
    raise exception 'Say what part you need.'
      using errcode = '42501';
  end if;

  v_contact := nullif(trim(coalesce(p_contact, '')), '');
  v_order := nullif(trim(coalesce(p_order, '')), '');
  v_has := v_order is not null or p_supplier_id is not null or v_contact is not null;

  select id, status
  into v_id, v_status
  from public.parts_orders
  where request_id = p_request_id
    and visit_id = p_visit_id
    and status <> 'cancelled'
  order by created_at desc
  limit 1
  for update;

  v_next := case
    when v_status = 'in_hand' then 'in_hand'::public.parts_order_status
    when v_has then 'ordered'::public.parts_order_status
    else 'needed'::public.parts_order_status
  end;

  if v_id is null then
    insert into public.parts_orders (
      request_id,
      visit_id,
      part_description,
      supplier_id,
      supplier_contact_text,
      order_number,
      expected_delivery_date,
      status,
      entered_by,
      last_updated_by
    )
    values (
      p_request_id,
      p_visit_id,
      v_description,
      p_supplier_id,
      v_contact,
      v_order,
      p_eta,
      v_next,
      p_actor,
      p_actor
    )
    returning id into v_id;
  else
    update public.parts_orders
    set
      part_description = v_description,
      supplier_id = p_supplier_id,
      supplier_contact_text = v_contact,
      order_number = v_order,
      expected_delivery_date = p_eta,
      status = v_next,
      last_updated_by = p_actor
    where id = v_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.guard_service_visit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  step text;
begin
  if not public.is_app_session() then
    return new;
  end if;

  if current_setting('app.visit_fixture', true) = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'planned' then
      return new;
    end if;
    if new.status = 'en_route' and (
      current_setting('app.visit_step', true) = 'en_route'
      or current_setting('app.auto_rule', true) = 'A1'
    ) then
      return new;
    end if;
    raise exception 'a visit starts as planned or en route'
      using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    if old.status in ('closed', 'attempt', 'cancelled')
      and (
        new.outcome_path is distinct from old.outcome_path
        or new.tech_note is distinct from old.tech_note
        or new.attempt_reason is distinct from old.attempt_reason
        or new.model_typed is distinct from old.model_typed
        or new.serial_typed is distinct from old.serial_typed
      ) then
      raise exception 'that visit is already finished'
        using errcode = '42501';
    end if;
    return new;
  end if;

  step := current_setting('app.visit_step', true);
  if step is distinct from new.status::text then
    raise exception 'that visit step is not allowed from here'
      using errcode = '42501';
  end if;

  if not (
    (old.status = 'planned' and new.status in ('en_route', 'cancelled'))
    or (old.status = 'en_route' and new.status in ('on_site', 'attempt', 'cancelled'))
    or (old.status = 'on_site' and new.status in ('working', 'attempt', 'cancelled'))
    or (old.status = 'working' and new.status in ('closed', 'cancelled'))
  ) then
    raise exception 'that visit step is not allowed from here'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists service_visits_guard on public.service_visits;
create trigger service_visits_guard
  before insert or update on public.service_visits
  for each row execute function public.guard_service_visit();

-- The assigned tech can replace the repair pick while the job is still open.
create policy selections_delete_open_visit on public.visit_bundle_selections
  for delete to authenticated
  using (
    public.is_owner()
    or exists (
      select 1
      from public.service_visits v
      where v.id = visit_id
        and v.tech_user_id = public.current_profile_id()
        and v.status = 'working'
    )
  );

-- On the way still starts travel. A later call, after an attempt or a close, is a return visit.
create or replace function public.go_en_route(
  request_id uuid,
  eta_minutes integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor uuid;
  v_status public.board_status;
  v_assigned uuid;
  v_phone text;
  v_sms_ok boolean;
  v_property text;
  v_unit text;
  v_address text;
  v_visit uuid;
  v_visit_status public.visit_status;
  v_seq integer;
  v_type public.visit_type;
  v_body text;
  v_sms text;
  v_notice text;
begin
  if not public.is_active_member() then
    raise exception 'not an active LSP user'
      using errcode = '42501';
  end if;

  v_actor := public.current_profile_id();

  select r.board_status, r.assigned_user_id, c.phone, c.sms_ok, p.name, u.unit_label,
    concat_ws(', ', p.address_line1, p.city, p.state || ' ' || p.zip)
  into v_status, v_assigned, v_phone, v_sms_ok, v_property, v_unit, v_address
  from public.service_requests r
  join public.customer_contacts c on c.id = r.contact_id
  join public.properties p on p.id = r.property_id
  join public.units u on u.id = r.unit_id
  where r.id = request_id
    and r.deleted_at is null
  for update of r;

  if v_status is null then
    raise exception 'That call is not on the board.'
      using errcode = '42501';
  end if;

  if v_assigned is distinct from v_actor then
    raise exception 'Only the assigned tech can go en route.'
      using errcode = '42501';
  end if;

  if v_status not in ('assigned', 'ready') then
    raise exception 'This call is not ready to start.'
      using errcode = '42501';
  end if;

  perform set_config('app.auto_rule', 'A1', true);

  perform internal.move_board_status(
    request_id, 'in_progress', 'my_jobs_tap', null, null, false
  );

  select v.id, v.status
  into v_visit, v_visit_status
  from public.service_visits v
  where v.request_id = go_en_route.request_id
    and v.status in ('planned', 'en_route', 'on_site', 'working')
  order by v.visit_seq desc
  limit 1;

  perform set_config('app.visit_step', 'en_route', true);

  if v_visit is null then
    select coalesce(max(visit_seq), 0) + 1
    into v_seq
    from public.service_visits
    where service_visits.request_id = go_en_route.request_id;

    if exists (
      select 1
      from public.service_visits prior
      where prior.request_id = go_en_route.request_id
        and prior.status in ('attempt', 'closed')
    ) then
      v_type := 'return';
    else
      v_type := 'service';
    end if;

    insert into public.service_visits (
      request_id, visit_seq, tech_user_id, visit_type, status
    )
    values (request_id, v_seq, v_actor, v_type, 'en_route')
    returning id into v_visit;
  elsif v_visit_status = 'planned' then
    update public.service_visits
    set status = 'en_route'
    where id = v_visit;
  end if;

  perform set_config('app.visit_step', '', true);

  if not exists (
    select 1
    from public.time_segments t
    where t.visit_id = v_visit
      and t.kind = 'travel'
      and t.ended_at is null
  ) then
    insert into public.time_segments (
      visit_id, user_id, kind, started_at, start_source
    )
    values (v_visit, v_actor, 'travel', now(), 'tap');
  end if;

  v_phone := nullif(trim(coalesce(v_phone, '')), '');
  if v_phone is null or v_phone = 'unset' then
    v_sms := 'no_phone';
    v_notice := 'No ETA text sent — no phone.';
  elsif not coalesce(v_sms_ok, false) then
    v_sms := 'sms_off';
    v_notice := 'No ETA text sent — texts are off for this contact.';
  else
    v_body := 'LSP is on the way to ' || v_property || ' ' || v_unit || '.';
    if eta_minutes is not null and eta_minutes > 0 then
      v_body := v_body || ' ETA about ' || eta_minutes || ' min.';
    end if;
    insert into public.outbound_messages (
      request_id, channel, to_address, template, body, status
    )
    values (request_id, 'sms', v_phone, 'eta', v_body, 'queued');
    v_sms := 'queued';
    v_notice := 'ETA text queued for ' || v_phone || '.';
  end if;

  return jsonb_build_object(
    'address', v_address,
    'sms', v_sms,
    'notice', v_notice,
    'eta_minutes', eta_minutes,
    'visit_id', v_visit
  );
end;
$$;

-- Unassign cancels the open visit. The step flag is cleared before the function returns
-- so a later statement in the same transaction is not treated as a cancel.
create or replace function public.assign_request(
  request_id uuid,
  tech_id uuid
)
returns public.board_status
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status public.board_status;
  v_next public.board_status;
  v_progressed boolean;
  v_seq integer;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can assign a call.'
      using errcode = '42501';
  end if;

  select board_status
  into v_status
  from public.service_requests
  where id = request_id
    and deleted_at is null
  for update;

  if v_status is null then
    raise exception 'That call is not on the board.'
      using errcode = '42501';
  end if;

  if tech_id is null then
    select exists (
      select 1
      from public.service_visits v
      where v.request_id = assign_request.request_id
        and v.status in ('en_route', 'on_site', 'working', 'closed', 'attempt')
    )
    into v_progressed;

    update public.time_segments as t
    set
      ended_at = now(),
      end_source = 'owner_edit'
    from public.service_visits as v
    where t.visit_id = v.id
      and v.request_id = assign_request.request_id
      and v.status in ('planned', 'en_route', 'on_site', 'working')
      and t.ended_at is null;

    perform set_config('app.visit_step', 'cancelled', true);
    update public.service_visits
    set status = 'cancelled'
    where service_visits.request_id = assign_request.request_id
      and status in ('planned', 'en_route', 'on_site', 'working');
    perform set_config('app.visit_step', '', true);

    update public.service_requests
    set assigned_user_id = null
    where id = request_id;

    v_next := v_status;
    if v_status = 'assigned' and not v_progressed then
      v_next := 'new';
    elsif v_status in ('assigned', 'in_progress') then
      v_next := 'ready';
    end if;

    if v_next is distinct from v_status then
      perform internal.move_board_status(
        request_id,
        v_next,
        'manual',
        'Unassigned',
        null,
        false
      );
    end if;
  else
    if not exists (
      select 1 from public.profiles p
      where p.id = tech_id and p.active
    ) then
      raise exception 'Pick someone on the crew.'
        using errcode = '42501';
    end if;

    update public.service_requests
    set assigned_user_id = tech_id
    where id = request_id;

    perform set_config('app.visit_step', 'cancelled', true);
    update public.service_visits
    set status = 'cancelled'
    where service_visits.request_id = assign_request.request_id
      and status in ('planned', 'en_route')
      and tech_user_id is distinct from tech_id;
    perform set_config('app.visit_step', '', true);

    if not exists (
      select 1
      from public.service_visits v
      where v.request_id = assign_request.request_id
        and v.tech_user_id = tech_id
        and v.status in ('planned', 'en_route', 'on_site', 'working')
    ) then
      select coalesce(max(visit_seq), 0) + 1
      into v_seq
      from public.service_visits
      where service_visits.request_id = assign_request.request_id;

      insert into public.service_visits (
        request_id, visit_seq, tech_user_id, visit_type, status
      )
      values (assign_request.request_id, v_seq, tech_id, 'service', 'planned');
    end if;

    if v_status in ('new', 'ready') then
      perform internal.move_board_status(
        request_id, 'assigned', 'manual', null, null, false
      );
    end if;
  end if;

  select r.board_status
  into v_status
  from public.service_requests r
  where r.id = assign_request.request_id;

  return v_status;
end;
$$;

create or replace function public.mark_on_site(
  request_id uuid,
  arrival_source text,
  lat numeric default null,
  lng numeric default null,
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
  v_source public.time_source;
  v_lat numeric;
  v_lng numeric;
  v_radius integer;
  v_meters numeric;
begin
  v_req := internal.lock_call(request_id);
  v_actor := public.current_profile_id();
  if v_req.assigned_user_id is distinct from v_actor then
    raise exception 'Only the assigned tech can do that on this call.'
      using errcode = '42501';
  end if;

  if arrival_source not in ('gps', 'tap') then
    raise exception 'Arrival has to be the map fence or I''m here.'
      using errcode = '42501';
  end if;

  v_visit := internal.visit_for_call(request_id);
  if v_visit.id is null then
    raise exception 'Go on the way before marking arrival.'
      using errcode = '42501';
  end if;

  if internal.board_overridden(request_id, seen_at) then
    perform internal.flag_offline_conflict(v_visit.id);
    return internal.conflict_result(request_id);
  end if;

  if v_visit.status in ('on_site', 'working', 'closed') then
    return internal.visit_result(request_id, 'Already on site.');
  end if;

  if v_visit.status <> 'en_route' then
    raise exception 'Go on the way before marking arrival.'
      using errcode = '42501';
  end if;

  v_source := arrival_source::public.time_source;
  if v_source = 'gps' then
    select p.lat, p.lng, p.geofence_radius_m
    into v_lat, v_lng, v_radius
    from public.properties p
    where p.id = v_req.property_id;

    if v_lat is null or v_lng is null then
      raise exception 'This property has no map pin. Tap I''m here.'
        using errcode = '42501';
    end if;
    if lat is null or lng is null then
      raise exception 'Location did not come through. Tap I''m here.'
        using errcode = '42501';
    end if;
    v_meters := internal.distance_meters(v_lat, v_lng, lat, lng);
    if v_meters > coalesce(v_radius, 150) then
      raise exception 'You are not at the property yet. Tap I''m here if you are.'
        using errcode = '42501';
    end if;
  end if;

  perform set_config('app.visit_step', 'on_site', true);
  update public.service_visits
  set status = 'on_site', sync_state = 'synced'
  where id = v_visit.id;
  perform set_config('app.visit_step', '', true);

  perform internal.end_clock(v_visit.id, 'travel', v_source);
  perform internal.start_clock(v_visit.id, v_actor, 'access', v_source);

  return internal.visit_result(request_id, 'On site. Access time started.');
end;
$$;

create or replace function public.start_job(
  request_id uuid,
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
begin
  v_req := internal.lock_call(request_id);
  v_actor := public.current_profile_id();
  if v_req.assigned_user_id is distinct from v_actor then
    raise exception 'Only the assigned tech can do that on this call.'
      using errcode = '42501';
  end if;

  v_visit := internal.visit_for_call(request_id);
  if v_visit.id is null then
    raise exception 'Tap I''m here before starting the job.'
      using errcode = '42501';
  end if;

  if internal.board_overridden(request_id, seen_at) then
    perform internal.flag_offline_conflict(v_visit.id);
    return internal.conflict_result(request_id);
  end if;

  if v_visit.status in ('working', 'closed') then
    return internal.visit_result(request_id, 'Job already started.');
  end if;

  if v_visit.status <> 'on_site' then
    raise exception 'Tap I''m here before starting the job.'
      using errcode = '42501';
  end if;

  perform set_config('app.visit_step', 'working', true);
  update public.service_visits
  set status = 'working', sync_state = 'synced'
  where id = v_visit.id;
  perform set_config('app.visit_step', '', true);

  perform internal.end_clock(v_visit.id, 'access', 'tap');
  perform internal.start_clock(v_visit.id, v_actor, 'work', 'tap');

  return internal.visit_result(request_id, 'Tools on the equipment. Work time started.');
end;
$$;

create or replace function public.save_visit_capture(
  request_id uuid,
  model_typed text default null,
  serial_typed text default null,
  equipment_size_text text default null,
  tech_note text default null,
  readings jsonb default null,
  outcome public.outcome_path default null,
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
begin
  v_req := internal.lock_call(request_id);
  if v_req.assigned_user_id is distinct from public.current_profile_id() then
    raise exception 'Only the assigned tech can do that on this call.'
      using errcode = '42501';
  end if;

  v_visit := internal.visit_for_call(request_id);
  if v_visit.id is null or v_visit.status not in ('working', 'closed') then
    raise exception 'Start the job before saving the diagnosis.'
      using errcode = '42501';
  end if;

  if internal.board_overridden(request_id, seen_at) then
    perform internal.flag_offline_conflict(v_visit.id);
    return internal.conflict_result(request_id);
  end if;

  if v_visit.status = 'closed' then
    return internal.visit_result(request_id, 'That visit is already closed.');
  end if;

  update public.service_visits
  set
    model_typed = coalesce(nullif(trim(coalesce(model_typed, '')), ''), service_visits.model_typed),
    serial_typed = coalesce(nullif(trim(coalesce(serial_typed, '')), ''), service_visits.serial_typed),
    equipment_size_text = coalesce(nullif(trim(coalesce(equipment_size_text, '')), ''), service_visits.equipment_size_text),
    tech_note = coalesce(nullif(trim(coalesce(tech_note, '')), ''), service_visits.tech_note),
    readings = case
      when readings is null then service_visits.readings
      else readings
    end,
    outcome_path = coalesce(outcome, service_visits.outcome_path),
    client_draft_id = coalesce(client_draft_id, service_visits.client_draft_id),
    sync_state = 'synced'
  where id = v_visit.id;

  return internal.visit_result(request_id, 'Saved.');
end;
$$;

create or replace function public.select_visit_bundle(
  request_id uuid,
  bundle_id uuid,
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
  v_code text;
  v_title text;
  v_narrative text;
  v_price integer;
  v_hours numeric(5, 2);
  v_kind public.pricing_kind;
  v_one_shot boolean;
  v_requires boolean;
  v_rate integer;
  v_labor integer;
  v_parts integer;
  v_cost integer;
  v_lines jsonb;
begin
  v_req := internal.lock_call(request_id);
  v_actor := public.current_profile_id();
  if v_req.assigned_user_id is distinct from v_actor then
    raise exception 'Only the assigned tech can do that on this call.'
      using errcode = '42501';
  end if;

  v_visit := internal.visit_for_call(request_id);
  if v_visit.id is null or v_visit.status not in ('working', 'closed') then
    raise exception 'Start the job before picking a repair.'
      using errcode = '42501';
  end if;

  if internal.board_overridden(request_id, seen_at) then
    perform internal.flag_offline_conflict(v_visit.id);
    return internal.conflict_result(request_id);
  end if;

  select
    b.code,
    b.title,
    b.narrative,
    b.target_price_cents,
    b.labor_hours,
    b.pricing_kind,
    b.one_shot,
    b.requires_model_serial
  into
    v_code, v_title, v_narrative, v_price, v_hours, v_kind, v_one_shot, v_requires
  from public.bundles b
  where b.id = bundle_id
    and b.status = 'active';

  if v_code is null then
    raise exception 'That repair is not in the book.'
      using errcode = '42501';
  end if;

  if v_visit.status = 'closed' then
    return internal.visit_result(request_id, 'That visit is already closed.') || jsonb_build_object(
      'bundle_id', bundle_id,
      'code', v_code,
      'title', v_title,
      'price_cents', v_price,
      'one_shot', v_one_shot,
      'pricing_kind', v_kind,
      'requires_model_serial', v_requires
    );
  end if;

  select labor_rate_cents into v_rate from public.app_config where id = 1;
  v_labor := round(v_hours * v_rate)::integer;
  select coalesce(round(sum(bl.qty * bl.unit_cost_cents))::integer, 0)
  into v_parts
  from public.bundle_lines bl
  where bl.bundle_id = select_visit_bundle.bundle_id;
  v_cost := v_labor + v_parts;

  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', bl.kind,
    'description', bl.description,
    'qty', bl.qty,
    'unit_cost_cents', bl.unit_cost_cents
  )), '[]'::jsonb)
  into v_lines
  from public.bundle_lines bl
  where bl.bundle_id = select_visit_bundle.bundle_id;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'kind', 'labor',
    'description', 'Labor',
    'qty', v_hours,
    'unit_cost_cents', v_rate
  ));

  delete from public.visit_bundle_selections where visit_id = v_visit.id;

  insert into public.visit_bundle_selections (
    visit_id,
    bundle_id,
    code_snap,
    title_snap,
    narrative_snap,
    price_cents_snap,
    labor_hours_snap,
    labor_rate_cents_snap,
    cost_lines_snap,
    profit_cents_snap,
    qty,
    selected_by
  )
  values (
    v_visit.id,
    bundle_id,
    v_code,
    v_title,
    v_narrative,
    v_price,
    v_hours,
    v_rate,
    v_lines,
    v_price - v_cost,
    1,
    v_actor
  );

  if v_one_shot then
    update public.service_visits
    set outcome_path = 'parts', sync_state = 'synced'
    where id = v_visit.id;
  else
    update public.service_visits
    set sync_state = 'synced'
    where id = v_visit.id;
  end if;

  return internal.visit_result(request_id, 'Repair saved.') || jsonb_build_object(
    'bundle_id', bundle_id,
    'code', v_code,
    'title', v_title,
    'price_cents', v_price,
    'one_shot', v_one_shot,
    'pricing_kind', v_kind,
    'requires_model_serial', v_requires
  );
end;
$$;

create or replace function public.attach_visit_file(
  request_id uuid,
  kind public.attachment_kind,
  storage_path text,
  caption text default null,
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
  v_path text;
  v_id uuid;
begin
  v_req := internal.lock_call(request_id);
  v_actor := public.current_profile_id();
  if v_req.assigned_user_id is distinct from v_actor then
    raise exception 'Only the assigned tech can do that on this call.'
      using errcode = '42501';
  end if;

  if kind not in ('photo', 'nameplate', 'signature') then
    raise exception 'That file is not part of the visit.'
      using errcode = '42501';
  end if;

  v_path := nullif(trim(coalesce(storage_path, '')), '');
  if v_path is null then
    raise exception 'The file did not come through.'
      using errcode = '42501';
  end if;

  v_visit := internal.visit_for_call(request_id);
  if v_visit.id is null or v_visit.status not in ('on_site', 'working', 'closed') then
    raise exception 'Start the visit before adding a photo.'
      using errcode = '42501';
  end if;

  if internal.board_overridden(request_id, seen_at) then
    perform internal.flag_offline_conflict(v_visit.id);
    return internal.conflict_result(request_id);
  end if;

  select a.id
  into v_id
  from public.attachments a
  where a.owner_type = 'visit'
    and a.owner_id = v_visit.id
    and a.storage_path = v_path
  limit 1;

  if v_id is null then
    if v_visit.status = 'closed' then
      raise exception 'That visit is already finished.'
        using errcode = '42501';
    end if;
    insert into public.attachments (
      owner_type, owner_id, kind, storage_path, caption, taken_at, uploaded_by, upload_state
    )
    values (
      'visit', v_visit.id, kind, v_path, nullif(trim(coalesce(caption, '')), ''), now(), v_actor, 'local'
    )
    returning id into v_id;
  end if;

  if kind = 'signature' and v_visit.status = 'working' then
    update public.service_visits
    set
      signoff_signature_attachment_id = v_id,
      signoff_name = coalesce(nullif(trim(coalesce(caption, '')), ''), signoff_name)
    where id = v_visit.id;
  end if;

  return internal.visit_result(request_id, 'File saved on the visit.') || jsonb_build_object(
    'attachment_id', v_id
  );
end;
$$;

create or replace function public.save_parts_order(
  request_id uuid,
  part_description text,
  supplier_id uuid default null,
  supplier_contact_text text default null,
  order_number text default null,
  expected_delivery date default null,
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
  v_order_id uuid;
begin
  v_req := internal.lock_call(request_id);
  v_actor := public.current_profile_id();
  if not public.is_owner() and v_req.assigned_user_id is distinct from v_actor then
    raise exception 'Only an owner or the assigned tech can save the part order.'
      using errcode = '42501';
  end if;

  v_visit := internal.visit_for_call(request_id);
  if v_visit.id is null then
    raise exception 'There is no visit to hang this part on.'
      using errcode = '42501';
  end if;

  if internal.board_overridden(request_id, seen_at) then
    perform internal.flag_offline_conflict(v_visit.id);
    return internal.conflict_result(request_id);
  end if;

  if nullif(trim(coalesce(v_visit.model_typed, '')), '') is null
    or nullif(trim(coalesce(v_visit.serial_typed, '')), '') is null then
    raise exception 'Type the model and serial before ordering a part. A photo of the nameplate is not enough.'
      using errcode = '42501';
  end if;

  v_order_id := internal.upsert_parts_order(
    request_id,
    v_visit.id,
    v_actor,
    part_description,
    supplier_id,
    supplier_contact_text,
    order_number,
    expected_delivery
  );

  return internal.visit_result(request_id, 'Part order saved.') || jsonb_build_object(
    'parts_order_id', v_order_id
  );
end;
$$;

create or replace function public.mark_part_in_hand(
  parts_order_id uuid,
  seen_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.parts_orders;
  v_req public.service_requests;
  v_actor uuid;
  v_visit uuid;
begin
  if not public.is_active_member() then
    raise exception 'not an active LSP user'
      using errcode = '42501';
  end if;

  v_actor := public.current_profile_id();

  select *
  into v_order
  from public.parts_orders
  where id = parts_order_id
  for update;

  if not found then
    raise exception 'That part order is not on the call.'
      using errcode = '42501';
  end if;

  v_req := internal.lock_call(v_order.request_id);
  if not public.is_owner() and v_req.assigned_user_id is distinct from v_actor then
    raise exception 'Only an owner or the assigned tech can mark the part in hand.'
      using errcode = '42501';
  end if;

  select id into v_visit
  from public.service_visits
  where request_id = v_order.request_id
  order by visit_seq desc
  limit 1;

  if internal.board_overridden(v_order.request_id, seen_at) then
    perform internal.flag_offline_conflict(v_visit);
    return internal.conflict_result(v_order.request_id);
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'That part order was cancelled.'
      using errcode = '42501';
  end if;

  if v_order.status <> 'in_hand' then
    update public.parts_orders
    set
      status = 'in_hand',
      in_hand_at = now(),
      in_hand_by = v_actor,
      last_updated_by = v_actor
    where id = v_order.id;
  end if;

  return internal.visit_result(v_order.request_id, 'Part in hand. The call is Ready.') || jsonb_build_object(
    'parts_order_id', v_order.id
  );
end;
$$;

create or replace function public.record_attempt(
  request_id uuid,
  reason public.attempt_reason,
  tech_note text,
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
  v_back public.board_status;
begin
  v_req := internal.lock_call(request_id);
  v_actor := public.current_profile_id();
  if v_req.assigned_user_id is distinct from v_actor then
    raise exception 'Only the assigned tech can do that on this call.'
      using errcode = '42501';
  end if;

  if reason is null then
    raise exception 'Pick why you could not get in.'
      using errcode = '42501';
  end if;

  v_note := nullif(trim(coalesce(tech_note, '')), '');
  if v_note is null then
    raise exception 'Write what happened.'
      using errcode = '42501';
  end if;

  v_visit := internal.visit_for_call(request_id);
  if v_visit.id is null then
    raise exception 'Go on the way before recording an attempt.'
      using errcode = '42501';
  end if;

  if internal.board_overridden(request_id, seen_at) then
    perform internal.flag_offline_conflict(v_visit.id);
    return internal.conflict_result(request_id);
  end if;

  if v_visit.status = 'attempt' then
    return internal.visit_result(request_id, 'Attempt already recorded.');
  end if;

  if v_visit.status not in ('en_route', 'on_site') then
    raise exception 'Couldn''t get in is only before the job starts.'
      using errcode = '42501';
  end if;

  perform set_config('app.visit_step', 'attempt', true);
  update public.service_visits
  set
    status = 'attempt',
    outcome_path = 'attempt',
    attempt_reason = reason,
    tech_note = v_note,
    closed_at = coalesce(closed_at, now()),
    sync_state = 'synced'
  where id = v_visit.id;
  perform set_config('app.visit_step', '', true);

  perform internal.end_clock(v_visit.id, null, 'tap');

  if v_req.board_status = 'in_progress' then
    select e.from_status
    into v_back
    from public.status_events e
    where e.request_id = record_attempt.request_id
      and e.to_status = 'in_progress'
      and e.from_status in ('assigned', 'ready')
    order by e.at desc
    limit 1;

    if v_back is null then
      v_back := 'ready';
    end if;

    perform set_config('app.auto_rule', 'VISIT_ATTEMPT', true);
    perform internal.move_board_status(
      request_id, v_back, 'system', null, null, false
    );
    perform set_config('app.auto_rule', '', true);
  end if;

  return internal.visit_result(request_id, 'Couldn''t get in. The call stays open.');
end;
$$;

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

  if v_note is null then
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

revoke all on function internal.distance_meters(numeric, numeric, numeric, numeric) from public;
revoke all on function internal.board_overridden(uuid, timestamptz) from public;
revoke all on function internal.flag_offline_conflict(uuid) from public;
revoke all on function internal.lock_call(uuid) from public;
revoke all on function internal.end_clock(uuid, public.time_segment_kind, public.time_source) from public;
revoke all on function internal.start_clock(uuid, uuid, public.time_segment_kind, public.time_source) from public;
revoke all on function internal.visit_result(uuid, text) from public;
revoke all on function internal.conflict_result(uuid) from public;
revoke all on function internal.visit_for_call(uuid) from public;
revoke all on function internal.upsert_parts_order(uuid, uuid, uuid, text, uuid, text, text, date) from public;
revoke all on function public.guard_service_visit() from public;
revoke all on function public.mark_on_site(uuid, text, numeric, numeric, timestamptz) from public;
revoke all on function public.start_job(uuid, timestamptz) from public;
revoke all on function public.save_visit_capture(uuid, text, text, text, text, jsonb, public.outcome_path, uuid, timestamptz) from public;
revoke all on function public.select_visit_bundle(uuid, uuid, timestamptz) from public;
revoke all on function public.attach_visit_file(uuid, public.attachment_kind, text, text, timestamptz) from public;
revoke all on function public.save_parts_order(uuid, text, uuid, text, text, date, timestamptz) from public;
revoke all on function public.mark_part_in_hand(uuid, timestamptz) from public;
revoke all on function public.record_attempt(uuid, public.attempt_reason, text, timestamptz) from public;
revoke all on function public.close_visit(uuid, public.outcome_path, text, text, text, text, jsonb, text, text, text, text, uuid, text, text, date, uuid, timestamptz) from public;

grant execute on function internal.distance_meters(numeric, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function internal.board_overridden(uuid, timestamptz) to authenticated, service_role;
grant execute on function internal.flag_offline_conflict(uuid) to authenticated, service_role;
grant execute on function internal.lock_call(uuid) to authenticated, service_role;
grant execute on function internal.end_clock(uuid, public.time_segment_kind, public.time_source) to authenticated, service_role;
grant execute on function internal.start_clock(uuid, uuid, public.time_segment_kind, public.time_source) to authenticated, service_role;
grant execute on function internal.visit_result(uuid, text) to authenticated, service_role;
grant execute on function internal.conflict_result(uuid) to authenticated, service_role;
grant execute on function internal.visit_for_call(uuid) to authenticated, service_role;
grant execute on function internal.upsert_parts_order(uuid, uuid, uuid, text, uuid, text, text, date) to authenticated, service_role;
grant execute on function public.guard_service_visit() to authenticated, service_role;
grant execute on function public.mark_on_site(uuid, text, numeric, numeric, timestamptz) to authenticated, service_role;
grant execute on function public.start_job(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.save_visit_capture(uuid, text, text, text, text, jsonb, public.outcome_path, uuid, timestamptz) to authenticated, service_role;
grant execute on function public.select_visit_bundle(uuid, uuid, timestamptz) to authenticated, service_role;
grant execute on function public.attach_visit_file(uuid, public.attachment_kind, text, text, timestamptz) to authenticated, service_role;
grant execute on function public.save_parts_order(uuid, text, uuid, text, text, date, timestamptz) to authenticated, service_role;
grant execute on function public.mark_part_in_hand(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.record_attempt(uuid, public.attempt_reason, text, timestamptz) to authenticated, service_role;
grant execute on function public.close_visit(uuid, public.outcome_path, text, text, text, text, jsonb, text, text, text, text, uuid, text, text, date, uuid, timestamptz) to authenticated, service_role;

comment on function public.mark_on_site(uuid, text, numeric, numeric, timestamptz) is
  'En route to on site. GPS must be inside the property fence. I''m here is the tap fallback. Ends travel and starts access.';
comment on function public.start_job(uuid, timestamptz) is
  'On site to working. Ends access and starts work. Cannot skip arrival.';
comment on function public.close_visit(uuid, public.outcome_path, text, text, text, text, jsonb, text, text, text, text, uuid, text, text, date, uuid, timestamptz) is
  'Working to closed when the path gates are met. Easy and one-off draft an invoice and move the call to Complete. Parts moves to Parts. Estimate drafts an estimate and moves to To Estimate.';
