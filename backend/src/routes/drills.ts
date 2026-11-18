import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate } from '../auth.js';

export const drillsRouter = Router();

drillsRouter.use(authenticate);

const CAN_START = new Set(['COORD_INCIDENTES', 'JEFE_SEGURIDAD', 'ADMIN_TIC']);

/**
 * POST /v1/drills
 * Simulacro: crea incidente + alerta con is_drill=true.
 *   { type_code, building_code, severity: 'ROJO'|'AMARILLO', level, message? }
 */
drillsRouter.post('/', async (req, res, next) => {
  try {
    if (!req.user!.roles.some((r) => CAN_START.has(r))) {
      res.status(403).json({ error: 'FORBIDDEN' });
      return;
    }

    const { type_code, building_code, severity, level, message } = req.body ?? {};
    if (!type_code || !building_code) {
      res.status(400).json({ error: 'BAD_REQUEST' });
      return;
    }
    if (!['ROJO', 'AMARILLO'].includes(severity)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'severity ROJO|AMARILLO' });
      return;
    }
    if (![1, 2, 3].includes(level)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'level 1|2|3' });
      return;
    }

    const bld = await pool.query<{ id: string }>(
      'SELECT id FROM building WHERE code = $1',
      [building_code],
    );
    if (!bld.rows[0]) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const inc = await pool.query<{ id: string }>(
      `INSERT INTO incident
         (type_code, origin_building_id, affected_buildings, description,
          reported_by, severity, level, status)
       VALUES ($1, $2, ARRAY[$2]::uuid[], $3, $4, $5, $6, 'CONFIRMADO')
       RETURNING id`,
      [
        type_code, bld.rows[0].id,
        `[SIMULACRO] ${message ?? 'Ejercicio programado'}`,
        req.user!.id, severity, level,
      ],
    );
    const incidentId = inc.rows[0]!.id;

    await pool.query(
      `INSERT INTO incident_event (incident_id, actor_id, kind, payload)
       VALUES ($1, $2, 'DRILL_STARTED', $3::jsonb)`,
      [incidentId, req.user!.id, JSON.stringify({ type: type_code, building: building_code })],
    );

    const alert = await pool.query<{ id: string }>(
      `INSERT INTO alert
         (severity, level, message, incident_id, is_drill, created_by)
       VALUES ($1, $2, $3, $4, true, $5)
       RETURNING id`,
      [
        severity, level,
        `[SIMULACRO] ${message ?? 'Ejercicio de evacuación en curso.'}`,
        incidentId, req.user!.id,
      ],
    );

    const audience = await pool.query<{ person_id: string; delivery_reason: string | null }>(
      `SELECT person_id, delivery_reason
         FROM resolve_alert_audience($1, $2, $3, ARRAY[$3]::uuid[], now())`,
      [severity, level, bld.rows[0].id],
    );

    for (const row of audience.rows) {
      await pool.query(
        `INSERT INTO alert_delivery
           (alert_id, person_id, escalation_step, delivery_reason, sent_at)
         VALUES ($1, $2, 0, $3, now())`,
        [alert.rows[0]!.id, row.person_id, row.delivery_reason],
      );
    }

    res.status(201).json({ incident_id: incidentId, alert_id: alert.rows[0]!.id });
  } catch (err) {
    next(err);
  }
});

/** POST /v1/drills/:incidentId/close */
drillsRouter.post('/:incidentId/close', async (req, res, next) => {
  try {
    if (!req.user!.roles.some((r) => CAN_START.has(r))) {
      res.status(403).json({ error: 'FORBIDDEN' });
      return;
    }

    const r = await pool.query(
      `UPDATE incident SET status = 'CERRADO', closed_at = now()
       WHERE id = $1 AND description LIKE '[SIMULACRO]%'`,
      [req.params.incidentId],
    );
    if (!r.rowCount) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    await pool.query(
      `INSERT INTO incident_event (incident_id, actor_id, kind, payload)
       VALUES ($1, $2, 'DRILL_CLOSED', '{}'::jsonb)`,
      [req.params.incidentId, req.user!.id],
    );

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/drills/:incidentId/metrics
 * Latencia de acuse P50/P90 y totales.
 */
drillsRouter.get('/:incidentId/metrics', async (req, res, next) => {
  try {
    const inc = await pool.query<{ reported_at: string; closed_at: string | null }>(
      'SELECT reported_at::text, closed_at::text FROM incident WHERE id = $1',
      [req.params.incidentId],
    );
    if (!inc.rows[0]) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const deliveries = await pool.query<{
      sent_at: string | null;
      acked_at: string | null;
    }>(
      `SELECT ad.sent_at::text, ad.acked_at::text
         FROM alert_delivery ad
         JOIN alert a ON a.id = ad.alert_id
        WHERE a.incident_id = $1 AND a.is_drill = true`,
      [req.params.incidentId],
    );

    const latencies: number[] = [];
    for (const d of deliveries.rows) {
      if (d.sent_at && d.acked_at) {
        latencies.push(
          (new Date(d.acked_at).getTime() - new Date(d.sent_at).getTime()) / 1000,
        );
      }
    }
    latencies.sort((a, b) => a - b);

    const pick = (p: number) =>
      latencies.length === 0
        ? null
        : latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]!;

    res.json({
      incident_id: req.params.incidentId,
      started_at: inc.rows[0].reported_at,
      closed_at: inc.rows[0].closed_at,
      total_deliveries: deliveries.rowCount ?? 0,
      acked: latencies.length,
      p50_seconds: pick(0.5),
      p90_seconds: pick(0.9),
      first_ack_seconds: latencies[0] ?? null,
    });
  } catch (err) {
    next(err);
  }
});
