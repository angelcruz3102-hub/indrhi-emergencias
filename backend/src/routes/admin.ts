import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate } from '../auth.js';

export const adminRouter = Router();

adminRouter.use(authenticate);

/**
 * Calibración sísmica en memoria. Persistir en tabla dedicada queda como
 * siguiente paso; por ahora se reinicia con cada deploy.
 */
const runtimeParams = {
  k: Number(process.env.SEISMIC_K ?? 1.0),
  i_min: Number(process.env.SEISMIC_I_MIN ?? 2.35),
  max_hypo_km: Number(process.env.SEISMIC_MAX_HYPO_KM ?? 250),
  min_mag: Number(process.env.SEISMIC_MIN_MAG ?? 4.0),
};

function requireAdmin(roles: string[]): boolean {
  return roles.some((r) => ['ADMIN_TIC', 'COORD_INCIDENTES'].includes(r));
}

/** GET /v1/admin/seismic-params */
adminRouter.get('/seismic-params', async (_req, res, next) => {
  try {
    res.json({ ...runtimeParams });
  } catch (err) {
    next(err);
  }
});

/** PUT /v1/admin/seismic-params { k?, i_min?, max_hypo_km?, min_mag? } */
adminRouter.put('/seismic-params', async (req, res, next) => {
  try {
    if (!requireAdmin(req.user!.roles)) {
      res.status(403).json({ error: 'FORBIDDEN' });
      return;
    }
    const { k, i_min, max_hypo_km, min_mag } = req.body ?? {};
    if (typeof k === 'number' && k > 0) runtimeParams.k = k;
    if (typeof i_min === 'number') runtimeParams.i_min = i_min;
    if (typeof max_hypo_km === 'number' && max_hypo_km > 0) {
      runtimeParams.max_hypo_km = max_hypo_km;
    }
    if (typeof min_mag === 'number' && min_mag > 0) runtimeParams.min_mag = min_mag;

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id)
       VALUES ($1, 'SEISMIC_PARAMS_UPDATED', 'config', $2)`,
      [req.user!.id, JSON.stringify(runtimeParams)],
    );

    res.json({ ...runtimeParams });
  } catch (err) {
    next(err);
  }
});

/** GET /v1/admin/protocols */
adminRouter.get('/protocols', async (_req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT code, version, title, effective_from::text, checksum,
              approved_by
         FROM protocol_doc
        ORDER BY code, version DESC`,
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/admin/protocols
 *   { code, version, title, content_md, checksum, effective_from? }
 */
adminRouter.post('/protocols', async (req, res, next) => {
  try {
    if (!req.user!.roles.includes('ADMIN_TIC')) {
      res.status(403).json({ error: 'FORBIDDEN' });
      return;
    }
    const {
      code, version, title, content_md, checksum, effective_from,
    } = req.body ?? {};

    if (!code || !Number.isInteger(version) || !title || !content_md || !checksum) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Campos incompletos' });
      return;
    }

    await pool.query(
      `INSERT INTO protocol_doc
         (code, version, title, effective_from, content_md, checksum, approved_by)
       VALUES ($1, $2, $3, COALESCE($4::date, current_date), $5, $6, $7)
       ON CONFLICT (code, version) DO UPDATE SET
         title = EXCLUDED.title,
         content_md = EXCLUDED.content_md,
         checksum = EXCLUDED.checksum,
         approved_by = EXCLUDED.approved_by`,
      [
        code, version, title, effective_from ?? null,
        content_md, checksum, req.user!.id,
      ],
    );

    res.status(201).json({ code, version });
  } catch (err) {
    next(err);
  }
});
