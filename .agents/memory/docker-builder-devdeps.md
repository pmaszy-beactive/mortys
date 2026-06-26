---
name: Docker builder stage — devDeps + reliable npm install
description: Why the builder stage forces devDeps, disables npm update-notifier, and verifies the vite/esbuild bins
---

# Docker builder stage: getting vite/esbuild to actually install

The builder stage needs vite & esbuild (both **devDependencies**) and invokes
`node_modules/.bin/vite` / `node_modules/.bin/esbuild` directly.

Two distinct failure modes both produced `node_modules/.bin/vite: not found`
(exit 127) and rolled back the ActiveAI Backbone / Jenkins deploy:

1. **devDeps skipped.** The deploy environment exports `NODE_ENV=production`, so a
   plain `npm ci` omits devDependencies. Fix: `ENV NODE_ENV=development` +
   `npm ci --include=dev` in the builder stage. Production stage keeps `--omit=dev`.

2. **CONFIRMED ROOT CAUSE — lockfile pins tarballs to Replit's internal package
   proxy, unreachable off-Replit → npm "Exit handler never called!".** The
   committed `package-lock.json` has every `resolved` URL pointing at
   `http://package-firewall.replit.local/npm/...` (Replit's internal proxy). That
   hostname only resolves INSIDE Replit; on an external build host (Jenkins/Docker)
   it's unreachable, so `npm ci` can't fetch tarballs and dies with the misleading
   "Exit handler never called!" — and it EXITS 0 (the exit handler that sets the
   error code never runs), leaving node_modules incomplete. Wrong theories that all
   failed: npm version (10.8.2 & 11.5.2), update-notifier, `--maxsockets`, puppeteer
   Chromium download, OOM/peak-memory. It was never resources.
   How it was finally found: dump npm's debug log UNCONDITIONALLY (not only on
   non-zero exit, since npm exits 0 here) — `tail /root/.npm/_logs/*-debug-*.log`
   showed the `package-firewall.replit.local` URLs.
   Fix (Dockerfile, build-time only, in BOTH builder AND production stages, before
   each `npm ci`): rewrite the URLs to the public registry —
   `RUN sed -i 's#http://package-firewall.replit.local/npm/#https://registry.npmjs.org/#g' package-lock.json`
   then `npm ci ... --registry=https://registry.npmjs.org/`. Leave the COMMITTED
   lockfile untouched (Replit dev needs the proxy URLs). The bundled scraper
   (`scripts/migrate-site`) is unaffected: it installs with `--no-package-lock`.
   **Lessons:** (a) "Exit handler never called!" with no detail is npm hiding the
   real error — get the debug log (and note npm may EXIT 0 on this crash, so dump
   the log unconditionally). (b) A Replit-generated `package-lock.json` carries
   `package-firewall.replit.local` URLs that break any build OUTSIDE Replit; rewrite
   them to `registry.npmjs.org` at build time.

**Why it matters:** a layer marked DONE (exit 0) is NOT proof the install
succeeded — npm can exit 0 with an incomplete node_modules. Verify critical bins
in the same RUN.

**How to apply:** on any builder stage where the deploy env may set
NODE_ENV=production and where build tools live in devDependencies: force devDeps,
silence npm's exit-handler notifier, and assert the bins exist before relying on
them.

Note: on the Jenkins host the repo is a fresh git checkout (no committed
node_modules), so `COPY . .` overwriting a host node_modules is NOT the cause
there — but a `.dockerignore` excluding node_modules/.git is still kept for
context size/speed and for correctness when building from a dirty workspace.
