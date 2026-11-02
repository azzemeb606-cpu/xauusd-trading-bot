# ─── Stage 1: Build React frontend ───────────────────────────────────────────
FROM node:20-slim AS web-builder
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ─── Stage 2: Build Node backend ─────────────────────────────────────────────
FROM node:20-slim AS server-builder
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install
COPY backend/ ./
RUN npm run build

# ─── Stage 3: Runtime image ───────────────────────────────────────────────────
FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Copy backend dependencies and install production modules
COPY backend/package.json ./
RUN npm install --omit=dev

# Install Playwright Chromium browser binary and system dependencies
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium

# Copy build artifacts
COPY --from=server-builder /app/backend/dist ./dist
COPY --from=web-builder    /app/frontend/dist /app/frontend/dist

ENV NODE_ENV=production
ENV PORT=8080
ENV WEB_DIST_DIR=/app/frontend/dist
ENV DATA_DIR=/app/data

VOLUME ["/app/data"]
EXPOSE 8080

CMD ["node", "dist/index.js"]
