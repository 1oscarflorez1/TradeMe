# TradeMe web — build + preview estático
FROM node:20-slim
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @trademe/web build
EXPOSE 5173
CMD ["pnpm", "--filter", "@trademe/web", "preview", "--host", "--port", "5173"]
