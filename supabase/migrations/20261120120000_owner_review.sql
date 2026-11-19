-- Stage 3: owner review of draft invoices (Build Brief screens 11 and 12).
--
-- Every repair on a draft carries its cost lines (labor, parts, materials,
-- refrigerant..., then profit) copied from the price snapshot taken when the
-- tech picked it. The owner removes, puts back or edits lines; the repair's
-- amount is the sum of the lines still in. The property only ever sees the
-- repair wording and its amount.
--
-- Approve numbers the invoice, bills the customer's billing contact, stamps
-- the date and terms and marks it sent; the existing A3 rule moves the job
-- from Complete to Invoiced. The app then emails the PDF.
--
-- A question to the tech marks the draft flagged, queues a text, and shows on
-- the tech's My Jobs; the job stays in Complete.

-- ---------------------------------------------------------------------------
-- Cost lines.
-- ---------------------------------------------------------------------------

create type public.cost_line_kind as enum (
  'labor',
  'part',
  'equipment',
  'material',
  'consumable',
  'refrigerant',
  'profit'
);

create table public.invoice_cost_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoice_records (id) on delete cascade,
  invoice_line_id uuid not null references public.invoice_lines (id) on delete cascade,
  sort integer not null,
  kind public.cost_line_kind not null,
  label text not null,
  amount_cents integer not null,
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_cost_lines_sort_unique unique (invoice_line_id, sort),
  constraint invoice_cost_lines_label_not_blank check (length(trim(label)) > 0),
  constraint invoice_cost_lines_cost_nonnegative check (kind = 'profit' or amount_cents >= 0)
);

comment on table public.invoice_cost_lines is
  'Owner-only breakdown of each repair on an invoice. The line amount is the sum of the rows not removed.';

create index invoice_cost_lines_invoice_idx on public.invoice_cost_lines (invoice_id);

create trigger invoice_cost_lines_set_updated_at
  before update on public.invoice_cost_lines
  for each row execute function public.set_updated_at();

alter table public.invoice_cost_lines enable row level security;

create policy invoice_cost_lines_select_member on public.invoice_cost_lines
  for select to authenticated
  using (public.is_active_member());

create policy invoice_cost_lines_write_owner on public.invoice_cost_lines
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Owners may take a line off a draft (the functions below allow it only on drafts).
create policy invoice_lines_delete_owner on public.invoice_lines
  for delete to authenticated
  using (public.is_owner());

-- Question and answer on a draft; next invoice number.
alter table public.invoice_records
  add column flag_asked_at timestamptz,
  add column flag_asked_by uuid references public.profiles (id),
  add column flag_answer text,
  add column flag_answered_at timestamptz;

alter table public.app_config
  add column next_invoice_number integer not null default 1001,
  add constraint app_config_next_invoice_positive check (next_invoice_number > 0);

comment on column public.app_config.next_invoice_number is
  'The number the next approved invoice gets. Set it to continue from QuickBooks.';

-- Search words for a repair, so "no issue" finds SYS - MIN - None (Matt, Nov 19).
alter table public.bundles add column search_terms text;

update public.bundles
set search_terms = 'no issue found, nothing wrong, no problem found, working as designed'
where code = 'SYS - MIN - None';

-- ---------------------------------------------------------------------------
-- Building the cost lines from the repair's price snapshot.
-- ---------------------------------------------------------------------------

