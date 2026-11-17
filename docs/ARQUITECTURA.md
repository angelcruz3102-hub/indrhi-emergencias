# Arquitectura · INDRHI Brigadas

## Principios (del prompt V2.1)

1. **Ruta crítica sin red**: todo el texto de la alerta viaja en el push FCM (`data-only`).
2. **Autorización server-side**: audiencias, permisos y reglas se validan en PostgreSQL.
3. **Acuse obligatorio** en ROJO/AMARILLO con reescalamiento 60 s → 120 s.
4. **Bitácoras inmutables**: `incident_event` y `audit_log` protegidos por triggers SQL.
5. **Privacidad por diseño** (Ley 172-13): sin coordenadas GPS ni trayectorias en servidor.

## Diagrama de flujo crítico

```
[Feed USGS] ──► Ingestor ──► seismic_event
                                 │
                                 ▼
                        freeze_panel() ──► felt_decision
                                 │
                    (panel congelado, 3 min)
                                 ▼
                     doble umbral (0.60 resp / 0.25 panel)
                                 │
                        ┌────────┴────────┐
                        ▼                 ▼
                   EVALUAR_DANOS     SOLO_REGISTRO
                        │
                        ▼
              alertService.createAndDispatch
                        │
                        ▼
                  resolve_alert_audience (SQL)
                        │
                        ▼
                    FCM data-only
                        │
                        ▼
                  [Android AlertNotifier]
```

## Modelo de datos (resumen)

- `person`, `assignment` (vigencia), `device` (presencia sin historial), `shift_instance` (tstzrange con exclusión `gist`).
- `seismic_event`, `felt_decision`, `felt_report` (crowdsourcing).
- `incident`, `incident_event` (inmutable), `alert`, `alert_delivery` (por step de escalamiento).
- `building_clearance`, `safety_status`, `route_block`, `floor_plan`, `equipment`.
- `duty_override`, `gathering`, `gathering_change`, `audit_log` (inmutable).

## Componentes técnicos

| Componente | Tecnología |
|---|---|
| App móvil | Kotlin 2.0 + Jetpack Compose + WorkManager + Play Services Location + CameraX/ML Kit |
| Backend | Node.js 20 + TypeScript + Express + pg + firebase-admin |
| BD | PostgreSQL 16 (`btree_gist`, `tstzrange`, `uuid[]`, `jsonb`) |
| Push | Firebase Cloud Messaging (`AndroidConfigV2`, prioridad `high`, data-only) |
| Observabilidad | Prometheus + Grafana |

## Modos de fallo deliberados

| Escenario | Regla |
|---|---|
| Presencia `DESCONOCIDA` | ROJO/AMARILLO **fallan abierto** (se muestran) |
| Presencia `DESCONOCIDA` + voto sísmico | **Falla cerrado** (no se cuenta) |
| Latencia de catálogo > 20 min | Se omite votación → AMARILLO a jefes |
| Canal ROJO silenciado por usuario | `FullScreenAlertActivity` reproduce alarma vía `STREAM_ALARM` |
