import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const here = dirname(fileURLToPath(import.meta.url))
const migration = await readFile(resolve(here, '../../database/migrations/001_initial.sql'), 'utf8')
const sql = postgres(connectionString, { ssl: 'require', max: 1 })
try { await sql.unsafe(migration); console.log('Applied database/migrations/001_initial.sql') } finally { await sql.end() }
