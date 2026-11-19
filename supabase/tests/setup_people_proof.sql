-- Proves the Setup people rules. Uses owner 1111…, tech 2222…, property
-- 5555… from rls_proof.sql. Every mutation rolls back.
\set ON_ERROR_STOP on

-- Suppliers start active; a tech cannot retire one, an owner can.
begin;
insert into public.suppliers (id, name) values ('99999999-9999-4999-8999-999999999999', 'Proof Supply');

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $tech$
declare n integer;
begin
  update public.suppliers set active = false where id = '99999999-9999-4999-8999-999999999999';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a tech retired a supplier'; end if;
end;
$tech$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $owner$
declare n integer;
begin
  update public.suppliers set active = false where id = '99999999-9999-4999-8999-999999999999';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: owner could not retire a supplier'; end if;
end;
$owner$;
rollback;

-- Only owners can unlink a contact from a property.
begin;
insert into public.contact_properties (contact_id, property_id)
values ('44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555')
on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $tech$
declare n integer;
begin
  delete from public.contact_properties where property_id = '55555555-5555-4555-8555-555555555555';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a tech unlinked a contact'; end if;
end;
$tech$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $owner$
declare n integer;
begin
  delete from public.contact_properties where property_id = '55555555-5555-4555-8555-555555555555';
  get diagnostics n = row_count;
  if n < 1 then raise exception 'FAIL: owner could not unlink a contact'; end if;
end;
$owner$;
rollback;

-- The last active owner cannot be demoted or deactivated.
begin;
do $last$
begin
  update public.profiles set role = 'tech' where auth_user_id = '11111111-1111-4111-8111-111111111111';
  raise exception 'FAIL: the last owner was demoted';
exception when check_violation then
  null;
end;
$last$;

do $last2$
begin
  update public.profiles set active = false where auth_user_id = '11111111-1111-4111-8111-111111111111';
  raise exception 'FAIL: the last owner was deactivated';
exception when check_violation then
  null;
end;
$last2$;

-- With a second owner, the first can step down.
update public.profiles set role = 'owner' where auth_user_id = '22222222-2222-4222-8222-222222222222';
update public.profiles set role = 'tech' where auth_user_id = '11111111-1111-4111-8111-111111111111';
rollback;

-- create_customer: owners only; makes customer + billing contact together.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $tech$
begin
  perform public.create_customer('Tech Co', 30, 'Pat', null, null, null);
  raise exception 'FAIL: a tech added a customer';
exception when insufficient_privilege then
  null;
end;
$tech$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $owner$
declare
  v uuid;
  contact_name text;
begin
  v := public.create_customer('Proof Apartments', 15, 'Robin Billing', 'Manager', '336-555-0100', null);
  select cc.name into contact_name
  from public.customers c join public.customer_contacts cc on cc.id = c.billing_contact_id
  where c.id = v and cc.customer_id = v;
  if contact_name is distinct from 'Robin Billing' then
    raise exception 'FAIL: create_customer did not link the billing contact';
  end if;
end;
$owner$;
rollback;
