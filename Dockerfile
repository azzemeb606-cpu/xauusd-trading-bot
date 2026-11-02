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
# Install build tools for better-sqlite3 native compilation if needed
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json ./
RUN npm install
COPY backend/ ./
RUN npm run build

# ─── Stage 3: Runtime image ───────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install Playwright system dependencies for headless Chromium and sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl python3 make g++ \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdbus-1-3 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Copy backend dependencies and install production modules
COPY backend/package.json ./
RUN npm install --omit=dev

# Install Playwright Chromium browser binary
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium

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
