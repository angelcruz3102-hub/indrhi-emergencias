CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ── 1. Catálogos ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS role (
  code text PRIMARY KEY,
  name text NOT NULL
);

INSERT INTO role (code, name) VALUES
  ('GENERAL',          'Personal General'),
  ('BRIGADISTA',       'Brigadista'),
  ('JEFE_BRIGADA',     'Jefe de Brigada'),
  ('DISPENSARIO',      'Personal de Dispensario'),
  ('SEGURIDAD',        'Seguridad Física'),
  ('JEFE_SEGURIDAD',   'Jefe de Seguridad'),
  ('COORD_INCIDENTES', 'Coordinador de Incidentes'),
  ('RRHH',             'Recursos Humanos'),
  ('ADMIN_TIC',        'Administrador TIC')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS alert_policy (
  severity text PRIMARY KEY CHECK (severity IN ('ROJO', 'AMARILLO', 'VERDE')),
  respects_shift boolean NOT NULL,
  presence_overrides_shift boolean NOT NULL
);

INSERT INTO alert_policy (severity, respects_shift, presence_overrides_shift) VALUES
  ('ROJO',     true, true),
  ('AMARILLO', true, true),
  ('VERDE',    true, false)
ON CONFLICT (severity) DO NOTHING;

-- ── 2. Recinto, edificios y zonas ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS site (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  lat double precision,
  lon double precision
);

CREATE TABLE IF NOT EXISTS building (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES site(id),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  lat double precision,
  lon double precision,
  totp_secret text
);

CREATE TABLE IF NOT EXISTS perimeter_zone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES building(id),
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  radius_m integer NOT NULL
);

CREATE TABLE IF NOT EXISTS dispensary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES building(id),
  name text NOT NULL,
  phone text
);

CREATE TABLE IF NOT EXISTS assembly_point (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES building(id),
  name text NOT NULL,
  lat double precision,
  lon double precision
);

-- ── 3. Personal, asignaciones y dispositivos ──────────────────────────

CREATE TABLE IF NOT EXISTS person (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid text UNIQUE,
  full_name text NOT NULL,
  email text,
  phone text,
  home_building_id uuid REFERENCES building(id),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id),
  role_code text NOT NULL REFERENCES role(code),
  building_id uuid REFERENCES building(id),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz
);

CREATE TABLE IF NOT EXISTS device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id),
  fcm_token text NOT NULL UNIQUE,
  app_version text,
  last_seen_at timestamptz,
  delivery_health jsonb,
  presence_state text NOT NULL DEFAULT 'DESCONOCIDA' CHECK (presence_state IN ('DENTRO','FUERA','DESCONOCIDA')),
  presence_source text CHECK (presence_source IN ('GEOFENCE','QR')),
  last_entered_at timestamptz,
  last_left_at timestamptz,
  qr_expires_at timestamptz
);

-- ── 4. Turnos, ausencias y convocatorias extraordinarias ──────────────

CREATE TABLE IF NOT EXISTS shift_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  tz text NOT NULL DEFAULT 'America/Santo_Domingo'
);

CREATE TABLE IF NOT EXISTS shift_instance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id),
  template_id uuid REFERENCES shift_template(id),
  during tstzrange NOT NULL,
  EXCLUDE USING gist (person_id WITH =, during WITH &&)
);

CREATE TABLE IF NOT EXISTS time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id),
  kind text NOT NULL CHECK (kind IN ('LIBRE', 'VACACIONES', 'LICENCIA')),
  during tstzrange NOT NULL,
  approved_by uuid REFERENCES person(id)
);

-- ── 5. Protocolos, planos, incidentes y alertas ───────────────────────

CREATE TABLE IF NOT EXISTS protocol_doc (
  code text NOT NULL,
  version int NOT NULL,
  title text NOT NULL,
  effective_from date NOT NULL DEFAULT current_date,
  content_md text NOT NULL,
  checksum text NOT NULL,
  approved_by uuid REFERENCES person(id),
  PRIMARY KEY (code, version)
);

CREATE TABLE IF NOT EXISTS incident_type (
  code text PRIMARY KEY,
  name text NOT NULL,
  default_severity text NOT NULL CHECK (default_severity IN ('ROJO', 'AMARILLO', 'VERDE')),
  default_level int NOT NULL CHECK (default_level IN (1, 2, 3)),
  protocol_code text
);

