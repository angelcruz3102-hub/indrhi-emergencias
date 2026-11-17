# INDRHI · Sistema de Brigadas y Emergencias

Sistema interno de gestión de emergencias y brigadas del INDRHI (Santo Domingo, RD).

> **No sustituye** a Alerta RD, al COE ni a los servicios nacionales de emergencia.

## Estructura

- `android/` — App Kotlin (FCM, geocercas, TOTP QR, colas offline)
- `backend/` — API Node.js 20 + TypeScript + PostgreSQL
- `infra/` — Prometheus + Grafana
- `docs/` — Arquitectura, API, piloto

## Desarrollo rápido

### Backend
```bash
cd backend
cp .env.example .env
npm install
npm run build
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/migrations/001_immutable_logs.sql
npm run dev
