import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * API tests for recurring class series management.
 *
 * Covers:
 *  - POST /api/admin/classes/bulk assigns a shared seriesId to every generated class
 *  - PUT /api/classes/:id changing a schedule field on a series class sets detached_from_series
 *  - PATCH /api/class-series/:seriesId scope 'all' updates future classes but skips
 *    past classes and detached classes
 *  - PATCH scope 'future' with fromDate only touches classes on/after that date
 *  - DELETE /api/class-series/:seriesId never deletes past classes
 *
 * Runs against the live dev server with an authenticated admin session.
 * The session cookie is Secure even in dev, so requests must go through the
 * HTTPS Replit domain rather than http://localhost:5000.
 *
 * The series is generated with no instructor, no room, and no enrollments, so
 * conflict pre-validation is a no-op and no student notifications fire.
 * Everything created here is deleted afterwards (by series_id).
 */

const TEST_ADMIN_EMAIL = 'e2e-class-series-admin@test.local';
const TEST_ADMIN_PASSWORD = 'e2e-series-test-pw-1';

const baseURL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : 'http://localhost:5000';

const localDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (base: Date, days: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};

let api: APIRequestContext;
let db: Client;
let seriesId: string;
let seriesDates: string[] = [];
let pastDates: string[] = [];
let futureDates: string[] = [];
let detachedDate: string; // earliest future class, individually edited
let detachedId: number;
const today = localDateStr(new Date());

async function fetchSeriesRows() {
  const { rows } = await db.query(
    `SELECT id, date, time, duration, max_students, status, detached_from_series
     FROM classes WHERE series_id = $1 ORDER BY date`,
    [seriesId],
  );
  return rows as Array<{
    id: number;
    date: string;
    time: string;
    duration: number;
    max_students: number;
    status: string;
    detached_from_series: boolean;
  }>;
}

