-- On the way is a work event (A1), including when the assigned person is an owner.
-- The owner status switch still requires a reason for Assigned or Ready → In Progress.
-- That reason check was rejecting go_en_route for an owner on their own call
-- with "skipping a step needs a reason." Location is unrelated: a null ETA is already allowed.

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
    else false
  end
$$;

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

  -- Set only here, after the assignment check. The status switch does not set it,
  -- so an owner skip from the status sheet still needs a reason.
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
