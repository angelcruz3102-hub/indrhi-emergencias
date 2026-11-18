import pg from 'pg';

const { Pool } = pg;

const connectionString =
  process.env.TEST_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  'postgres://postgres:test@localhost:5432/indrhi_test';

if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  console.warn(
    '[db] Ni TEST_DATABASE_URL ni DATABASE_URL están definidos. ' +
    'Usando default local: postgres://postgres:test@localhost:5432/indrhi_test',
  );
}

export const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[db] Pool error:', err.message);
});

/** Ping de salud. Retorna true si el pool puede ejecutar `SELECT 1`. */
export async function pingDb(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    console.warn('[db] pingDb falló:', (err as Error).message);
    return false;
  }
}
