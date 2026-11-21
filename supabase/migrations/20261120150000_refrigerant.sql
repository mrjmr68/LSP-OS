-- Refrigerant added on the visit (Matt, Nov 20).
--
-- The tech enters the refrigerant type and pounds added on the Readings tab.
-- Those pounds are the rule: when the visit closes, the invoice's refrigerant
-- cost line becomes pounds × the price book's cost per pound, and the repair
-- price moves with it, dollar for dollar (profit stays). An approved estimate
-- holds its price instead (profit takes the difference). The owner can correct
-- the type and pounds on the invoice before approving. With no repair that
-- carries refrigerant, the pounds are recorded and printed but not priced.

alter table public.invoice_records
  add column refrigerant_type text,
  add column refrigerant_lbs numeric(6, 2),
  add constraint invoice_records_refrigerant_lbs_range check (refrigerant_lbs is null or refrigerant_lbs between 0 and 200);

-- Puts the invoice's pounds on its refrigerant cost lines. Safe to run again.
create or replace function internal.apply_refrigerant(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoice_records;
  v_first record;
  v_other record;
  v_rate integer;
  v_new integer;
  v_delta integer;
begin
  select * into v_inv from public.invoice_records where id = p_invoice_id;
  if v_inv.id is null or v_inv.refrigerant_lbs is null then
    return;
  end if;

  -- The first refrigerant line, in invoice order, carries all the pounds.
  select c.id, c.amount_cents, c.removed, l.id as line_id, s.bundle_id, s.estimate_line_id
  into v_first
  from public.invoice_cost_lines c
  join public.invoice_lines l on l.id = c.invoice_line_id
  left join public.visit_bundle_selections s on s.id = l.visit_selection_id
  where c.invoice_id = p_invoice_id and c.kind = 'refrigerant'
  order by l.sort, c.sort
  limit 1;
  if v_first.id is null then
    return;
  end if;

  select round(bl.unit_cost_cents)::integer into v_rate
  from public.bundle_lines bl
  where bl.bundle_id = v_first.bundle_id and bl.kind = 'refrigerant'
  limit 1;
  v_rate := coalesce(v_rate, 1500);

  v_new := round(v_inv.refrigerant_lbs * v_rate)::integer;
  v_delta := v_new - case when v_first.removed then 0 else v_first.amount_cents end;
  update public.invoice_cost_lines
  set amount_cents = v_new,
      removed = false,
      label = 'Refrigerant' || coalesce(' ' || nullif(trim(v_inv.refrigerant_type), ''), '')
        || ' · ' || trim_scale(v_inv.refrigerant_lbs) || ' lb'
  where id = v_first.id;
  if v_first.estimate_line_id is not null then
    update public.invoice_cost_lines set amount_cents = amount_cents - v_delta
    where invoice_line_id = v_first.line_id and kind = 'profit';
  end if;

  -- Refrigerant on any other repair is already counted above.
  for v_other in
    select c.id, c.amount_cents, l.id as line_id, s.estimate_line_id
    from public.invoice_cost_lines c
    join public.invoice_lines l on l.id = c.invoice_line_id
    left join public.visit_bundle_selections s on s.id = l.visit_selection_id
    where c.invoice_id = p_invoice_id and c.kind = 'refrigerant' and c.id <> v_first.id and not c.removed
  loop
    update public.invoice_cost_lines set removed = true where id = v_other.id;
    if v_other.estimate_line_id is not null then
      update public.invoice_cost_lines set amount_cents = amount_cents + v_other.amount_cents
      where invoice_line_id = v_other.line_id and kind = 'profit';
    end if;
  end loop;

  perform internal.recompute_invoice(p_invoice_id);
end;
$$;

-- When a visit closes with refrigerant on its readings, its new draft invoice takes the pounds.
create or replace function internal.visit_refrigerant_to_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lbs_text text := trim(coalesce(new.readings ->> 'refrigerantLbs', ''));
  v_type text := nullif(trim(coalesce(new.readings ->> 'refrigerantType', '')), '');
  v_invoice uuid;
begin
  if new.status <> 'closed' or old.status = 'closed' or v_lbs_text !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' then
    return new;
  end if;
  if v_lbs_text::numeric > 200 then
    return new;
  end if;
  select i.id into v_invoice
  from public.invoice_records i
  where i.request_id = new.request_id and i.status = 'draft' and i.refrigerant_lbs is null;
  if v_invoice is null then
    return new;
  end if;
  update public.invoice_records
  set refrigerant_lbs = v_lbs_text::numeric, refrigerant_type = v_type
  where id = v_invoice;
  perform internal.apply_refrigerant(v_invoice);
  return new;
end;
$$;

create trigger service_visits_refrigerant_to_invoice
  after update of status on public.service_visits
  for each row execute function internal.visit_refrigerant_to_invoice();

-- The owner corrects the type or pounds before approving. owner_draft checks the owner.
create or replace function public.set_invoice_refrigerant(invoice_id uuid, refrigerant_type text, lbs numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoice_records;
begin
  v_inv := internal.owner_draft(set_invoice_refrigerant.invoice_id);
  if lbs is null or lbs < 0 or lbs > 200 then
    raise exception 'Enter the pounds added (0 to 200).' using errcode = '22023';
  end if;
  update public.invoice_records
  set refrigerant_lbs = round(lbs, 2),
      refrigerant_type = nullif(trim(coalesce(set_invoice_refrigerant.refrigerant_type, '')), '')
  where id = v_inv.id;
  perform internal.apply_refrigerant(v_inv.id);
end;
$$;

revoke all on function internal.apply_refrigerant(uuid) from public, anon, authenticated;
revoke all on function internal.visit_refrigerant_to_invoice() from public, anon, authenticated;
revoke all on function public.set_invoice_refrigerant(uuid, text, numeric) from public, anon;
grant execute on function public.set_invoice_refrigerant(uuid, text, numeric) to authenticated;
