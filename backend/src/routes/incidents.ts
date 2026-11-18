import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate } from '../auth.js';

export const incidentsRouter = Router();

incidentsRouter.use(authenticate);

const GROUPING_WINDOW_MIN = 5;

/**
 * POST /v1/incidents
 * Reporte de 3 toques con agrupación de 5 min por (type_code, origin_building).
 *   { type_code, origin_building_code, floor?, plan_x?, plan_y?, description? }
 */
incidentsRouter.post('/', async (req, res, next) => {
  try {
    const {
      type_code,
      origin_building_code,
      floor,
      plan_x,
      plan_y,
      description,
    } = req.body ?? {};

    if (!type_code || !origin_building_code) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'type_code/origin_building_code requeridos' });
      return;
    }

    const bld = await pool.query<{ id: string }>(
      'SELECT id FROM building WHERE code = $1 LIMIT 1',
      [origin_building_code],
    );
    if (!bld.rows[0]) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Edificio inexistente' });
      return;
    }
    const buildingId = bld.rows[0].id;

    const existing = await pool.query<{ id: string; severity: string; level: number }>(
      `SELECT id, severity, level
         FROM incident
        WHERE type_code = $1
          AND origin_building_id = $2
          AND reported_at > now() - interval '${GROUPING_WINDOW_MIN} minutes'
          AND status NOT IN ('CERRADO', 'FALSA_ALARMA')
        ORDER BY reported_at DESC
        LIMIT 1`,
      [type_code, buildingId],
    );

    if (existing.rows[0]) {
      const inc = existing.rows[0];
      await pool.query(
        `INSERT INTO incident_event (incident_id, actor_id, kind, payload)
         VALUES ($1, $2, 'ADDITIONAL_REPORT', $3::jsonb)`,
        [
          inc.id,
          req.user!.id,
          JSON.stringify({ floor, description, plan_x, plan_y }),
        ],
      );
      const countRow = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM incident_event
          WHERE incident_id = $1 AND kind = 'ADDITIONAL_REPORT'`,
        [inc.id],
      );
      res.status(200).json({
        id: inc.id,
        grouped: true,
        group_count: (countRow.rows[0]?.n ?? 0) + 1,
        severity: inc.severity,
        level: inc.level,
      });
      return;
    }

    const typeRow = await pool.query<{ default_severity: string; default_level: number }>(
      'SELECT default_severity, default_level FROM incident_type WHERE code = $1',
      [type_code],
    );
    const type = typeRow.rows[0];
    if (!type) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'type_code inexistente' });
      return;
    }

    const inserted = await pool.query<{
      id: string;
      severity: string;
      level: number;
      reported_at: string;
    }>(
      `INSERT INTO incident
         (type_code, origin_building_id, affected_buildings, floor,
          plan_x, plan_y, description, reported_by, severity, level, status)
       VALUES ($1, $2, ARRAY[$2]::uuid[], $3, $4, $5, $6, $7, $8, $9, 'REPORTADO')
       RETURNING id, severity, level, reported_at::text`,
      [
        type_code,
        buildingId,
        floor ?? null,
        plan_x ?? null,
        plan_y ?? null,
        description ?? null,
        req.user!.id,
        type.default_severity,
        type.default_level,
      ],
    );
    const inc = inserted.rows[0]!;

    await pool.query(
      `INSERT INTO incident_event (incident_id, actor_id, kind, payload)
       VALUES ($1, $2, 'REPORT_CREATED', $3::jsonb)`,
      [
        inc.id,
        req.user!.id,
        JSON.stringify({ type: type_code, building: origin_building_code, floor }),
      ],
    );

    res.status(201).json({
      id: inc.id,
      grouped: false,
      group_count: 1,
      severity: inc.severity,
      level: inc.level,
      reported_at: inc.reported_at,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/incidents/:id
 */
incidentsRouter.get('/:id', async (req, res, next) => {
  try {
    const row = await pool.query(
      `SELECT i.*, b.code AS origin_building_code
         FROM incident i
         JOIN building b ON b.id = i.origin_building_id
        WHERE i.id = $1`,
      [req.params.id],
    );
    if (!row.rows[0]) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json(row.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/incidents/:id/safety-status
 * Marca "Estoy a salvo" / "Necesito ayuda".
 *   { status: 'A_SALVO' | 'NECESITA_AYUDA', assembly_point_id? }
 */
incidentsRouter.post('/:id/safety-status', async (req, res, next) => {
  try {
    const { status, assembly_point_id } = req.body ?? {};
    if (!['A_SALVO', 'NECESITA_AYUDA'].includes(status)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'status inválido' });
      return;
    }

    await pool.query(
      `INSERT INTO safety_status (incident_id, person_id, status, assembly_point_id, at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (incident_id, person_id) DO UPDATE SET
         status = EXCLUDED.status,
         assembly_point_id = EXCLUDED.assembly_point_id,
         at = now()`,
      [req.params.id, req.user!.id, status, assembly_point_id ?? null],
    );

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /v1/incidents/:id/safety-status
 * Tablero de conteo.
 */
incidentsRouter.get('/:id/safety-status', async (req, res, next) => {
  try {
    const inc = await pool.query<{ affected_buildings: string[] }>(
      'SELECT affected_buildings FROM incident WHERE id = $1',
      [req.params.id],
    );
    if (!inc.rows[0]) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const counts = await pool.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM safety_status
        WHERE incident_id = $1 GROUP BY status`,
      [req.params.id],
    );
    const byStatus = new Map(counts.rows.map((r) => [r.status, r.n]));

    const ayuda = await pool.query<{
      person_id: string;
      full_name: string;
      phone: string | null;
      assembly_point: string | null;
    }>(
      `SELECT p.id AS person_id, p.full_name, p.phone, ap.name AS assembly_point
         FROM safety_status s
         JOIN person p ON p.id = s.person_id
         LEFT JOIN assembly_point ap ON ap.id = s.assembly_point_id
        WHERE s.incident_id = $1 AND s.status = 'NECESITA_AYUDA'
        LIMIT 200`,
      [req.params.id],
    );

    res.json({
      counts: {
        aSalvo: byStatus.get('A_SALVO') ?? 0,
        necesitaAyuda: byStatus.get('NECESITA_AYUDA') ?? 0,
      },
      ayuda: ayuda.rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/incidents/:id/clearance
 * Chequeo de reingreso (4 puntos).
 *   { building_code, checklist: {estructura_ok, plafones_vidrios_ok, servicios_ok, rutas_ok} }
 */
incidentsRouter.post('/:id/clearance', async (req, res, next) => {
  try {
    const { building_code, checklist } = req.body ?? {};
    if (!building_code || typeof checklist !== 'object' || checklist === null) {
      res.status(400).json({ error: 'BAD_REQUEST' });
      return;
    }
    const keys = ['estructura_ok', 'plafones_vidrios_ok', 'servicios_ok', 'rutas_ok'] as const;
    if (!keys.every((k) => checklist[k] === true)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Checklist incompleta' });
      return;
    }

    const bld = await pool.query<{ id: string }>(
      'SELECT id FROM building WHERE code = $1',
      [building_code],
    );
    if (!bld.rows[0]) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Edificio inexistente' });
      return;
    }

    await pool.query(
      `INSERT INTO building_clearance
         (incident_id, building_id, status, checklist, inspected_by)
       VALUES ($1, $2, 'PENDIENTE', $3::jsonb, $4)
       ON CONFLICT (incident_id, building_id) DO UPDATE SET
         checklist = EXCLUDED.checklist,
         inspected_by = EXCLUDED.inspected_by`,
      [req.params.id, bld.rows[0].id, JSON.stringify(checklist), req.user!.id],
    );

    res.json({ ok: true, status: 'PENDIENTE' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/incidents/:id/authorize-reentry
 * Autorización de reingreso (solo jefes / coordinación).
 *   { building_code }
 */
incidentsRouter.post('/:id/authorize-reentry', async (req, res, next) => {
  try {
    const { building_code } = req.body ?? {};
    if (!building_code) {
      res.status(400).json({ error: 'BAD_REQUEST' });
      return;
    }

    if (!req.user!.roles.some((r) =>
      ['JEFE_BRIGADA', 'COORD_INCIDENTES', 'JEFE_SEGURIDAD'].includes(r))) {
      res.status(403).json({ error: 'FORBIDDEN' });
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

    const updated = await pool.query<{ authorized_at: string }>(
      `UPDATE building_clearance SET
         status = 'APTO_REINGRESO',
         authorized_by = $3,
         authorized_at = now()
       WHERE incident_id = $1 AND building_id = $2
       RETURNING authorized_at::text`,
      [req.params.id, bld.rows[0].id, req.user!.id],
    );

    if (!updated.rows[0]) {
      res.status(409).json({ error: 'CONFLICT', message: 'Sin inspección previa' });
      return;
    }

    await pool.query(
      `INSERT INTO incident_event (incident_id, actor_id, kind, payload)
       VALUES ($1, $2, 'REENTRY_AUTHORIZED', $3::jsonb)`,
      [req.params.id, req.user!.id, JSON.stringify({ building: building_code })],
    );

    res.json({ status: 'APTO_REINGRESO', authorized_at: updated.rows[0].authorized_at });
  } catch (err) {
    next(err);
  }
});