CREATE TABLE IF NOT EXISTS incident (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_code text NOT NULL REFERENCES incident_type(code),
  origin_building_id uuid NOT NULL REFERENCES building(id),
  affected_buildings uuid[] NOT NULL DEFAULT '{}',
  floor text,
  plan_x numeric,
  plan_y numeric,
  description text,
  reported_by uuid REFERENCES person(id),
  reported_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  severity text NOT NULL CHECK (severity IN ('ROJO', 'AMARILLO', 'VERDE')),
  level int NOT NULL CHECK (level IN (1, 2, 3)),
  status text NOT NULL DEFAULT 'REPORTADO'
);

CREATE TABLE IF NOT EXISTS duty_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES person(id),
  incident_id uuid REFERENCES incident(id),
  scope text NOT NULL CHECK (scope IN ('TODOS', 'EDIFICIO', 'ROL')),
  building_id uuid REFERENCES building(id),
  role_code text REFERENCES role(code),
  reason text NOT NULL,
  confirmed_at timestamptz,
  during tstzrange NOT NULL
);

CREATE TABLE IF NOT EXISTS incident_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incident(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES person(id),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safety_status (
  incident_id uuid NOT NULL REFERENCES incident(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id),
  status text NOT NULL CHECK (status IN ('A_SALVO', 'NECESITA_AYUDA')),
  assembly_point_id uuid REFERENCES assembly_point(id),
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (incident_id, person_id)
);

CREATE TABLE IF NOT EXISTS building_clearance (
  incident_id uuid NOT NULL REFERENCES incident(id) ON DELETE CASCADE,
  building_id uuid NOT NULL REFERENCES building(id),
  status text NOT NULL,
  checklist jsonb NOT NULL,
  inspected_by uuid REFERENCES person(id),
  authorized_by uuid REFERENCES person(id),
  authorized_at timestamptz,
  PRIMARY KEY (incident_id, building_id)
);

CREATE TABLE IF NOT EXISTS route_block (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES building(id),
  description text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  reported_by uuid REFERENCES person(id),
  confirmed_by uuid REFERENCES person(id)
);

CREATE TABLE IF NOT EXISTS floor_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES building(id),
  level text NOT NULL,
  file_url text NOT NULL,
  version int NOT NULL DEFAULT 1,
  valid_from date NOT NULL DEFAULT current_date
);

CREATE TABLE IF NOT EXISTS equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_plan_id uuid NOT NULL REFERENCES floor_plan(id) ON DELETE CASCADE,
  kind text NOT NULL,
  plan_x numeric,
  plan_y numeric,
  next_inspection date
);

CREATE TABLE IF NOT EXISTS seismic_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  magnitude numeric,
  depth_km numeric,
  lat double precision,
  lon double precision,
  origin_time timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS felt_decision (
  seismic_event_id uuid PRIMARY KEY REFERENCES seismic_event(id) ON DELETE CASCADE,
  panel_member_ids uuid[] NOT NULL DEFAULT '{}',
  window_end timestamptz NOT NULL,
  result text NOT NULL DEFAULT 'PENDIENTE',
  responses int NOT NULL DEFAULT 0,
  yes_count int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS felt_report (
  seismic_event_id uuid NOT NULL REFERENCES seismic_event(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id),
  felt boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seismic_event_id, person_id)
);

