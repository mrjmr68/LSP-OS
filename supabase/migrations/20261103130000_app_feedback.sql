-- Crew notes from the Board: bugs, observations, and suggestions.
-- A signed-in owner or tech inserts their own row. Owners can read every row.
-- The person who wrote it can read their own. Email is optional and stamped later.
-- Helpers live in schema internal so PostgREST does not expose them.

create schema if not exists internal;

revoke all on schema internal from public;
grant usage on schema internal to authenticated, service_role;

create type public.feedback_kind as enum ('bug', 'observation', 'suggestion');

create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  kind public.feedback_kind not null,
  body text not null,
  context jsonb,
  email_sent_at timestamptz,
  constraint app_feedback_body_not_blank check (length(trim(body)) > 0),
  constraint app_feedback_body_length check (length(body) <= 4000),
  constraint app_feedback_context_size check (
    context is null or octet_length(context::text) <= 4000
  )
);

comment on table public.app_feedback is
  'Board notes from the crew. Saved even when email is not configured. Owners review them.';

comment on column public.app_feedback.context is
  'Read-only Board snapshot: path, filter, request_id, display_number, user_agent.';

comment on column public.app_feedback.email_sent_at is
  'Set after Resend accepts the notice. Null means the row was saved and no email went out.';

create or replace function public.guard_app_feedback()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_app_session() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'feedback cannot be deleted from the app'
      using errcode = '42501';
  end if;

  if not public.is_active_member() then
    raise exception 'not an active LSP user'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.created_by is distinct from public.current_profile_id() then
      raise exception 'feedback must be your own'
        using errcode = '42501';
    end if;
    if new.email_sent_at is not null then
      raise exception 'email status is set after send'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'feedback cannot be edited from the app'
    using errcode = '42501';
end;
$$;

create trigger app_feedback_guard_write
  before insert or update or delete on public.app_feedback
  for each row execute function public.guard_app_feedback();

alter table public.app_feedback enable row level security;

create policy app_feedback_insert_self on public.app_feedback
  for insert to authenticated
  with check (
    created_by = public.current_profile_id()
    and public.is_active_member()
  );

create policy app_feedback_select_own_or_owner on public.app_feedback
  for select to authenticated
  using (
    public.is_owner()
    or created_by = public.current_profile_id()
  );

-- The mail stamp runs as the function owner so it can set email_sent_at
-- without an app-user update policy. It only touches the caller's own row.
create or replace function internal.mark_app_feedback_emailed(feedback_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_member() then
    raise exception 'not an active LSP user'
      using errcode = '42501';
  end if;

  update public.app_feedback
  set email_sent_at = now()
  where id = feedback_id
    and created_by = public.current_profile_id()
    and email_sent_at is null;

  if not found then
    raise exception 'That note is not yours.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.mark_app_feedback_emailed(feedback_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform internal.mark_app_feedback_emailed(feedback_id);
end;
$$;

revoke all on function public.guard_app_feedback() from public;
revoke all on function internal.mark_app_feedback_emailed(uuid) from public;
revoke all on function public.mark_app_feedback_emailed(uuid) from public;

grant execute on function public.guard_app_feedback() to authenticated, service_role;
grant execute on function internal.mark_app_feedback_emailed(uuid) to authenticated, service_role;
grant execute on function public.mark_app_feedback_emailed(uuid) to authenticated, service_role;
