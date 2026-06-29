# Morty's Driving School Management System

## Overview
This project is a comprehensive web application designed to streamline the operations of a driving school. It aims to manage student enrollment, instructor assignments, class scheduling, financial contracts, student evaluations, and internal communications. The system provides a centralized platform to automate administrative tasks, improve efficiency, and enhance the overall management of a driving school business. The project has significant market potential by offering a modern, integrated solution to traditional driving schools.

## User Preferences
Preferred communication style: Simple, everyday language.
Navigation preference: Dedicated pages over popup dialogs for better usability.
Class terminology: Use "Theory Classes" and "Driving Classes" (not "Practical Classes") throughout the app.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query
- **UI Components**: Radix UI primitives with custom styling
- **Styling**: Tailwind CSS with CSS variables
- **Build Tool**: Vite
- **Form Handling**: React Hook Form with Zod validation
- **Responsive Design**: Mobile-friendly with touch optimization.
- **UI/UX Decisions**: Responsive sidebar navigation, reusable form components, sortable/filterable data tables, modal dialogs, toast notifications, and dashboard cards for metrics. Brand colors #ECC462 (golden-yellow) and #111111 (deep black) are used throughout, maintaining semantic colors for status indicators.

### Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL with Drizzle ORM
- **Session Management**: Express sessions with PostgreSQL store (1-hour expiration with automatic cleanup)
- **API Design**: RESTful API with JSON responses
- **Data Storage**: Full CRUD operations with DatabaseStorage implementation.
- **Security**: Automatic session expiration after 1 hour of inactivity; frontend interceptor redirects expired sessions to login with user-friendly message. Passwords hashed with bcrypt. Password hashes are never returned in API responses (`/api/auth/user`, `/api/admin/users`).
- **Admin Authentication**: Email-based login (no hardcoded credentials). Passwords stored as bcrypt hashes in `users.password` column. Accounts: paul@beactive.ai, daniel@beactive.ai, morty@mortysdriving.com, demo@mortysdriving.com, admin@mortys.com, pasindu@empowerdigitaldata.com.

### Database Design
- **ORM**: Drizzle ORM for PostgreSQL.
- **Migration**: Drizzle Kit for schema migrations.
- **Schema**: Centralized in `shared/schema.ts` for type safety.
- **Key Data Models**: Users, Students, Instructors, Classes, Contracts, Evaluations, Communications, Lesson Records, Payment Transactions, Student Documents, School Permits, Parents, StudentParents. Includes schema for student self-onboarding (email verification, registration tracking), unified notifications (templates, records, deliveries, preferences), payment reconciliation (payer profiles, intakes, allocations, audit logs), booking policy overrides (logs), and legacy import tracking (`imported_pages`: per-page `url_hash` unique key + content hash + page type + created/updated/skipped counts for idempotent incremental re-import).

### Core Features
- **Student Management**: Full lifecycle management with self-service profile editing, parent/guardian linking, and a self-onboarding wizard.
- **Parent/Guardian System**: Permission-based access (View Only, View + Book, View + Book + Payments) with invitation workflow.
- **Instructor Management**: Credential tracking, specialization, scheduling.
- **Class Scheduling**: Calendar-based, room/instructor assignment, with "Theory Classes" and "Driving Classes" and differentiation for 'regular' vs. 'one_off' lessons. Includes conflict detection for instructor/room double-bookings and drag-and-drop rescheduling.
- **Location Management**: Full CRUD with Canadian address validation (postal code, phone, email), linked students/classes view, and role-based permissions (admin/manager for edit, admin only for delete).
- **Contract Management**: Financial tracking, payment processing.
- **Evaluation System**: Performance and progress tracking.
- **Communication Hub**: Internal messaging and a unified notification system with email (SendGrid) and in-app notifications, respecting user preferences.
- **Data Migration System**: Automated web scraping for legacy data import.
- **Legacy JSON Importer**: Admin "Data Migration → Import to Database" tab walks page-level JSON produced by the bundled scraper (`scripts/migrate-site/spider.js`) and idempotently upserts students, contracts, payments, evaluations, lessons, notes, course-transfer/phase progress, online tests, Zoom attendance, reservations (booking rows → lesson records), registration report pages (student stubs from listing links), and attestation pages (attestation-number enrichment). Every scraped page type has an explicit parser. Engine: `server/services/json-importer.ts`; endpoints `GET /api/import/manifest`, `POST /api/import/start`, `GET /api/import/status`. Idempotency via the `imported_pages` tracking table (per-page `url_hash` + content hash to skip unchanged files), deterministic legacy keys on child records, and DB-preloaded note signatures so notes never re-insert across runs. `GET /api/import/manifest`'s `alreadyImported` is bounded to the URL hashes of the files currently present. Source folder is `IMPORT_DATA_DIR`. Logging: the importer emits ISO-timestamped, severity-tagged lines (`<ISO> [LEVEL] [import] …`) mirroring the scraper's logger; verbosity is controlled by env var `IMPORT_LOG_LEVEL` (error|warn|info|debug|trace, default info, same naming convention as `SCRAPE_LOG_LEVEL`). Per-page/per-record detail (processing/skip-unchanged) is at debug/trace; errors always include the file path + `url_hash`. Lines are mirrored to the in-app import status log.
- **School Permits Management**: Government permit number tracking and assignment.
- **Zoom Integration**: Automated meeting creation and attendance tracking for theory classes.
- **Reporting Dashboard**: Analytics and business insights, including a comprehensive transaction audit system.
- **Payment Reconciliation**: Handles external/manual payments, supports partial allocations across multiple students, and includes payer profile management.
- **Booking Policy Override Audit System**: Tracks all policy override actions, requires reasons, and sends notifications for compliance.
- **Student Notes System**: Two-tier notes — internal notes (office/instructor only) and student-visible notes. Notes tracked with author, role, and timestamps. Accessible from admin student profile, instructor detail view, and student dashboard.
- **Phase-Based Booking Rules Engine**: Hard-coded 4-phase progression rules enforced at all booking points (student portal, admin enrollment, available-classes filter). Rules in `shared/bookingRules.ts`: Phase 1 (T1 must be first, T5 requires 28 days and all prior theory); Phase 2 (T6→T7 in order, In-Car 1-4 sequential 60-min-only, In-Car 4 requires 28 days from T6); Phase 3 (T8 first, flexible after, min 56 days to Phase 4 entry); Phase 4 (T11 first, T12 and In-Car 11-14 before In-Car 15, In-Car 12/13 must be shared 2-student sessions, In-Car 15 is 60-min-only, min 56 days). Admin with override permission can bypass with mandatory reason.
- **Admin Dashboard Widgets**: Student Quick Search (inline dropdown), Instructor Availability Alert (shows instructors without availability set), Registration Summary (this week/month by course type with bar charts), Theory Class Attendance Sheet (date-picker + expandable class/student rows).
- **Admin User Management**: Full CRUD for admin accounts in Settings → Admin Users tab. Add/edit/delete users with email, role (owner/admin/manager/staff), password, and booking-policy-override permission. Passwords hashed server-side; never exposed to client.

