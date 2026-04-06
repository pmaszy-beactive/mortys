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
- **Key Data Models**: Users, Students, Instructors, Classes, Contracts, Evaluations, Communications, Lesson Records, Payment Transactions, Student Documents, School Permits, Parents, StudentParents. Includes schema for student self-onboarding (email verification, registration tracking), unified notifications (templates, records, deliveries, preferences), payment reconciliation (payer profiles, intakes, allocations, audit logs), and booking policy overrides (logs).

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
- **`Dockerfile`**: Multi-stage build. Builder stage installs all deps (including devDeps), runs `vite build` for the frontend, then compiles `server/index.prod.ts` with esbuild into `dist/index.js`. Production stage runs `npm ci --omit=dev` and copies only the compiled `dist/` folder.
- **`server/index.prod.ts`**: Production-only server entry — mirrors `server/index.ts` but has NO `vite` imports. Uses inline static file serving (`express.static`). This prevents the `ERR_MODULE_NOT_FOUND: vite` crash that occurs when vite (a devDependency) is missing in the production container.
- **`docker-compose.yml`**: Build-only config (single `app` service). Runtime config is managed by the Backbone deploy script.
- **`.deploy.env`**: Deploy settings — `APP_NAME=mortys`, `APP_INTERNAL_PORT=5000`, `HAPROXY_FRONTEND_PORT=8300`, `HEALTH_ENDPOINT=/health`, no worker.
- **Health endpoint**: `GET /health` returns `{ status: "ok", timestamp }`. Defined in both `server/index.ts` (dev) and `server/index.prod.ts` (prod).
- **Deploy command** (on server): `cd /path/to/repo && bash /etc/backbone/scripts/deploy.sh`

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