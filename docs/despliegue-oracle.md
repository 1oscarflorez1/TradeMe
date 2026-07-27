# Despliegue 24/7 gratis: Oracle Cloud Always Free + Tailscale (Módulo 3)

> Resultado: TradeMe corriendo **siempre encendido** en una VM gratuita de Oracle, accesible
> **solo para el equipo** por HTTPS (Tailscale), con datos persistentes (volúmenes nombrados) y
> secrets fuera del repo. Costo: **$0**.

## 0. Qué necesitas
- Cuenta en Oracle Cloud (https://signup.oraclecloud.com) — pide **tarjeta para verificación**
  (no cobra; el tier Always Free no expira). Elige una *home region* con capacidad ARM
  (p. ej. `us-ashburn-1`, `sa-saopaulo-1`).
- Cuenta Tailscale (gratis) con tu equipo ya invitado (ver `despliegue-gratis.md`).

## 1. Crear la VM (5 min)
En Oracle Cloud → Compute → Instances → **Create instance**:
- Image: **Ubuntu 24.04**. Shape: **Ampere A1.Flex** (ARM) con **4 OCPU / 24 GB** (todo el Always
  Free en una sola VM). Si dice *Out of capacity*: prueba otra *availability domain*, reintenta más
  tarde, o usa 2 OCPU/12GB (sobra para TradeMe).
- Sube tu llave SSH pública (o descarga la que genera).
- Networking: deja la VCN por defecto. **No abras puertos extra** (el acceso irá por Tailscale).

Conéctate: `ssh ubuntu@IP_PUBLICA`

## 2. Instalar Docker + Tailscale (5 min)
```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # abre el enlace y autoriza la VM en tu tailnet
sudo tailscale set --operator=ubuntu
```
En https://login.tailscale.com/admin/machines verás la VM (p. ej. `trademe`). Puedes renombrarla.

## 3. Clonar y configurar (5 min)
```bash
git clone https://github.com/1oscarflorez1/TradeMe.git && cd TradeMe
cp infra/.env.prod.example infra/.env.prod
openssl rand -hex 32        # úsalo como JWT_SECRET
openssl rand -hex 16        # úsalo como POSTGRES_PASSWORD
nano infra/.env.prod        # rellena secrets y las URLs ts.net (paso 4)
```

## 4. Publicar con HTTPS del tailnet
```bash
tailscale serve --bg --https=443  http://localhost:5173   # web
tailscale serve --bg --https=8443 http://localhost:3001   # api
tailscale serve status
```
Anota la URL (p. ej. `https://trademe.tu-tailnet.ts.net`) y pon en `infra/.env.prod`:
`PUBLIC_WEB_ORIGIN=https://trademe.tu-tailnet.ts.net` y
`PUBLIC_API_URL=https://trademe.tu-tailnet.ts.net:8443`.

## 5. Levantar TradeMe
```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --build
docker compose -f infra/docker-compose.prod.yml ps
curl -s http://localhost:3001/health
```

## 6. Crear los usuarios del equipo
```bash
docker compose -f infra/docker-compose.prod.yml exec api \
  node --experimental-strip-types apps/api/scripts/create-user.ts correo@equipo.com 'clave-fuerte'
```
(Si el runtime no acepta strip-types: `docker compose ... exec api npx tsx apps/api/scripts/create-user.ts ...`.)

## 7. El equipo entra
Cada miembro (con Tailscale iniciado en su dispositivo) abre
`https://trademe.tu-tailnet.ts.net` → login → puede **instalar la PWA** y activar **push** (HTTPS ✓).

## Seguridad y persistencia (qué garantiza esta receta)
- **Nada expuesto a internet:** web/API escuchan solo en `localhost` de la VM; Postgres/Redis/quant
  son internos. El único camino de entrada es tu tailnet privado + login JWT.
- **CORS estricto** al dominio ts.net (`PUBLIC_WEB_ORIGIN`).
- **Secrets** en `infra/.env.prod` (gitignoreado), nunca en el repo.
- **Persistencia:** volumen nombrado `pgdata_prod` (velas, snapshots, backtests, usuarios) y
  `artifacts/` en disco (ensembles optimizados, calibradores) → sobreviven reinicios y rebuilds.
- **Actualizar versión:** `git pull && docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --build`.
