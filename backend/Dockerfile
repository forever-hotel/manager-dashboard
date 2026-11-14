# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,id=mad-backend-npm,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline
COPY . .
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,id=mad-backend-npm,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --prefer-offline
COPY --from=builder --chown=node:node /app/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
