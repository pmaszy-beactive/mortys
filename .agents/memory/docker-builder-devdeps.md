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

2. **puppeteer Chromium download OOM-killed → npm "Exit handler never called!".**
   `puppeteer` is a RUNTIME dependency; its install script downloads + extracts a
   full Chromium (~150MB). On the memory-constrained shared build host that child
   was being killed, which npm surfaces as the cryptic "Exit handler never
   called!" (crashed ~74-84s into the install, across npm 10.8.2 AND 11.5.2, so it
   is NOT an npm-version bug). The production stage sets
   `PUPPETEER_SKIP_DOWNLOAD=true` before its `npm ci`, which is the ONLY reason the
   prod install succeeds while the builder install crashed — it was never about
   `--include=dev` vs `--omit=dev`.
   Fix: set `ENV PUPPETEER_SKIP_DOWNLOAD=true` in the builder stage too (it only
   runs vite + esbuild, never Chromium). Upgrading npm / `--maxsockets` did NOT
   help and were reverted. Keep the
   `&& test -x node_modules/.bin/vite && test -x node_modules/.bin/esbuild`
   verification so a broken/incomplete install fails the layer instead of caching.
   **Lesson:** "Exit handler never called!" with no other output during an install
   is almost always a child process (postinstall / native build / large download)
   being OOM-killed — look for heavy install scripts, not an npm bug.

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
