#!/usr/bin/env tsx
/**
 * Migration runner script for Drizzle ORM
 * 
 * Usage:
 *   pnpm migrate          - Run pending migrations
 *   pnpm migrate:generate - Generate a new migration
 *   pnpm migrate:push     - Push schema changes directly (dev only)
 *   pnpm migrate:drop     - Drop all tables (dev only)
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, getPool } from './src/db';

async function runMigrations() {
  console.log('Running migrations...');
  
  try {
    // Run migrations
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    // Close the pool
    const pool = getPool();
    await pool.end();
  }
}

// Run if called directly
runMigrations();
