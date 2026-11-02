import pg from 'pg'
import { applyPlan, isNoop } from './apply.mjs'
import {
  connectionTarget,
  isRemoteTarget,
  loadEnvFiles,
  redactTarget,
} from './lib.mjs'
import { buildPlan, summarize } from './plan.mjs'
import { formatProblems, money, verifyDatabase } from './verify.mjs'

const { Client } = pg

function flag(name) {
  return process.argv.includes(name)
}

function printPlan(plan) {
  const summary = summarize(plan)
  console.log('From the files')
  console.log(`  Bundles:     ${summary.bundles}`)
  console.log(`  Cost lines:  ${summary.lines}`)
  console.log(`  Customers:   ${summary.customers}`)
  console.log(`  Properties:  ${summary.properties}`)
  console.log(`  Contacts:    ${summary.contacts}`)
  console.log(`  Links:       ${summary.links}`)
  console.log(`  Units:       ${summary.units}`)
  console.log(`  History:     ${summary.history}`)
  console.log(`  Linked:      ${summary.historyLinked}`)
  console.log(`  Not linked:  ${summary.historyUnlinked}`)
  console.log(`  History $:   ${money(summary.totalCents)}`)
  console.log('  Quick select:')
  for (const line of summary.quick) console.log(`    ${line}`)
  if (summary.corrections.length) {
    console.log('  Corrections:')
    for (const line of summary.corrections) console.log(`    ${line}`)
  }
  if (summary.skippedSeed.length) {
    console.log(`  Left out of the catalog: ${summary.skippedSeed.join(', ')}`)
  }
  if (summary.warnings.length) {
    console.log(`  Cost list differences: ${summary.warnings.length} (workbook wins)`)
    for (const line of summary.warnings.slice(0, 8)) console.log(`    ${line}`)
  }
  return summary
}

function printStats(stats) {
  console.log('This run')
  console.log(`  Bundles added:    ${stats.bundlesInserted}`)
  console.log(`  Cost lines added: ${stats.linesInserted}`)
  console.log(`  Customers added:  ${stats.customersInserted}`)
  console.log(`  Contacts added:   ${stats.contactsInserted}`)
  console.log(`  Properties added: ${stats.propertiesInserted}`)
  console.log(`  Links added:      ${stats.linksInserted}`)
  console.log(`  Units added:      ${stats.unitsInserted}`)
  console.log(`  History added:    ${stats.historyInserted}`)
  console.log(`  History relinked: ${stats.historyRelinked}`)
  console.log(`  History removed:  ${stats.historyRemoved}`)
}

async function main() {
  const plan = buildPlan()
  printPlan(plan)
  if (flag('--dry-run')) {
    console.log('Dry run. Nothing was written.')
    return
  }

  loadEnvFiles()
  const target = connectionTarget()
  if (isRemoteTarget(target) && !flag('--commit')) {
    console.error(
      `\nRefusing to write to ${redactTarget(target)}.\nRun again with --commit when you mean the LSP Operations database.`,
    )
    process.exit(2)
  }

  const client = new Client(
    target
      ? {
          connectionString: target,
          ssl: /supabase/i.test(target) ? { rejectUnauthorized: false } : undefined,
          application_name: 'lsp-os-import',
        }
      : { application_name: 'lsp-os-import' },
  )
  await client.connect()
  try {
    console.log(`\nWriting to ${redactTarget(target)}`)
    await client.query('begin')
    const stats = await applyPlan(client, plan)
    printStats(stats)
    if (flag('--expect-noop') && !isNoop(stats)) {
      await client.query('rollback')
      console.error('Expected a second run to change nothing except links that were already current.')
      process.exit(1)
    }
    const problems = await verifyDatabase(client, plan, { fresh: flag('--fresh') })
    if (problems.length) {
      await client.query('rollback')
      console.error(`\nImport does not reconcile:\n${formatProblems(problems)}`)
      process.exit(1)
    }
    await client.query('commit')
    console.log('\nCounts reconcile. History is not on the Board and does not count toward Financial Pulse.')
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // The connection may already be closing.
    }
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
