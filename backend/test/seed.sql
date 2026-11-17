INSERT INTO site (id, name, lat, lon)
VALUES ('11111111-1111-1111-1111-111111111111', 'INDRHI', 18.4736, -69.9381);

INSERT INTO building (id, site_id, code, name, lat, lon, totp_secret)
VALUES
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   'ED1', 'Edificio 1', 18.4736, -69.9381, 'AAECAwQFBgcICQoLDA0ODw=='),
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   'ED2', 'Edificio 2', 18.4756, -69.9361, 'EBESExQVFhcYGRobHB0eHw==');

INSERT INTO perimeter_zone (building_id, lat, lon, radius_m)
VALUES
  ('22222222-2222-2222-2222-222222222222', 18.4736, -69.9381, 150),
  ('33333333-3333-3333-3333-333333333333', 18.4756, -69.9361, 150);

INSERT INTO person (id, auth_uid, full_name, active)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'u-brig-ed1',   'Brigadista ED1',  true),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'u-jefe-ed1',    'Jefe ED1',        true),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'u-coord',       'Coordinadora',    true),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'u-jefe-seg',    'Jefe Seguridad',  true),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'u-general-ed1', 'General ED1',     true),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'u-general-ed2', 'General ED2',     true);

INSERT INTO assignment (person_id, role_code, building_id)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'BRIGADISTA',       '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'JEFE_BRIGADA',     '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'COORD_INCIDENTES', NULL),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'JEFE_SEGURIDAD',   NULL),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'GENERAL',          '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'GENERAL',          '33333333-3333-3333-3333-333333333333');

INSERT INTO device (id, person_id, fcm_token, presence_state, presence_source, last_entered_at)
VALUES
  ('dddddddd-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'tok-brig-ed1',
   'DENTRO', 'GEOFENCE', now() - interval '1 hour'),
  ('dddddddd-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000002', 'tok-jefe-ed1',
   'DENTRO', 'GEOFENCE', now() - interval '1 hour'),
  ('dddddddd-0000-0000-0000-000000000005',
   'aaaaaaaa-0000-0000-0000-000000000005', 'tok-gen-ed1',
   'DENTRO', 'GEOFENCE', now() - interval '1 hour'),
  ('dddddddd-0000-0000-0000-000000000006',
   'aaaaaaaa-0000-0000-0000-000000000006', 'tok-gen-ed2',
   'DENTRO', 'GEOFENCE', now() - interval '1 hour');

INSERT INTO protocol_doc (code, version, title, effective_from, content_md, checksum)
VALUES ('FIRE', 1, 'Incendio', current_date, 'contenido', 'checksum');

INSERT INTO incident_type (code, name, default_severity, default_level, protocol_code)
VALUES ('INCENDIO', 'Incendio', 'ROJO', 2, 'FIRE');
