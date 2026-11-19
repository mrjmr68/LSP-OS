-- Setup screens: suppliers can be retired, owners can unlink a contact
-- from a property, the business always keeps one active owner, and a new
-- customer is created together with its billing contact.

alter table public.suppliers
  add column active boolean not null default true;

create policy contact_properties_delete_owner on public.contact_properties
  for delete to authenticated
  using (public.is_owner());

-- Never leave the business without an active owner (no one could reach Setup).
create or replace function public.keep_an_active_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.role = 'owner' and old.active
     and (new.role <> 'owner' or not new.active)
     and not exists (
       select 1 from public.profiles p
       where p.id <> old.id and p.role = 'owner' and p.active
     )
  then
    raise exception 'keep at least one active owner'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger profiles_keep_an_active_owner
  before update on public.profiles
  for each row execute function public.keep_an_active_owner();

-- Customer and its first (billing) contact in one step. Invoker rights:
-- RLS still decides (owners only, through customers_write_owner).
create or replace function public.create_customer(
  p_name text,
  p_payment_terms_days integer,
  p_contact_name text,
  p_contact_title text,
  p_contact_phone text,
  p_contact_email text
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_customer uuid := gen_random_uuid();
  v_contact uuid := gen_random_uuid();
begin
  if not public.is_owner() then
    raise exception 'only owners can add customers' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'customer name is required' using errcode = '22023';
  end if;
  if p_contact_name is null or length(btrim(p_contact_name)) = 0 then
    raise exception 'billing contact name is required' using errcode = '22023';
  end if;

  insert into public.customers (
    id, name, billing_contact_id, payment_terms_days,
    addon_approval_mode, signoff_requirement, resident_report_mode
  ) values (
    v_customer, btrim(p_name), v_contact, coalesce(p_payment_terms_days, 30),
    'call_first', 'none', 'confirm_with_property'
  );

  insert into public.customer_contacts (id, customer_id, name, title, phone, email)
  values (
    v_contact, v_customer, btrim(p_contact_name),
    nullif(btrim(coalesce(p_contact_title, '')), ''),
    nullif(btrim(coalesce(p_contact_phone, '')), ''),
    nullif(btrim(coalesce(p_contact_email, '')), '')
  );

  return v_customer;
end;
$$;

revoke all on function public.create_customer(text, integer, text, text, text, text) from public;
grant execute on function public.create_customer(text, integer, text, text, text, text) to authenticated;
