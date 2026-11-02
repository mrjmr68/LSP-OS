import {
  cleanPhone,
  dollarsToCents,
  matchKey,
  parseBool,
  parseHours,
  parseSqlTuples,
  phoneDigits,
  readCsvObjects,
  readCsvRows,
  readText,
  sha256,
  taxRateBps,
  uuidV5,
} from './lib.mjs'

export const SOURCE_FILE = 'Call History.csv'
export const WALL_MOUNT_CODE = 'SYS - TOTAL - Change Out - Wall Mount'

// The workbook renamed this repair. The catalog keeps the workbook's formula.
// History still uses the older string, so the importer links it on purpose.
export const DIAGNOSIS_ALIASES = {
  'SYS - TOTAL - Change Out - Attic/Crawl AHU': 'SYS - Attic/Crawl AHU - Change Out',
}

// These history locations are not communities in the Wynnefield or Sasser
// files. They stay on the history row until someone adds the property.
export const UNMATCHED_PROPERTIES = [
  'Commercial',
  'Forest Park Crossing',
  'New Garden',
  'Other',
  'Villas at Forest Park',
  'Villas at Hope Crest',
  'West Cumberland',
]

const EQUIPMENT = new Set(['ahu', 'condenser', 'furnace', 'heat pump'])

const CONTRACT = {
  paymentTermsDays: 30,
  addonApprovalMode: 'call_first',
  signoffRequirement: 'none',
  residentReportMode: 'confirm_with_property',
  portalEnabled: false,
}

const MATERIAL_ITEM = {
  Standard: 'Materials - Standard',
  Minimal: 'Materials - Minimal',
  Brazing: 'Materials - Brazing',
  Install: 'Materials - Changeout',
}

function catalogCode(diagnosis) {
  const code = (diagnosis ?? '').trim()
  if (!code) return null
  return DIAGNOSIS_ALIASES[code] ?? code
}

function notesFor(row) {
  const notes = []
  if (!row.propertyId) {
    notes.push(
      'Property is not in the hierarchy yet. Add the property, then run the import again to link these calls.',
    )
  }
  if (!row.unitLabel) notes.push('No unit on this row.')
  if (!row.diagnosisCode && !row.diagnosisRaw) notes.push('No diagnosis on this row.')
  else if (!row.diagnosisCode) notes.push('No catalog code on this row.')
  else if (!row.bundleId && row.diagnosisCode === WALL_MOUNT_CODE) {
    notes.push(
      'Wall-mount change-out is not in the catalog. Build that bundle in the repair flow with this same code, then run the import again to link these calls.',
    )
  } else if (!row.bundleId) {
    notes.push('Diagnosis code is not in the catalog.')
  } else if (DIAGNOSIS_ALIASES[row.diagnosisCode]) {
    notes.push('Linked from the older change-out code.')
  }
  return notes.length ? notes.join(' ') : null
}

function accessFields(note) {
  const text = (note ?? '').trim()
  if (!text || /^n\/?a$/i.test(text)) return { siteAccess: null, lockbox: null }
  return {
    siteAccess: text,
    lockbox: /\d{3,}/.test(text) ? text : null,
  }
}

function parseWhen(value, sourceRow) {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*([AP]M)$/i)
  if (!match) {
    throw new Error(`Row ${sourceRow} has a job date I cannot read: ${JSON.stringify(text)}`)
  }
  const month = match[1].padStart(2, '0')
  const day = match[2].padStart(2, '0')
  const year = String(2000 + Number(match[3]))
  let hour = Number(match[4])
  const minute = match[5]
  const ampm = match[6].toUpperCase()
  if (ampm === 'AM' && hour === 12) hour = 0
  else if (ampm === 'PM' && hour !== 12) hour += 12
  return {
    jobOn: `${year}-${month}-${day}`,
    occurredAt: `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${minute}:00`,
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? '')
}

