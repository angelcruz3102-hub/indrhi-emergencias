# Piloto ED1 · 30 días · Puerta de salida RF-9.4

## Día 0 · Preparación
- [ ] `google-services.json` en el proyecto, build firmado `release`.
- [ ] Firebase Auth + importación de directorio (CSV → `person`).
- [ ] `perimeter_zone` cargado para ED1 (radio inicial 150 m).
- [ ] `building.totp_secret` generado para ED1 y ED2.
- [ ] `incident_type` sembrado con severidad/nivel por defecto.
- [ ] `contacts` (dispensario + jefe seguridad) con teléfono verificado.
- [ ] Prometheus + Grafana desplegados; dashboards importados.

## Día 1-3 · Instalación
- [ ] ≥90% de equipos con los 5 indicadores de salud verdes.
- [ ] Cada usuario completó consentimiento Ley 172-13.
- [ ] QR dinámico verificado en garita (TOTP 45 s contra `building.totp_secret`).

## Día 7 · Primer simulacro
- [ ] `POST /v1/drills` con `severity=ROJO`.
- [ ] Acuses <60 s ≥85% (panel Grafana `indrhi_ack_latency_seconds`).
- [ ] Escalamiento disparado a los 60 s/120 s sin intervención manual.
- [ ] 0 falsos positivos.

## Día 15 · Simulacro sísmico
- [ ] Ingestor recibe el evento del feed USGS en <60 s.
- [ ] Panel congelado correcto (`felt_decision.panel_size` ≥3).
- [ ] Votación con doble umbral produce `EVALUAR_DANOS` o `SOLO_REGISTRO`.

## Día 30 · Puerta de salida
- [ ] 30 días sin Rojos por falsos positivos.
- [ ] ≥90% de equipos con 5 indicadores verdes el día 30.
- [ ] ≥85% de acuses <60 s en los simulacros.
- [ ] Tablero de reingreso probado en al menos un simulacro por edificio.
- [ ] Sin incidentes de privacidad (auditoría: 0 coordenadas GPS en BD).
