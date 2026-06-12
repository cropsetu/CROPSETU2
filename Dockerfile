# CropSetu backend + embedded admin SPA (same-origin).
#
# Two stages: (1) build the admin React/Vite SPA, (2) backend runtime that serves
# both the API (/api/v1/*) and the built admin panel (/admin) from one origin.
# Used by the Railway *backend* service with Root Directory = repo root.

# ── Stage 1: build the admin SPA ──────────────────────────────────────────────
FROM node:20-slim AS admin-build
WORKDIR /admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci
COPY admin/ ./
# Same-origin: the SPA calls /api/v1/* on the backend that serves it (no CORS).
ENV VITE_API_URL=/api/v1
ENV VITE_ENV_NAME=production
RUN npm run build           # → /admin/dist

# ── Stage 2: backend runtime ──────────────────────────────────────────────────
FROM node:20-slim AS backend
# OpenSSL is required by the Prisma query engine.
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Install deps first (better layer caching). The prisma schema must be present
# because backend's `postinstall` runs `prisma generate`.
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci

# App source (node_modules / .env excluded via .dockerignore).
COPY backend/ ./

# Built admin SPA → resolved by the backend at ../../admin/dist from src/app.js.
COPY --from=admin-build /admin/dist /app/admin/dist

ENV NODE_ENV=production
ENV ADMIN_DIST_DIR=/app/admin/dist
EXPOSE 3000

# Push schema to the DB (no migration history yet) then start. Railway's
# startCommand overrides this if set; kept so the image runs standalone too.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node src/server.js"]