function seedBundles() {
  const byCode = new Map()
  for (const fields of parseSqlTuples(readText('diagnoses_seed.sql'))) {
    if (!isUuid(fields[0]) || fields.length < 13) continue
    const code = fields[4]
    if (!code || !code.includes(' - ')) continue
    byCode.set(code, fields[0])
  }
  return byCode
}

function seedCustomers(file) {
  return parseSqlTuples(readText(file))
    .filter((fields) => isUuid(fields[0]) && fields.length === 4)
    .map((fields) => ({ id: fields[0], name: fields[1] }))
}

function seedProperties(file, width) {
  return parseSqlTuples(readText(file))
    .filter((fields) => isUuid(fields[0]) && fields.length === width)
    .map((fields) => ({
      id: fields[0],
      customerId: fields[1],
      name: fields[2],
      address: (fields[3] ?? '').trim(),
      city: (fields[4] ?? '').trim(),
      state: (fields[5] ?? '').trim().toUpperCase(),
      zip: (fields[6] ?? '').trim(),
      access: width === 8 ? fields[7] : null,
    }))
}

function workbookBundles(seedIds) {
  const rows = readCsvRows('Operations - Invoicing - V2.csv')
  if (rows[1]?.[6] !== 'Repair Code' || rows[1]?.[10] !== 'Flat Rate' || rows[1]?.[17] !== 'Total Time') {
    throw new Error('The price workbook columns are not the ones this importer knows.')
  }
  const bundles = []
  const lines = []
  const skipped = []
  for (const row of rows.slice(2)) {
    const code = (row[6] ?? '').trim()
    // The sheet ends with a scratch area (possible additions, constants). Those
    // rows have no repair code, price, or narrative, so they are not bundles.
    if (!code) continue
    const narrative = (row[8] ?? '').trim()
    const price = dollarsToCents(row[10])
    if (!narrative || price == null) {
      skipped.push(code)
      continue
    }
    const variable = parseBool(row[13], `${code} variable`)
    const finishedInOneVisit = parseBool(row[14], `${code} one shot`)
    // The workbook's One Shot column means "normally finished on the first visit."
    // In this app, one_shot means the opposite: pre-arm the parts / return path.
    const oneShot = !finishedInOneVisit
    const laborHours = parseHours(row[17], `${code} total time`)
    const id = seedIds.get(code) ?? uuidV5(`bundle:${code}`)
    const partLines = [partLine(row[23], row[24]), partLine(row[25], row[26]), partLine(row[27], row[28])].filter(
      Boolean,
    )
    const material = materialLine(row[31], row[32], code)
    const refrigerant = refrigerantLine(row[29], row[30], code)
    const bundleLines = [...partLines, material, refrigerant].filter(Boolean)
    const reference = variable ? (partLines.find((line) => line.unitCostCents > 0)?.unitCostCents ?? null) : null
    bundles.push({
      id,
      code,
      title: code,
      narrative,
      pricingKind: variable ? 'variable' : 'fixed',
      targetPriceCents: price,
      referencePartCostCents: reference,
      laborHours,
      oneShot,
      requiresModelSerial: oneShot || variable,
      quickSelectRank: null,
      status: 'active',
    })
    for (const line of bundleLines) {
      lines.push({
        id: uuidV5(`${id}|${line.kind}|${line.description}`),
        bundleId: id,
        ...line,
      })
    }
  }
  if (bundles.length !== 40) {
    throw new Error(`Expected 40 priced bundles from the workbook, built ${bundles.length}.`)
  }
  return { bundles, lines, skipped }
}

function partLine(name, costRaw) {
  const description = String(name ?? '').trim()
  if (!description) return null
  const blankCost = String(costRaw ?? '').trim() === ''
  const unitCostCents = blankCost ? 0 : dollarsToCents(costRaw)
  if (unitCostCents == null) {
    throw new Error(`Part ${description} has an amount I cannot read.`)
  }
  const kind = EQUIPMENT.has(description.toLowerCase()) ? 'equipment' : 'part'
  return {
    kind,
    description,
    qty: '1',
    unitCostCents,
    isPlaceholder: unitCostCents === 0,
  }
}

