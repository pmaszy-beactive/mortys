FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
# Force devDependencies (vite, esbuild) even when the deploy environment sets
# NODE_ENV=production — otherwise `npm ci` omits them and the build can't find vite.
#
# PUPPETEER_SKIP_DOWNLOAD=true is the critical one: `puppeteer` is a runtime
# dependency, and its install script downloads + extracts a full Chromium (~150MB).
# On the memory-starved shared build host that child process was being killed,
# which npm reports as the cryptic "Exit handler never called!" — crashing the
# install. The builder never runs puppeteer (it only runs vite + esbuild), and the
# production stage already skips this download, which is why the prod install
# succeeds while the builder install was crashing. Skip it here too.
# NPM_CONFIG_UPDATE_NOTIFIER/FUND/AUDIT=false trim extra work and noise.
ENV NODE_ENV=development \
    PUPPETEER_SKIP_DOWNLOAD=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# DIAGNOSTIC: print what the build host actually has available right now, so the
# build log shows the real memory/disk/cpu picture instead of us guessing.
RUN echo "=== build host resources ===" \
    && (free -m || true) \
    && (df -h / /tmp 2>/dev/null || true) \
    && echo "cpus: $(nproc)" \
    && (node -e "console.log('node:', process.version, 'npm-managed install follows')" || true)

# Install devDependencies (vite, esbuild, etc).
# KEY INSIGHT: npm's "Exit handler never called!" crash exits with status 0 — the
# exit handler that would set a non-zero code never runs. So npm "succeeds" but
# leaves node_modules incomplete. That's why earlier the real failure was the
# `test -x` guard, not npm. Therefore we print npm's exit code AND dump its debug
# log UNCONDITIONALLY (whatever the status), then check the bins last so the layer
# still fails loudly if the install was incomplete.
RUN sh -c 'npm ci --include=dev --foreground-scripts; \
    status=$?; \
    echo "===== npm ci exit status: $status ====="; \
    echo "===== npm debug log (tail) ====="; \
    tail -n 250 /root/.npm/_logs/*-debug-*.log 2>/dev/null || echo "(no npm debug log found)"; \
    echo "===== end npm debug log ====="; \
    echo "=== resources after install ==="; (free -m || true); (df -h / /tmp 2>/dev/null || true); \
    echo "=== build tool bins ==="; ls -la node_modules/.bin/vite node_modules/.bin/esbuild 2>&1 || true; \
    echo "===== verifying build tools are linked ====="; \
    test -x node_modules/.bin/vite && test -x node_modules/.bin/esbuild'

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
RUN npm ci --omit=dev

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
