# Despliegue gratis para el equipo (Módulo 3 · opción sin costo)

> Objetivo: que el equipo (Edgar, Óscar, Sergio) acceda a TradeMe por HTTPS, con login, **sin pagar
> nada**, y sin cambiar la arquitectura (docker-compose + TimescaleDB + quant intactos).

## Recomendación: **Tailscale** (red privada del equipo)

**Por qué es la mejor opción gratuita para nuestro caso:**

- **Gratis para 3 usuarios** (plan personal): justo el tamaño del equipo.
- **La app sigue corriendo en tu PC** con el mismo `docker compose` de siempre: TimescaleDB, el
  servicio quant y la API funcionan idénticos (las nubes gestionadas gratuitas NO ofrecen
  TimescaleDB y fragmentarían el stack).
- **Privado de verdad:** la plataforma no queda expuesta a internet; solo los dispositivos de la
  red Tailscale la ven. El login JWT queda como segunda capa.
- **HTTPS válido incluido** (dominio `*.ts.net`): requisito para la PWA y el Web Push en móvil.

**Limitación honesta:** tu PC debe estar encendida para que el equipo acceda. Si más adelante se
necesita 24/7, la ruta natural es la misma configuración en un VPS (o el *Always Free* de Oracle
Cloud) — sin cambiar nada del compose.

## Pasos (una vez, ~15 minutos)

1. **Instala Tailscale** en tu PC (Windows): https://tailscale.com/download — inicia sesión
   (Google/GitHub). En **cada dispositivo del equipo**, instalar Tailscale e iniciar sesión;
   desde tu panel (https://login.tailscale.com/admin) **invítalos** a tu red (Users → Invite).
2. **Levanta TradeMe** como siempre, en `C:\Users\hp\Claude\Projects\TradeMe - Build\TradeMe`:
   ```powershell
   docker compose -f infra/docker-compose.yml up -d
   ```
3. **Publica la web y la API con HTTPS del tailnet** (PowerShell):
   ```powershell
   tailscale serve --bg --https=443 http://localhost:5173
   tailscale serve --bg --https=8443 http://localhost:3001
   ```
   Tailscale te dirá tu URL, p. ej. `https://tu-pc.tu-tailnet.ts.net` (web) y
   `https://tu-pc.tu-tailnet.ts.net:8443` (API).
4. **Apunta la web a la API pública del tailnet:** crea `apps/web/.env.production` con
   `VITE_API_URL=https://tu-pc.tu-tailnet.ts.net:8443` y reconstruye la web
   (`docker compose -f infra/docker-compose.yml up -d --build web`).
5. **Restringe CORS** en el compose (servicio api): `CORS_ORIGIN: https://tu-pc.tu-tailnet.ts.net`.
6. El equipo abre la URL, se **loguea** (usuarios creados con `apps/api/scripts/create-user.ts`) y
   puede **instalar la PWA** y activar el **push** (HTTPS válido ✓).

## Alternativa 24/7 gratuita (si la PC encendida es un problema)

**Oracle Cloud Always Free** (VM ARM, 4 OCPU/24 GB, gratis permanente): instalar Docker + clonar el
repo + mismo `docker compose` + Tailscale en la VM (misma receta de arriba). Es más trámite
(cuenta con tarjeta para verificación) pero deja la plataforma siempre disponible sin costo.

> Evitamos túneles públicos gratuitos (URLs efímeras que cambian y rompen la PWA/push) y nubes
> gestionadas gratuitas (sin TimescaleDB, stack fragmentado). Cuando haya presupuesto, el salto a
> VPS de pago (~$6/mes) usa exactamente esta misma receta.