function materialLine(name, costRaw, code) {
  const label = String(name ?? '').trim()
  if (!label) return null
  const unitCostCents = dollarsToCents(costRaw)
  if (unitCostCents == null || unitCostCents === 0) return null
  return {
    kind: 'material',
    description: `Materials - ${label}`,
    qty: '1',
    unitCostCents,
    isPlaceholder: false,
    itemName: MATERIAL_ITEM[label] ?? null,
    code,
  }
}

function refrigerantLine(qtyRaw, costRaw, code) {
  const qtyText = String(qtyRaw ?? '').trim()
  const costText = String(costRaw ?? '').trim()
  if (!qtyText && !costText) return null
  if (!/^\d+$/.test(qtyText)) {
    throw new Error(`${code} has a refrigerant quantity I cannot read: ${qtyText}`)
  }
  const qty = Number(qtyText)
  const totalCents = dollarsToCents(costText)
  if (!qty || totalCents == null || totalCents % qty !== 0) {
    throw new Error(`${code} refrigerant cost ${costText} does not divide into ${qtyText} pounds.`)
  }
  return {
    kind: 'refrigerant',
    description: 'Refrigerant',
    qty: String(qty),
    unitCostCents: totalCents / qty,
    isPlaceholder: false,
  }
}

function itemWarnings(lines) {
  const items = new Map(
    readCsvObjects('ITEMS.csv').map((row) => [matchKey(row['Product/Service Name']), dollarsToCents(row.Cost)]),
  )
  const warnings = []
  for (const line of lines) {
    const itemName = line.itemName ?? line.description
    const itemCost = items.get(matchKey(itemName))
    if (itemCost == null || itemCost === line.unitCostCents) continue
    warnings.push(
      `${line.code ?? line.description}: workbook has ${line.unitCostCents} cents, ITEMS.csv has ${itemCost} cents for ${itemName}. The catalog uses the workbook.`,
    )
  }
  return warnings
}

