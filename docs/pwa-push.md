# PWA + Web Push (M9)

> Objetivo: que TradeMe se **instale como app** (móvil/escritorio) y avise con **push real en
> segundo plano** (con la app cerrada). Reutiliza el portal web al 100%.

## PWA

- `apps/web/public/manifest.webmanifest` (nombre, iconos, `display: standalone`, colores).
- `apps/web/public/sw.js` (service worker): maneja `push` (muestra la notificación), `notificationclick`
  (enfoca/abre la app) e instala la app.
- Registro del SW en `main.tsx`.

En escritorio/Android el navegador ofrecerá **"Instalar app"**. En iOS, *Compartir → Añadir a inicio*.

## Web Push (VAPID)

Como la app puede estar cerrada, el **servidor** evalúa una regla y envía el push:

- **Regla de servidor:** en el loop de señales, si la decisión es COMPRAR/VENDER con
  **confianza ≥ `PUSH_MIN_CONFIDENCE`** (por defecto 0.65) y pasó el **cooldown**
  (`PUSH_COOLDOWN_MS`, 10 min), crea una alerta y **envía Web Push** a todas las suscripciones.
- Las **otras reglas** (Reditum, snapshot TP/SL, dirección/macro, avance 10%) siguen en el cliente
  (avisan con el portal abierto).

### Endpoints

- `GET /push/vapid` → clave pública VAPID.
- `POST /push/subscribe` → guarda la suscripción del navegador (tabla `push_subscriptions`).

### Activar en el dispositivo

En la **campana → "Activar push en este dispositivo"**: pide permiso, se suscribe con la clave VAPID
y registra la suscripción. A partir de ahí recibes push aunque cierres la pestaña.

## Requisitos

- **HTTPS** (o `localhost`): el push y el service worker requieren contexto seguro. Para probar en un
  móvil real, expón el portal por HTTPS (túnel) — en `localhost` funciona directo.
- **Claves VAPID:** no hay ninguna en el código. Hasta 0.75.0 `config.ts` traía un par por
  defecto, con la privada publicada en el repositorio; cualquier despliegue sin las variables
  firmaba con una clave que conoce todo el que lea el código. Ahora las resuelve
  `apps/api/src/push/vapid.ts`:

  | entorno | con `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` | sin ninguna de las dos |
  |---|---|---|
  | producción (`NODE_ENV=production`) | se usan tal cual | **push apagado** y aviso al arrancar; los avisos en la app siguen |
  | desarrollo y tests | se usan tal cual | se genera un par al arrancar; las suscripciones caducan en cada reinicio |

  Con solo una de las dos, el push queda apagado en cualquier entorno y el aviso dice cuál falta:
  una clave generada no casaría con la otra. `docker-compose.prod.yml` fija `NODE_ENV=production`;
  las claves se generan con `npx web-push generate-vapid-keys` y van en `infra/.env.prod`.

  Al arrancar, la api registra de dónde salieron (`origen`: `entorno`, `efimeras` o `ninguna`),
  nunca las claves, y `/status` lo muestra en «Notificaciones push».

  **Cambiar las claves invalida las suscripciones existentes**: cada dispositivo tiene que volver
  a pulsar «Activar push».
