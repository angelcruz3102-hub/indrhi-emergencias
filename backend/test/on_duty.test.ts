import { describe, it, expect, beforeEach } from 'vitest';
import { testPool } from './setup.js';

const P = 'aaaaaaaa-0000-0000-0000-000000000005';

beforeEach(async () => {
  await testPool.query('DELETE FROM time_off WHERE person_id = $1', [P]);
  await testPool.query('DELETE FROM shift_instance WHERE person_id = $1', [P]);
});

describe('on_duty()', () => {
  it('devuelve al empleado dentro de la gracia de ±30 min', async () => {
    await testPool.query(
      `INSERT INTO shift_instance (person_id, during)
       VALUES ($1, tstzrange(now() - interval '10 minutes', now() + interval '5 hours', '[)'))`,
      [P],
    );
    const r = await testPool.query<{ person_id: string }>('SELECT person_id FROM on_duty(now())');
    expect(r.rows.map((x) => x.person_id)).toContain(P);
  });

  it('NO lo devuelve si time_off cubre el instante evaluado', async () => {
    await testPool.query(
      `INSERT INTO shift_instance (person_id, during)
       VALUES ($1, tstzrange(now() - interval '1 hour', now() + interval '5 hours', '[)'))`,
      [P],
    );
    await testPool.query(
      `INSERT INTO time_off (person_id, kind, during)
       VALUES ($1, 'VACACIONES', tstzrange(now() - interval '30 minutes', now() + interval '1 hour', '[)'))`,
      [P],
    );
    const r = await testPool.query<{ person_id: string }>('SELECT person_id FROM on_duty(now())');
    expect(r.rows.map((x) => x.person_id)).not.toContain(P);
  });
});
