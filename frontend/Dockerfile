FROM node:22-alpine AS builder
WORKDIR /app
COPY . .
# Check host-supplied config before dependencies or Next.js can execute it.
# Optional native packages are supplied by the lockfile; dependency lifecycle
# scripts are deliberately disabled in this build.
RUN node scripts/verify-build-config.mjs \
    && npm ci --ignore-scripts --no-audit --no-fund --fetch-timeout=60000 --fetch-retries=1 \
    && node scripts/verify-build-config.mjs
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
