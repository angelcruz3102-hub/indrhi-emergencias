import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate } from '../auth.js';

export const buildingsRouter = Router();

buildingsRouter.use(authenticate);

/** GET /v1/buildings */
buildingsRouter.get('/', async (_req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT b.id, b.code, b.name, b.lat, b.lon,
              s.name AS site_name
         FROM building b
         JOIN site s ON s.id = b.site_id
        ORDER BY b.code`,
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

/** GET /v1/buildings/:code/dispensary */
buildingsRouter.get('/:code/dispensary', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT d.id, d.name, d.phone, b.code AS building_code
         FROM dispensary d
         JOIN building b ON b.id = d.building_id
        WHERE b.code = $1`,
      [req.params.code],
    );
    if (!r.rows[0]) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

/** GET /v1/buildings/:code/assembly-points */
buildingsRouter.get('/:code/assembly-points', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT ap.id, ap.name, ap.lat, ap.lon
         FROM assembly_point ap
         JOIN building b ON b.id = ap.building_id
        WHERE b.code = $1
        ORDER BY ap.name`,
      [req.params.code],
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

/** GET /v1/buildings/:code/route-blocks */
buildingsRouter.get('/:code/route-blocks', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT rb.id, rb.description, rb.starts_at, rb.ends_at,
              rb.reported_by, rb.confirmed_by
         FROM route_block rb
         JOIN building b ON b.id = rb.building_id
        WHERE b.code = $1
          AND (rb.ends_at IS NULL OR rb.ends_at > now())
        ORDER BY rb.starts_at DESC`,
      [req.params.code],
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

/** POST /v1/buildings/:code/route-blocks { description } */
buildingsRouter.post('/:code/route-blocks', async (req, res, next) => {
  try {
    const { description } = req.body ?? {};
    if (typeof description !== 'string' || !description.trim()) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'description requerido' });
      return;
    }

    const bld = await pool.query<{ id: string }>(
      'SELECT id FROM building WHERE code = $1',
      [req.params.code],
    );
    if (!bld.rows[0]) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO route_block (building_id, description, reported_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [bld.rows[0].id, description.trim(), req.user!.id],
    );

    res.status(201).json({ id: inserted.rows[0]!.id });
  } catch (err) {
    next(err);
  }
});
