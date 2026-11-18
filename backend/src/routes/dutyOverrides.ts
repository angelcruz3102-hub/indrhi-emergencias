import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate } from '../auth.js';

export const dutyOverridesRouter = Router();

dutyOverridesRouter.use(authenticate);

const MAX_HOURS = 4;

/**
 * POST /v1/duty-overrides
 * Convocatoria extraordinaria. Solo JEFE_SEGURIDAD.
 *   { incident_id, scope: 'TODOS'|'EDIFICIO'|'ROL', building_code?, role_code?,
 *     reason, starts_at, ends_at }
 */
dutyOverridesRouter.post('/', async (req, res, next) => {
  try {
    if (!req.user!.roles.includes('JEFE_SEGURIDAD')) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Solo Jefe de Seguridad' });
      return;
    }

    const {
      incident_id, scope, building_code, role_code, reason, starts_at, ends_at,
    } = req.body ?? {};

    if (!['TODOS', 'EDIFICIO', 'ROL'].includes(scope)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'scope inválido' });
      return;
    }
    if (typeof reason !== 'string' || reason.trim().length < 10) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Motivo ≥10 caracteres' });
      return;
    }
    if (!incident_id) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'incident_id requerido' });
      return;
    }

    const start = new Date(starts_at);
    const end = new Date(ends_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Rango inválido' });
      return;
    }
    if (end.getTime() - start.getTime() > MAX_HOURS * 3600 * 1000) {
      res.status(400).json({ error: 'BAD_REQUEST', message: `Máximo ${MAX_HOURS}h` });
      return;
    }

    const inc = await pool.query<{ severity: string; status: string }>(
      'SELECT severity, status FROM incident WHERE id = $1',
      [incident_id],
    );
    const row = inc.rows[0];
    if (!row) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Incidente inexistente' });
      return;
    }
    if (row.severity !== 'ROJO' || row.status === 'CERRADO' || row.status === 'FALSA_ALARMA') {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Requiere incidente ROJO activo' });
      return;
    }

    let buildingId: string | null = null;
    if (scope === 'EDIFICIO') {
      if (!building_code) {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'building_code requerido' });
        return;
      }
      const b = await pool.query<{ id: string }>(
        'SELECT id FROM building WHERE code = $1',
        [building_code],
      );
      if (!b.rows[0]) {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      buildingId = b.rows[0].id;
    } else if (scope === 'ROL') {
      if (!role_code) {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'role_code requerido' });
        return;
      }
    }

    const r = await pool.query<{ id: string }>(
      `INSERT INTO duty_override
         (created_by, incident_id, scope, building_id, role_code, reason,
          confirmed_at, during)
       VALUES ($1, $2, $3, $4, $5, $6, now(),
               tstzrange($7::timestamptz, $8::timestamptz, '[)'))
       RETURNING id`,
      [
        req.user!.id, incident_id, scope, buildingId, role_code ?? null,
        reason.trim(), start.toISOString(), end.toISOString(),
      ],
    );

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id)
       VALUES ($1, 'DUTY_OVERRIDE_CREATED', 'duty_override', $2)`,
      [req.user!.id, r.rows[0]!.id],
    );

    res.status(201).json({ id: r.rows[0]!.id });
  } catch (err) {
    next(err);
  }
});

/** GET /v1/duty-overrides/active */
dutyOverridesRouter.get('/active', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT o.id, o.scope, b.code AS building_code, o.role_code,
              o.reason, o.during::text
         FROM duty_override o
         LEFT JOIN building b ON b.id = o.building_id
        WHERE o.during @> now()`,
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});
