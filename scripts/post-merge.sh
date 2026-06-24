#!/bin/bash
set -e
npm install
# Apply committed SQL migrations non-interactively. We intentionally do NOT use
# `drizzle-kit push` here: push prompts on ambiguous drift (stdin is closed
# during a merge, so it would fail) and can silently apply schema drift.
npx tsx scripts/db-migrate.ts
