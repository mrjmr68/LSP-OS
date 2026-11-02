-- M3 Board actions and auto status rules A1–A5.
-- Authority: STATE_MACHINES.md. Quick Add, assign, High, and My Jobs en route
-- go through these functions so the status event and the guard run in one transaction.
-- A2–A5 are triggers on the work rows (invoice drafted, invoice sent, parts order, part in hand).
-- Helpers live in schema internal so PostgREST does not expose them.

create schema if not exists internal;

revoke all on schema internal from public;
grant usage on schema internal to authenticated, service_role;

-- Owner status switch needs a reason when the move is not one of the normal
-- Board steps. Parts → ready is normal, and the in-hand check stays in the guard.
create or replace function internal.owner_status_needs_reason(
  old_status public.board_status,
  new_status public.board_status
)
returns boolean
language sql
immutable
as $$
  select not (
    old_status = new_status
    or (old_status = 'new' and new_status in ('assigned', 'ready', 'to_estimate'))
    or (old_status = 'ready' and new_status = 'assigned')
    or (old_status = 'assigned' and new_status = 'ready')
    or (old_status = 'to_estimate' and new_status = 'estimate_out')
    or (old_status = 'estimate_out' and new_status in ('ready', 'complete', 'closed'))
    or (old_status = 'complete' and new_status = 'closed')
    or (old_status = 'invoiced' and new_status = 'closed')
    or (old_status = 'parts' and new_status = 'ready')
  )
$$;

-- True only for the automatic work-event move named by app.auto_rule.
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
    else false
  end
$$;

