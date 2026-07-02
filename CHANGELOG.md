# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y [Versionado Semántico](https://semver.org/lang/es/).

## [No publicado]

### Added — M0 · Scaffolding

- Monorepo pnpm con workspaces (`apps/api`, `apps/quant`, `apps/web`, `packages/core-signals`).
- `apps/api`: servidor Fastify con `GET /health` y canal WebSocket base `/stream`.
- `apps/quant`: esqueleto de paquete Python con tracking MLflow local y pruebas.
- `packages/core-signals`: esquema de señal `signal.schema.json` v1.0.0 y carpeta de paridad.
- `apps/web`: shell del dashboard React + Vite con tema oscuro y selector de activos.
- `infra/docker-compose.yml`: api + quant + web + PostgreSQL/TimescaleDB + Redis.
- CI de GitHub Actions con dos jobs (Node y Python): lint + typecheck/mypy + tests.
- Documentación inicial en `docs/` y `.env.example`.
