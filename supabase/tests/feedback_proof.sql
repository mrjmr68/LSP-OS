-- Proves crew feedback: a person inserts their own note, reads their own,
-- and cannot read or stamp someone else's. An owner reads all of them.
-- Runs after supabase/tests/rls_proof.sql. Every mutation rolls back.
\set ON_ERROR_STOP on

begin;
set local role anon;

do $anon$
begin
  insert into public.app_feedback (created_by, kind, body)
  values ('11111111-1111-4111-8111-111111111111', 'bug', 'Anon should not save this.');
  raise exception 'FAIL: anon inserted feedback';
exception
  when others then
    if sqlerrm like 'FAIL:%' then
      raise;
    end if;
end
$anon$;

rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $proof$
declare
  tech_id uuid;
  owner_id uuid;
  tech_note uuid;
  owner_note uuid;
  seen integer;
  n integer;
  stamped timestamptz;
begin
  select id into tech_id
  from public.profiles
  where auth_user_id = '22222222-2222-4222-8222-222222222222';

  select id into owner_id
  from public.profiles
  where auth_user_id = '11111111-1111-4111-8111-111111111111';

  if tech_id is null or owner_id is null then
    raise exception 'FAIL: proof profiles are missing';
  end if;

  begin
    insert into public.app_feedback (created_by, kind, body)
    values (tech_id, 'bug', '   ');
    raise exception 'FAIL: blank feedback was saved';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
  end;

  begin
    insert into public.app_feedback (created_by, kind, body)
    values (owner_id, 'bug', 'This should stay the owner''s.');
    raise exception 'FAIL: tech inserted feedback as the owner';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if sqlerrm not like '%feedback must be your own%'
        and sqlerrm not like '%row-level security%' then
        raise exception 'FAIL: unexpected spoof error: %', sqlerrm;
      end if;
  end;

  insert into public.app_feedback (created_by, kind, body, context)
  values (
    tech_id,
    'observation',
    'The assign sheet is hard to tap.',
    '{"path":"/board","filter":"mine"}'::jsonb
  )
  returning id into tech_note;

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

  insert into public.app_feedback (created_by, kind, body)
  values (owner_id, 'suggestion', 'Add a bigger close button.')
  returning id into owner_note;

  select count(*) into seen
  from public.app_feedback
  where id in (tech_note, owner_note);
  if seen <> 2 then
    raise exception 'FAIL: owner should see both notes, saw %', seen;
  end if;

  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

  select count(*) into seen from public.app_feedback where id = tech_note;
  if seen <> 1 then
    raise exception 'FAIL: tech should see their own note';
  end if;

  select count(*) into seen from public.app_feedback where id = owner_note;
  if seen <> 0 then
    raise exception 'FAIL: tech can read the owner note';
  end if;

  begin
    update public.app_feedback
    set body = 'Changed after save.'
    where id = tech_note;
    get diagnostics n = row_count;
    if n <> 0 then
      raise exception 'FAIL: tech edited a saved note (% rows)', n;
    end if;
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if sqlerrm not like '%feedback cannot be edited%'
        and sqlerrm not like '%row-level security%' then
        raise exception 'FAIL: unexpected edit error: %', sqlerrm;
      end if;
  end;

  if (select body from public.app_feedback where id = tech_note) is distinct from
    'The assign sheet is hard to tap.' then
    raise exception 'FAIL: saved note text changed';
  end if;

  perform public.mark_app_feedback_emailed(tech_note);
  select email_sent_at into stamped from public.app_feedback where id = tech_note;
  if stamped is null then
    raise exception 'FAIL: own note did not record the sent time';
  end if;

  begin
    perform public.mark_app_feedback_emailed(owner_note);
    raise exception 'FAIL: tech stamped the owner note';
  exception
    when others then
      if sqlerrm like 'FAIL:%' then
        raise;
      end if;
      if sqlerrm not like '%That note is not yours%' then
        raise exception 'FAIL: unexpected stamp error: %', sqlerrm;
      end if;
  end;

  raise notice 'PASS: feedback insert, read, and email stamp';
end
$proof$;

rollback;
