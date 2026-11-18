import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { pool } from './db.js';

export interface AuthUser {
  id: string;
  roles: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const IS_TEST = process.env.NODE_ENV === 'test';
const IS_AUTH_DISABLED = process.env.AUTH_DISABLED === 'true';

/**
 * Middleware de autenticación.
 *
 *  - Producción: lee `Authorization: Bearer <idToken>` y resuelve el `sub`
 *    como `auth_uid` de la tabla `person`.
 *  - Test / AUTH_DISABLED: acepta `x-test-user-id: <uuid|auth_uid>` para que
 *    los tests de CI no necesiten Firebase.
 *
 * Adjunta `req.user = { id, roles }` o responde 401.
 */
export const authenticate: RequestHandler = (req, res, next) => {
  doAuthenticate(req, res, next).catch(next);
};

async function doAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // ── 1) Test header (solo con NODE_ENV=test o AUTH_DISABLED=true) ──
    if (IS_TEST || IS_AUTH_DISABLED) {
      const testUid = req.header('x-test-user-id')?.trim();
      if (testUid) {
        const user = await lookupUser(testUid);
        if (user) {
          req.user = user;
          next();
          return;
        }
      }
      if (IS_AUTH_DISABLED) {
        // Fallback dev: primer usuario activo
        const r = await pool.query<{ id: string }>(
          'SELECT id FROM person WHERE active = true ORDER BY full_name LIMIT 1',
        );
        if (r.rows[0]) {
          req.user = { id: r.rows[0].id, roles: await lookupRoles(r.rows[0].id) };
          next();
          return;
        }
      }
    }

    // ── 2) Bearer token ──
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Falta token Bearer' });
      return;
    }

    const authUid = extractUidFromJwt(match[1]!);
    if (!authUid) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Token inválido' });
      return;
    }

    const user = await lookupUserByAuthUid(authUid);
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Usuario sin perfil activo' });
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────

/**
 * Acepta indistintamente `person.id` (uuid) o `person.auth_uid` (texto).
 * Útil para tests: `x-test-user-id: aaaaaaaa-0000-...-001` o `u-brig-ed1`.
 */
async function lookupUser(identifier: string): Promise<AuthUser | null> {
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let personId: string | null = null;
  if (uuidRe.test(identifier)) {
    const r = await pool.query<{ id: string }>(
      'SELECT id FROM person WHERE id = $1 AND active = true LIMIT 1',
      [identifier],
    );
    personId = r.rows[0]?.id ?? null;
  }
  if (!personId) {
    const r = await pool.query<{ id: string }>(
      'SELECT id FROM person WHERE auth_uid = $1 AND active = true LIMIT 1',
      [identifier],
    );
    personId = r.rows[0]?.id ?? null;
  }
  if (!personId) return null;

  return { id: personId, roles: await lookupRoles(personId) };
}

async function lookupUserByAuthUid(authUid: string): Promise<AuthUser | null> {
  const r = await pool.query<{ id: string }>(
    'SELECT id FROM person WHERE auth_uid = $1 AND active = true LIMIT 1',
    [authUid],
  );
  if (!r.rows[0]) return null;
  const id = r.rows[0].id;
  return { id, roles: await lookupRoles(id) };
}

async function lookupRoles(personId: string): Promise<string[]> {
  const r = await pool.query<{ role_code: string }>(
    `SELECT DISTINCT role_code
       FROM assignment
      WHERE person_id = $1
        AND starts_at <= now()
        AND (ends_at IS NULL OR ends_at > now())`,
    [personId],
  );
  return r.rows.map((row) => row.role_code);
}

/**
 * Decodifica el payload de un JWT sin verificar la firma.
 *
 * NOTA: En producción la verificación de firma debe hacerse con
 * `firebase-admin.auth().verifyIdToken(token)`. Aquí solo se decodifica
 * el claim `sub` para mantener el build sin credenciales de Firebase.
 * Cuando configures `GOOGLE_APPLICATION_CREDENTIALS`, reemplaza esta
 * función por la verificación real.
 */
function extractUidFromJwt(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    const json = JSON.parse(payload) as Record<string, unknown>;
    const uid =
      (json.sub as string | undefined) ??
      (json.user_id as string | undefined) ??
      (json.uid as string | undefined);
    return uid ?? null;
  } catch {
    return null;
  }
}
