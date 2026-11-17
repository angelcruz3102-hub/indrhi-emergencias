import { describe, it, expect } from 'vitest';
import { testPool } from './setup.js';

describe('inmutabilidad de bitácoras', () => {
  it('audit_log rechaza UPDATE y DELETE', async () => {
    await testPool.query(
      `INSERT INTO audit_log (action, entity, entity_id) VALUES ('TEST', 'x', 'y')`,
    );
    await expect(
      testPool.query(`UPDATE audit_log SET action = 'HACK' WHERE action = 'TEST'`),
    ).rejects.toThrow(/inmutable/);
    await expect(
      testPool.query(`DELETE FROM audit_log WHERE action = 'TEST'`),
    ).rejects.toThrow(/inmutable/);
  });
});
