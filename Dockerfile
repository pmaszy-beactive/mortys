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

# bash for the entrypoint; chromium + fonts/libs so the bundled site scraper
# (scripts/migrate-site/spider.js → Puppeteer) can run headless inside the container.
RUN apk add --no-cache \
    bash \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Puppeteer must use the system chromium (do not download its own at install time).
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# SQL migration files — needed by dist/migrate.js at startup
COPY --from=builder /app/migrations ./dist/migrations

# --- Legacy site scraper ---
# Bundle the scraper source and install its runtime deps (puppeteer, system chromium).
# At runtime it crawls the legacy site and writes page-level JSON to the import volume.
COPY --from=builder /app/scripts/migrate-site ./scripts/migrate-site
RUN cd scripts/migrate-site && npm install --omit=dev --no-package-lock

# Import data volume — scraper output + dedup state + session cookie persist here.
# IMPORT_DATA_DIR is read by the in-app importer; MIGRATE_OUTPUT_DIR/MIGRATE_COOKIE_FILE
# are read by the scraper. All point at the same mounted volume.
ENV IMPORT_DATA_DIR=/data/migrate \
    MIGRATE_OUTPUT_DIR=/data/migrate \
    MIGRATE_COOKIE_FILE=/data/cookie.txt
VOLUME ["/data"]

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
