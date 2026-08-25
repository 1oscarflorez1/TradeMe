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

   **Ejecutar exactamente los comandos de CI**, no variantes. En quant CI corre `mypy` a secas, que
   comprueba **54 ficheros incluidos los tests**; `mypy trademe_quant` solo mira 35 y deja pasar
   errores. Ha roto CI dos veces. Si el entorno local no admite el comando tal cual (los stubs de
   numpy modernos exigen `--python-version` mayor que el 3.11 de CI), mantener al menos el mismo
   **alcance**: `mypy --python-version 3.14 .` desde `apps/quant`.
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

**Resuelta la de las cuatro copias a mano** (comprobado el 24-ago-2026). La plataforma ya no se
describe a sí misma en sitios que envejecen por su cuenta:

- **Novedades** (`NewsView.tsx`) lee el CHANGELOG vía `GET /releases`. No tiene nada propio que
  desviarse, y CI comprueba que la versión de los `package.json` coincide con la primera entrada.
- **El asistente** tiene `cambios_de_version` (sobre el CHANGELOG) y `consultar_documentacion`
  (sobre `docs/`), y el prompt le prohíbe responder de memoria sobre ambas cosas.
- **El Centro de ayuda** se quedó como documentación conceptual, que es lo que debía ser: no es un
  registro de cambios y no debe derivarse del CHANGELOG.

Lo que esto implica al entregar: **la documentación conceptual vive en `docs/`**, y hay que
actualizarla ahí cuando un hito cambia cómo funciona algo por dentro. El asistente la lee de ahí, así
que un `docs/` desactualizado se convierte en un asistente que miente con seguridad.

**El backtest es cuadrático en el número de velas.** `decide()` llama a `compute_readings(high[:t+1],
…)` en cada vela y los `*_last()` recorren la serie entera: 250→500→1000 velas cuesta 0,03→0,14→0,46
s (×4 el tiempo al ×2 las velas). Multiplicar por diez la ventana multiplicaría por cien el tiempo
del piloto, de ~9 minutos a más de 15 horas. **Linealizar antes de alargar ninguna ventana** — los
indicadores son incrementales por naturaleza.

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
