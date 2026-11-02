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

# ─── Stage 3: Production Runtime with Pre-installed Chromium ─────────────────
FROM mcr.microsoft.com/playwright:v1.48.2-noble AS runtime

WORKDIR /app/backend

# Copy compiled dependencies directly from server-builder
COPY --from=server-builder /app/backend/node_modules ./node_modules
COPY backend/package.json ./

# Copy compiled backend and frontend artifacts
COPY --from=server-builder /app/backend/dist ./dist
COPY --from=web-builder    /app/frontend/dist /app/frontend/dist

ENV NODE_ENV=production
ENV PORT=8080
ENV WEB_DIST_DIR=/app/frontend/dist
ENV DATA_DIR=/app/data

VOLUME ["/app/data"]
EXPOSE 8080

CMD ["node", "dist/index.js"]