function hierarchy(historyTax) {
  const corrections = []
  const customers = [...seedCustomers('wynnefield_seed.sql'), ...seedCustomers('sasser_seed.sql')]
  if (customers.length !== 2) {
    throw new Error(`Expected Wynnefield and Sasser, found ${customers.length} customers in the seeds.`)
  }
  const properties = [
    ...seedProperties('wynnefield_seed.sql', 8),
    ...seedProperties('sasser_seed.sql', 7),
  ]
  const wynnefieldId = customers.find((customer) => customer.name === 'Wynnefield Properties')?.id
  const doorByKey = new Map()
  for (const row of readCsvObjects('Wynnefield Properties - Locations.csv')) {
    const name = row.Property
    if (!name || !String(name).trim()) continue
    doorByKey.set(matchKey(name), row)
  }
  const sasserPhone = new Map()
  for (const row of readCsvObjects('Sasser Companies - Locations.csv')) {
    sasserPhone.set(matchKey(row.Location), cleanPhone(row['Site Contact']))
  }

  const contacts = []
  const links = []
  const contactByKey = new Map()

  function addContact({ customerId, name, phone, title, email = null, smsOk, propertyId, primary }) {
    const key = `${customerId}|${matchKey(name)}|${phoneDigits(phone)}`
    let contact = contactByKey.get(key)
    if (!contact) {
      contact = {
        id: uuidV5(`contact:${key}`),
        customerId,
        name,
        phone,
        email,
        title,
        smsOk,
      }
      contactByKey.set(key, contact)
      contacts.push(contact)
    }
    if (!propertyId) return contact
    const existing = links.find((link) => link.contactId === contact.id && link.propertyId === propertyId)
    if (existing) {
      existing.isPrimary = existing.isPrimary || primary
      return contact
    }
    links.push({
      id: uuidV5(`link:${contact.id}|${propertyId}`),
      contactId: contact.id,
      propertyId,
      isPrimary: primary,
    })
    return contact
  }

  for (const customer of customers) {
    customer.contract = CONTRACT
    const billing = addContact({
      customerId: customer.id,
      name: `${customer.name} billing`,
      phone: null,
      title: 'Billing',
      smsOk: false,
      propertyId: null,
      primary: false,
    })
    customer.billingContactId = billing.id
  }

  for (const property of properties) {
    const key = matchKey(property.name)
    const tax = historyTax.get(`${property.customerId}|${key}`)
    property.taxRateBps = tax ?? 675
    if (!property.address) {
      property.address = 'Address not on file'
      property.access = 'Street address was missing in the source file. Correct it before dispatch.'
      corrections.push(`${property.name}: street was unusable in the source file. Stored "Address not on file".`)
    }
    if (!property.zip) {
      if (key === 'juniper village' && matchKey(property.city) === 'lillington') {
        property.zip = '27546'
        corrections.push('Juniper Village: ZIP was blank. Set to 27546, the only ZIP for Lillington.')
      } else {
        throw new Error(`${property.name} has no ZIP.`)
      }
    }
    if (!property.city || !property.state) {
      throw new Error(`${property.name} is missing a city or state.`)
    }
    const door = doorByKey.get(key)
    const accessNote = door?.['Door Combinations'] || property.access
    const access = accessFields(accessNote)
    property.siteAccess = access.siteAccess
    property.lockbox = access.lockbox
    if (property.customerId === wynnefieldId) {
      if (!door) throw new Error(`No Wynnefield contact row for ${property.name}.`)
      const roles = [
        ['Manager', door.Manager, door['Manager Cell']],
        ['Maintenance', door.Maintenance, door['Maintenance Cell']],
        ['Regional', door.Regional, door['Regional Manager Cell']],
      ]
      let hasPrimary = false
      for (const [title, name, phone] of roles) {
        const cleanedName = String(name ?? '').trim()
        if (!cleanedName) continue
        addContact({
          customerId: property.customerId,
          name: cleanedName,
          phone: cleanPhone(phone),
          title,
          smsOk: true,
          propertyId: property.id,
          primary: !hasPrimary,
        })
        hasPrimary = true
      }
      const officePhone = cleanPhone(door['Property Phone'])
      if (officePhone) {
        addContact({
          customerId: property.customerId,
          name: `${property.name} office`,
          phone: officePhone,
          title: 'Property office',
          smsOk: false,
          propertyId: property.id,
          primary: !hasPrimary,
        })
        hasPrimary = true
      }
      if (!hasPrimary) throw new Error(`${property.name} has nobody to call.`)
    } else {
      const phone = sasserPhone.get(key)
      if (!phone) throw new Error(`No Sasser site phone for ${property.name}.`)
      addContact({
        customerId: property.customerId,
        name: `${property.name} site line`,
        phone,
        title: 'Site contact',
        smsOk: true,
        propertyId: property.id,
        primary: true,
      })
    }
  }

  const withoutPrimary = properties.filter(
    (property) => !links.some((link) => link.propertyId === property.id && link.isPrimary),
  )
  if (withoutPrimary.length) {
    throw new Error(`No primary contact: ${withoutPrimary.map((property) => property.name).join(', ')}`)
  }

  return { customers, properties, contacts, links, corrections }
}

