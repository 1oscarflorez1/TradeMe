# TradeMe API (Node) — imagen de producción
FROM node:20-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Copia todo el monorepo. El .dockerignore excluye node_modules/dist/.git,
# así que la estructura de workspaces de pnpm se resuelve dentro del contenedor.
COPY . .

# Instala TODAS las dependencias del workspace (incluye devDeps -> tsc disponible).
RUN pnpm install --frozen-lockfile

# Compila la API.
RUN pnpm --filter @trademe/api build

EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
