import { beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const testPool = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL
    ?? 'postgres://postgres:test@localhost:5432/indrhi_test',
  max: 2,
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
