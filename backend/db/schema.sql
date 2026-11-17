create extension if not exists btree_gist;

create table site (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null,
  lon double precision not null
);

create table building (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references site(id),
  code text not null,
  name text not null,
  lat double precision,
  lon double precision,
  totp_secret text not null,
  unique (site_id, code)
);

create table dispensary (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null unique references building(id),
  name text not null,
  phone text not null
);

create table floor_plan (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references building(id),
  level text not null,
  file_url text not null,
  version int not null default 1,
  valid_from date not null default current_date
);

create table assembly_point (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references site(id),
  building_id uuid references building(id),
  name text not null,
  lat double precision,
  lon double precision
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references building(id),
  floor_plan_id uuid references floor_plan(id),
  kind text not null check (kind in ('EXTINTOR','BOTIQUIN','CAMILLA','OTRO')),
  plan_x numeric,
  plan_y numeric,
  next_inspection date
);

create table person (
  id uuid primary key default gen_random_uuid(),
  auth_uid text unique,
  full_name text not null,
  email text unique,
  phone text,
  photo_url text,
  home_building_id uuid references building(id),
  active boolean not null default true,
  consent_version text,
  consent_at timestamptz
);

create table role (
  code text primary key,
  name text not null
);

insert into role (code, name) values
  ('BRIGADISTA', 'Brigadista'),
  ('JEFE_BRIGADA', 'Jefe de Brigada'),
  ('COORD_INCIDENTES', 'Coordinadora de Incidentes'),
  ('RRHH', 'Recursos Humanos'),
  ('JEFE_SEGURIDAD', 'Jefe de Seguridad'),
  ('SEGURIDAD', 'Guardia o Militar'),
  ('DISPENSARIO', 'Personal de Dispensario'),
  ('GENERAL', 'Personal General'),
  ('ADMIN_TIC', 'Administrador TIC');

create table brigade (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null
);

