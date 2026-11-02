import { resolveHistory } from './plan.mjs'

function rows(result) {
  return result.rowCount ?? 0
}

async function loadDirectory(client) {
  const customers = (
    await client.query('select id, name from public.customers')
  ).rows.map((row) => ({ id: row.id, name: row.name }))
  const properties = (
    await client.query('select id, customer_id, name from public.properties')
  ).rows.map((row) => ({ id: row.id, customerId: row.customer_id, name: row.name }))
  const bundles = (await client.query('select id, code from public.bundles')).rows.map((row) => ({
    id: row.id,
    code: row.code,
  }))
  return { customers, properties, bundles }
}

export async function applyPlan(client, plan) {
  const stats = {
    bundlesInserted: 0,
    linesInserted: 0,
    customersInserted: 0,
    contactsInserted: 0,
    propertiesInserted: 0,
    linksInserted: 0,
    unitsInserted: 0,
    historyInserted: 0,
    historyRelinked: 0,
    historyRemoved: 0,
  }

  const customerResult = await client.query(
    `insert into public.customers (
       id, name, billing_contact_id, payment_terms_days, addon_approval_mode,
       signoff_requirement, resident_report_mode, portal_enabled, active
     )
     select
       id, name, billing_contact_id, payment_terms_days,
       addon_approval_mode::public.addon_approval_mode,
       signoff_requirement::public.signoff_requirement,
       resident_report_mode::public.resident_report_mode,
       portal_enabled, active
     from unnest(
       $1::uuid[], $2::text[], $3::uuid[], $4::int[],
       $5::text[], $6::text[], $7::text[], $8::boolean[], $9::boolean[]
     ) as t(
       id, name, billing_contact_id, payment_terms_days, addon_approval_mode,
       signoff_requirement, resident_report_mode, portal_enabled, active
     )
     on conflict (id) do nothing`,
    [
      plan.customers.map((row) => row.id),
      plan.customers.map((row) => row.name),
      plan.customers.map((row) => row.billingContactId),
      plan.customers.map((row) => row.contract.paymentTermsDays),
      plan.customers.map((row) => row.contract.addonApprovalMode),
      plan.customers.map((row) => row.contract.signoffRequirement),
      plan.customers.map((row) => row.contract.residentReportMode),
      plan.customers.map((row) => row.contract.portalEnabled),
      plan.customers.map(() => true),
    ],
  )
  stats.customersInserted = rows(customerResult)

  const contactResult = await client.query(
    `insert into public.customer_contacts (
       id, customer_id, name, title, phone, email, sms_ok, active
     )
     select *
     from unnest(
       $1::uuid[], $2::uuid[], $3::text[], $4::text[],
       $5::text[], $6::text[], $7::boolean[], $8::boolean[]
     )
     on conflict (id) do nothing`,
    [
      plan.contacts.map((row) => row.id),
      plan.contacts.map((row) => row.customerId),
      plan.contacts.map((row) => row.name),
      plan.contacts.map((row) => row.title),
      plan.contacts.map((row) => row.phone),
      plan.contacts.map((row) => row.email),
      plan.contacts.map((row) => row.smsOk),
      plan.contacts.map(() => true),
    ],
  )
  stats.contactsInserted = rows(contactResult)

  const propertyResult = await client.query(
    `insert into public.properties (
       id, customer_id, name, address_line1, city, state, zip,
       tax_rate_bps, site_access_text, lockbox_info, active
     )
     select *
     from unnest(
       $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[],
       $7::text[], $8::int[], $9::text[], $10::text[], $11::boolean[]
     )
     on conflict (id) do nothing`,
    [
      plan.properties.map((row) => row.id),
      plan.properties.map((row) => row.customerId),
      plan.properties.map((row) => row.name),
      plan.properties.map((row) => row.address),
      plan.properties.map((row) => row.city),
      plan.properties.map((row) => row.state),
      plan.properties.map((row) => row.zip),
      plan.properties.map((row) => row.taxRateBps),
      plan.properties.map((row) => row.siteAccess),
      plan.properties.map((row) => row.lockbox),
      plan.properties.map(() => true),
    ],
  )
  stats.propertiesInserted = rows(propertyResult)

  const linkResult = await client.query(
    `insert into public.contact_properties (id, contact_id, property_id, is_primary)
     select * from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::boolean[])
     on conflict on constraint contact_properties_unique do nothing`,
    [
      plan.links.map((row) => row.id),
      plan.links.map((row) => row.contactId),
      plan.links.map((row) => row.propertyId),
      plan.links.map((row) => row.isPrimary),
    ],
  )
  stats.linksInserted = rows(linkResult)

  const bundleResult = await client.query(
    `insert into public.bundles (
       id, code, title, narrative, pricing_kind, target_price_cents,
       reference_part_cost_cents, labor_hours, one_shot, quick_select_rank,
       requires_model_serial, status
     )
     select
       id, code, title, narrative, pricing_kind::public.pricing_kind,
       target_price_cents, reference_part_cost_cents, labor_hours, one_shot,
       quick_select_rank, requires_model_serial, status::public.bundle_status
     from unnest(
       $1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[],
       $7::int[], $8::numeric[], $9::boolean[], $10::int[], $11::boolean[], $12::text[]
     ) as t(
       id, code, title, narrative, pricing_kind, target_price_cents,
       reference_part_cost_cents, labor_hours, one_shot, quick_select_rank,
       requires_model_serial, status
     )
     on conflict (code) do nothing
     returning id`,
    [
      plan.bundles.map((row) => row.id),
      plan.bundles.map((row) => row.code),
      plan.bundles.map((row) => row.title),
      plan.bundles.map((row) => row.narrative),
      plan.bundles.map((row) => row.pricingKind),
      plan.bundles.map((row) => row.targetPriceCents),
      plan.bundles.map((row) => row.referencePartCostCents),
      plan.bundles.map((row) => row.laborHours),
      plan.bundles.map((row) => row.oneShot),
      plan.bundles.map((row) => row.quickSelectRank),
      plan.bundles.map((row) => row.requiresModelSerial),
      plan.bundles.map((row) => row.status),
    ],
  )
  stats.bundlesInserted = rows(bundleResult)
  const insertedBundleIds = new Set(bundleResult.rows.map((row) => row.id))
  const newLines = plan.lines.filter((line) => insertedBundleIds.has(line.bundleId))
  if (newLines.length) {
    const lineResult = await client.query(
      `insert into public.bundle_lines (
         id, bundle_id, kind, description, qty, unit_cost_cents, is_placeholder
       )
       select
         id, bundle_id, kind::public.bundle_line_kind, description, qty,
         unit_cost_cents, is_placeholder
       from unnest(
         $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::numeric[], $6::int[], $7::boolean[]
       ) as t(id, bundle_id, kind, description, qty, unit_cost_cents, is_placeholder)`,
      [
        newLines.map((row) => row.id),
        newLines.map((row) => row.bundleId),
        newLines.map((row) => row.kind),
        newLines.map((row) => row.description),
        newLines.map((row) => row.qty),
        newLines.map((row) => row.unitCostCents),
        newLines.map((row) => row.isPlaceholder),
      ],
    )
    stats.linesInserted = rows(lineResult)
  }

  const directory = await loadDirectory(client)
  const resolved = resolveHistory(plan.history, directory.customers, directory.properties, directory.bundles)
  if (resolved.units.length) {
    const unitResult = await client.query(
      `insert into public.units (id, property_id, unit_label, unit_label_norm)
       select * from unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[])
       on conflict (property_id, unit_label_norm) do nothing`,
      [
        resolved.units.map((row) => row.id),
        resolved.units.map((row) => row.propertyId),
        resolved.units.map((row) => row.unitLabel),
        resolved.units.map((row) => row.unitLabelNorm),
      ],
    )
    stats.unitsInserted = rows(unitResult)
  }

  // Resolve from the database, not only from the files. A property Matt adds
  // later is picked up here. An existing unit keeps its id.
  const unitLookup = new Map(
    (
      await client.query('select id, property_id, unit_label_norm from public.units')
    ).rows.map((row) => [`${row.property_id}|${row.unit_label_norm}`, row.id]),
  )
  const history = resolved.history.map((row) => {
    if (!row.propertyId || !row.unitLabel) return row
    const unitId = unitLookup.get(`${row.propertyId}|${row.unitLabel.toLowerCase()}`) ?? null
    if (unitId === row.unitId) return row
    const next = { ...row, unitId }
    return next
  })
  // Notes were built before the database unit id was confirmed. Rebuild only
  // when the link changed so a second run does not rewrite an identical note.
  const { history: renoted } = resolveHistory(
    history.map((row) => ({ ...row, customerId: null, propertyId: null, unitId: null, bundleId: null })),
    directory.customers,
    directory.properties,
    directory.bundles,
  )
  const finalHistory = renoted.map((row) => {
    if (!row.propertyId || !row.unitLabel) return row
    const unitId = unitLookup.get(`${row.propertyId}|${row.unitLabel.toLowerCase()}`) ?? row.unitId
    return unitId === row.unitId ? row : { ...row, unitId }
  })

  const historyResult = await client.query(
    `with incoming as (
       select
         source_key, source_file, source_row, customer_id, property_id, unit_id, bundle_id,
         customer_name, property_name, unit_label, job_on,
         (occurred_at::timestamp at time zone 'America/New_York') as occurred_at,
         diagnosis_code, diagnosis_raw, subtotal_cents, tax_rate_bps, tax_cents, total_cents,
         match_notes
       from unnest(
         $1::text[], $2::text[], $3::int[], $4::uuid[], $5::uuid[], $6::uuid[], $7::uuid[],
         $8::text[], $9::text[], $10::text[], $11::date[], $12::text[], $13::text[], $14::text[],
         $15::int[], $16::int[], $17::int[], $18::int[], $19::text[]
       ) as t(
         source_key, source_file, source_row, customer_id, property_id, unit_id, bundle_id,
         customer_name, property_name, unit_label, job_on, occurred_at, diagnosis_code,
         diagnosis_raw, subtotal_cents, tax_rate_bps, tax_cents, total_cents, match_notes
       )
     ),
     ins as (
       insert into public.legacy_imports (
         source_key, source_file, source_row, customer_id, property_id, unit_id, bundle_id,
         customer_name, property_name, unit_label, job_on, occurred_at, diagnosis_code,
         diagnosis_raw, subtotal_cents, tax_rate_bps, tax_cents, total_cents, match_notes
       )
       select * from incoming
       on conflict (source_key) do nothing
       returning 1
     ),
     rel as (
       update public.legacy_imports as saved
       set
         customer_id = incoming.customer_id,
         property_id = incoming.property_id,
         unit_id = incoming.unit_id,
         bundle_id = incoming.bundle_id,
         match_notes = incoming.match_notes
       from incoming
       where saved.source_key = incoming.source_key
         and (
           saved.customer_id is distinct from incoming.customer_id
           or saved.property_id is distinct from incoming.property_id
           or saved.unit_id is distinct from incoming.unit_id
           or saved.bundle_id is distinct from incoming.bundle_id
           or saved.match_notes is distinct from incoming.match_notes
         )
       returning 1
     ),
     removed as (
       delete from public.legacy_imports as saved
       where saved.source_file = $20
         and not exists (
           select 1 from incoming where incoming.source_key = saved.source_key
         )
       returning 1
     )
     select
       (select count(*) from ins)::int as inserted,
       (select count(*) from rel)::int as relinked,
       (select count(*) from removed)::int as removed`,
    [
      finalHistory.map((row) => row.sourceKey),
      finalHistory.map((row) => row.sourceFile),
      finalHistory.map((row) => row.sourceRow),
      finalHistory.map((row) => row.customerId),
      finalHistory.map((row) => row.propertyId),
      finalHistory.map((row) => row.unitId),
      finalHistory.map((row) => row.bundleId),
      finalHistory.map((row) => row.customerName),
      finalHistory.map((row) => row.propertyName),
      finalHistory.map((row) => row.unitLabel),
      finalHistory.map((row) => row.jobOn),
      finalHistory.map((row) => row.occurredAt),
      finalHistory.map((row) => row.diagnosisCode),
      finalHistory.map((row) => row.diagnosisRaw),
      finalHistory.map((row) => row.subtotalCents),
      finalHistory.map((row) => row.taxRateBps),
      finalHistory.map((row) => row.taxCents),
      finalHistory.map((row) => row.totalCents),
      finalHistory.map((row) => row.matchNotes),
      plan.history[0]?.sourceFile ?? 'Call History.csv',
    ],
  )
  stats.historyInserted = historyResult.rows[0].inserted
  stats.historyRelinked = historyResult.rows[0].relinked
  stats.historyRemoved = historyResult.rows[0].removed
  return stats
}

export function isNoop(stats) {
  return Object.values(stats).every((value) => value === 0)
}
