# API v1 · INDRHI Brigadas

Autenticación: `Authorization: Bearer <Firebase ID token>`.
Todas las respuestas en JSON. Códigos 4xx/5xx siguen formato `{ "error": "<CODE>", "message": "<texto>" }`.

## Health

- `GET /v1/health/live` → 204
- `GET /v1/health/ready` → `{ db: bool, uptime_s }`

## Devices

- `POST /v1/devices/token` — `{ fcm_token, app_version?, platform?, device_id? }` → 204
- `POST /v1/devices/presence` — `{ device_id, state, source, building_code?, last_entered_at, last_left_at }` → 204
- `POST /v1/devices/presence/qr-checkin` — `{ device_id, building_code, code }` → `{ valid_until, building_code }`

## Alerts

- `POST /v1/alerts/:id/ack` — `{ escalation_step }` → 204
- `POST /v1/alerts/:id/delivery` — `{ escalation_step, outcome }` → 204
- `POST /v1/alerts/:id/close` → 204

## Incidents

- `POST /v1/incidents` — `{ type_code, origin_building_code, floor, plan_x?, plan_y?, description }` → `{ id, grouped, group_count, severity, level, reported_at }`
- `POST /v1/incidents/:id/buildings/:code/inspection` — `{ checklist, photo_base64, notes }` → `{ status, hadEvacuation }`
- `POST /v1/incidents/:id/buildings/:code/authorize-reentry` — `{ confirm }` → `{ status, hadEvacuation, authorizedAt }`
- `POST /v1/incidents/:id/safety-status` — `{ status, assembly_point_id }` → 204
- `GET /v1/incidents/:id/safety-status/dashboard?building=ED1` → `{ counts, ayuda, onDutyMissing }`
- `GET /v1/incidents/:id/timeline?format=csv|json` → `AuditRow[] | CSV`

## Buildings

- `GET /v1/buildings/perimeters` → `[{ building_code, lat, lon, radius_m }]`
- `GET /v1/buildings/:code/qr` → `{ building_code, code, secondsRemaining }`

## Floor Plans

- `GET /v1/floor-plans?building=ED1` → `FloorPlanSummary[]`
- `GET /v1/floor-plans/:id` → `FloorPlanDetail`

## Shifts

- `GET /v1/shifts/templates` → `ShiftTemplate[]`
- `POST /v1/shifts/templates` — `{ name, start_time, end_time, tz }` → `{ id }`
- `POST /v1/shifts/instances` — `{ person_id, template_id, starts_at, ends_at }` → `ShiftInstance`
- `POST /v1/shifts/swap` — `{ shift_a_id, shift_b_id }` → 204
- `POST /v1/shifts/time-off` — `{ person_id, kind, starts_at, ends_at }` → `{ id }`
- `GET /v1/shifts/me?from&to` → `{ onDuty, shifts }`

## Duty Overrides

- `POST /v1/duty-overrides` — `{ incident_id, scope, building_code?, role_code?, reason, confirm, starts_at, ends_at }` → `DutyOverride`
- `POST /v1/duty-overrides/:id/revoke` → 204
- `GET /v1/duty-overrides/active` → `ActiveOverride[]`

## Admin

- `GET /v1/me/roles` → `string[]`
- `GET /v1/directory?q=&building=&limit=` → `DirectoryEntry[]`
- `POST /v1/gatherings` — `{ kind, title, building_code, location, starts_at }` → `{ id }`
- `PATCH /v1/gatherings/:id` — `{ new_starts_at?, new_location? }` → 204
- `GET /v1/gatherings?from&to` → `Gathering[]`
- `GET /v1/audit/export?from&to&format=json|csv` → `AuditRow[] | CSV`

## Drills

- `POST /v1/drills` — `{ type_code, building_code, severity, level, message? }` → `{ incident_id, alert_id }`
- `GET /v1/drills/:id/report` → `DrillReport`
- `POST /v1/drills/:id/close` → 204

## Contacts

- `GET /v1/contacts` → `[{ label, phone }]`

## Metrics

- `GET /v1/metrics` → Prometheus text format