## Deployment

### Docker / ActiveAI Backbone
- **`Dockerfile`**: Multi-stage build. Builder stage installs all deps (including devDeps), runs `vite build` for the frontend, then compiles `server/index.prod.ts` → `dist/index.js`, `server/migrate.ts` → `dist/migrate.js`, and `server/scripts/seed-legacy-data.ts` → `dist/seed-legacy.js` with esbuild. Production stage runs `npm ci --omit=dev`, copies `dist/`, `dist/migrations/` (SQL files), and `server/scripts/data/`. Also bundles the legacy scraper (`scripts/migrate-site/`) with its own `npm install` plus headless Chromium (`chromium`, `nss`, `freetype`, `harfbuzz`, `ttf-freefont`); sets `PUPPETEER_SKIP_DOWNLOAD=true` and `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`. Import/scraper data persists on a `/data` Docker volume: `IMPORT_DATA_DIR=/data/migrate`, `MIGRATE_OUTPUT_DIR=/data/migrate`, `MIGRATE_COOKIE_FILE=/data/cookie.txt`.
- **`docker-entrypoint.sh`**: Container startup script — ensures `IMPORT_DATA_DIR` exists, runs first-boot seeding (see below), then runs `node dist/migrate.js` (applies all pending SQL migrations), then `exec node dist/index.js`. This ensures tables exist before the app tries to query them.
- **First-boot import seeding (`import-seed/`)**: A dedicated, tracked folder (`.gitkeep` + `README.md` only; data is gitignored) for shipping pre-scraped legacy JSON into a deployment. The Dockerfile copies it into the image (`/app/import-seed`); `docker-entrypoint.sh` copies its contents onto the `/data` volume (`IMPORT_DATA_DIR`) **only when the volume has no JSON yet**. After first boot the volume is the source of truth (a re-scrape is never overwritten). Operators drop the scraper's `migrate/` output (incl. `_manifest.json`) into `import-seed/` on the build machine before building; data stays out of Git (real student PII). Seeding only places files — the admin still clicks **Data Migration → Import to Database → Run Import** to load them.
- **`server/migrate.ts`**: Compiled migration runner using `drizzle-orm/node-postgres/migrator`. Reads SQL files from `dist/migrations/` and applies any that haven't run yet (idempotent — safe to run on every boot).
- **`server/index.prod.ts`**: Production-only server entry — mirrors `server/index.ts` but has NO `vite` imports. Uses inline static file serving (`express.static`). This prevents the `ERR_MODULE_NOT_FOUND: vite` crash that occurs when vite (a devDependency) is missing in the production container.
- **`docker-compose.yml`**: Build-only config (single `app` service). Runtime config is managed by the Backbone deploy script.
- **`.deploy.env`**: Deploy settings — `APP_NAME=mortys`, `APP_INTERNAL_PORT=5000`, `HAPROXY_FRONTEND_PORT=8300`, `HEALTH_ENDPOINT=/health`, no worker.
- **Health endpoint**: `GET /health` returns `{ status: "ok", timestamp }`. Defined in both `server/index.ts` (dev) and `server/index.prod.ts` (prod).
- **Nightly scrape failure alerts**: `scripts/nightly-scrape.sh` captures the scraper's combined output. When the run exits non-zero, or the spider reports a login redirect / expired cookie (matched in the output), the wrapper POSTs to the running app's internal endpoint `POST /api/internal/scrape-alert` (defaults to `http://localhost:${APP_INTERNAL_PORT:-5000}`, override with `SCRAPE_ALERT_URL`). The endpoint requires header `X-Internal-Token` matching env var `INTERNAL_ALERT_TOKEN`; without that env var set it returns 503 (alerts disabled). The handler calls `notifyScrapeFailure` in `server/services/notifications.ts`, which sends email (SendGrid) + in-app notifications (type `scrape_failure`) to office staff (owner/admin/manager). Optional `SCRAPE_ALERT_EMAIL` env var is always added as a fallback recipient so alerts aren't lost if no office users exist. Successful runs send nothing. The alert includes the run date, reason, and the last 40 log lines. **Persistent-failure reminders & recovery:** the wrapper keeps a tiny failure-streak counter on the `/data` volume (`SCRAPE_STATE_FILE`, default `/data/scrape-failure-count`). Because cron runs nightly, each failing night re-alerts (one reminder per day) and passes `consecutiveFailures` so the message/title escalate ("failing N nights in a row"). The first success after a streak POSTs `recovered: true`, which calls `notifyScrapeRecovered` (notification type `scrape_recovered`) to send a one-time "all clear" noting how many nights it had been failing, then resets the counter to 0. Healthy runs that follow healthy runs stay completely silent.
- **Alert env vars**: `INTERNAL_ALERT_TOKEN` (shared secret guarding `/api/internal/scrape-alert`; required for alerts to fire — set in both the app container and cron environment), optional `SCRAPE_ALERT_URL` (override the alert endpoint URL), optional `SCRAPE_ALERT_EMAIL` (fallback alert recipient).
- **Deploy command** (on server): `cd /path/to/repo && bash /etc/backbone/scripts/deploy.sh`

