import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'

const here = path.dirname(fileURLToPath(import.meta.url))

export const root = path.resolve(here, '../..')
export const dataDir = path.join(root, 'data/import')

// RFC 4122 DNS namespace. Used only to prove uuidV5 before we mint import ids.
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const IMPORT_NAMESPACE = '6f4e8a2c-1b7d-4e9a-8c55-0d3a6b9e4f21'

export function uuidV5(name, namespace = IMPORT_NAMESPACE) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  if (ns.length !== 16) {
    throw new Error(`Bad UUID namespace: ${namespace}`)
  }
  const hash = createHash('sha1').update(ns).update(String(name), 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const vector = uuidV5('www.example.com', DNS_NAMESPACE)
if (vector !== '2ed6657d-e927-568b-95e1-2665a8aea6a2') {
  throw new Error(`uuidV5 self-check failed: ${vector}`)
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function readText(name) {
  return fs.readFileSync(path.join(dataDir, name), 'utf8')
}

export function readCsvRows(name) {
  return parse(readText(name), {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: false,
  })
}

export function readCsvObjects(name) {
  return parse(readText(name), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  })
}

// Lowercase, collapse whitespace, and fold the two messy workbook names.
export function matchKey(value) {
  let text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  text = text.replace(/\s*\(aka:.*$/, '').trim()
  text = text.replace(/prop$/, '').trim()
  return text
}

export function cleanPhone(value) {
  if (value == null) return null
  let text = String(value).trim()
  if (!text || /^n\/?a$/i.test(text)) return null
  text = text.replace(/[A-Za-z]+$/g, '').trim()
  return text || null
}

export function phoneDigits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

export function dollarsToCents(value) {
  if (value == null) return null
  const original = String(value).trim()
  if (!original) return null
  const negative = original.startsWith('-') || original.startsWith('(')
  const cleaned = original.replace(/[$,()\s]/g, '').replace(/^-/, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Cannot read an amount: ${original}`)
  }
  const [dollars, fraction = ''] = cleaned.split('.')
  if (fraction.length > 2) {
    throw new Error(`Amount has more than cents: ${original}`)
  }
  const cents = Number(dollars) * 100 + Number((fraction + '00').slice(0, 2))
  return negative ? -cents : cents
}

export function taxRateBps(value) {
  if (value == null) return null
  const original = String(value).trim()
  if (!original) return null
  const cleaned = original.replace('%', '').trim()
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Cannot read a tax rate: ${original}`)
  }
  const [whole, fraction = ''] = cleaned.split('.')
  if (fraction.length > 2) {
    throw new Error(`Tax rate has too many decimals: ${original}`)
  }
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
}

export function parseBool(value, label) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'true') return true
  if (text === 'false') return false
  throw new Error(`${label} should be TRUE or FALSE, got ${JSON.stringify(value)}`)
}

export function parseHours(value, label) {
  const text = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error(`${label} is not an hour amount: ${JSON.stringify(value)}`)
  }
  return text
}

// Pulls parenthesized tuples out of the old seed files. Strings may contain
// commas, quotes, and newlines. NULL, numbers, and true/false stay unquoted.
function stripSqlComments(sql) {
  let out = ''
  let i = 0
  let inString = false
  while (i < sql.length) {
    if (!inString && sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n') i += 1
      continue
    }
    if (sql[i] === "'") {
      if (inString && sql[i + 1] === "'") {
        out += "''"
        i += 2
        continue
      }
      inString = !inString
    }
    out += sql[i]
    i += 1
  }
  return out
}

export function parseSqlTuples(sql) {
  sql = stripSqlComments(sql)
  const tuples = []
  let i = 0
  while (i < sql.length) {
    if (sql[i] !== '(') {
      i += 1
      continue
    }
    const start = i
    i += 1
    const fields = []
    let closed = false
    while (i < sql.length) {
      while (i < sql.length && /[\s,]/.test(sql[i])) i += 1
      if (i >= sql.length) break
      if (sql[i] === ')') {
        closed = true
        i += 1
        break
      }
      if (sql.startsWith('NULL', i) && !/[A-Za-z0-9_]/.test(sql[i + 4] ?? '')) {
        fields.push(null)
        i += 4
        continue
      }
      const uuid = sql.slice(i).match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
      if (uuid) {
        fields.push(uuid[0])
        i += uuid[0].length
        continue
      }
      if (sql[i] === "'") {
        i += 1
        let text = ''
        while (i < sql.length) {
          if (sql[i] === "'" && sql[i + 1] === "'") {
            text += "'"
            i += 2
            continue
          }
          if (sql[i] === "'") {
            i += 1
            break
          }
          text += sql[i]
          i += 1
        }
        fields.push(text)
        continue
      }
      const token = sql.slice(i).match(/^[A-Za-z0-9_]+(?:\.[0-9]+)?/)
      if (!token) {
        throw new Error(`Cannot read the seed SQL near: ${sql.slice(start, start + 80)}`)
      }
      fields.push(token[0])
      i += token[0].length
    }
    if (closed && fields.length > 0) tuples.push(fields)
  }
  return tuples
}

export function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (process.env[key] == null || process.env[key] === '') {
        process.env[key] = value
      }
    }
  }
}

export function connectionTarget() {
  return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || ''
}

export function isRemoteTarget(target = connectionTarget()) {
  if (!target) return false
  if (/localhost|127\.0\.0\.1|\/var\/run\/postgresql/i.test(target)) return false
  return true
}

export function redactTarget(target = connectionTarget()) {
  if (!target) {
    const host = process.env.PGHOST || 'local socket'
    const db = process.env.PGDATABASE || '(default database)'
    return `${host} / ${db}`
  }
  return target.replace(/\/\/([^:/]+):([^@]+)@/, '//$1:***@')
}
