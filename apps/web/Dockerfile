# TradeMe web — build + preview estático
FROM node:20-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @trademe/web build

EXPOSE 5173
CMD ["pnpm", "--filter", "@trademe/web", "preview", "--host", "--port", "5173"]