function historyRows() {
  const rows = []
  const seen = new Map()
  readCsvObjects(SOURCE_FILE).forEach((row, index) => {
    const sourceRow = index + 1
    const when = parseWhen(row.job_date, sourceRow)
    const diagnosisCode = (row.diagnosis ?? '').trim() || null
    const diagnosisRaw = (row.diagnosis_raw ?? '').trim() || null
    const record = {
      sourceFile: SOURCE_FILE,
      sourceRow,
      customerName: (row.customer ?? '').trim(),
      propertyName: (row.location ?? '').trim(),
      unitLabel: (row.unit ?? '').trim() || null,
      jobOn: when.jobOn,
      occurredAt: when.occurredAt,
      diagnosisCode,
      diagnosisRaw,
      subtotalCents: dollarsToCents(row.invoice_subtotal),
      taxRateBps: taxRateBps(row.tax_rate),
      taxCents: dollarsToCents(row.invoice_tax),
      totalCents: dollarsToCents(row.invoice_total),
    }
    if (!record.customerName || !record.propertyName) {
      throw new Error(`Row ${sourceRow} is missing a customer or location.`)
    }
    const basis = [
      record.customerName,
      record.propertyName,
      record.unitLabel ?? '',
      record.occurredAt,
      record.diagnosisCode ?? '',
      record.diagnosisRaw ?? '',
      record.subtotalCents ?? '',
      record.taxRateBps ?? '',
      record.taxCents ?? '',
      record.totalCents ?? '',
    ].join('\u001f')
    const occurrence = (seen.get(basis) ?? 0) + 1
    seen.set(basis, occurrence)
    record.sourceKey = sha256(`${basis}\u001f${occurrence}`)
    rows.push(record)
  })
  const keys = new Set(rows.map((row) => row.sourceKey))
  if (keys.size !== rows.length) throw new Error('History source keys collided.')
  return rows
}

function propertyTax(history, customers) {
  const customerId = new Map(customers.map((customer) => [matchKey(customer.name), customer.id]))
  const rates = new Map()
  for (const row of history) {
    const id = customerId.get(matchKey(row.customerName))
    if (!id || row.taxRateBps == null) continue
    const key = `${id}|${matchKey(row.propertyName)}`
    if (!rates.has(key)) rates.set(key, new Set())
    rates.get(key).add(row.taxRateBps)
  }
  const single = new Map()
  for (const [key, values] of rates) {
    if (values.size === 1) single.set(key, [...values][0])
  }
  return single
}

export function resolveHistory(history, customers, properties, bundles) {
  const customerByKey = new Map(customers.map((customer) => [matchKey(customer.name), customer]))
  const propertyByKey = new Map(
    properties.map((property) => [`${property.customerId}|${matchKey(property.name)}`, property]),
  )
  const bundleByKey = new Map(bundles.map((bundle) => [matchKey(bundle.code), bundle]))
  const units = new Map()
  const resolved = history.map((row) => {
    const customer = customerByKey.get(matchKey(row.customerName))
    const property = customer
      ? propertyByKey.get(`${customer.id}|${matchKey(row.propertyName)}`)
      : null
    const code = catalogCode(row.diagnosisCode)
    const bundle = code ? bundleByKey.get(matchKey(code)) : null
    let unitId = null
    if (property && row.unitLabel) {
      const norm = row.unitLabel.toLowerCase()
      const unitKey = `${property.id}|${norm}`
      if (!units.has(unitKey)) {
        units.set(unitKey, {
          id: uuidV5(`unit:${unitKey}`),
          propertyId: property.id,
          unitLabel: row.unitLabel,
          unitLabelNorm: norm,
        })
      }
      unitId = units.get(unitKey).id
    }
    const next = {
      ...row,
      customerId: customer?.id ?? null,
      propertyId: property?.id ?? null,
      unitId,
      bundleId: bundle?.id ?? null,
    }
    next.matchNotes = notesFor(next)
    return next
  })
  return { history: resolved, units: [...units.values()] }
}

