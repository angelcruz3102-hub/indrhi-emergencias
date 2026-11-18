import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate } from '../auth.js';

export const floorPlansRouter = Router();

floorPlansRouter.use(authenticate);

/** GET /v1/floor-plans?building=ED1 */
floorPlansRouter.get('/', async (req, res, next) => {
  try {
    const building = typeof req.query.building === 'string' ? req.query.building : null;
    const r = await pool.query(
      `SELECT fp.id, b.code AS building_code, fp.level, fp.file_url,
              fp.version, fp.valid_from::text,
              (SELECT count(*) FROM equipment e WHERE e.floor_plan_id = fp.id)::int AS equipment_count
         FROM floor_plan fp
         JOIN building b ON b.id = fp.building_id
        WHERE ($1::text IS NULL OR b.code = $1)
          AND fp.valid_from <= current_date
        ORDER BY b.code, fp.level`,
      [building],
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

/** GET /v1/floor-plans/:id — plano + equipos */
floorPlansRouter.get('/:id', async (req, res, next) => {
  try {
    const plan = await pool.query(
      `SELECT fp.id, b.code AS building_code, fp.level, fp.file_url,
              fp.version, fp.valid_from::text
         FROM floor_plan fp
         JOIN building b ON b.id = fp.building_id
        WHERE fp.id = $1`,
      [req.params.id],
    );
    if (!plan.rows[0]) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const equipment = await pool.query(
      `SELECT id, kind, plan_x::text, plan_y::text, next_inspection::text
         FROM equipment WHERE floor_plan_id = $1 ORDER BY kind`,
      [req.params.id],
    );
    res.json({ ...plan.rows[0], equipment: equipment.rows });
  } catch (err) {
    next(err);
  }
});
