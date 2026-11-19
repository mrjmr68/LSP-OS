-- SMS consent record for the Twilio A2P campaign.
-- Anyone (signed out) may record consent through record_sms_consent();
-- nobody reads the table except owners. Each row keeps the exact wording
-- the person agreed to, so the record still proves consent if the wording
-- changes later.

create table public.sms_consents (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  mobile_e164 text not null check (mobile_e164 ~ '^\+1[2-9][0-9]{9}$'),
  property_name text check (property_name is null or length(property_name) <= 120),
  consent_text text not null,
  consent_version text not null,
  source text not null default 'text_updates_page',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index sms_consents_mobile_idx on public.sms_consents (mobile_e164);

alter table public.sms_consents enable row level security;

create policy sms_consents_owner_read on public.sms_consents
  for select to authenticated
  using (public.is_owner());

create policy sms_consents_owner_update on public.sms_consents
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

revoke all on public.sms_consents from anon;
revoke insert, delete on public.sms_consents from authenticated;

create or replace function public.record_sms_consent(
  p_full_name text,
  p_mobile_e164 text,
  p_property_name text,
  p_consent_text text,
  p_consent_version text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_full_name is null or length(btrim(p_full_name)) = 0 then
    raise exception 'name is required' using errcode = '22023';
  end if;
  if p_mobile_e164 is null or p_mobile_e164 !~ '^\+1[2-9][0-9]{9}$' then
    raise exception 'a US mobile number is required' using errcode = '22023';
  end if;
  if p_consent_text is null or length(p_consent_text) < 40 then
    raise exception 'consent wording is required' using errcode = '22023';
  end if;

  insert into public.sms_consents
    (full_name, mobile_e164, property_name, consent_text, consent_version)
  values (
    btrim(p_full_name),
    p_mobile_e164,
    nullif(btrim(coalesce(p_property_name, '')), ''),
    p_consent_text,
    coalesce(nullif(btrim(p_consent_version), ''), 'unknown')
  );
end;
$$;

revoke all on function public.record_sms_consent(text, text, text, text, text) from public;
grant execute on function public.record_sms_consent(text, text, text, text, text) to anon, authenticated;
