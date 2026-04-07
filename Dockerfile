FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build frontend with vite (devDeps available here)
RUN node_modules/.bin/vite build

# Build production server from vite-free entry point
RUN node_modules/.bin/esbuild server/index.prod.ts \
    --platform=node \
    --packages=external \
    --bundle \
    --format=esm \
    --outfile=dist/index.js

# Build migration runner (runs at container startup to create/update tables)
RUN node_modules/.bin/esbuild server/migrate.ts \
    --platform=node \
    --packages=external \
    --bundle \
    --format=esm \
    --outfile=dist/migrate.js

# Build one-time legacy seed script (delete after first use)
RUN node_modules/.bin/esbuild server/scripts/seed-legacy-data.ts \
    --platform=node \
    --packages=external \
    --bundle \
    --format=esm \
    --outfile=dist/seed-legacy.js

FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache bash

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# SQL migration files — needed by dist/migrate.js at startup
COPY --from=builder /app/migrations ./dist/migrations

# Include legacy seed data files (needed by dist/seed-legacy.js)
# To run: docker exec <container> node dist/seed-legacy.js
# Delete dist/seed-legacy.js and server/scripts/data/ after first use
COPY --from=builder /app/server/scripts/data ./server/scripts/data

# Entrypoint: apply migrations then start the app
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 5000

ENV NODE_ENV=production

CMD ["/docker-entrypoint.sh"]
