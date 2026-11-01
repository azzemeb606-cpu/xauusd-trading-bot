# ─── Stage 1: Build React frontend ───────────────────────────────────────────
FROM node:20-slim AS web-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# ─── Stage 2: Build Node backend ─────────────────────────────────────────────
FROM node:20-slim AS server-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --silent
COPY backend/ ./
RUN npm run build

# ─── Stage 3: Runtime image ───────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install Playwright system dependencies for headless Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdbus-1-3 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend production dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev --silent

# Install Playwright and Chromium browser binary
RUN cd backend && npx playwright install chromium --with-deps 2>&1 | tail -5

# Copy build artifacts
COPY --from=server-builder /app/backend/dist ./backend/dist
COPY --from=web-builder    /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
ENV WEB_DIST_DIR=/app/frontend/dist
ENV DATA_DIR=/app/data

VOLUME ["/app/data"]
EXPOSE 8080

CMD ["node", "backend/dist/index.js"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/api/status -H "Authorization: Bearer ${ADMIN_TOKEN}" || exit 1
