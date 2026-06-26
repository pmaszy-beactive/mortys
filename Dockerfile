FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
# Force devDependencies (vite, esbuild) even when the deploy environment sets
# NODE_ENV=production — otherwise `npm ci` omits them and the build can't find vite.
# PUPPETEER_SKIP_DOWNLOAD=true so the builder doesn't download Chromium (~150MB)
# it never uses — the runtime stage installs system chromium instead.
# NPM_CONFIG_UPDATE_NOTIFIER/FUND/AUDIT=false trim extra work and noise.
ENV NODE_ENV=development \
    PUPPETEER_SKIP_DOWNLOAD=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# ROOT CAUSE of the build failures: the committed package-lock.json pins every
# tarball to Replit's internal package proxy (http://package-firewall.replit.local/),
# which only resolves INSIDE Replit. On this external build host that hostname is
# unreachable, so `npm ci` can't fetch the tarballs and dies with the misleading
# "Exit handler never called!" (exiting 0, leaving node_modules incomplete).
# Rewrite those URLs to the public npm registry for the build ONLY — the committed
# lockfile is left untouched so Replit development keeps working.
RUN sed -i 's#http://package-firewall.replit.local/npm/#https://registry.npmjs.org/#g' package-lock.json

# Install (incl. devDeps), then verify the build tools actually got linked so an
# incomplete install fails the layer loudly instead of being cached.
RUN npm ci --include=dev --registry=https://registry.npmjs.org/ \
    && test -x node_modules/.bin/vite \
    && test -x node_modules/.bin/esbuild

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
# busybox-suid provides a working crond applet for the nightly scrape cron job.
# coreutils provides GNU `date`, whose relative-date arithmetic
# (`date -d "<date> - N days"`) the scrape-registrations.sh script relies on;
# Alpine's BusyBox `date` does not support it.
RUN apk add --no-cache \
    bash \
    busybox-suid \
    coreutils \
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
# Same registry rewrite as the builder stage: the committed lockfile pins tarballs
# to Replit's internal proxy, which is unreachable from this build host.
RUN sed -i 's#http://package-firewall.replit.local/npm/#https://registry.npmjs.org/#g' package-lock.json
RUN npm ci --omit=dev --registry=https://registry.npmjs.org/

COPY --from=builder /app/dist ./dist

# SQL migration files — needed by dist/migrate.js at startup
COPY --from=builder /app/migrations ./dist/migrations

# --- Legacy site scraper ---
# Bundle the scraper source and install its runtime deps (puppeteer, system chromium).
# At runtime it crawls the legacy site and writes page-level JSON to the import volume.
COPY --from=builder /app/scripts/migrate-site ./scripts/migrate-site
RUN cd scripts/migrate-site && npm install --omit=dev --no-package-lock

# Nightly scrape cron: wrapper script + crontab.
# The wrapper exports the env the scraper needs (cron runs with a minimal env)
# and runs scrape-registrations.sh for the last 7 days. crond reads the crontab
# from /etc/crontabs/root; the entrypoint starts crond in the background.
COPY --from=builder /app/scripts/nightly-scrape.sh ./scripts/nightly-scrape.sh
COPY --from=builder /app/scripts/rotate-log.sh ./scripts/rotate-log.sh
COPY --from=builder /app/scripts/crontab /etc/crontabs/root
RUN chmod +x ./scripts/nightly-scrape.sh ./scripts/rotate-log.sh

# Import data volume — scraper output + dedup state + session cookie persist here.
# IMPORT_DATA_DIR is read by the in-app importer; MIGRATE_OUTPUT_DIR/MIGRATE_COOKIE_FILE
# are read by the scraper. All point at the same mounted volume.
ENV IMPORT_DATA_DIR=/data/migrate \
    MIGRATE_OUTPUT_DIR=/data/migrate \
    MIGRATE_COOKIE_FILE=/data/cookie.txt
VOLUME ["/data"]

# Seed data for first boot — pre-scraped JSON placed in import-seed/ on the build
# machine. docker-entrypoint.sh copies these onto the /data volume the first time
# the container starts (only when the volume has no JSON yet). The folder always
# exists (tracked .gitkeep/README); the actual data is gitignored.
COPY --from=builder /app/import-seed ./import-seed

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