### Stripe Payment Environment Variables
- **`STRIPE_SECRET_KEY`**: Stripe secret key (already configured as Replit secret).
- **`VITE_STRIPE_PUBLIC_KEY`**: Stripe publishable key (already configured as Replit secret).
- **`STRIPE_WEBHOOK_SECRET`**: Signing secret for verifying Stripe webhook events. Get this from the Stripe Dashboard → Developers → Webhooks after creating the endpoint, or from `stripe listen` output during local testing. Required for `POST /api/stripe/webhook` to work. Without it the webhook endpoint returns 400 and all events are silently ignored.
- **`APP_URL`**: Full base URL of the deployed app (e.g. `https://mortys.activeaidemo.com`). Used as the `return_url` for 3D-Secure card redirects in billing checkout. Falls back to `REPLIT_DEV_DOMAIN` in development, then `http://localhost:5000`.
- **Local webhook testing**: `stripe listen --forward-to localhost:5000/api/stripe/webhook` (Stripe CLI required). Copy the printed signing secret into `STRIPE_WEBHOOK_SECRET`.

### S3 File Storage
- **Service**: `server/services/s3.ts` — wraps `@aws-sdk/client-s3` pointing at the ActiveAI Backbone S3 proxy.
- **Config env vars**: `S3_ENDPOINT` (e.g. `https://backbone.activeaidemo.com/s3`) and `S3_API_KEY` (Bearer token).
- **Graceful fallback**: If env vars are not set, file uploads fall back to storing base64 in the database (backward compatible for local dev).
- **Key format**: Documents → `documents/{studentId}/{documentId}/{filename}`; Profile images → `profiles/{userId}/photo`.
- **Affected routes**: All document upload endpoints (`POST /api/students/:id/documents`, `POST /api/student/documents`, `POST /api/student/upload-document/:regId`) upload to S3 and store the S3 key in `documentData`. Delete endpoints also remove the file from S3.
- **Download endpoint**: `GET /api/student-documents/:id/file` (admin) and `GET /api/student/documents/:id/file` (student) — fetches from S3 or decodes base64 for legacy records.
- **Document viewer**: Document verification page uses the download endpoint URL instead of base64 data.

## External Dependencies

### Production Dependencies
- **Database**: Neon (serverless PostgreSQL)
- **Email Service**: SendGrid (for email notifications and verification)
- **Frontend State/Caching**: TanStack Query (React Query)
- **UI Primitives**: Radix UI
- **Styling**: Tailwind CSS
- **Form Management**: React Hook Form
- **Schema Validation**: Zod
- **Icons**: Lucide React
- **Component Utilities**: Class Variance Authority
- **Date Handling**: Date-fns
- **Carousel**: Embla Carousel

### Development Tools
- **Build Tool**: Vite
- **Language**: TypeScript
- **Code Quality**: ESLint, Prettier
- **Database Migrations**: Drizzle Kit