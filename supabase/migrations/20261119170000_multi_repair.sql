-- Several repairs on one visit (Nov 18 design: "A visit can carry
-- multiple repairs"). select_visit_bundle replaces the pick; these two
-- add to it and take one off. close_visit already invoices every
-- selection, with internal cost and profit kept for owner review.

create or replace function public.add_visit_bundle(
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
  v_visit public.service_visits;
  v_keep public.visit_bundle_selections[];
  v_result jsonb;
begin
  v_visit := internal.visit_for_call(add_visit_bundle.request_id);

  if v_visit.id is not null and exists (
    select 1 from public.visit_bundle_selections s
    where s.visit_id = v_visit.id and s.bundle_id = add_visit_bundle.bundle_id
  ) then
    return internal.visit_result(add_visit_bundle.request_id, 'That repair is already on this visit.');
  end if;

  select coalesce(array_agg(s order by s.created_at), '{}')
  into v_keep
  from public.visit_bundle_selections s
  where s.visit_id = v_visit.id;

  -- Same checks, snapshot and price as a single pick; it clears the list, so put the rest back.
  v_result := public.select_visit_bundle(add_visit_bundle.request_id, add_visit_bundle.bundle_id, seen_at);
  if coalesce((v_result ->> 'conflict')::boolean, false) then
    return v_result;
  end if;

  insert into public.visit_bundle_selections
  select * from unnest(v_keep)
  on conflict (id) do nothing;

  return v_result;
end;
$$;

create or replace function public.remove_visit_bundle(
  request_id uuid,
  selection_id uuid,
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
  v_req := internal.lock_call(remove_visit_bundle.request_id);
  if v_req.assigned_user_id is distinct from public.current_profile_id() then
    raise exception 'Only the assigned tech can do that on this call.'
      using errcode = '42501';
  end if;

  v_visit := internal.visit_for_call(remove_visit_bundle.request_id);
  if v_visit.id is null or v_visit.status <> 'working' then
    raise exception 'That visit is not open.'
      using errcode = '42501';
  end if;

  if internal.board_overridden(remove_visit_bundle.request_id, seen_at) then
    perform internal.flag_offline_conflict(v_visit.id);
    return internal.conflict_result(remove_visit_bundle.request_id);
  end if;

  delete from public.visit_bundle_selections s
  where s.id = remove_visit_bundle.selection_id
    and s.visit_id = v_visit.id;

  -- A part-needing repair set the path to parts; drop that if none remain.
  if v_visit.outcome_path = 'parts' and not exists (
    select 1
    from public.visit_bundle_selections s
    join public.bundles b on b.id = s.bundle_id
    where s.visit_id = v_visit.id and b.one_shot
  ) then
    update public.service_visits set outcome_path = null where id = v_visit.id;
  end if;

  return internal.visit_result(remove_visit_bundle.request_id, 'Repair removed.');
end;
$$;

revoke all on function public.add_visit_bundle(uuid, uuid, timestamptz) from public, anon;
revoke all on function public.remove_visit_bundle(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.add_visit_bundle(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.remove_visit_bundle(uuid, uuid, timestamptz) to authenticated;
