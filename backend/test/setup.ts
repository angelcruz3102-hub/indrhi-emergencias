import { beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const connectionString =
  (process.env.TEST_DATABASE_URL ?? '').trim() ||
  'postgres://postgres:test@127.0.0.1:5432/indrhi_test';

const parsed = new URL(connectionString);
if (!parsed.username) {
  throw new Error(
    `TEST_DATABASE_URL sin usuario: "${connectionString}". ` +
      `Se esperaba algo como postgres://postgres:test@127.0.0.1:5432/indrhi_test`,
  );
}
if (parsed.username === 'root') {
  throw new Error(
    `TEST_DATABASE_URL con usuario "root". ` +
      `Configura el env en el workflow o exporta TEST_DATABASE_URL antes de "npm test".`,
  );
}

export const testPool = new pg.Pool({
  connectionString,
  max: 2,
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = process.env.SCHEMA_PATH ?? resolve(__dirname, '../db/schema.sql');
const migrationsDir = resolve(__dirname, '../db/migrations');
const seedPath = resolve(__dirname, 'seed.sql');

const CLEAN_TABLES_SQL = `
  DO $$
  DECLARE stmt text;
  BEGIN
    SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' RESTART IDENTITY CASCADE'
      INTO stmt
      FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT IN ('role', 'alert_policy');
    IF stmt IS NOT NULL THEN
      EXECUTE stmt;
    END IF;
  END $$;
`;

beforeAll(async () => {
  const client = await testPool.connect();
  try {
    // Candado exclusivo en la misma sesión para evitar colisiones y deadlocks
    await client.query('SELECT pg_advisory_lock(987654321)');
    try {
      const check = await client.query<{ exists: boolean }>(
        "SELECT to_regclass('public.site') IS NOT NULL AS exists",
      );

      // 1) Crear tablas y migraciones SOLO la primera vez
      if (!check.rows[0]?.exists) {
        await client.query(readFileSync(schemaPath, 'utf8'));
        if (existsSync(migrationsDir)) {
          for (const file of readdirSync(migrationsDir).sort()) {
            if (file.endsWith('.sql')) {
              await client.query(readFileSync(resolve(migrationsDir, file), 'utf8'));
            }
          }
        }
      }

      // 2) Limpiar datos previos y cargar seed.sql limpio para este archivo de test
      await client.query(CLEAN_TABLES_SQL);
      if (existsSync(seedPath)) {
        await client.query(readFileSync(seedPath, 'utf8'));
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(987654321)');
    }
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await testPool.query(CLEAN_TABLES_SQL);
  await testPool.end();
});
