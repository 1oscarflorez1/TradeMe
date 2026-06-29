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
