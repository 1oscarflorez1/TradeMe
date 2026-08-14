# TradeMe — instrucciones del proyecto

Copiloto de trading: **apoyo a la decisión, no asesoría financiera**. Monorepo pnpm.
Repositorio: `1oscarflorez1/TradeMe`. Despliegue: Docker Compose + Tailscale Funnel.

---

## Reglas inquebrantables

1. **Responder en español.** Commits y PR en español, Conventional Commits.
2. **Nunca ejecutar órdenes con dinero real.** Vive tras `ENABLE_LIVE_TRADING=false`, que es el
   valor por defecto en el esquema de configuración y en ambos ficheros de compose. Ninguna
   entrega puede cambiar eso.
3. **Una rama y un PR por hito.** Jamás commits directos a `main`. Un PR abarca todos los commits
   que haga falta; no se abre uno nuevo para arreglar el anterior.
4. **Mini-plan antes de codificar.** Qué se toca, por qué y cómo se verifica.
5. **Puertas verdes antes de entregar**: api (lint + typecheck + test), quant (ruff + black + mypy +
   pytest), web (build + lint) y la **suite de paridad**. Si se toca la matemática de la decisión,
   regenerar vectores con `pnpm exec tsx scripts/gen-parity.ts` desde `apps/api`.
6. **Pedir confirmación** antes de: borrar ficheros o datos, `force-push`, tocar secretos, instalar
   dependencias pesadas, o cualquier acción irreversible.
7. **No incluir código propietario Reditum/Pine** en el repositorio. Solo se mapean sus salidas por
   configuración, en `apps/api/config/external_signals.yaml`.

## Al terminar cada hito, siempre

- **Título y descripción del PR rellenos**, en un bloque markdown listo para pegar, con las
  secciones: Objetivo · Cambios por área · Capturas · Checklist DoD.
- **Cada comando de terminal con su ubicación exacta.** El usuario trabaja en PowerShell sobre
  Windows y la carpeta es `C:\Users\hp\Claude\Projects\TradeMe - Build\TradeMe`.
- Actualizar `CHANGELOG.md` y subir la versión (semver) en `apps/api/package.json` y
  `apps/web/package.json`.

## Flujo de entrega

Trabajar directamente sobre el repositorio: crear la rama, commitear y hacer push. **No usar
bundles** — eran un apaño de cuando el asistente no tenía acceso al repositorio y causaron varios
despliegues fallidos.

```
git checkout main && git pull origin main
git checkout -b feat/<hito>
# ... trabajo, puertas verdes ...
git push -u origin feat/<hito>
```

Despliegue tras el merge (el usuario lo ejecuta):

```
cd "C:\Users\hp\Claude\Projects\TradeMe - Build\TradeMe"
git checkout main
git pull origin main
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
```

Siempre `--build` y **sin nombres de servicio**, o algún contenedor se queda en la versión vieja.
Después, `Ctrl+Shift+R` en el navegador. Si `quant` no recoge los cambios:
`build --no-cache quant`.

---

## Arquitectura

- **`apps/api`** (Node 20 · Fastify) — **aquí nace la decisión**. Velas → 8 indicadores → régimen
  ADX (escalado continuo) → media ponderada → banda neutra → calibración → meta-modelo → señal por
  WebSocket. Indicadores: EMA 9/21, MACD, Supertrend(10,3) [tendencia/momentum]; RSI 14,
  Bollinger 20·2, Estocástico 14 [reversión]; ADX 14 y ATR 14 como contexto.
- **`apps/quant`** (Python 3.11 · FastAPI) — el laboratorio. Backtest sin look-ahead y con peor
  caso, Optuna con walk-forward (promociona solo si gana fuera de muestra), calibración
  isotónica/Platt por régimen, meta-modelo RandomForest exportado como bosque JSON, y el piloto
  automático que lo lanza todo.
- **`apps/web`** (React + Vite, PWA) — Panel (con el sustento debajo), Registros, Backtest,
  Laboratorio, Ayuda, Novedades, Estado, y el asistente flotante.
- **`packages/core-signals`** — contrato JSON Schema y **vectores de paridad**: garantizan que Node
  y Python calculan exactamente lo mismo. Sin eso, cualquier backtest sería ficción.
- Datos en TimescaleDB (migraciones automáticas al arrancar, registradas en `schema_migrations`) y
  Redis. Artefactos en `artifacts/`, que quant publica y la api recarga con `POST /reload`.

### Proveedores de datos

Binance (cripto, streaming, sin clave) · Twelve Data (acciones, divisas, índices; por sondeo,
requiere clave) · IBKR (planificado). **TradingView no es proveedor de datos**: dibuja el gráfico y
envía las alertas Reditum por webhook, pero no publica API de velas para terceros.

---

## Deuda técnica conocida

**La plataforma se describe a sí misma en cuatro sitios escritos a mano** y hay que acordarse de
tocarlos todos en cada entrega: `NewsView.tsx`, `HelpView.tsx`, `Asistente.tsx` y
`assistant/context.ts`. El único al día es `CHANGELOG.md`, porque sí está en el checklist del PR.

Distinción importante al resolverlo: **Novedades y el historial del asistente sí deben derivarse
del CHANGELOG**; el **Centro de ayuda no** — es documentación conceptual, no un registro de
cambios. Para Ayuda, la vía correcta es que el asistente lea `docs/`, no una copia dentro del
código.

---

## Estado y pendientes

**Configuración que el usuario debe rellenar en `infra/.env.prod`** (las tres activan funciones ya
programadas):

- `TV_WEBHOOK_SECRET` → activa el webhook de Reditum. Guía en `docs/reditum-tradingview.md`.
- `TWELVEDATA_API_KEY` → activa acciones, divisas e índices. Guía en `docs/proveedores.md`.
- `ASSISTANT_*` → modelo (Groq) y búsqueda (Tavily) del asistente. Guía en `docs/asistente.md`.

**IBKR** — plan acordado en tres fases (datos → papel → real tras flag apagado), documentado en
`TradeMe_Integracion_IBKR.docx`. Bloqueado en el paso 0: seis preguntas al compañero del equipo que
tiene la cuenta (usuario de papel, compartir suscripciones de datos, permisos de API, clasificación
profesional, y consultar a IBKR sobre redistribución en un portal de equipo).

**M11–M14** — análisis fundamental, según `TradeMe_Analisis_Fundamental.docx`. Al reactivar el
sesgo macro, usar el escalado por temporalidad que ya existe desactivado por bandera.

---

## Estilo

Explicar el porqué con claridad no técnica cuando se pida: al usuario le gusta entender el
razonamiento, no solo el resultado. Ser honesto sobre lo que se verificó y lo que él debe probar.
Avisar cuándo un número es el esperado y cuándo es un fallo. Nunca dar por buena una suposición
cómoda sin comprobarla en el código.
