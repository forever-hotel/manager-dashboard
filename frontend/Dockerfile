FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/verify-build-config.mjs scripts/build-config-integrity.json ./scripts/
COPY postcss.config.mjs next.config.ts eslint.config.mjs vitest.config.ts ./
# Check host-supplied config before dependencies or Next.js can execute it.
# Optional native packages are supplied by the lockfile; dependency lifecycle
# scripts are deliberately disabled in this build.
# Keep verified npm downloads across failed builds and retry transient timeouts.
# Source-only edits do not invalidate the dependency installation layer.
RUN --mount=type=cache,id=mad-frontend-npm,target=/root/.npm,sharing=locked \
    node scripts/verify-build-config.mjs \
    && npm ci --ignore-scripts --no-audit --no-fund --prefer-offline \
        --fetch-timeout=300000 --fetch-retries=3 \
        --fetch-retry-mintimeout=10000 --fetch-retry-maxtimeout=60000 --maxsockets=5 \
    && node scripts/verify-build-config.mjs
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build && node scripts/verify-build-config.mjs

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
