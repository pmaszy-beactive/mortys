---
name: Docker builder must force devDependencies
description: Why the multi-stage Docker builder stage installs devDeps explicitly
---

# Docker builder stage must force devDependencies

The builder stage installs build tooling (vite, esbuild) which are
**devDependencies** in package.json. The frontend/server build steps invoke
`node_modules/.bin/vite` and `node_modules/.bin/esbuild` directly.

**Rule:** the builder stage `npm ci` must include devDependencies
(`ENV NODE_ENV=development` + `npm ci --include=dev`). The production stage
keeps `npm ci --omit=dev`.

**Why:** the ActiveAI Backbone / Jenkins deploy environment exports
`NODE_ENV=production`. With that set, a plain `npm ci` omits devDependencies,
so vite/esbuild never get installed and the build dies with
`node_modules/.bin/vite: not found` (exit 127), then the deploy rolls back.

**How to apply:** never rely on a bare `npm ci` in the builder stage for a
project where the build tools live in devDependencies and the deploy env may
set NODE_ENV=production. Be explicit.
