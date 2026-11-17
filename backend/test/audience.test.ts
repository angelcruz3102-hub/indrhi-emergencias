import { describe, it, expect } from 'vitest';
import { testPool } from './setup.js';

describe('resolve_alert_audience()', () => {
  it('Nivel 1 llega a jefes del edificio + coordinación', async () => {
    const r = await testPool.query<{ person_id: string }>(
      `SELECT person_id FROM resolve_alert_audience('ROJO', 1, $1, ARRAY[]::uuid[], now())`,
      ['22222222-2222-2222-2222-222222222222'],
    );
    const ids = r.rows.map((x) => x.person_id);
    expect(ids).toContain('aaaaaaaa-0000-0000-0000-000000000002');
    expect(ids).toContain('aaaaaaaa-0000-0000-0000-000000000003');
    expect(ids).toContain('aaaaaaaa-0000-0000-0000-000000000004');
  });

  it('Nivel 2 llega al personal del edificio afectado', async () => {
    const r = await testPool.query<{ person_id: string }>(
      `SELECT person_id FROM resolve_alert_audience('ROJO', 2, $1, ARRAY[$1]::uuid[], now())`,
      ['22222222-2222-2222-2222-222222222222'],
    );
    const ids = r.rows.map((x) => x.person_id);
    expect(ids).toContain('aaaaaaaa-0000-0000-0000-000000000005');
    expect(ids).not.toContain('aaaaaaaa-0000-0000-0000-000000000006');
  });

  it('Nivel 3 incluye a todo el personal elegible', async () => {
    const r = await testPool.query<{ person_id: string }>(
      `SELECT person_id FROM resolve_alert_audience('ROJO', 3, $1, ARRAY[]::uuid[], now())`,
      ['22222222-2222-2222-2222-222222222222'],
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(5);
  });

  it('VERDE respeta turno (no llega a personal FUERA sin turno)', async () => {
    await testPool.query(
      `UPDATE device SET presence_state = 'FUERA', last_left_at = now()
        WHERE id = 'dddddddd-0000-0000-0000-000000000006'`,
    );
    const r = await testPool.query<{ person_id: string }>(
      `SELECT person_id FROM resolve_alert_audience('VERDE', 3, $1, ARRAY[]::uuid[], now())`,
      ['22222222-2222-2222-2222-222222222222'],
    );
    const ids = r.rows.map((x) => x.person_id);
    expect(ids).not.toContain('aaaaaaaa-0000-0000-0000-000000000006');
  });
});