create or replace function internal.move_board_status(
  p_request_id uuid,
  p_to public.board_status,
  p_trigger public.status_trigger,
  p_reason text,
  p_auto_rule text,
  p_bump boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_from public.board_status;
  v_actor uuid;
  v_reason text;
begin
  select board_status
  into v_from
  from public.service_requests
  where id = p_request_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'That call is not on the board.'
      using errcode = '42501';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  v_actor := public.current_profile_id();

  if v_reason is not null then
    perform set_config('app.status_override_reason', v_reason, true);
  end if;

  -- Only a trigger may set an auto rule. A direct call cannot skip the guard.
  if p_auto_rule is not null and pg_trigger_depth() > 0 then
    perform set_config('app.auto_rule', p_auto_rule, true);
  end if;

  if v_from = p_to then
    if p_bump then
      update public.service_requests
      set board_sort_bumped_at = now()
      where id = p_request_id;
    end if;
    return;
  end if;

  update public.service_requests
  set
    board_status = p_to,
    board_sort_bumped_at = case
      when p_bump then now()
      else board_sort_bumped_at
    end,
    closed_at = case
      when p_to = 'closed' then coalesce(closed_at, now())
      when v_from = 'closed' then null
      else closed_at
    end
  where id = p_request_id;

  insert into public.status_events (
    request_id, from_status, to_status, actor_id, trigger, reason
  )
  values (p_request_id, v_from, p_to, v_actor, p_trigger, v_reason);
end;
$$;

-- Replace the M1 guard so owner skips require a reason, and A2–A5 may move
-- a tech's call when the work row changed in this same transaction.
create or replace function public.guard_service_request()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor_is_owner boolean;
  assigned_to_self boolean;
  auto_rule text;
begin
  if not public.is_app_session() then
    return new;
  end if;

  actor_is_owner := public.is_owner();
  auto_rule := current_setting('app.auto_rule', true);

  if not actor_is_owner and not public.is_tech() then
    raise exception 'not an active LSP user'
      using errcode = '42501';
  end if;

  if not actor_is_owner and new.priority = 'high'
    and (tg_op = 'INSERT' or old.priority is distinct from 'high') then
    raise exception 'tech cannot elevate priority to high'
      using errcode = '42501';
  end if;

  if not actor_is_owner and tg_op = 'UPDATE' and new.priority is distinct from old.priority then
    raise exception 'tech cannot change priority'
      using errcode = '42501';
  end if;

  if not actor_is_owner and (
    (tg_op = 'INSERT' and new.deleted_at is not null)
    or (
      tg_op = 'UPDATE'
      and (
        new.deleted_at is distinct from old.deleted_at
        or new.deleted_by is distinct from old.deleted_by
      )
    )
  ) then
    raise exception 'tech cannot delete requests'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and not actor_is_owner and new.board_status <> 'new' then
    raise exception 'tech cannot set board status on create'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.board_status is distinct from old.board_status then
    if not actor_is_owner then
      assigned_to_self :=
        old.assigned_user_id = public.current_profile_id()
        or new.assigned_user_id = public.current_profile_id();
      if not internal.auto_rule_allows(old.board_status, new.board_status, auto_rule)
        and not public.tech_may_change_board_status(
          old.board_status,
          new.board_status,
          assigned_to_self
        ) then
        raise exception 'tech cannot change status except through visit work'
          using errcode = '42501';
      end if;
    else
      if not internal.auto_rule_allows(old.board_status, new.board_status, auto_rule)
        and internal.owner_status_needs_reason(old.board_status, new.board_status)
        and coalesce(current_setting('app.status_override_reason', true), '') = '' then
        raise exception 'skipping a step needs a reason'
          using errcode = '42501';
      end if;
    end if;

    if old.board_status = 'parts' and new.board_status = 'ready' then
      if not exists (
        select 1
        from public.parts_orders po
        where po.request_id = new.id
          and po.status = 'in_hand'
      ) and (
        not actor_is_owner
        or coalesce(current_setting('app.status_override_reason', true), '') = ''
      ) then
        raise exception 'parts cannot move to ready until a part is in hand'
          using errcode = '42501';
      end if;
    end if;

    if actor_is_owner
      and old.board_status = 'closed'
      and coalesce(current_setting('app.status_override_reason', true), '') = '' then
      raise exception 'reopening a closed request requires a reason'
        using errcode = '42501';
    end if;

    if not actor_is_owner and new.board_status = 'invoiced' then
      raise exception 'tech cannot approve invoices'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- A2 invoice drafted on an in-progress call → complete.
-- A3 invoice approved and sent on a complete call → invoiced.
-- A draft invoice on any other status does not move the card (intake is not a visit close).
create or replace function internal.auto_status_on_invoice()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status public.board_status;
begin
  if not public.is_app_session() then
    return new;
  end if;

  select board_status
  into v_status
  from public.service_requests
  where id = new.request_id
    and deleted_at is null;

  if v_status is null then
    return new;
  end if;

  if tg_op = 'INSERT'
    and new.status in ('draft', 'in_review')
    and v_status = 'in_progress' then
    perform internal.move_board_status(
      new.request_id, 'complete', 'invoice_drafted', null, 'A2', false
    );
  elsif tg_op = 'UPDATE'
    and new.status = 'approved_sent'
    and old.status is distinct from 'approved_sent'
    and v_status = 'complete' then
    perform internal.move_board_status(
      new.request_id, 'invoiced', 'invoice_sent', null, 'A3', false
    );
  end if;

  return new;
end;
$$;

drop trigger if exists invoice_records_auto_status on public.invoice_records;
create trigger invoice_records_auto_status
  after insert or update of status on public.invoice_records
  for each row execute function internal.auto_status_on_invoice();

-- A4 supplier or order number saved → parts.
-- A5 part marked in hand → ready, floated to the top of Ready.
create or replace function internal.auto_status_on_parts()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status public.board_status;
  v_has_order boolean;
  v_became_in_hand boolean;
begin
  if not public.is_app_session() then
    return new;
  end if;

  if new.status = 'cancelled' then
    return new;
  end if;

  v_has_order :=
    nullif(trim(coalesce(new.order_number, '')), '') is not null
    or new.supplier_id is not null
    or nullif(trim(coalesce(new.supplier_contact_text, '')), '') is not null;

  v_became_in_hand := new.status = 'in_hand'
    and (tg_op = 'INSERT' or old.status is distinct from 'in_hand');

  select board_status
  into v_status
  from public.service_requests
  where id = new.request_id
    and deleted_at is null;

  if v_status is null then
    return new;
  end if;

  if v_became_in_hand and v_status in (
    'new', 'assigned', 'ready', 'in_progress', 'to_estimate', 'estimate_out', 'parts'
  ) then
    perform internal.move_board_status(
      new.request_id, 'ready', 'part_in_hand', null, 'A5', true
    );
  elsif v_has_order and v_status in (
    'new', 'assigned', 'ready', 'in_progress', 'to_estimate', 'estimate_out'
  ) and (
    tg_op = 'INSERT'
    or old.order_number is distinct from new.order_number
    or old.supplier_id is distinct from new.supplier_id
    or old.supplier_contact_text is distinct from new.supplier_contact_text
  ) then
    perform internal.move_board_status(
      new.request_id, 'parts', 'parts_order_entered', null, 'A4', false
    );
  end if;

  return new;
end;
$$;

drop trigger if exists parts_orders_auto_status on public.parts_orders;
create trigger parts_orders_auto_status
  after insert or update of status, order_number, supplier_id, supplier_contact_text
  on public.parts_orders
  for each row execute function internal.auto_status_on_parts();

create or replace function public.create_quick_add(
  contact_id uuid,
  property_id uuid,
  unit_id uuid,
  new_unit_label text,
  issue text,
  source public.request_source,
  reported_by_resident boolean,
  link_contact boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor uuid;
  v_customer uuid;
  v_contact_customer uuid;
  v_unit uuid;
  v_label text;
  v_issue text;
  v_window integer;
  v_dup uuid;
  v_dup_issue text;
  v_dup_status public.board_status;
  v_dup_at timestamptz;
  v_id uuid;
  v_display text;
begin
  if not public.is_active_member() then
    raise exception 'not an active LSP user'
      using errcode = '42501';
  end if;

  if source = 'portal' then
    raise exception 'Portal calls are submitted by the property, not Quick Add.'
      using errcode = '42501';
  end if;

  v_issue := trim(coalesce(issue, ''));
  if v_issue = '' then
    raise exception 'Issue is required.'
      using errcode = '42501';
  end if;

  v_actor := public.current_profile_id();

  select p.customer_id
  into v_customer
  from public.properties p
  where p.id = property_id
    and p.active;

  if v_customer is null then
    raise exception 'Pick a property.'
      using errcode = '42501';
  end if;

  select c.customer_id
  into v_contact_customer
  from public.customer_contacts c
  where c.id = contact_id
    and c.active;

  if v_contact_customer is null then
    raise exception 'Pick a contact.'
      using errcode = '42501';
  end if;

  if v_contact_customer <> v_customer then
    raise exception 'That contact is not on this customer.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.contact_properties cp
    where cp.contact_id = create_quick_add.contact_id
      and cp.property_id = create_quick_add.property_id
  ) then
    if not coalesce(link_contact, false) then
      raise exception 'Link this contact to the property before saving.'
        using errcode = '42501';
    end if;
    insert into public.contact_properties (contact_id, property_id)
    values (create_quick_add.contact_id, create_quick_add.property_id)
    on conflict on constraint contact_properties_unique do nothing;
  end if;

  if unit_id is not null then
    select u.id
    into v_unit
    from public.units u
    where u.id = unit_id
      and u.property_id = create_quick_add.property_id;
    if v_unit is null then
      raise exception 'That unit is not at this property.'
        using errcode = '42501';
    end if;
  else
    v_label := trim(coalesce(new_unit_label, ''));
    if v_label = '' then
      raise exception 'Unit is required.'
        using errcode = '42501';
    end if;
    select u.id
    into v_unit
    from public.units u
    where u.property_id = create_quick_add.property_id
      and u.unit_label_norm = lower(v_label);
    if v_unit is null then
      insert into public.units (property_id, unit_label, unit_label_norm)
      values (create_quick_add.property_id, v_label, lower(v_label))
      returning id into v_unit;
    end if;
  end if;

  select repeat_unit_window_days
  into v_window
  from public.app_config
  where id = 1;
  v_window := coalesce(v_window, 14);

  select r.id, r.issue, r.board_status, r.created_at
  into v_dup, v_dup_issue, v_dup_status, v_dup_at
  from public.service_requests r
  where r.unit_id = v_unit
    and r.deleted_at is null
    and r.created_at >= now() - make_interval(days => v_window)
  order by r.created_at desc
  limit 1;

  insert into public.service_requests (
    customer_id,
    property_id,
    unit_id,
    contact_id,
    issue,
    source,
    reported_by_resident,
    board_status,
    priority,
    duplicate_of_request_id
  )
  values (
    v_customer,
    property_id,
    v_unit,
    contact_id,
    v_issue,
    source,
    coalesce(reported_by_resident, false),
    'new',
    'normal',
    v_dup
  )
  returning id, display_number into v_id, v_display;

  insert into public.status_events (
    request_id, from_status, to_status, actor_id, trigger, reason
  )
  values (v_id, null, 'new', v_actor, 'system', null);

  return jsonb_build_object(
    'id', v_id,
    'display_number', v_display,
    'duplicate_of', v_dup,
    'duplicate_issue', v_dup_issue,
    'duplicate_status', v_dup_status,
    'duplicate_created_at', v_dup_at
  );
end;
$$;

-- A1. Assigned tech taps the call in My Jobs. Moves to in progress, starts
-- travel, and queues the ETA text when the contact can receive one.
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

  if v_visit is null then
    select coalesce(max(visit_seq), 0) + 1
    into v_seq
    from public.service_visits
    where service_visits.request_id = go_en_route.request_id;

    insert into public.service_visits (
      request_id, visit_seq, tech_user_id, visit_type, status
    )
    values (request_id, v_seq, v_actor, 'service', 'en_route')
    returning id into v_visit;
  elsif v_visit_status = 'planned' then
    update public.service_visits
    set status = 'en_route'
    where id = v_visit;
  end if;

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
    'eta_minutes', eta_minutes
  );