create or replace function internal.build_invoice_cost_lines(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.invoice_lines;
  v_sel public.visit_bundle_selections;
  v_sort integer := 0;
  v_sum integer := 0;
  v_amount integer;
  v_qty numeric;
  v_label text;
  v_item record;
begin
  select * into v_line from public.invoice_lines where id = p_line_id;
  if v_line.id is null or v_line.visit_selection_id is null then
    return;
  end if;
  if exists (select 1 from public.invoice_cost_lines where invoice_line_id = p_line_id) then
    return;
  end if;

  select * into v_sel from public.visit_bundle_selections where id = v_line.visit_selection_id;
  if v_sel.id is null then
    return;
  end if;

  -- Labor first, then the rest in price-book order.
  for v_item in
    select e.value as item, e.ordinality as n
    from jsonb_array_elements(coalesce(v_sel.cost_lines_snap, '[]'::jsonb)) with ordinality as e
    order by (e.value ->> 'kind') <> 'labor', e.ordinality
  loop
    v_qty := coalesce((v_item.item ->> 'qty')::numeric, 1);
    v_amount := round(v_qty * coalesce((v_item.item ->> 'unit_cost_cents')::numeric, 0))::integer * v_sel.qty;
    if (v_item.item ->> 'kind') = 'labor' then
      v_label := 'Labor ' || trim_scale(v_qty * v_sel.qty) || ' hr';
    else
      v_label := coalesce(nullif(trim(v_item.item ->> 'description'), ''), initcap(v_item.item ->> 'kind'));
      if v_qty * v_sel.qty <> 1 then
        v_label := v_label || ' × ' || trim_scale(v_qty * v_sel.qty);
      end if;
    end if;
    if (v_item.item ->> 'kind') not in ('labor', 'part', 'equipment', 'material', 'consumable', 'refrigerant') then
      continue;
    end if;
    v_sort := v_sort + 1;
    insert into public.invoice_cost_lines (invoice_id, invoice_line_id, sort, kind, label, amount_cents)
    values (v_line.invoice_id, v_line.id, v_sort, (v_item.item ->> 'kind')::public.cost_line_kind, v_label, v_amount);
    v_sum := v_sum + v_amount;
  end loop;

  -- Profit is whatever is left, so the lines always add up to the repair price.
  insert into public.invoice_cost_lines (invoice_id, invoice_line_id, sort, kind, label, amount_cents)
  values (v_line.invoice_id, v_line.id, v_sort + 1, 'profit', 'Profit', v_line.amount_cents - v_sum);
end;
$$;

create or replace function internal.invoice_line_cost_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform internal.build_invoice_cost_lines(new.id);
  return new;
end;
$$;

create trigger invoice_lines_build_cost_lines
  after insert on public.invoice_lines
  for each row execute function internal.invoice_line_cost_lines();

-- The drafts already in the database get theirs now.
do $backfill$
declare
  v_id uuid;
begin
  for v_id in
    select l.id
    from public.invoice_lines l
    join public.invoice_records i on i.id = l.invoice_id
    where i.status in ('draft', 'in_review', 'flagged')
  loop
    perform internal.build_invoice_cost_lines(v_id);
  end loop;
end;
$backfill$;

-- ---------------------------------------------------------------------------
-- Owner helpers.
-- ---------------------------------------------------------------------------

-- Lock a draft for an owner edit. Anything already approved is final.
create or replace function internal.owner_draft(p_invoice_id uuid)
returns public.invoice_records
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv public.invoice_records;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can change an invoice.'
      using errcode = '42501';
  end if;
  select * into v_inv from public.invoice_records where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'That invoice is gone. Go back to Review.'
      using errcode = '42501';
  end if;
  if v_inv.status not in ('draft', 'in_review', 'flagged') then
    raise exception 'That invoice was already approved.'
      using errcode = '42501';
  end if;
  return v_inv;
end;
$$;

-- Repair amounts from their cost lines, then the invoice totals.
create or replace function internal.recompute_invoice(p_invoice_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_subtotal integer;
  v_bps integer;
  v_tax integer;
begin
  update public.invoice_lines l
  set
    amount_cents = c.amount,
    internal_cost_cents = c.cost,
    internal_profit_cents = c.profit
  from (
    select
      invoice_line_id,
      coalesce(sum(amount_cents) filter (where not removed), 0)::integer as amount,
      coalesce(sum(amount_cents) filter (where not removed and kind <> 'profit'), 0)::integer as cost,
      coalesce(sum(amount_cents) filter (where not removed and kind = 'profit'), 0)::integer as profit
    from public.invoice_cost_lines
    where invoice_id = p_invoice_id
    group by invoice_line_id
  ) c
  where l.id = c.invoice_line_id
    and (l.amount_cents, l.internal_cost_cents, l.internal_profit_cents)
      is distinct from (c.amount, c.cost, c.profit);

  select coalesce(sum(amount_cents), 0)::integer into v_subtotal
  from public.invoice_lines where invoice_id = p_invoice_id;
  select tax_rate_bps_snap into v_bps from public.invoice_records where id = p_invoice_id;
  v_tax := case when v_subtotal > 0 then ((v_subtotal * v_bps) + 5000) / 10000 else 0 end;

  update public.invoice_records
  set subtotal_cents = v_subtotal, tax_cents = v_tax, total_cents = v_subtotal + v_tax
  where id = p_invoice_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner actions on a draft.
-- ---------------------------------------------------------------------------

-- Remove or put back a cost line, or change its amount.
create or replace function public.set_invoice_cost_line(
  cost_line_id uuid,
  removed boolean default null,
  amount_cents integer default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cost public.invoice_cost_lines;
begin
  select * into v_cost from public.invoice_cost_lines c where c.id = set_invoice_cost_line.cost_line_id;
  if v_cost.id is null then
    raise exception 'That line is gone. Reload the invoice.'
      using errcode = '42501';
  end if;
  perform internal.owner_draft(v_cost.invoice_id);

  if amount_cents is not null and amount_cents < 0 and v_cost.kind <> 'profit' then
    raise exception 'A cost can''t be below zero.'
      using errcode = '22023';
  end if;

  update public.invoice_cost_lines c
  set
    removed = coalesce(set_invoice_cost_line.removed, c.removed),
    amount_cents = coalesce(set_invoice_cost_line.amount_cents, c.amount_cents)
  where c.id = v_cost.id;

  perform internal.recompute_invoice(v_cost.invoice_id);
end;
$$;

-- Change what the property reads for a line. Lines without cost lines
-- (one-off, added lines) also take a new amount here.
create or replace function public.update_invoice_line(
  line_id uuid,
  description text,
  amount_cents integer default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line public.invoice_lines;
  v_text text := nullif(trim(coalesce(description, '')), '');
begin
  select * into v_line from public.invoice_lines l where l.id = update_invoice_line.line_id;
  if v_line.id is null then
    raise exception 'That line is gone. Reload the invoice.'
      using errcode = '42501';
  end if;
  perform internal.owner_draft(v_line.invoice_id);

  if v_text is null then
    raise exception 'Write what the property reads for this line.'
      using errcode = '22023';
  end if;

  if amount_cents is not null and exists (
    select 1 from public.invoice_cost_lines c where c.invoice_line_id = v_line.id
  ) then
    raise exception 'Change this repair''s price through its cost lines.'
      using errcode = '22023';
  end if;

  update public.invoice_lines l
  set
    description_customer = v_text,
    amount_cents = coalesce(update_invoice_line.amount_cents, l.amount_cents),
    internal_profit_cents = case
      when update_invoice_line.amount_cents is null then l.internal_profit_cents
      else update_invoice_line.amount_cents - coalesce(l.internal_cost_cents, 0)
    end
  where l.id = v_line.id;

  perform internal.recompute_invoice(v_line.invoice_id);
end;
$$;

-- Add a line the property sees (a discount is a negative amount).
create or replace function public.add_invoice_line(
  invoice_id uuid,
  description text,
  amount_cents integer
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv public.invoice_records;
  v_text text := nullif(trim(coalesce(description, '')), '');
  v_id uuid;
begin
  v_inv := internal.owner_draft(add_invoice_line.invoice_id);
  if v_text is null then
    raise exception 'Write what the property reads for this line.'
      using errcode = '22023';
  end if;
  if amount_cents is null then
    raise exception 'Put in an amount.'
      using errcode = '22023';
  end if;

  insert into public.invoice_lines (
    invoice_id, sort, source, description_customer, amount_cents,
    internal_cost_cents, internal_profit_cents, added_by
  )
  values (
    v_inv.id,
    coalesce((select max(sort) from public.invoice_lines where invoice_lines.invoice_id = v_inv.id), 0) + 1,
    'adjustment',
    v_text,
    add_invoice_line.amount_cents,
    0,
    add_invoice_line.amount_cents,
    public.current_profile_id()
  )
  returning id into v_id;

  perform internal.recompute_invoice(v_inv.id);
  return v_id;
end;
$$;

-- Take a whole line off. One line has to stay.
create or replace function public.remove_invoice_line(line_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line public.invoice_lines;
begin
  select * into v_line from public.invoice_lines l where l.id = remove_invoice_line.line_id;
  if v_line.id is null then
    return;
  end if;
  perform internal.owner_draft(v_line.invoice_id);

  if (select count(*) from public.invoice_lines where invoice_id = v_line.invoice_id) <= 1 then
    raise exception 'An invoice needs at least one line.'
      using errcode = '22023';
  end if;

  delete from public.invoice_lines where id = v_line.id;
  perform internal.recompute_invoice(v_line.invoice_id);
end;
$$;

-- Ask the tech. The job stays in Complete; the text goes once texting is set up.
create or replace function public.ask_about_invoice(invoice_id uuid, question text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv public.invoice_records;
  v_text text := nullif(trim(coalesce(question, '')), '');
  v_tech public.profiles;
  v_owner text;
  v_phone text;
  v_sms text := 'none';
begin
  v_inv := internal.owner_draft(ask_about_invoice.invoice_id);
  if v_text is null then
    raise exception 'Type the question.'
      using errcode = '22023';
  end if;

  select p.* into v_tech
  from public.service_requests r
  join public.profiles p on p.id = r.assigned_user_id
  where r.id = v_inv.request_id;

  if v_tech.id is null then
    raise exception 'No tech is on this job to ask.'
      using errcode = '22023';
  end if;

  update public.invoice_records
  set
    status = 'flagged',
    flag_question = v_text,
    flag_asked_at = now(),
    flag_asked_by = public.current_profile_id(),
    flag_answer = null,
    flag_answered_at = null
  where id = v_inv.id;

  select split_part(full_name, ' ', 1) into v_owner from public.profiles where id = public.current_profile_id();
  v_phone := nullif(trim(coalesce(v_tech.phone, '')), '');
  if v_phone is not null and v_phone <> 'unset' then
    insert into public.outbound_messages (request_id, channel, to_address, template, body, status)
    values (
      v_inv.request_id, 'sms', v_phone, 'flag_back',
      coalesce(v_owner, 'An owner') || ' has a question on ' || v_inv.property_snap || ' ' || v_inv.unit_snap
        || ': ' || v_text || ' Answer it in the LSP app under My jobs.',
      'queued'
    );
    v_sms := 'queued';
  end if;

  return jsonb_build_object('tech', v_tech.full_name, 'sms', v_sms);
end;
$$;

-- The tech answers in the app. The draft goes back to the owner.
create or replace function public.answer_invoice_question(invoice_id uuid, answer text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv public.invoice_records;
  v_text text := nullif(trim(coalesce(answer, '')), '');
begin
  select * into v_inv from public.invoice_records i where i.id = answer_invoice_question.invoice_id for update;
  if v_inv.id is null or v_inv.status <> 'flagged' then
    raise exception 'That question was already handled.'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.service_requests r
    where r.id = v_inv.request_id and r.assigned_user_id = public.current_profile_id()
  ) and not public.is_owner() then
    raise exception 'Only the tech on this job can answer.'
      using errcode = '42501';
  end if;
  if v_text is null then
    raise exception 'Type your answer.'
      using errcode = '22023';
  end if;

  update public.invoice_records
  set status = 'in_review', flag_answer = v_text, flag_answered_at = now()
  where id = v_inv.id;
end;
$$;

-- Approve: number it, bill the customer's billing contact, date it, mark it sent.
-- seen_at guards against approving a draft someone changed after it was opened.
create or replace function public.approve_invoice(invoice_id uuid, seen_at timestamptz default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv public.invoice_records;
  v_number integer;
  v_tz text;
  v_today date;
  v_contact uuid;
  v_email text;
begin
  v_inv := internal.owner_draft(approve_invoice.invoice_id);

  if seen_at is not null and v_inv.updated_at > seen_at + interval '1 second' then
    raise exception 'This invoice changed since you opened it. Look it over again.'
      using errcode = '40001';
  end if;
  if not exists (select 1 from public.invoice_lines where invoice_lines.invoice_id = v_inv.id) then
    raise exception 'An invoice needs at least one line.'
      using errcode = '22023';
  end if;
  if v_inv.total_cents < 0 then
    raise exception 'The total can''t be below zero.'
      using errcode = '22023';
  end if;

  update public.app_config
  set next_invoice_number = next_invoice_number + 1
  where id = 1
  returning next_invoice_number - 1, timezone into v_number, v_tz;
  v_today := (now() at time zone coalesce(v_tz, 'America/New_York'))::date;

  select c.billing_contact_id,
    coalesce(nullif(trim(c.billing_email_override), ''), nullif(trim(ct.email), ''), nullif(v_inv.bill_to_email_snap, 'unset'))
  into v_contact, v_email
  from public.customers c
  left join public.customer_contacts ct on ct.id = c.billing_contact_id
  where c.id = v_inv.bill_to_customer_id;

  update public.invoice_records
  set
    status = 'approved_sent',
    number = v_number::text,
    invoice_date = v_today,
    due_date = v_today + terms_days_snap,
    reviewed_by = public.current_profile_id(),
    sent_at = now(),
    bill_to_contact_id = coalesce(v_contact, bill_to_contact_id),
    bill_to_email_snap = coalesce(v_email, 'unset')
  where id = v_inv.id;

  return jsonb_build_object('id', v_inv.id, 'number', v_number::text, 'email', v_email);
end;
$$;

-- The app records how the email went (sent, failed, or not sent).
create or replace function public.record_invoice_email(
  invoice_id uuid,
  to_address text,
  status public.outbound_status,
  provider_id text default null,
  body text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_request uuid;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can send an invoice.'
      using errcode = '42501';
  end if;
  select request_id into v_request from public.invoice_records i where i.id = record_invoice_email.invoice_id;
  insert into public.outbound_messages (request_id, channel, to_address, template, body, status, provider_id, sent_at)
  values (
    v_request, 'email', coalesce(nullif(trim(to_address), ''), 'unset'), 'invoice',
    coalesce(body, 'Invoice email'), record_invoice_email.status, provider_id,
    case when record_invoice_email.status = 'sent' then now() else null end
  );
end;
$$;

revoke all on function internal.build_invoice_cost_lines(uuid) from public, anon, authenticated;
revoke all on function internal.invoice_line_cost_lines() from public, anon, authenticated;
revoke all on function internal.owner_draft(uuid) from public, anon;
revoke all on function internal.recompute_invoice(uuid) from public, anon;
grant execute on function internal.owner_draft(uuid) to authenticated;
grant execute on function internal.recompute_invoice(uuid) to authenticated;

revoke all on function public.set_invoice_cost_line(uuid, boolean, integer) from public, anon;
revoke all on function public.update_invoice_line(uuid, text, integer) from public, anon;
revoke all on function public.add_invoice_line(uuid, text, integer) from public, anon;
revoke all on function public.remove_invoice_line(uuid) from public, anon;
revoke all on function public.ask_about_invoice(uuid, text) from public, anon;
revoke all on function public.answer_invoice_question(uuid, text) from public, anon;
revoke all on function public.approve_invoice(uuid, timestamptz) from public, anon;
revoke all on function public.record_invoice_email(uuid, text, public.outbound_status, text, text) from public, anon;
grant execute on function public.set_invoice_cost_line(uuid, boolean, integer) to authenticated;
grant execute on function public.update_invoice_line(uuid, text, integer) to authenticated;
grant execute on function public.add_invoice_line(uuid, text, integer) to authenticated;
grant execute on function public.remove_invoice_line(uuid) to authenticated;
grant execute on function public.ask_about_invoice(uuid, text) to authenticated;
grant execute on function public.answer_invoice_question(uuid, text) to authenticated;
grant execute on function public.approve_invoice(uuid, timestamptz) to authenticated;
grant execute on function public.record_invoice_email(uuid, text, public.outbound_status, text, text) to authenticated;
