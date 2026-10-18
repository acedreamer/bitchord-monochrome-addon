# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy lockfiles and manifests
COPY package*.json ./

# Install all dependencies including devDependencies
RUN npm ci

# Copy full source tree and build TypeScript
COPY . .
RUN npm run build

# Stage 2: Production runner stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# REQ-GIT-08: Multi-stage hygiene - copy both package.json and package-lock.json
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy compiled JavaScript output from builder
COPY --from=builder /app/dist ./dist

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/manifest.json || exit 1

CMD ["node", "dist/index.js"]