CREATE TABLE IF NOT EXISTS alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL REFERENCES alert_policy(severity),
  level int NOT NULL CHECK (level IN (1, 2, 3)),
  message text NOT NULL,
  incident_id uuid REFERENCES incident(id),
  seismic_event_id uuid REFERENCES seismic_event(id),
  is_drill boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES person(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES alert(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id),
  escalation_step int NOT NULL DEFAULT 0,
  delivery_reason text,
  sent_at timestamptz,
  acked_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES person(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  at timestamptz NOT NULL DEFAULT now()
);

-- ── 6. Funciones de dominio (después de crear device y turnos) ────────

CREATE OR REPLACE FUNCTION on_duty(p_at timestamptz DEFAULT now())
RETURNS TABLE (person_id uuid) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT si.person_id
  FROM shift_instance si
  JOIN person p ON p.id = si.person_id AND p.active = true
  WHERE si.during @> p_at
    AND NOT EXISTS (
      SELECT 1 FROM time_off tof
      WHERE tof.person_id = si.person_id
        AND tof.during @> p_at
    )
$$;

CREATE OR REPLACE FUNCTION was_inside_at(d device, p_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT
    CASE
      WHEN d.last_entered_at IS NULL THEN
        d.presence_state = 'DENTRO'
      WHEN d.last_entered_at > p_at THEN
        false
      WHEN d.last_left_at IS NOT NULL
        AND d.last_left_at >= d.last_entered_at
        AND d.last_left_at <= p_at THEN
        false
      WHEN d.presence_source = 'QR'
        AND d.qr_expires_at IS NOT NULL
        AND d.qr_expires_at < p_at THEN
        false
      ELSE
        true
    END
$$;

CREATE OR REPLACE FUNCTION resolve_alert_audience(
  p_severity text,
  p_level int,
  p_origin_building_id uuid,
  p_affected_buildings uuid[],
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE (person_id uuid, delivery_reason text) LANGUAGE sql STABLE AS $$
  WITH policy AS (
    SELECT * FROM alert_policy WHERE severity = p_severity
  ),
  role_candidates AS (
    SELECT DISTINCT
      a.person_id,
      coalesce(a.building_id, p.home_building_id) AS building_id,
      a.role_code
    FROM assignment a
    JOIN person p ON p.id = a.person_id AND p.active = true
    WHERE a.starts_at <= p_at
      AND (a.ends_at IS NULL OR a.ends_at > p_at)
      AND (
        (p_level = 1 AND (
          a.role_code IN ('COORD_INCIDENTES', 'RRHH', 'JEFE_SEGURIDAD')
          OR (
            a.role_code IN ('JEFE_BRIGADA', 'DISPENSARIO', 'SEGURIDAD')
            AND (a.building_id IS NULL OR a.building_id = p_origin_building_id)
          )
        ))
        OR (p_level = 2 AND (
          a.building_id = ANY(p_affected_buildings)
          OR a.building_id = p_origin_building_id
          OR (a.building_id IS NULL AND p.home_building_id = p_origin_building_id)
        ))
      )
    UNION
    SELECT DISTINCT
      p.id AS person_id,
      coalesce(a.building_id, p.home_building_id) AS building_id,
      a.role_code
    FROM person p
    LEFT JOIN assignment a ON a.person_id = p.id
      AND a.starts_at <= p_at
      AND (a.ends_at IS NULL OR a.ends_at > p_at)
    WHERE p_level = 3
      AND p.active = true
  ),
  active_override AS (
    SELECT o.* FROM duty_override o WHERE o.during @> p_at
  ),
  presence_eval AS (
    SELECT
      rc.person_id,
      rc.building_id,
      rc.role_code,
      (
        NOT EXISTS (SELECT 1 FROM device d WHERE d.person_id = rc.person_id)
        OR EXISTS (
          SELECT 1 FROM device d
          WHERE d.person_id = rc.person_id
            AND (was_inside_at(d, p_at) OR d.presence_state = 'DESCONOCIDA')
        )
      ) AS is_inside_or_unknown
    FROM role_candidates rc
  )
  SELECT DISTINCT pe.person_id,
    CASE
      WHEN EXISTS (SELECT 1 FROM on_duty(p_at) od WHERE od.person_id = pe.person_id) THEN 'EN_TURNO'
      WHEN EXISTS (
        SELECT 1 FROM active_override ao
        WHERE ao.scope = 'TODOS'
           OR (ao.scope = 'EDIFICIO' AND ao.building_id = pe.building_id)
           OR (ao.scope = 'ROL' AND ao.role_code = pe.role_code)
      ) THEN 'CONVOCATORIA_SEGURIDAD'
      WHEN (SELECT presence_overrides_shift FROM policy) AND pe.is_inside_or_unknown THEN 'DENTRO_FUERA_DE_TURNO'
    END AS delivery_reason
  FROM presence_eval pe
  WHERE
    NOT (SELECT respects_shift FROM policy)
    OR EXISTS (SELECT 1 FROM on_duty(p_at) od WHERE od.person_id = pe.person_id)
    OR EXISTS (
      SELECT 1 FROM active_override ao
      WHERE ao.scope = 'TODOS'
         OR (ao.scope = 'EDIFICIO' AND ao.building_id = pe.building_id)
         OR (ao.scope = 'ROL' AND ao.role_code = pe.role_code)
    )
    OR ((SELECT presence_overrides_shift FROM policy) AND pe.is_inside_or_unknown)
$$;
