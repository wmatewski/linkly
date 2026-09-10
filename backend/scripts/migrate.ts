import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const here = dirname(fileURLToPath(import.meta.url))
const sql = postgres(connectionString, { ssl: 'require', max: 1 })
const migrationsDir = resolve(here, '../../database/migrations')
const migrations = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()
try {
  for (const file of migrations) {
    await sql.unsafe(await readFile(resolve(migrationsDir, file), 'utf8'))
    console.log(`Applied database/migrations/${file}`)
  }
} finally { await sql.end() }
