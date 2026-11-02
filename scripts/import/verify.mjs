import { resolveHistory, WALL_MOUNT_CODE } from './plan.mjs'

function money(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`
}

async function directory(client) {
  const customers = (await client.query('select id, name from public.customers')).rows.map((row) => ({
    id: row.id,
    name: row.name,
  }))
  const properties = (
    await client.query('select id, customer_id, name from public.properties')
  ).rows.map((row) => ({ id: row.id, customerId: row.customer_id, name: row.name }))
  const bundles = (await client.query('select id, code from public.bundles')).rows.map((row) => ({
    id: row.id,
    code: row.code,
  }))
  return { customers, properties, bundles }
}

export async function verifyDatabase(client, plan, { fresh = false } = {}) {
  const problems = []
  const fail = (problem) => {
    if (problems.length < 25) problems.push(problem)
  }
  const { customers, properties, bundles } = await directory(client)
  const expected = resolveHistory(plan.history, customers, properties, bundles).history
  const expectedByKey = new Map(expected.map((row) => [row.sourceKey, row]))

  const loaded = (
    await client.query(
      `select source_key, customer_id, property_id, unit_id, bundle_id, property_name,
              subtotal_cents, tax_cents, total_cents, counts_toward_pulse, diagnosis_code
       from public.legacy_imports`,
    )
  ).rows

  if (loaded.length !== plan.history.length) {
    fail(`History rows are ${loaded.length}. The workbook has ${plan.history.length}.`)
  }

  const seen = new Set()
  let totalCents = 0
  const byProperty = new Map()
  for (const row of loaded) {
    seen.add(row.source_key)
    totalCents += row.total_cents ?? 0
    byProperty.set(row.property_name, (byProperty.get(row.property_name) ?? 0) + 1)
    if (row.counts_toward_pulse !== false) {
      fail('A history row is marked as counting toward Financial Pulse.')
    }
    const want = expectedByKey.get(row.source_key)
    if (!want) {
      fail('A history row is in the database and not in the workbook.')
      continue
    }
    if (
      row.customer_id !== want.customerId ||
      row.property_id !== want.propertyId ||
      row.unit_id !== want.unitId ||
      row.bundle_id !== want.bundleId ||
      row.subtotal_cents !== want.subtotalCents ||
      row.tax_cents !== want.taxCents ||
      row.total_cents !== want.totalCents
    ) {
      fail(`History row ${want.sourceRow} at ${want.propertyName} does not match the workbook.`)
    }
  }
  for (const row of plan.history) {
    if (!seen.has(row.sourceKey)) {
      fail(`Workbook row ${row.sourceRow} at ${row.propertyName} was not loaded.`)
    }
    byProperty.set(row.propertyName, (byProperty.get(row.propertyName) ?? 0) - 1)
  }
  for (const [name, delta] of byProperty) {
    if (delta !== 0) problems.push(`${name} history count is off by ${delta}.`)
  }

  const planTotal = plan.history.reduce((sum, row) => sum + (row.totalCents ?? 0), 0)
  if (totalCents !== planTotal) {
    fail(`History total is ${money(totalCents)}. The workbook total is ${money(planTotal)}.`)
  }

  const codes = new Set(bundles.map((bundle) => bundle.code))
  for (const bundle of plan.bundles) {
    if (!codes.has(bundle.code)) problems.push(`Catalog is missing ${bundle.code}.`)
  }
  if (bundles.some((bundle) => /wall[\s-]*mount/i.test(bundle.code))) {
    fail('The catalog has a wall-mount bundle. Create that one later, from the repair builder.')
  }

  const wallOpen = loaded.filter(
    (row) => row.diagnosis_code === WALL_MOUNT_CODE && row.bundle_id == null,
  ).length
  const wallAll = loaded.filter((row) => row.diagnosis_code === WALL_MOUNT_CODE).length
  if (wallAll && wallOpen !== wallAll && !bundles.some((bundle) => bundle.code === WALL_MOUNT_CODE)) {
    fail('Wall-mount history linked to a bundle even though that bundle does not exist.')
  }

  if (fresh) {
    if (bundles.length !== plan.bundles.length) {
      fail(`Catalog has ${bundles.length} bundles. The workbook has ${plan.bundles.length}.`)
    }
    const dbBundles = (await client.query('select * from public.bundles')).rows
    const dbByCode = new Map(dbBundles.map((row) => [row.code, row]))
    for (const bundle of plan.bundles) {
      const saved = dbByCode.get(bundle.code)
      if (!saved) continue
      const labor = Number(saved.labor_hours)
      const wantLabor = Number(bundle.laborHours)
      if (
        saved.target_price_cents !== bundle.targetPriceCents ||
        saved.pricing_kind !== bundle.pricingKind ||
        saved.one_shot !== bundle.oneShot ||
        saved.requires_model_serial !== bundle.requiresModelSerial ||
        saved.quick_select_rank !== bundle.quickSelectRank ||
        saved.reference_part_cost_cents !== bundle.referencePartCostCents ||
        labor !== wantLabor
      ) {
        fail(`Catalog values for ${bundle.code} do not match the workbook.`)
      }
    }
    const dbLines = (await client.query('select * from public.bundle_lines')).rows
    if (dbLines.length !== plan.lines.length) {
      fail(`Catalog has ${dbLines.length} cost lines. The workbook has ${plan.lines.length}.`)
    }
    const lineKey = (bundleId, description) => `${bundleId}|${description}`
    const dbLineMap = new Map(dbLines.map((row) => [lineKey(row.bundle_id, row.description), row]))
    for (const line of plan.lines) {
      const saved = dbLineMap.get(lineKey(line.bundleId, line.description))
      if (!saved) {
        fail(`Missing cost line ${line.description}.`)
        continue
      }
      if (
        saved.kind !== line.kind ||
        Number(saved.qty) !== Number(line.qty) ||
        saved.unit_cost_cents !== line.unitCostCents ||
        saved.is_placeholder !== line.isPlaceholder
      ) {
        fail(`Cost line ${line.description} does not match the workbook.`)
      }
    }
    const counts = (
      await client.query(
        `select
           (select count(*) from public.service_requests)::int as requests,
           (select count(*) from public.service_visits)::int as visits,
           (select count(*) from public.invoice_records)::int as invoices,
           (select count(*) from public.systems)::int as systems,
           (select count(*) from public.customers)::int as customers,
           (select count(*) from public.properties)::int as properties,
           (select count(*) from public.units)::int as units`,
      )
    ).rows[0]
    if (Number(counts.requests) || Number(counts.visits) || Number(counts.invoices)) {
      fail('The import created Board cards or invoices. History must stay off the Board.')
    }
    if (Number(counts.systems)) fail('The import created equipment rows. None were in the source files.')
    if (Number(counts.customers) !== plan.customers.length) {
      fail(`Customers are ${counts.customers}. Expected ${plan.customers.length}.`)
    }
    if (Number(counts.properties) !== plan.properties.length) {
      fail(`Properties are ${counts.properties}. Expected ${plan.properties.length}.`)
    }
    if (Number(counts.units) !== plan.units.length) {
      fail(`Units are ${counts.units}. Expected ${plan.units.length}.`)
    }
    const savedProperties = (
      await client.query('select id, tax_rate_bps, address_line1 from public.properties')
    ).rows
    const savedById = new Map(savedProperties.map((row) => [row.id, row]))
    for (const property of plan.properties) {
      const saved = savedById.get(property.id)
      if (!saved) {
        fail(`Property ${property.name} was not loaded.`)
        continue
      }
      if (Number(saved.tax_rate_bps) !== property.taxRateBps) {
        fail(`${property.name} tax rate is ${saved.tax_rate_bps} bps. The history rate is ${property.taxRateBps}.`)
      }
      if (saved.address_line1 !== property.address) {
        fail(`${property.name} street does not match the source file.`)
      }
    }
  }

  return problems
}

export function formatProblems(problems) {
  return problems.map((problem) => `  - ${problem}`).join('\n')
}

export { money }
