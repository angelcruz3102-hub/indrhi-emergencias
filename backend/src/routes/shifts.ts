import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate } from '../auth.js';

export const shiftsRouter = Router();

shiftsRouter.use(authenticate);

const HHMM = /^\d{2}:\d{2}$/;

/** GET /v1/shifts/templates */
shiftsRouter.get('/templates', async (_req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id, name, start_time::text, end_time::text, tz
         FROM shift_template ORDER BY name`,
    );
    res.json(r.rows);
  } catch (err) {
    next(err);
  }
});

/** POST /v1/shifts/templates { name, start_time, end_time, tz? } */
shiftsRouter.post('/templates', async (req, res, next) => {
  try {
    const { name, start_time, end_time, tz } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'name requerido' });
      return;
    }
    if (!HHMM.test(start_time) || !HHMM.test(end_time)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'start_time/end_time HH:MM' });
      return;
    }
    const r = await pool.query<{ id: string }>(
      `INSERT INTO shift_template (name, start_time, end_time, tz)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [name.trim(), start_time, end_time, tz ?? 'America/Santo_Domingo'],
    );
    res.status(201).json({ id: r.rows[0]!.id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/shifts/instances { person_id, template_id?, starts_at, ends_at }
 */
shiftsRouter.post('/instances', async (req, res, next) => {
  try {
    const { person_id, template_id, starts_at, ends_at } = req.body ?? {};
    if (!person_id || !starts_at || !ends_at) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'person_id/starts_at/ends_at requeridos' });
      return;
    }
    const start = new Date(starts_at);
    const end = new Date(ends_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Rango inválido' });
      return;
    }

    try {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO shift_instance (person_id, template_id, during)
         VALUES ($1, $2, tstzrange($3::timestamptz, $4::timestamptz, '[)'))
         RETURNING id`,
        [person_id, template_id ?? null, start.toISOString(), end.toISOString()],
      );
      res.status(201).json({ id: r.rows[0]!.id });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === '23P01') {
        res.status(409).json({ error: 'CONFLICT', message: 'Solapamiento con otro turno' });
        return;
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

/** GET /v1/shifts/me/on-duty → { onDuty: boolean } */
shiftsRouter.get('/me/on-duty', async (req, res, next) => {
  try {
    const r = await pool.query<{ ok: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM on_duty(now()) od WHERE od.person_id = $1) AS ok',
      [req.user!.id],
    );
    res.json({ onDuty: r.rows[0]?.ok === true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/shifts/time-off { person_id, kind, starts_at, ends_at }
 */
shiftsRouter.post('/time-off', async (req, res, next) => {
  try {
    const { person_id, kind, starts_at, ends_at } = req.body ?? {};
    if (!person_id || !['LIBRE', 'VACACIONES', 'LICENCIA'].includes(kind)) {
      res.status(400).json({ error: 'BAD_REQUEST' });
      return;
    }
    const start = new Date(starts_at);
    const end = new Date(ends_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Rango inválido' });
      return;
    }

    const r = await pool.query<{ id: string }>(
      `INSERT INTO time_off (person_id, kind, during, approved_by)
       VALUES ($1, $2, tstzrange($3::timestamptz, $4::timestamptz, '[)'), $5)
       RETURNING id`,
      [person_id, kind, start.toISOString(), end.toISOString(), req.user!.id],
    );
    res.status(201).json({ id: r.rows[0]!.id });
  } catch (err) {
    next(err);
  }
});