create table assignment (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  role_code text not null references role(code),
  building_id uuid references building(id),
  brigade_id uuid references brigade(id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  substitute_for uuid references assignment(id)
);

create table device (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  fcm_token text not null unique,
  app_version text,
  last_seen_at timestamptz,
  delivery_health jsonb,
  presence_state text not null default 'DESCONOCIDA' check (presence_state in ('DENTRO','FUERA','DESCONOCIDA')),
  presence_source text check (presence_source in ('GEOFENCE','QR')),
  last_entered_at timestamptz,
  last_left_at timestamptz,
  qr_expires_at timestamptz
);

create or replace function was_inside_at(d device, p_at timestamptz)
returns boolean language sql immutable as $$
  select
    case
      when d.presence_source = 'QR' then
        d.last_entered_at is not null
        and d.last_entered_at <= p_at
        and (d.qr_expires_at is null or d.qr_expires_at >= p_at)
        and (d.last_left_at is null or d.last_left_at < d.last_entered_at or d.last_left_at > p_at)
      else
        d.last_entered_at is not null
        and d.last_entered_at <= p_at
        and (d.last_left_at is null or d.last_left_at < d.last_entered_at or d.last_left_at > p_at)
    end
$$;

create table perimeter_zone (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references building(id),
  lat double precision not null,
  lon double precision not null,
  radius_m numeric not null check (radius_m >= 100),
  active boolean not null default true
);

create table shift_template (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_time time not null,
  end_time time not null,
  tz text not null default 'America/Santo_Domingo'
);

create table shift_instance (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  template_id uuid references shift_template(id),
  during tstzrange not null check (not isempty(during)),
  source text not null default 'PLANTILLA' check (source in ('PLANTILLA','AJUSTE_MANUAL','CAMBIO_TURNO')),
  exclude using gist (person_id with =, during with &&)
);
create index shift_instance_during_idx on shift_instance using gist (during);

create table time_off (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  kind text not null check (kind in ('LIBRE','VACACIONES','LICENCIA')),
  during tstzrange not null check (not isempty(during)),
  approved_by uuid references person(id)
);
create index time_off_person_idx on time_off using gist (person_id, during);

create or replace function on_duty(p_at timestamptz default now(), p_grace interval default '30 minutes')
returns table (person_id uuid) language sql stable as $$
  select distinct s.person_id
  from shift_instance s
  where s.during && tstzrange(p_at - p_grace, p_at + p_grace)
    and not exists (select 1 from time_off t where t.person_id = s.person_id and t.during @> p_at)
$$;

create table duty_override (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references person(id),
  incident_id uuid,
  scope text not null check (scope in ('TODOS','EDIFICIO','ROL')),
  building_id uuid references building(id),
  role_code text references role(code),
  reason text not null,
  confirmed_at timestamptz not null,
  during tstzrange not null,
  notified_roles text[] not null default '{COORD_INCIDENTES,RRHH}'
);

create table seismic_event (
  id text primary key,
  source text not null,
  magnitude numeric,
  depth_km numeric,
  lat double precision,
  lon double precision,
  origin_time timestamptz not null,
  dist_epicenter_km numeric,
  dist_hypocenter_km numeric,
  estimated_intensity numeric,
  revision int not null default 1,
  last_seen_at timestamptz
);

create table felt_report (
  seismic_event_id text not null references seismic_event(id),
  person_id uuid not null references person(id),
  felt boolean not null,
  building_id uuid references building(id),
  at timestamptz not null default now(),
  primary key (seismic_event_id, person_id)
);

create table felt_decision (
  seismic_event_id text primary key references seismic_event(id),
  frozen_at timestamptz not null default now(),
  window_end timestamptz not null,
  panel_size int not null,
  panel_member_ids uuid[] not null default '{}',
  responses int not null default 0,
  yes_count int not null default 0,
  calibration_params jsonb not null default '{"k": 1.0, "i_min": 2.35, "max_hypo_km": 250}',
  rule_version text not null,
  result text not null check (result in ('PENDIENTE','SIN_QUORUM','EVALUAR_DANOS','SOLO_REGISTRO','LATENCIA_ALTA'))
);

create table protocol_doc (
  code text not null,
  version int not null,
  title text not null,
  effective_from date not null,
  content_md text not null,
  checksum text not null,
  approved_by uuid references person(id),
  primary key (code, version)
);

create table incident_type (
  code text primary key,
  name text not null,
  default_severity text not null check (default_severity in ('ROJO','AMARILLO','VERDE')),
  default_level int not null check (default_level in (1,2,3)),
  protocol_code text not null,
  active_protocol_version int not null default 1,
  foreign key (protocol_code, active_protocol_version) references protocol_doc(code, version)
);

create table incident (
  id uuid primary key default gen_random_uuid(),
  type_code text not null references incident_type(code),
  origin_building_id uuid not null references building(id),
  affected_buildings uuid[] not null default '{}',
  floor text,
  plan_x numeric,
  plan_y numeric,
  description text,
  reported_by uuid not null references person(id),
  reported_at timestamptz not null default now(),
  status text not null default 'REPORTADO'
    check (status in ('REPORTADO','EN_EVALUACION','CONFIRMADO','CONTENIDO','REINGRESO_AUTORIZADO','CERRADO','FALSA_ALARMA')),
  severity text not null default 'VERDE' check (severity in ('ROJO','AMARILLO','VERDE')),
  level int not null default 1 check (level in (1,2,3)),
  level_changed_by uuid references person(id),
  level_changed_at timestamptz,
  closed_at timestamptz
);

alter table duty_override
  add constraint duty_override_incident_fk foreign key (incident_id) references incident(id);

create table building_clearance (
  incident_id uuid not null references incident(id),
  building_id uuid not null references building(id),
  status text not null default 'PENDIENTE' check (status in ('PENDIENTE','APTO_REINGRESO','RESTRINGIDO')),
  had_evacuation boolean not null default false,
  checklist jsonb not null default '{"estructura_ok":false,"plafones_vidrios_ok":false,"servicios_ok":false,"rutas_ok":false}',
  notes text,
  photo_url text,
  inspected_by uuid references person(id),
  authorized_by uuid references person(id),
  authorized_at timestamptz,
  primary key (incident_id, building_id)
);

create table incident_event (
  id bigserial primary key,
  incident_id uuid not null references incident(id),
  at timestamptz not null default now(),
  actor_id uuid references person(id),
  kind text not null,
  payload jsonb
);

create table alert_policy (
  severity text primary key check (severity in ('ROJO','AMARILLO','VERDE')),
  channel text not null,
  bypass_dnd boolean not null,
  requires_presence boolean not null,
  presence_fail_mode text not null check (presence_fail_mode in ('ABIERTO','CERRADO')),
  respects_shift boolean not null,
  presence_overrides_shift boolean not null,
  defer_until_shift boolean not null
);

insert into alert_policy values
  ('ROJO',     'alerta_roja',     true,  true,  'ABIERTO', true, true,  false),
  ('AMARILLO', 'alerta_amarilla', false, false, 'ABIERTO', true, false, false),
  ('VERDE',    'aviso_verde',     false, false, 'ABIERTO', true, false, true);

create table alert (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incident(id),
  seismic_event_id text references seismic_event(id),
  severity text not null check (severity in ('ROJO','AMARILLO','VERDE')),
  level int not null check (level in (1,2,3)),
  message text not null,
  is_drill boolean not null default false,
  created_by uuid references person(id),
  created_at timestamptz not null default now()
);

create table alert_delivery (
  alert_id uuid not null references alert(id),
  person_id uuid not null references person(id),
  escalation_step int not null default 0,
  delivery_reason text,
  sent_at timestamptz,
  acked_at timestamptz,
  primary key (alert_id, person_id, escalation_step)
);

create table safety_status (
  incident_id uuid not null references incident(id),
  person_id uuid not null references person(id),
  status text not null check (status in ('A_SALVO','NECESITA_AYUDA')),
  assembly_point_id uuid references assembly_point(id),
  at timestamptz not null default now(),
  primary key (incident_id, person_id)
);

create or replace function resolve_alert_audience(
  p_severity text,
  p_level int,
  p_origin_building_id uuid,
  p_affected_buildings uuid[],
  p_at timestamptz default now()
)
returns table (person_id uuid, delivery_reason text) language sql stable as $$
  with policy as (
    select * from alert_policy where severity = p_severity
  ),
  role_candidates as (
    select distinct a.person_id, a.building_id
    from assignment a
    join person p on p.id = a.person_id and p.active = true
    where a.starts_at <= p_at
      and (a.ends_at is null or a.ends_at > p_at)
      and (
        (p_level = 1 and a.role_code in ('JEFE_BRIGADA','COORD_INCIDENTES','RRHH','JEFE_SEGURIDAD')
          and (a.building_id is null or a.building_id = p_origin_building_id))
        or (p_level = 2 and (a.building_id = any(p_affected_buildings) or a.building_id = p_origin_building_id))
        or (p_level = 3)
      )
  ),
  active_override as (
    select o.* from duty_override o where o.during @> p_at
  )
  select distinct rc.person_id,
    case
      when exists (select 1 from on_duty(p_at) od where od.person_id = rc.person_id) then 'EN_TURNO'
      when exists (
        select 1 from active_override ao
        where ao.scope = 'TODOS' or (ao.scope = 'EDIFICIO' and ao.building_id = rc.building_id)
      ) then 'CONVOCATORIA_SEGURIDAD'
      when (select presence_overrides_shift from policy)
        and exists (
          select 1 from device d
          where d.person_id = rc.person_id
            and (was_inside_at(d, p_at) or d.presence_state = 'DESCONOCIDA')
        ) then 'DENTRO_FUERA_DE_TURNO'
    end as delivery_reason
  from role_candidates rc
  where
    not (select respects_shift from policy)
    or exists (select 1 from on_duty(p_at) od where od.person_id = rc.person_id)
    or exists (
      select 1 from active_override ao
      where ao.scope = 'TODOS' or (ao.scope = 'EDIFICIO' and ao.building_id = rc.building_id)
    )
    or (
      (select presence_overrides_shift from policy)
      and exists (
        select 1 from device d
        where d.person_id = rc.person_id
          and (was_inside_at(d, p_at) or d.presence_state = 'DESCONOCIDA')
      )
    )
$$;

create table route_block (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references building(id),
  description text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  reported_by uuid not null references person(id),
  confirmed_by uuid references person(id)
);

create table gathering (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('REUNION','CURSO')),
  title text not null,
  building_id uuid references building(id),
  location text,
  starts_at timestamptz not null,
  created_by uuid not null references person(id)
);

create table gathering_change (
  id bigserial primary key,
  gathering_id uuid not null references gathering(id),
  changed_at timestamptz not null default now(),
  old_value jsonb not null,
  new_value jsonb not null,
  notified_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid references person(id),
  action text not null,
  entity text not null,
  entity_id text
);
