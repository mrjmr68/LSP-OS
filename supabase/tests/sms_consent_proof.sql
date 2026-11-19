-- Proves the SMS consent rules: signed-out people can record consent
-- but cannot read anyone's; techs cannot read; owners can.
-- Every mutation rolls back.
\set ON_ERROR_STOP on

begin;

set local role anon;

select public.record_sms_consent(
  'Pat Manager', '+13365550123', 'Abbey Crossing',
  'Yes, text me service updates from Legend Service Pros LLC. Reply STOP to opt out.',
  '2026-11-19'
);

do $anon$
declare
  n integer;
begin
  begin
    select count(*) into n from public.sms_consents;
    raise exception 'FAIL: anon read sms_consents';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.sms_consents (full_name, mobile_e164, consent_text, consent_version)
    values ('x', '+13365550199', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'v');
    raise exception 'FAIL: anon inserted directly into sms_consents';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.record_sms_consent('Pat', '336-555-0123', null,
      'Yes, text me service updates from Legend Service Pros LLC.', 'v');
    raise exception 'FAIL: an unformatted number was accepted';
  exception when invalid_parameter_value then
    null;
  end;
end;
$anon$;

reset role;

do $check$
declare
  n integer;
begin
  select count(*) into n from public.sms_consents
  where mobile_e164 = '+13365550123' and property_name = 'Abbey Crossing';
  if n <> 1 then
    raise exception 'FAIL: consent row not recorded (found %)', n;
  end if;
end;
$check$;

-- A tech cannot read consent records.
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $tech$
declare
  n integer;
begin
  select count(*) into n from public.sms_consents;
  if n <> 0 then
    raise exception 'FAIL: a tech can read % consent records', n;
  end if;
end;
$tech$;

-- An owner can.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $owner$
declare
  n integer;
begin
  select count(*) into n from public.sms_consents;
  if n <> 1 then
    raise exception 'FAIL: owner should read 1 consent record, got %', n;
  end if;
end;
$owner$;

rollback;
