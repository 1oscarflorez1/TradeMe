# Sobre mí y cómo trabajar conmigo

> Archivo de contexto para el proyecto **SignalDeck**. Rellena los campos `<...>` con tu información.
> Cowork puede actualizar este archivo si le pido "codifica esta preferencia".

## Quién soy

- **Nombre / cómo dirigirte a mí:** `<tu nombre>`
- **Rol:** `<p. ej. desarrollador / trader / fundador del proyecto>`
- **Nivel técnico:** `<p. ej. cómodo con JS/TS, aprendiendo Python; o el que sea>`
- **Zona horaria:** `<p. ej. America/Bogota (UTC-5)>`
- **Objetivo del proyecto:** construir SignalDeck, un copiloto de trading en tiempo real (apoyo a la decisión, no asesoría) para activos mixtos.

## Cómo prefiero trabajar

- **Idioma:** respóndeme en **español**.
- **Mensajes de commit y PRs:** en `<español | inglés>` (por defecto inglés con Conventional Commits).
- **Nivel de detalle:** explícame las decisiones de diseño no obvias en 2-3 frases; no te extiendas de más.
- **Cuándo preguntarme:** antes de cualquier acción irreversible (borrar, force-push, secretos, instalar dependencias pesadas) y antes de cerrar cada hito. Si una decisión tiene varias opciones razonables, pregúntame con AskUserQuestion en vez de asumir.
- **Ritmo:** un hito a la vez (M0→M10); no avances sin CI verde y DoD cumplido.

## Decisiones técnicas ya tomadas (no las reabras sin consultarme)

- **Arquitectura híbrida:** `apps/api` en Node/TypeScript (tiempo real, WS, webhooks, inferencia en vivo) + `apps/quant` en Python (backtesting, optimización, entrenamiento/calibración).
- **Frontend:** React + Vite + TS (`apps/web`); móvil con Expo (`apps/mobile`).
- **Datos:** PostgreSQL + TimescaleDB y Redis. Detalle de fuentes en `data-providers.md`.
- **Contrato Node↔Python:** esquema de señal versionado + artefactos (`ensemble.yaml`, calibradores, `model.onnx`) + **suite de paridad de indicadores** que debe pasar en CI.
- **Spec completa:** `SignalDeck_Cowork_Brief.md` es la fuente de verdad.

## Qué priorizo

1. Seguridad del capital y gestión de riesgo por encima de señales "agresivas".
2. Explicabilidad: toda sugerencia justificable (qué indicadores votaron y con qué peso).
3. Rigor estadístico: validación antes que optimización, sin look-ahead ni sobreajuste; probabilidades **calibradas**.

## Qué NO quiero

- Ejecución de órdenes con dinero real activada (debe quedar tras un feature flag desactivado por defecto).
- Promesas de rentabilidad o lenguaje de asesoría financiera; el disclaimer educativo va visible.
- Código propietario de cursos (p. ej. SniperUltra) copiado al repo; intégralo vía webhook respetando su licencia.
