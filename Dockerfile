# CropSetu backend + embedded admin SPA (same-origin).
#
# Stages: (1) build the admin React/Vite SPA, (2) backend runtime that serves the
# API (/api/v1/*) and the admin panel (/admin) from one origin.
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
# Prisma's update checker opens a socket to checkpoint.prisma.io and can keep the
# CLI process alive in a slim container, so `prisma db push && node …` never reaches
# node. Disable it so the CLI exits cleanly.
ENV CHECKPOINT_DISABLE=1
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
# No EXPOSE: Railway detects an EXPOSEd port as the healthcheck/proxy target,
# which would mismatch the $PORT the app actually listens on. With none, Railway
# routes to the PORT env var it injects (which the server binds to).

# Start only. Schema changes are applied deliberately, never on container boot.
#
# This used to run `timeout 60 npx prisma db push --skip-generate;` first, on
# EVERY boot of EVERY replica. Three reasons that is gone (DB-06):
#
#  1. It was already a no-op in production. `ai_scan_diagnoses` and
#     `ai_scan_feedback` are created by FastAPI via asyncpg and do not exist in
#     schema.prisma, so a non-interactive `db push` sees two tables it wants to
#     DROP, refuses with a data-loss error, and exits non-zero — swallowed by the
#     `;`. It never applied anything.
#  2. Worse, that refusal is the only thing that saved those two tables. Had they
#     ever been empty, `db push` would have DROPPED them without asking.
#  3. It serialises deploys. The migrate engine takes a session-scoped advisory
#     lock, so N replicas restarting queue behind each other — and that same lock
#     is what makes schema commands incompatible with PgBouncer transaction
#     pooling, so this had to go before a pooler can be introduced (DB-03).
#
# NOTE: `migrate deploy` is NOT the replacement. prisma/migrations is badly
# incomplete — 65 CREATE TABLE for 90 models, 23 CREATE TYPE for 43 enums — so it
# cannot build a fresh database and would fail on the first table against the
# existing one. Re-baselining that history is a separate, deliberate task. Until
# then schema changes follow the established manual path (prisma/manual/*.sql).
CMD ["sh", "-c", "node src/server.js"]
