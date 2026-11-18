import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate } from '../auth.js';

export const devicesRouter = Router();

devicesRouter.use(authenticate);

/**
 * POST /v1/devices/token
 * Upsert del `fcm_token` para el usuario autenticado.
 */
devicesRouter.post('/token', async (req, res, next) => {
  try {
    const { fcm_token, app_version } = req.body ?? {};
    if (typeof fcm_token !== 'string' || fcm_token.length < 20) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'fcm_token inválido' });
      return;
    }

    await pool.query(
      `INSERT INTO device (person_id, fcm_token, app_version, last_seen_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (fcm_token) DO UPDATE SET
         person_id = EXCLUDED.person_id,
         app_version = EXCLUDED.app_version,
         last_seen_at = now()`,
      [req.user!.id, fcm_token, app_version ?? null],
    );

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/devices/presence
 * Transición de presencia. Solo estado + marcas de tiempo, nunca coordenadas.
 *   { device_id, state, source, building_code?, last_entered_at, last_left_at }
 */
devicesRouter.post('/presence', async (req, res, next) => {
  try {
    const {
      device_id,
      state,
      source,
      last_entered_at,
      last_left_at,
    } = req.body ?? {};

    if (!device_id || !['DENTRO', 'FUERA', 'DESCONOCIDA'].includes(state)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'device_id/state inválidos' });
      return;
    }
    if (!['GEOFENCE', 'QR'].includes(source)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'source inválido' });
      return;
    }
    // Rechazo explícito de coordenadas (Ley 172-13 / D9).
    if ('lat' in req.body || 'lon' in req.body || 'latitude' in req.body) {
      res.status(400).json({
        error: 'FORBIDDEN',
        message: 'El servidor no acepta coordenadas. Solo estado y marcas de tiempo.',
      });
      return;
    }

    const r = await pool.query(
      `UPDATE device SET
         presence_state = $2,
         presence_source = $3,
         last_entered_at = $4,
         last_left_at = $5,
         last_seen_at = now()
       WHERE id = $1 AND person_id = $6`,
      [device_id, state, source, last_entered_at ?? null, last_left_at ?? null, req.user!.id],
    );

    if (!r.rowCount) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Device no encontrado' });
      return;
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/devices/delivery
 * Reporta el estado de salud de entrega (los 5 indicadores del RF-9.4).
 *   { device_id, health: { notifications, dnd, full_screen, battery, location } }
 */
devicesRouter.post('/delivery', async (req, res, next) => {
  try {
    const { device_id, health } = req.body ?? {};
    if (!device_id || typeof health !== 'object' || health === null) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'device_id/health requeridos' });
      return;
    }

    await pool.query(
      `UPDATE device SET delivery_health = $2::jsonb, last_seen_at = now()
       WHERE id = $1 AND person_id = $3`,
      [device_id, JSON.stringify(health), req.user!.id],
    );

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
