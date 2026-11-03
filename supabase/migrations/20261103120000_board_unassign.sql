-- Context-aware unassign. First pass, editable later.
-- Owner only, same as before. assign_request(request_id, null) still means unassign.
--
-- Always:
--   clear service_requests.assigned_user_id
--   cancel active visits (planned, en_route, on_site, working)
--   end any open time segment on those visits (end_source owner_edit)
--   leave closed, attempt, and already-cancelled visits as they are
--
-- Status, only when it changes, goes through internal.move_board_status
-- so a StatusEvent is written. Reason is "Unassigned" on that event.
--
--   assigned, and no visit is past planned
--     (only planned, cancelled, or none)          → new
--   assigned, and a visit is past planned
--     (en_route, on_site, working, closed, attempt) → ready
--   in_progress                                   → ready
--     (a call must not stay In Progress with no tech;
--      on_site and working visits are cancelled, not closed,
--      so unassign does not look like a finished visit)
--   ready                                         → ready
--   new, to_estimate, estimate_out, parts,
--   complete, invoiced, closed                    → unchanged
--
-- Returns the board_status after the call, including a normal assign.

drop function if exists public.assign_request(uuid, uuid);

create function public.assign_request(
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

    update public.service_visits
    set status = 'cancelled'
    where service_visits.request_id = assign_request.request_id
      and status in ('planned', 'en_route', 'on_site', 'working');

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
  end if;

  select r.board_status
  into v_status
  from public.service_requests r
  where r.id = assign_request.request_id;

  return v_status;
end;
$$;

revoke all on function public.assign_request(uuid, uuid) from public;
grant execute on function public.assign_request(uuid, uuid) to authenticated, service_role;

comment on function public.assign_request(uuid, uuid) is
  'Owner assign or unassign. Unassign clears the tech, cancels active visits, and moves status: fresh Assigned returns to New; a call whose visit got past planned, or that is In Progress, returns to Ready. Other statuses keep their column.';
