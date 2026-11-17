# INDRHI · Sistema de Brigadas y Emergencias

Sistema interno de gestión de emergencias, brigadas y seguridad del recinto del **INDRHI (Santo Domingo, República Dominicana)**.

> Sistema interno de apoyo a brigadas del INDRHI. **No sustituye** a Alerta RD, al COE ni a los servicios nacionales de emergencia. La orden de evacuación es siempre emitida por una persona autorizada.

## Estructura

| Carpeta | Contenido |
|---|---|
| `android/` | App nativa en Kotlin (ruta crítica FCM, geocercas, QR TOTP, colas offline) |
| `backend/` | API Node.js 20 + TypeScript + PostgreSQL + FCM |
| `infra/` | Docker Compose para Prometheus + Grafana |
| `docs/` | Arquitectura, API y checklist del piloto ED1 |

## Requisitos previos

- JDK 17 · Android SDK 35 · Gradle 8.6
- Node.js 20 · PostgreSQL 16
- Proyecto Firebase con FCM + Auth
- `google-services.json` en `android/app/`

## Desarrollo local

### Backend
```bash
cd backend
cp .env.example .env       # configura DATABASE_URL y GOOGLE_APPLICATION_CREDENTIALS
npm ci
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/migrations/001_immutable_logs.sql
npm run dev
```

### Android
```bash
cd android
echo "$(base64 -d GOOGLE_SERVICES_JSON_B64)" > app/google-services.json
./gradlew :app:assembleDebug
```

### Tests backend
```bash
cd backend
TEST_DATABASE_URL=postgres://postgres:test@localhost:5432/indrhi_test npm test
```

## Despliegue

- **Android**: `git tag v1.0.0 && git push --tags` → GitHub Actions genera `app-release.aab` firmado.
- **Backend**: build `npm run build`, ejecutar `node dist/index.js` detrás de TLS. Variables de entorno en `.env.example`.
- **Observabilidad**: `docker compose -f infra/docker-compose.observability.yml up -d`.

## Módulos implementados (V2.1)

- **M1** Sismo calibrado + crowdsourcing con doble umbral
- **M2** Reporte multiamenaza + agrupación 5 min
- **M3** Multiedificio + planos offline
- **M4** Semáforo + escalamiento automático
- **M5** Geocerca + QR TOTP (RFC 6238)
- **M6** Turnos + convocatorias extraordinarias
- **M7** Directorio + reuniones + bitácoras (WebView puente)
- **M8** Reingreso + "Estoy a salvo" + simulacros
- **M9** Offline + Ley 172-13 + accesibilidad + KPIs

## Licencia

Uso interno institucional del INDRHI. Ver `LICENSE`.
