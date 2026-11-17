import { beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// ────────────────────────────────────────────────────────────────
// Resolución del connection string.
//   - `||` (no `??`): si llega '' o undefined, cae al default.
//   - Guard explícito: si algo quedó mal, falla ruidosamente AQUÍ
//     y no más abajo con "role root does not exist".
// ────────────────────────────────────────────────────────────────
const connectionString =
  (process.env.TEST_DATABASE_URL ?? '').trim() ||
  'postgres://postgres:test@localhost:5432/indrhi_test';

const parsed = new URL(connectionString);
if (!parsed.username) {
  throw new Error(
    `TEST_DATABASE_URL sin usuario: "${connectionString}". ` +
      `Se esperaba algo como postgres://postgres:test@localhost:5432/indrhi_test`,
  );
}
if (parsed.username === 'root') {
  throw new Error(
    `TEST_DATABASE_URL con usuario "root". ` +
      `Configura el env en el workflow o exporta TEST_DATABASE_URL antes de "npm test".`,
  );
}

console.log(
  `[test/setup] conectando como "${parsed.username}" a ${parsed.host}:${parsed.port}${parsed.pathname}`,
);

export const testPool = new pg.Pool({
  connectionString,
  max: 2,
  // Sin `user`, sin `password` sueltos: TODO viene del connectionString.
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = process.env.SCHEMA_PATH ?? resolve(__dirname, '../db/schema.sql');
const migrationsDir = resolve(__dirname, '../db/migrations');
const seedPath = resolve(__dirname, 'seed.sql');

beforeAll(async () => {
  await testPool.query(readFileSync(schemaPath, 'utf8'));
  if (existsSync(migrationsDir)) {
    for (const file of readdirSync(migrationsDir).sort()) {
      if (file.endsWith('.sql')) {
        await testPool.query(readFileSync(resolve(migrationsDir, file), 'utf8'));
      }
    }
  }
  if (existsSync(seedPath)) {
    await testPool.query(readFileSync(seedPath, 'utf8'));
  }
});

afterAll(async () => {
  await testPool.query(`
    TRUNCATE TABLE
      alert_delivery, alert, safety_status, building_clearance,
      incident_event, incident, duty_override, time_off, shift_instance,
      assignment, device, person, perimeter_zone, building, site
    RESTART IDENTITY CASCADE
  `);
  await testPool.end();
});
