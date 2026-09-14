# Arquitectura híbrida

Monorepo pnpm con workspaces:

```
trademe/
  apps/
    api/          # Node + TypeScript — tiempo real, WS, webhooks, inferencia en vivo
    quant/        # Python — backtesting, optimización, entrenamiento/calibración, MLflow
    web/          # dashboard React + Vite + TS
    mobile/       # Expo (React Native) — futuro
  packages/
    core-signals/ # contrato compartido: esquema de señal + indicadores (TS) y mirror Python
  artifacts/      # salidas de quant consumidas por api: ensemble.yaml, model.onnx, calibrators/
  infra/          # docker-compose, migraciones, github actions
  docs/
```

**Separación estricta**: la decisión en vivo se sirve desde Node; el entrenamiento vive en Python.
Ambos comparten **contrato**, no código de runtime (ver [`contrato.md`](contrato.md)).

**Datos compartidos**: PostgreSQL + TimescaleDB (velas históricas y señales) y Redis (cache/pub-sub).
Tanto `api` como `quant` leen el mismo histórico.

**Artefactos**: quant los publica en `artifacts/` —cuarentena, meta-modelo, calibradores,
independencia, fundamentales, correlaciones— escribiendo de forma atómica, y la api los recoge sola
cuando cambian en disco, en unos 15 segundos como mucho. Hasta 0.72.2 solo los leía al arrancar o con
`POST /reload`. Ver [`recarga-artefactos.md`](recarga-artefactos.md).
