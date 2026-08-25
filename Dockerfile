# syntax=docker/dockerfile:1
# Single Railway service = NestJS backend that also serves the built Angular SPA.
# CLIP moderation and the Pollinations demo live on other platforms; the backend
# reaches CLIP via the CLIP_SERVICE_URL env var.

# ---- Stage 1: build the Angular frontend ----
FROM node:22-slim AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Production build lands in /fe/dist/frontend/browser (index.html + hashed assets).

# ---- Stage 2: build the NestJS backend ----
FROM node:22-slim AS backend
WORKDIR /be
# openssl is required by Prisma's query engine (generate + runtime).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npx prisma generate
RUN npm run build

# ---- Stage 3: runtime image ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Backend runtime artifacts (node_modules carries the generated Prisma client,
# sharp's native binary, and the pg driver — all built for this same base image).
COPY --from=backend /be/node_modules ./node_modules
COPY --from=backend /be/dist ./dist
COPY --from=backend /be/package.json ./package.json
COPY --from=backend /be/prisma ./prisma

# The compiled SPA — ServeStaticModule serves this at <cwd>/client == /app/client.
COPY --from=frontend /fe/dist/frontend/browser ./client

# Railway injects PORT at runtime; main.ts reads process.env.PORT.
EXPOSE 3000
CMD ["node", "dist/src/main"]
