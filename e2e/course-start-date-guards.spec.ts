import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * API tests for the course start date duplicate/merge guards.
 *
 * Covers:
 *  - POST /api/admin/course-start-dates duplicate guard (409 start_date_duplicate)
 *  - POST confirmDuplicate: true bypass
 *  - PATCH /api/admin/course-start-dates/:id date/course change merge guard (409 start_date_merge)
 *  - PATCH reactivation guard (cancelled -> active on an occupied day returns 409)
 *  - PATCH confirmMerge: true bypass
 *
 * Runs against the live dev server with an authenticated admin session.
 * The session cookie is Secure even in dev, so requests must go through the
 * HTTPS Replit domain rather than http://localhost:5000.
 *
 * Test data uses far-future dates (year 2035) so no Theory 1 class matches and
 * the auto-enroll reconciliation is a guaranteed no-op (no student/office
 * notifications fire). Everything created here is deleted afterwards.
 */

const TEST_ADMIN_EMAIL = 'e2e-start-date-guard-admin@test.local';
const TEST_ADMIN_PASSWORD = 'e2e-guard-test-pw-1';
const COURSE_TYPE = 'auto';
const DATE_A = '2035-03-05';
const DATE_B = '2035-03-12';

const baseURL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : 'http://localhost:5000';

let api: APIRequestContext;
let db: Client;
const createdIds: number[] = [];

async function createStartDate(body: Record<string, unknown>) {
  return api.post('/api/admin/course-start-dates', { data: body });
}

test.describe.serial('Course start date duplicate/merge guards', () => {
  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    // Throwaway admin account for an authenticated session.
    const hash = bcrypt.hashSync(TEST_ADMIN_PASSWORD, 10);
    await db.query(
      `INSERT INTO users (email, role, password, first_name, last_name)
       VALUES ($1, 'admin', $2, 'E2E', 'GuardTest')
       ON CONFLICT (email) DO UPDATE SET password = $2, role = 'admin'`,
      [TEST_ADMIN_EMAIL, hash],
    );

    // Remove any leftovers from previous runs so guards start from a clean slate.
    await db.query(
      `DELETE FROM course_start_dates WHERE start_date IN ($1, $2) AND course_type = $3`,
      [DATE_A, DATE_B, COURSE_TYPE],
    );

    api = await playwrightRequest.newContext({ baseURL });
    const login = await api.post('/api/auth/login', {
      data: { username: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
    });
    expect(login.ok(), `admin login failed: ${login.status()} ${await login.text()}`).toBe(true);
  });

  test.afterAll(async () => {
    if (db) {
      await db.query(
        `DELETE FROM course_start_dates WHERE start_date IN ($1, $2) AND course_type = $3`,
        [DATE_A, DATE_B, COURSE_TYPE],
      );
      await db.query(`DELETE FROM users WHERE email = $1`, [TEST_ADMIN_EMAIL]);
      await db.end();
    }
    if (api) await api.dispose();
  });

  let firstId: number;
  let secondId: number;

  test('POST creates the first active start date on an empty day', async () => {
    const res = await createStartDate({
      courseType: COURSE_TYPE,
      module: 1,
      startDate: DATE_A,
      startTime: '18:00',
      status: 'active',
      notes: 'e2e guard test A',
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    firstId = body.id;
    createdIds.push(firstId);
    expect(body.startDate).toBe(DATE_A);
  });

  test('POST duplicate on the same day returns 409 start_date_duplicate', async () => {
    const res = await createStartDate({
      courseType: COURSE_TYPE,
      module: 1,
      startDate: DATE_A,
      startTime: '18:00',
      status: 'active',
      notes: 'e2e guard test duplicate attempt',
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.conflict).toBe('start_date_duplicate');
    expect(Array.isArray(body.conflictingStartDates)).toBe(true);
    expect(body.conflictingStartDates.map((d: any) => d.id)).toContain(firstId);
  });

  test('POST with confirmDuplicate: true bypasses the duplicate guard', async () => {
    const res = await createStartDate({
      courseType: COURSE_TYPE,
      module: 1,
      startDate: DATE_A,
      startTime: '18:00',
      status: 'active',
      notes: 'e2e guard test confirmed duplicate',
      confirmDuplicate: true,
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    createdIds.push(body.id);

    // Clean up the extra cohort right away so later merge tests see exactly
    // one active start date on DATE_A.
    const del = await api.delete(`/api/admin/course-start-dates/${body.id}`);
    expect(del.ok()).toBe(true);
  });

  test('PATCH moving a start date onto an occupied day returns 409 start_date_merge', async () => {
    const created = await createStartDate({
      courseType: COURSE_TYPE,
      module: 1,
      startDate: DATE_B,
      startTime: '18:00',
      status: 'active',
      notes: 'e2e guard test B',
    });
    expect(created.status(), await created.text()).toBe(201);
    secondId = (await created.json()).id;
    createdIds.push(secondId);

    const res = await api.patch(`/api/admin/course-start-dates/${secondId}`, {
      data: { startDate: DATE_A },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.conflict).toBe('start_date_merge');
    expect(body.conflictingStartDates.map((d: any) => d.id)).toContain(firstId);

    // The guard must not have modified the row.
    const list = await api.get(`/api/admin/course-start-dates?courseType=${COURSE_TYPE}`);
    const rows = await list.json();
    const row = rows.find((d: any) => d.id === secondId);
    expect(row.startDate).toBe(DATE_B);
  });

  test('PATCH reactivating a cancelled start date onto an occupied day returns 409', async () => {
    // Cancel the DATE_B row, then move+reactivate it onto DATE_A.
    const cancel = await api.patch(`/api/admin/course-start-dates/${secondId}`, {
      data: { status: 'cancelled' },
    });
    expect(cancel.ok(), await cancel.text()).toBe(true);

    const moveWhileCancelled = await api.patch(`/api/admin/course-start-dates/${secondId}`, {
      data: { startDate: DATE_A },
    });
    expect(moveWhileCancelled.ok(), await moveWhileCancelled.text()).toBe(true);

    const reactivate = await api.patch(`/api/admin/course-start-dates/${secondId}`, {
      data: { status: 'active' },
    });
    expect(reactivate.status()).toBe(409);
    const body = await reactivate.json();
    expect(body.conflict).toBe('start_date_merge');
    expect(body.conflictingStartDates.map((d: any) => d.id)).toContain(firstId);

    // Still cancelled after the blocked reactivation.
    const list = await api.get(`/api/admin/course-start-dates?courseType=${COURSE_TYPE}&status=cancelled`);
    const rows = await list.json();
    expect(rows.some((d: any) => d.id === secondId)).toBe(true);
  });

  test('PATCH with confirmMerge: true bypasses the merge guard', async () => {
    const res = await api.patch(`/api/admin/course-start-dates/${secondId}`, {
      data: { status: 'active', confirmMerge: true },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('active');
    expect(body.startDate).toBe(DATE_A);

    // Both cohorts now share the same day, as explicitly confirmed.
    const list = await api.get(`/api/admin/course-start-dates?courseType=${COURSE_TYPE}&status=active`);
    const rows = await list.json();
    const sameDay = rows.filter((d: any) => d.startDate === DATE_A);
    expect(sameDay.length).toBe(2);
  });
});
