import { describe, it, expect } from 'vitest';
import { testPool } from './setup.js';

describe('was_inside_at()', () => {
  it('GEOFENCE: DENTRO con marca antes del instante evaluado', async () => {
    const r = await testPool.query<{ ok: boolean }>(
      `SELECT was_inside_at(d, now() - interval '30 minutes') AS ok
         FROM device d WHERE id = 'dddddddd-0000-0000-0000-000000000001'`,
    );
    expect(r.rows[0]?.ok).toBe(true);
  });

  it('GEOFENCE: marca de entrada posterior → false', async () => {
    const r = await testPool.query<{ ok: boolean }>(
      `SELECT was_inside_at(d, now() - interval '2 hours') AS ok
         FROM device d WHERE id = 'dddddddd-0000-0000-0000-000000000001'`,
    );
    expect(r.rows[0]?.ok).toBe(false);
  });

  it('QR: caducado en el instante evaluado → false', async () => {
    await testPool.query(
      `UPDATE device SET
         presence_source = 'QR', presence_state = 'DENTRO',
         last_entered_at = now() - interval '11 hours',
         qr_expires_at = now() - interval '1 hour',
         last_left_at = NULL
       WHERE id = 'dddddddd-0000-0000-0000-000000000001'`,
    );
    const r = await testPool.query<{ ok: boolean }>(
      `SELECT was_inside_at(d, now()) AS ok
         FROM device d WHERE id = 'dddddddd-0000-0000-0000-000000000001'`,
    );
    expect(r.rows[0]?.ok).toBe(false);
  });
});
