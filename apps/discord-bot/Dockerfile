FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/discord-bot/package.json apps/discord-bot/
RUN npm ci --workspace=apps/discord-bot
COPY apps/discord-bot/ apps/discord-bot/
RUN npm run build --workspace=apps/discord-bot

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN addgroup --system app && adduser --system --ingroup app app
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/discord-bot/package.json apps/discord-bot/
RUN npm ci --workspace=apps/discord-bot --omit=dev
COPY --from=builder /app/apps/discord-bot/dist apps/discord-bot/dist
RUN chown -R app:app /app
USER app
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/ || exit 1
CMD ["node", "apps/discord-bot/dist/index.js"]
