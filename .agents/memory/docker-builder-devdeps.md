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

2. **npm 10.8.2 "Exit handler never called!" crash during the bigger install.**
   node:20-alpine ships npm 10.8.2, which has an internal bug that crashes
   (~84s in) during `npm ci --include=dev` — the larger devDep tree. The
   production-stage `npm ci --omit=dev` (smaller tree) succeeds, so it's specific
   to the bigger install and aggravated by memory pressure on the shared build
   host. Disabling the update-notifier did NOT fix it (so the notifier was a red
   herring), and a broken/incomplete install was being cached by Docker.
   Fix: upgrade npm before installing (`npm install -g npm@11.5.2`), add
   `--maxsockets=3` to lower peak memory/concurrency, keep update-notifier/fund/
   audit disabled, and append
   `&& test -x node_modules/.bin/vite && test -x node_modules/.bin/esbuild` to the
   install RUN so a broken install fails the layer loudly instead of being cached.

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
