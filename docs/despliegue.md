# Despliegue (Módulo 3)

> Mientras no haya dominio propio, se despliega en PaaS: **Vercel** para `apps/web` y **Railway**
> para `apps/api` + `apps/quant` + Postgres/TimescaleDB + Redis. Ambos dan HTTPS automático, así
> que no hace falta Caddy ni un `docker-compose.prod.yml` — el `docker-compose.yml` de la raíz
> sigue siendo solo para desarrollo local.

## Por qué esta combinación

- **Vercel** encaja para `apps/web` (build estático de Vite): HTTPS y CDN automáticos, deploys por
  git, preview por PR. No sirve para `apps/api`: aunque tiene soporte nativo de WebSocket en beta
  (jun. 2026), las conexiones siguen atadas al límite de duración de una Function — no aguanta un
  stream de velas indefinido.
- **Render** también soporta WebSocket en sus servicios web, pero el plan gratis duerme el
  servicio a los 15 min sin tráfico (hasta 30s para despertar) y su Postgres administrado no lista
  TimescaleDB entre sus extensiones — no es lo mejor para "tiempo real".
- **Railway** soporta WebSocket en todos los planes, no duerme el servicio (cobra por uso real), y
  despliega imágenes Docker propias directo — incluida `timescale/timescaledb-ha`, que es
  exactamente lo que ya usa `infra/docker-compose.yml`. Por eso `api` + `quant` + DB + Redis van
  ahí, con red privada entre servicios.

## Railway — api, quant, Postgres/Timescale, Redis

1. Un proyecto Railway, cuatro servicios:
   - **postgres**: imagen `timescale/timescaledb-ha:pg16` (o la plantilla "Deploy & Host
     TimescaleDB" del marketplace de Railway). Volumen persistente.
   - **redis**: plantilla oficial de Redis.
   - **api**: build desde `apps/api/Dockerfile` (root del monorepo como contexto).
   - **quant**: build desde `apps/quant/Dockerfile`.
2. Variables de entorno del servicio **api** (además de las ya documentadas en `.env.example`):
   - `DATABASE_URL` → la del servicio postgres (Railway la inyecta si usas su referencia interna).
   - `REDIS_URL` → la del servicio redis.
   - `CORS_ORIGIN` → el dominio de Vercel, p. ej. `https://trademe.vercel.app`.
   - `JWT_SECRET` → **generar uno propio** (`openssl rand -base64 48`), nunca reutilizar el de
     ejemplo. Sin esta variable la API queda abierta (sirve para probar, no para producción).
   - `QUANT_URL` → URL interna del servicio quant en la red privada de Railway.
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` → generadas con `npx web-push generate-vapid-keys`.
3. Tras el primer deploy, crear los usuarios del equipo (no hay registro público):
   ```bash
   railway run --service api pnpm --filter @trademe/api exec tsx scripts/create-user.ts \
     edgar@equipo.com 'una-clave-fuerte'
   ```
   (repetir por cada persona). El script actualiza la contraseña si el email ya existe.
4. Las migraciones (`infra/postgres/migrations/*.sql`, incluida `009_users.sql`) se aplican solas
   al arrancar `api` (`runMigrations`), igual que en local.

## Vercel — web

1. Importar el repo, **root directory** `apps/web`, framework Vite (autodetectado).
2. Variables de entorno:
   - `VITE_API_URL` → la URL pública HTTPS del servicio `api` en Railway.
3. El login (Módulo 3) lo pide el propio backend: si `JWT_SECRET` está configurado en Railway, la
   web pide credenciales solas (`GET /health` anuncia `authRequired`); si no, queda abierta como
   antes de este módulo — útil para verificar un deploy antes de activar el login.

## Notas de seguridad

- Ningún secreto (`JWT_SECRET`, `DATABASE_URL`, `TV_WEBHOOK_SECRET`, claves VAPID) va en el repo:
  todos se ponen en las variables de entorno de Railway/Vercel.
- El token de sesión vive en `sessionStorage` del navegador (se pierde al cerrar la pestaña), no en
  `localStorage` — evita dejarlo pegado indefinidamente en un equipo compartido.
- `ENABLE_LIVE_TRADING` sigue en `false` por defecto también en producción; activarlo es una
  decisión aparte, nunca automática por el despliegue.
