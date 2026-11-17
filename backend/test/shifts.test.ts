import { describe, it, expect } from 'vitest';
import { testPool } from './setup.js';

const P = 'aaaaaaaa-0000-0000-0000-000000000005';

describe('shift_instance · constraint gist', () => {
  it('impide solapamiento para el mismo empleado', async () => {
    await testPool.query(
      `INSERT INTO shift_instance (person_id, during)
       VALUES ($1, tstzrange(now(), now() + interval '8 hours', '[)'))`,
      [P],
    );
    await expect(
      testPool.query(
        `INSERT INTO shift_instance (person_id, during)
         VALUES ($1, tstzrange(now() + interval '4 hours', now() + interval '12 hours', '[)'))`,
        [P],
      ),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('permite turnos contiguos', async () => {
    await testPool.query(
      `INSERT INTO shift_instance (person_id, during)
       VALUES ($1, tstzrange(now() + interval '1 day', now() + interval '1 day 8 hours', '[)'))`,
      [P],
    );
    await expect(
      testPool.query(
        `INSERT INTO shift_instance (person_id, during)
         VALUES ($1, tstzrange(now() + interval '1 day 8 hours', now() + interval '1 day 16 hours', '[)'))`,
        [P],
      ),
    ).resolves.toBeTruthy();
  });
});