function rankBundles(bundles, history) {
  const codeOf = new Map(bundles.map((bundle) => [bundle.id, bundle.code]))
  const counts = new Map()
  for (const row of history) {
    if (!row.bundleId) continue
    counts.set(row.bundleId, (counts.get(row.bundleId) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || codeOf.get(a[0]).localeCompare(codeOf.get(b[0])),
  )
  const rank = new Map(ranked.slice(0, 8).map(([id], index) => [id, index + 1]))
  return bundles.map((bundle) => ({ ...bundle, quickSelectRank: rank.get(bundle.id) ?? null }))
}

function assertReconciliation(plan) {
  const unmatched = [
    ...new Set(plan.history.filter((row) => !row.propertyId).map((row) => row.propertyName)),
  ].sort()
  const expected = [...UNMATCHED_PROPERTIES].sort()
  if (unmatched.join('|') !== expected.join('|')) {
    throw new Error(
      `Unmatched properties changed.\nExpected: ${expected.join(', ')}\nActual: ${unmatched.join(', ')}`,
    )
  }
  const wall = plan.history.filter((row) => row.diagnosisCode === WALL_MOUNT_CODE)
  if (wall.some((row) => row.bundleId)) {
    throw new Error('A wall-mount bundle was created. Leave that repair for the repair builder.')
  }
  const atticAlias = plan.history.filter((row) => DIAGNOSIS_ALIASES[row.diagnosisCode])
  if (atticAlias.some((row) => !row.bundleId)) {
    throw new Error('The older attic/crawl change-out code did not link to the catalog.')
  }
  if (plan.bundles.some((bundle) => /wall[\s-]*mount/i.test(`${bundle.code} ${bundle.title}`))) {
    throw new Error('The catalog contains a wall-mount bundle.')
  }
}

export function buildPlan() {
  const seedIds = seedBundles()
  const built = workbookBundles(seedIds)
  const history = historyRows()
  const customers = [...seedCustomers('wynnefield_seed.sql'), ...seedCustomers('sasser_seed.sql')]
  const tax = propertyTax(history, customers)
  const tree = hierarchy(tax)
  const resolved = resolveHistory(history, tree.customers, tree.properties, built.bundles)
  const bundles = rankBundles(built.bundles, resolved.history)
  const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]))
  const lines = built.lines.map((line) => ({
    ...line,
    code: bundleById.get(line.bundleId)?.code,
  }))
  const skippedSeed = [...seedIds.keys()].filter((code) => !bundles.some((bundle) => bundle.code === code))
  const plan = {
    bundles,
    lines,
    customers: tree.customers,
    properties: tree.properties,
    contacts: tree.contacts,
    links: tree.links,
    units: resolved.units,
    history: resolved.history,
    corrections: tree.corrections,
    warnings: itemWarnings(lines),
    skippedSeed,
    skippedWorkbook: built.skipped,
  }
  assertReconciliation(plan)
  return plan
}

export function summarize(plan) {
  const totalCents = plan.history.reduce((sum, row) => sum + (row.totalCents ?? 0), 0)
  const byProperty = new Map()
  for (const row of plan.history) {
    byProperty.set(row.propertyName, (byProperty.get(row.propertyName) ?? 0) + 1)
  }
  const linked = plan.history.filter((row) => row.bundleId).length
  const quick = plan.bundles
    .filter((bundle) => bundle.quickSelectRank)
    .sort((a, b) => a.quickSelectRank - b.quickSelectRank)
    .map((bundle) => `${bundle.quickSelectRank}. ${bundle.code}`)
  return {
    bundles: plan.bundles.length,
    lines: plan.lines.length,
    customers: plan.customers.length,
    properties: plan.properties.length,
    contacts: plan.contacts.length,
    links: plan.links.length,
    units: plan.units.length,
    history: plan.history.length,
    historyLinked: linked,
    historyUnlinked: plan.history.length - linked,
    totalCents,
    propertiesInHistory: byProperty.size,
    quick,
    corrections: plan.corrections,
    warnings: plan.warnings,
    skippedSeed: plan.skippedSeed,
  }
}
