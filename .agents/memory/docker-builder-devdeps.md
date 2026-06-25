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

2. **npm "Exit handler never called!" leaving bins unlinked, then CACHED.** npm's
   update-notifier ("new major version of npm available") runs in an exit handler;
   when it throws, npm can finish exit 0 but with the install incomplete (the
   `.bin` symlinks never created). Docker then caches that broken layer, so every
   later build reuses it.
   Fix: `ENV NPM_CONFIG_UPDATE_NOTIFIER=false` (also FUND/AUDIT=false) and append
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
