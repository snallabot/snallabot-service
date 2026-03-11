import { Pool } from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error(`No PostgresDB connection found`)
}

export const dbClientPool = new Pool({
  connectionString: process.env.DATABASE_URL
})