test.describe.serial('Recurring class series management', () => {
  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    const hash = bcrypt.hashSync(TEST_ADMIN_PASSWORD, 10);
    await db.query(
      `INSERT INTO users (email, role, password, first_name, last_name)
       VALUES ($1, 'admin', $2, 'E2E', 'SeriesTest')
       ON CONFLICT (email) DO UPDATE SET password = $2, role = 'admin'`,
      [TEST_ADMIN_EMAIL, hash],
    );

    api = await playwrightRequest.newContext({ baseURL });
    const login = await api.post('/api/auth/login', {
      data: { username: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
    });
    expect(login.ok(), `admin login failed: ${login.status()} ${await login.text()}`).toBe(true);
  });

  test.afterAll(async () => {
    if (db) {
      if (seriesId) {
        await db.query(
          `DELETE FROM class_enrollments WHERE class_id IN (SELECT id FROM classes WHERE series_id = $1)`,
          [seriesId],
        );
        await db.query(`DELETE FROM classes WHERE series_id = $1`, [seriesId]);
      }
      await db.query(`DELETE FROM users WHERE email = $1`, [TEST_ADMIN_EMAIL]);
      await db.end();
    }
    if (api) await api.dispose();
  });

  test('bulk generation assigns a shared seriesId to all created classes', async () => {
    // Weekly classes on the weekday 3 days from now, spanning ~5 weeks back
    // and ~2.5 weeks forward. The anchor weekday is offset from today so no
    // generated class ever lands exactly on today's date (which would sit on
    // the past/future cutoff boundary).
    const now = new Date();
    const anchorDow = addDays(now, 3).getDay();
    const res = await api.post('/api/admin/classes/bulk', {
      data: {
        courseType: 'auto',
        classType: 'theory',
        classNumber: 99,
        daysOfWeek: [anchorDow],
        time: '06:00',
        duration: 45,
        maxStudents: 12,
        lessonType: 'regular',
        startDate: localDateStr(addDays(now, -32)),
        endDate: localDateStr(addDays(now, 17)),
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(typeof body.seriesId).toBe('string');
    expect(body.seriesId.length).toBeGreaterThan(0);
    seriesId = body.seriesId;
    seriesDates = body.dates;
    expect(body.created).toBe(seriesDates.length);

    pastDates = seriesDates.filter((d: string) => d < today);
    futureDates = seriesDates.filter((d: string) => d >= today);
    expect(pastDates.length).toBeGreaterThanOrEqual(2);
    expect(futureDates.length).toBeGreaterThanOrEqual(2);
    expect(seriesDates).not.toContain(today);

    const rows = await fetchSeriesRows();
    expect(rows.length).toBe(seriesDates.length);
    for (const row of rows) {
      expect(row.detached_from_series).toBe(false);
      expect(row.time).toBe('06:00');
      expect(row.max_students).toBe(12);
    }

    // GET endpoint sees the whole series
    const get = await api.get(`/api/class-series/${seriesId}`);
    expect(get.ok()).toBe(true);
    const series = await get.json();
    expect(series.classes.length).toBe(seriesDates.length);
  });

  test('PUT /api/classes/:id changing a schedule field sets detached_from_series', async () => {
    const rows = await fetchSeriesRows();
    detachedDate = futureDates[0];
    const target = rows.find((r) => r.date === detachedDate)!;
    detachedId = target.id;

    const res = await api.put(`/api/classes/${detachedId}`, {
      data: { time: '06:15' },
    });
    expect(res.ok(), await res.text()).toBe(true);

    const after = await fetchSeriesRows();
    const edited = after.find((r) => r.id === detachedId)!;
    expect(edited.time).toBe('06:15');
    expect(edited.detached_from_series).toBe(true);
    // No other class was detached
    for (const r of after) {
      if (r.id !== detachedId) expect(r.detached_from_series).toBe(false);
    }
  });

  test('PATCH scope "all" updates future classes, skips past and detached', async () => {
    const res = await api.patch(`/api/class-series/${seriesId}`, {
      data: { scope: 'all', updates: { maxStudents: 7 } },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(futureDates.length - 1);
    expect(body.skippedPast).toBe(pastDates.length);
    expect(body.skippedDetached).toBe(1);

    const rows = await fetchSeriesRows();
    for (const r of rows) {
      if (r.date < today) {
        expect(r.max_students, `past class ${r.date} must be untouched`).toBe(12);
      } else if (r.id === detachedId) {
        expect(r.max_students, 'detached class must be untouched').toBe(12);
      } else {
        expect(r.max_students, `future class ${r.date} should be updated`).toBe(7);
      }
    }
  });

  test('PATCH scope "future" with fromDate only updates classes on/after that date', async () => {
    const lastDate = futureDates[futureDates.length - 1];
    expect(lastDate).not.toBe(detachedDate);

    const res = await api.patch(`/api/class-series/${seriesId}`, {
      data: { scope: 'future', fromDate: lastDate, updates: { duration: 90 } },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(1);

    const rows = await fetchSeriesRows();
    for (const r of rows) {
      if (r.date === lastDate) {
        expect(r.duration).toBe(90);
      } else {
        expect(r.duration, `class ${r.date} outside fromDate must keep duration`).toBe(45);
      }
    }
  });

  test('PATCH with a fromDate in the past still never touches past classes', async () => {
    const res = await api.patch(`/api/class-series/${seriesId}`, {
      data: { scope: 'future', fromDate: pastDates[0], updates: { maxStudents: 9 } },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.skippedPast).toBe(pastDates.length);
    expect(body.updated).toBe(futureDates.length - 1);

    const rows = await fetchSeriesRows();
    for (const r of rows.filter((r) => r.date < today)) {
      expect(r.max_students, `past class ${r.date} must remain untouched`).toBe(12);
    }
  });

  test('DELETE scope "all" removes future classes but never past classes', async () => {
    const res = await api.delete(`/api/class-series/${seriesId}?scope=all`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(futureDates.length); // detached classes are still deleted
    expect(body.skippedPast).toBe(pastDates.length);

    const rows = await fetchSeriesRows();
    expect(rows.length).toBe(pastDates.length);
    for (const r of rows) {
      expect(r.date < today, `remaining class ${r.date} must be in the past`).toBe(true);
    }
  });

  test('invalid scope is rejected', async () => {
    const res = await api.patch(`/api/class-series/${seriesId}`, {
      data: { scope: 'everything', updates: { maxStudents: 5 } },
    });
    expect(res.status()).toBe(400);
  });
});
