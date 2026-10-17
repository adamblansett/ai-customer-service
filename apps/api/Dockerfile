# Multi-stage Dockerfile for @customer-service/api
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace configs
COPY package*.json tsconfig.base.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/core/package.json ./packages/core/
COPY apps/api/package.json ./apps/api/

# Install all dependencies for build
RUN npm ci

# Copy source trees
COPY packages/db ./packages/db
COPY packages/core ./packages/core
COPY apps/api ./apps/api

# Build packages in dependency order
RUN npm run build --workspace=@customer-service/db
RUN npm run build --workspace=@customer-service/core
RUN npm run build --workspace=@customer-service/api

# Production Runner Stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install curl for health check
RUN apk add --no-cache curl

# Copy root configs and package files
COPY package*.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/core/package.json ./packages/core/
COPY apps/api/package.json ./apps/api/

# Install only production dependencies
RUN npm ci --omit=dev

# Copy compiled artifacts from builder
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Security: run as unprivileged node user
USER node

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
