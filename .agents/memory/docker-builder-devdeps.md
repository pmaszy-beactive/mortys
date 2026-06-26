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

2. **One-shot `npm ci --include=dev` OOM-killed → npm "Exit handler never
   called!".** On the memory-constrained shared build host (52 apps) the single
   full-tree install crashes ~74-87s in with the cryptic "Exit handler never
   called!". RULED OUT as causes (all still crashed): npm version (10.8.2 AND
   11.5.2), update-notifier, `--maxsockets=3`, and puppeteer's Chromium download
   (`PUPPETEER_SKIP_DOWNLOAD=true` did NOT stop it). The constant: the SMALLER
   production `npm ci --omit=dev` always succeeds; only the bigger one-shot install
   dies → it's a peak-memory ceiling, not a specific package.
   Fix: split the builder install into two steps so peak memory stays low —
   `RUN npm ci --omit=dev` (the known-good smaller install) THEN
   `RUN npm install --include=dev --prefer-offline --foreground-scripts` (layers
   devDeps onto the existing tree incrementally; far fewer packages processed at
   once). Use `npm install`, NOT a second `npm ci` (which would wipe node_modules
   and redo the whole tree). `--foreground-scripts` surfaces a failing install
   script if a script (not OOM) is ever the culprit. Keep
   `PUPPETEER_SKIP_DOWNLOAD=true` and the `test -x vite/esbuild` verification.
   **Lesson:** "Exit handler never called!" with no other output during an install
   is almost always OOM / a child process being killed. If the smaller install
   works and the bigger one doesn't, reduce PEAK memory (split the install) rather
   than chasing individual packages. Last resort: more memory on the build host.

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
