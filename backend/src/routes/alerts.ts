import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate } from '../auth.js';

export const alertsRouter = Router();

alertsRouter.use(authenticate);

const SEVERITIES = new Set(['ROJO', 'AMARILLO', 'VERDE']);

/**
 * POST /v1/alerts
 * Crea alerta + resuelve audiencia + inserta deliveries (escalation_step=0).
 *   { severity, level, message, origin_building_id, affected_buildings[],
 *     incident_id?, seismic_event_id?, is_drill? }
 */
alertsRouter.post('/', async (req, res, next) => {
  try {
    const {
      severity,
      level,
      message,
      origin_building_id,
      affected_buildings,
      incident_id,
      seismic_event_id,
      is_drill,
    } = req.body ?? {};

    if (!SEVERITIES.has(severity)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'severity inválida' });
      return;
    }
    if (![1, 2, 3].includes(level)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'level debe ser 1|2|3' });
      return;
    }
    if (typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'message requerido' });
      return;
    }
    if (!origin_building_id) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'origin_building_id requerido' });
      return;
    }

    const alertRow = await pool.query<{ id: string }>(
      `INSERT INTO alert
         (severity, level, message, incident_id, seismic_event_id, is_drill, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        severity,
        level,
        message.trim(),
        incident_id ?? null,
        seismic_event_id ?? null,
        is_drill === true,
        req.user!.id,
      ],
    );
    const alertId = alertRow.rows[0]!.id;

    const audience = await pool.query<{
      person_id: string;
      delivery_reason: string | null;
    }>(
      `SELECT person_id, delivery_reason
         FROM resolve_alert_audience($1, $2, $3, $4::uuid[], now())`,
      [severity, level, origin_building_id, affected_buildings ?? []],
    );

    for (const row of audience.rows) {
      await pool.query(
        `INSERT INTO alert_delivery
           (alert_id, person_id, escalation_step, delivery_reason, sent_at)
         VALUES ($1, $2, 0, $3, now())`,
        [alertId, row.person_id, row.delivery_reason],
      );
    }

    res.status(201).json({ id: alertId, deliveries: audience.rowCount ?? 0 });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/alerts/:id/ack
 * Marca `acked_at` para el usuario autenticado.
 */
alertsRouter.post('/:id/ack', async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE alert_delivery
          SET acked_at = COALESCE(acked_at, now())
        WHERE alert_id = $1 AND person_id = $2 AND acked_at IS NULL`,
      [req.params.id, req.user!.id],
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/alerts/:id/felt
 * Voto sísmico. Solo válido si el usuario está en el panel congelado y la
 * ventana sigue abierta.
 *   { felt: boolean }
 */
alertsRouter.post('/:id/felt', async (req, res, next) => {
  try {
    const { felt } = req.body ?? {};
    if (typeof felt !== 'boolean') {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'felt debe ser boolean' });
      return;
    }

    const alertRow = await pool.query<{ seismic_event_id: string | null }>(
      'SELECT seismic_event_id FROM alert WHERE id = $1',
      [req.params.id],
    );
    const seismicEventId = alertRow.rows[0]?.seismic_event_id;
    if (!seismicEventId) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Alerta no sísmica' });
      return;
    }

    const fd = await pool.query<{
      panel_member_ids: string[];
      window_end: string;
      result: string;
    }>(
      `SELECT panel_member_ids, window_end::text, result
         FROM felt_decision WHERE seismic_event_id = $1`,
      [seismicEventId],
    );
    const decision = fd.rows[0];
    if (!decision) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Sin panel congelado' });
      return;
    }
    if (decision.result !== 'PENDIENTE') {
      res.status(409).json({ error: 'CONFLICT', message: 'Ventana cerrada' });
      return;
    }
    if (new Date(decision.window_end) < new Date()) {
      res.status(409).json({ error: 'CONFLICT', message: 'Ventana expirada' });
      return;
    }
    if (!decision.panel_member_ids.includes(req.user!.id)) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Fuera del panel' });
      return;
    }

    await pool.query(
      `INSERT INTO felt_report (seismic_event_id, person_id, felt)
       VALUES ($1, $2, $3)
       ON CONFLICT (seismic_event_id, person_id) DO UPDATE SET felt = EXCLUDED.felt, at = now()`,
      [seismicEventId, req.user!.id, felt],
    );

    const counts = await pool.query<{ total: number; yes_count: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE felt)::int AS yes_count
         FROM felt_report WHERE seismic_event_id = $1`,
      [seismicEventId],
    );
    const c = counts.rows[0]!;

    await pool.query(
      `UPDATE felt_decision SET responses = $2, yes_count = $3
        WHERE seismic_event_id = $1`,
      [seismicEventId, c.total, c.yes_count],
    );

    res.json({ ok: true, responses: c.total, yes_count: c.yes_count });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/alerts/:id
 * Estado consolidado de una alerta.
 */
alertsRouter.get('/:id', async (req, res, next) => {
  try {
    const row = await pool.query(
      `SELECT a.*,
              (SELECT count(*) FROM alert_delivery WHERE alert_id = a.id)::int AS total,
              (SELECT count(*) FROM alert_delivery WHERE alert_id = a.id AND acked_at IS NOT NULL)::int AS acked
         FROM alert a WHERE id = $1`,
      [req.params.id],
    );
    if (!row.rows[0]) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Alerta inexistente' });
      return;
    }
    res.json(row.rows[0]);
  } catch (err) {
    next(err);
  }
});
