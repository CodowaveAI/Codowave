import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const { Pool } = pg;

// Create a pool with connection string from environment
function createPool() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  
  return new Pool({
    connectionString: databaseUrl,
  });
}

// Singleton pool instance
let pool: pg.Pool | null = null;

// Get or create the pool
export function getPool(): pg.Pool {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

// Database instance
export const db = drizzle({
  client: getPool(),
  schema,
  logger: process.env.NODE_ENV === 'development',
});

// Export schema for use in migrations
export { schema };
