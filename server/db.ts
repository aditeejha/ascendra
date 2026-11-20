import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { newDb } from 'pg-mem';

export interface Db {
  mode: 'postgres' | 'in-memory';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

const SCHEMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/schema.sql');

export async function connectDb(url = process.env.DATABASE_URL): Promise<Db> {
  let pool: Queryable;
  let mode: Db['mode'];
  if (url) {
    pool = new pg.Pool({ connectionString: url });
    mode = 'postgres';
  } else {
    const adapter = newDb().adapters.createPg();
    pool = new adapter.Pool() as Queryable;
    mode = 'in-memory';
  }
  const statements = readFileSync(SCHEMA, 'utf8')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await pool.query(statement);
  return {
    mode,
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    },
  };
}
