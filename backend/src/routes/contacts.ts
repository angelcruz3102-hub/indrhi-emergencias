import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate } from '../auth.js';

export const contactsRouter = Router();

contactsRouter.use(authenticate);

const PHONE_VIEWERS = new Set([
  'JEFE_BRIGADA',
  'COORD_INCIDENTES',
  'RRHH',
  'JEFE_SEGURIDAD',
  'ADMIN_TIC',
]);

/**
 * GET /v1/contacts?q=texto&building=ED1&limit=50
 * Directorio con teléfonos filtrados por rol del solicitante y auditoría.
 */
contactsRouter.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : null;
    const building = typeof req.query.building === 'string' ? req.query.building : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));

    const canSeePhones = req.user!.roles.some((r) => PHONE_VIEWERS.has(r));

    const r = await pool.query<{
      id: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      home_building_code: string | null;
      roles: string[];
    }>(
      `SELECT p.id, p.full_name, p.email, p.phone,
              b.code AS home_building_code,
              COALESCE(
                array_agg(DISTINCT a.role_code) FILTER (WHERE a.role_code IS NOT NULL),
                ARRAY[]::text[]
              ) AS roles
         FROM person p
         LEFT JOIN building b ON b.id = p.home_building_id
         LEFT JOIN assignment a ON a.person_id = p.id
              AND a.starts_at <= now()
              AND (a.ends_at IS NULL OR a.ends_at > now())
        WHERE p.active = true
          AND ($1::text IS NULL OR p.full_name ILIKE '%' || $1 || '%' OR p.email ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR b.code = $2::text)
        GROUP BY p.id, b.code
        ORDER BY p.full_name
        LIMIT $3`,
      [q, building, limit],
    );

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_id)
       VALUES ($1, 'DIRECTORY_VIEW', 'person', $2)`,
      [req.user!.id, `q=${q ?? ''}|b=${building ?? ''}`],
    );

    res.json(
      r.rows.map((row) => ({
        id: row.id,
        full_name: row.full_name,
        email: row.email,
        phone: canSeePhones ? row.phone : null,
        home_building_code: row.home_building_code,
        roles: row.roles,
      })),
    );
  } catch (err) {
    next(err);
  }
});