end;
$$;

create or replace function public.assign_request(
  request_id uuid,
  tech_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status public.board_status;
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
    update public.service_visits
    set status = 'cancelled'
    where service_visits.request_id = assign_request.request_id
      and status = 'planned';

    update public.service_requests
    set assigned_user_id = null
    where id = request_id;

    if v_status = 'assigned' then
      perform internal.move_board_status(
        request_id, 'ready', 'manual', null, null, false
      );
    end if;
    return;
  end if;

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

  update public.service_visits
  set status = 'cancelled'
  where service_visits.request_id = assign_request.request_id
    and status in ('planned', 'en_route')
    and tech_user_id is distinct from tech_id;

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
end;
$$;

create or replace function public.set_board_status(
  request_id uuid,
  next_status public.board_status,
  reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status public.board_status;
  v_trigger public.status_trigger;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can change status from the board.'
      using errcode = '42501';
  end if;

  select board_status
  into v_status
  from public.service_requests
  where id = request_id
    and deleted_at is null;

  if v_status is null then
    raise exception 'That call is not on the board.'
      using errcode = '42501';
  end if;

  if v_status = next_status then
    return;
  end if;

  if internal.owner_status_needs_reason(v_status, next_status)
    and nullif(trim(coalesce(reason, '')), '') is null then
    raise exception 'skipping a step needs a reason'
      using errcode = '42501';
  end if;

  v_trigger := case
    when v_status = 'invoiced' and next_status = 'closed' then 'mark_paid'::public.status_trigger
    else 'manual'::public.status_trigger
  end;

  perform internal.move_board_status(
    request_id,
    next_status,
    v_trigger,
    reason,
    null,
    false
  );
end;
$$;

create or replace function public.set_request_priority(
  request_id uuid,
  next_priority public.request_priority
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only an owner can set High.'
      using errcode = '42501';
  end if;

  update public.service_requests
  set priority = next_priority
  where id = request_id
    and deleted_at is null;

  if not found then
    raise exception 'That call is not on the board.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.soft_delete_request(request_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor uuid;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can delete a duplicate.'
      using errcode = '42501';
  end if;

  v_actor := public.current_profile_id();

  update public.service_requests
  set deleted_at = now(), deleted_by = v_actor
  where id = request_id
    and deleted_at is null;

  if not found then
    raise exception 'That call is not on the board.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function internal.owner_status_needs_reason(public.board_status, public.board_status) from public;
revoke all on function internal.auto_rule_allows(public.board_status, public.board_status, text) from public;
revoke all on function internal.move_board_status(uuid, public.board_status, public.status_trigger, text, text, boolean) from public;
revoke all on function internal.auto_status_on_invoice() from public;
revoke all on function internal.auto_status_on_parts() from public;
revoke all on function public.create_quick_add(uuid, uuid, uuid, text, text, public.request_source, boolean, boolean) from public;
revoke all on function public.go_en_route(uuid, integer) from public;
revoke all on function public.assign_request(uuid, uuid) from public;
revoke all on function public.set_board_status(uuid, public.board_status, text) from public;
revoke all on function public.set_request_priority(uuid, public.request_priority) from public;
revoke all on function public.soft_delete_request(uuid) from public;

grant execute on function internal.owner_status_needs_reason(public.board_status, public.board_status) to authenticated, service_role;
grant execute on function internal.auto_rule_allows(public.board_status, public.board_status, text) to authenticated, service_role;
grant execute on function internal.move_board_status(uuid, public.board_status, public.status_trigger, text, text, boolean) to authenticated, service_role;
grant execute on function internal.auto_status_on_invoice() to authenticated, service_role;
grant execute on function internal.auto_status_on_parts() to authenticated, service_role;
grant execute on function public.create_quick_add(uuid, uuid, uuid, text, text, public.request_source, boolean, boolean) to authenticated, service_role;
grant execute on function public.go_en_route(uuid, integer) to authenticated, service_role;
grant execute on function public.assign_request(uuid, uuid) to authenticated, service_role;
grant execute on function public.set_board_status(uuid, public.board_status, text) to authenticated, service_role;
grant execute on function public.set_request_priority(uuid, public.request_priority) to authenticated, service_role;
grant execute on function public.soft_delete_request(uuid) to authenticated, service_role;
