import './load-env.mjs';
import { Pool } from 'pg';

const SAFE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const safeTableName = (value, fallback) => {
  if (typeof value === 'string' && SAFE_NAME.test(value)) return value;
  return fallback;
};

const createPoolFromEnv = () => {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new Pool({
      connectionString,
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }

  if (!process.env.PGHOST) return null;

  return new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
};

export const pool = createPoolFromEnv();
export const isPostgresConfigured = () => Boolean(pool);
