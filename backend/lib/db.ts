import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

export const sql = postgres(databaseUrl, { ssl: 'require', max: 10 })

/** Every owner-scoped query runs in one transaction with an unforgeable SQL context. */
export async function asUser(userId: string, run: (tx: any) => Promise<any>): Promise<any> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`
    return run(tx)
  })
}
