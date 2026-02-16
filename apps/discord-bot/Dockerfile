FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/discord-bot/package.json apps/discord-bot/
RUN npm ci --workspace=apps/discord-bot
COPY apps/discord-bot/ apps/discord-bot/
RUN npm run build --workspace=apps/discord-bot

FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/discord-bot/package.json apps/discord-bot/
RUN npm ci --workspace=apps/discord-bot --omit=dev
COPY --from=builder /app/apps/discord-bot/dist apps/discord-bot/dist
CMD ["node", "apps/discord-bot/dist/index.js"]
