# TradeMe API — imagen de producción
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# Instalar dependencias del workspace (contexto = raíz del monorepo)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/
COPY packages/core-signals/package.json packages/core-signals/
RUN pnpm install --frozen-lockfile || pnpm install

COPY . .
RUN pnpm --filter @trademe/api build

EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
