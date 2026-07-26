import { Pool } from "pg"

function setupPostgres(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set - Postgres is not configured!")
  }
  return new Pool({ connectionString: process.env.DATABASE_URL })
}

const pool = setupPostgres()
export default pool
