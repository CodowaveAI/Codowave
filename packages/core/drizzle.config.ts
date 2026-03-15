import { defineConfig } from 'drizzle-kit';
import * as schema from './src/db/schema';

export default defineConfig({
  schema,
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  verbose: process.env.NODE_ENV === 'development',
  strict: true,
});
