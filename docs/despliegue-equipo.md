# Desplegar TradeMe para el equipo — gratis, con tu PC encendida

> Objetivo: que 5 personas (o las que quieras) entren desde cualquier lugar por **HTTPS**, con su
> usuario y contraseña, **sin pagar nada** y **sin tocar el router**. La plataforma corre en tu PC.

## Opción recomendada: **Tailscale Funnel**

**Por qué esta y no otra:**

| | Tailscale Funnel | Cloudflare Tunnel | ngrok gratis | Abrir puertos del router |
|---|---|---|---|---|
| Coste | **Gratis** | Gratis | Gratis | Gratis |
| Tarjeta | **No** | No | No | No |
| URL estable | **Sí** (`algo.tu-tailnet.ts.net`) | Solo con dominio propio (~$10/año) | No (cambia al reiniciar) | Con DuckDNS, sí |
| Usuarios | **Ilimitados** (entran por tu login) | Ilimitados | Ilimitados | Ilimitados |
| HTTPS válido | **Sí, automático** | Sí | Sí | Requiere Caddy + configuración |
| Configurar router | **No** | No | No | Sí (y falla con CGNAT) |

Funnel expone tu servicio a internet con un certificado válido y una URL fija. **Tus compañeros no
necesitan instalar nada ni tener cuenta de Tailscale**: abren la URL y entran con las credenciales
que tú les crees en TradeMe. El plan gratuito de Tailscale limita *usuarios del tailnet* (3), pero
aquí solo tú estás en el tailnet: los demás son visitantes de una web pública protegida por el login
de la app.

---

## Paso a paso (≈20 minutos, una sola vez)

### 1. Instala Tailscale en tu PC
Descarga desde <https://tailscale.com/download> e inicia sesión (Google/GitHub). Tu PC aparecerá en
<https://login.tailscale.com/admin/machines>; **renómbrala** a algo corto, por ejemplo `trademe`.

### 2. Habilita HTTPS y Funnel en tu tailnet
En el panel de administración:
- **DNS → HTTPS Certificates → Enable.**
- **Access controls (ACL)**: asegúrate de que el atributo de Funnel está permitido. Si tu ACL es la
  por defecto, añade dentro del JSON:
  ```json
  "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]
  ```

### 3. Prepara los secretos de producción
En PowerShell, dentro de `C:\Users\hp\Claude\Projects\TradeMe - Build\TradeMe`:
```powershell
copy infra\.env.prod.example infra\.env.prod
notepad infra\.env.prod
```
Rellena (genera valores largos y aleatorios para los dos primeros):
```
POSTGRES_PASSWORD=<una-clave-larga>
JWT_SECRET=<otra-clave-larga-distinta>
PUBLIC_WEB_ORIGIN=https://trademe.TU-TAILNET.ts.net
PUBLIC_API_URL=https://trademe.TU-TAILNET.ts.net:8443
VAPID_PUBLIC_KEY=<la que ya usas>
VAPID_PRIVATE_KEY=<la que ya usas>
VAPID_SUBJECT=mailto:tu-correo@ejemplo.com
```
> El nombre exacto del tailnet lo ves en el panel de Tailscale (algo como `tail1234.ts.net`).

### 4. Levanta TradeMe en modo producción
```powershell
docker compose --env-file infra\.env.prod -f infra\docker-compose.prod.yml up -d --build
```
Este compose ya trae lo importante: **volúmenes con nombre** (tus datos sobreviven reinicios),
**reinicio automático** de los contenedores, y web/API escuchando **solo en localhost** (nada
expuesto salvo lo que publiques por Funnel).

### 5. Publica web y API por Funnel
```powershell
tailscale funnel --bg --https=443 http://localhost:5173
tailscale funnel --bg --https=8443 http://localhost:3001
tailscale funnel status
```
Te mostrará tus URLs públicas. Compruébalas desde el móvil con datos (sin wifi) para confirmar que
salen a internet.

### 6. Crea los usuarios del equipo
Uno por persona:
```powershell
docker compose --env-file infra\.env.prod -f infra\docker-compose.prod.yml exec api node --experimental-strip-types apps/api/scripts/create-user.ts compañero@correo.com "clave-larga-y-unica"
```

### 7. Que tu PC no se duerma
Windows: **Configuración → Sistema → Inicio/apagado → Suspensión: Nunca** (al menos conectado a la
corriente). En Docker Desktop activa **«Start Docker Desktop when you log in»**. Con
`restart: unless-stopped` los contenedores vuelven solos tras un reinicio del PC.

### 7b. Da memoria suficiente a Docker (importante)

El servicio quant entrena modelos y optimiza: si Docker tiene poca RAM, **Windows lo mata sin aviso**
(el contenedor desaparece y verás «Servicio quant · Caído» en la pestaña Estado). Con Docker Desktop
sobre WSL2, crea o edita `C:\Users\hp\.wslconfig`:

```
[wsl2]
memory=6GB
processors=4
```

Cierra sesión de Docker Desktop y reinícialo (`wsl --shutdown` y volver a abrir Docker). Con 6 GB va
sobrado; con menos de 4 GB es probable que quant muera durante una optimización.

> Todos los servicios llevan `restart: unless-stopped`, así que si alguno cae vuelve solo; y quant
> tiene *healthcheck*, de modo que `docker compose ps` te dirá si está sano.

### 8. El equipo entra
Abren `https://trademe.TU-TAILNET.ts.net`, inician sesión y pueden **instalar la app** (PWA) y
**activar las notificaciones push** — el HTTPS válido de Funnel lo permite.

---

## Alternativa si Funnel te da problemas: DuckDNS + Caddy

Requiere que tu conexión tenga **IP pública** (muchas fibras y móviles usan CGNAT y no la tienen) y
abrir los puertos 80/443 en el router:

1. Registra un subdominio gratis en <https://www.duckdns.org> (p. ej. `trademe.duckdns.org`).
2. Redirige los puertos 80 y 443 de tu router hacia tu PC.
3. Añade Caddy al compose para obtener certificados automáticos de Let's Encrypt y hacer de proxy
   hacia `web:5173` y `api:3001`.

Es más frágil y expone tu red: úsala solo si Funnel no es viable.

---

## Seguridad de este montaje

- **Login obligatorio** (JWT): sin credenciales no se ve nada. Los usuarios los creas tú; no hay
  registro público.
- **CORS restringido** a tu dominio `ts.net`.
- **Postgres, Redis y quant no se exponen**: solo son accesibles dentro de Docker.
- **Secretos** en `infra/.env.prod`, que está ignorado por Git.
- **Operaciones con dinero real deshabilitadas** por diseño (`ENABLE_LIVE_TRADING=false`).

## Cuando quieras dejar de depender de tu PC

Esta misma receta funciona igual en un VPS de ~4 €/mes (Hetzner) o en una VM gratuita de Oracle si
algún día pasa la verificación: se instala Docker y Tailscale, se clona el repo y se ejecutan los
mismos comandos. No habría que cambiar nada de la aplicación.
