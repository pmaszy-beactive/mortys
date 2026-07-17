import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * API tests for the all-or-nothing conflict guarantee of series-wide edits.
 *
 * PATCH /api/class-series/:seriesId pre-validates every target class for
 * instructor/room double-bookings and must return 409 with a conflicts array
 * WITHOUT modifying ANY class — a conflict must never leave the series
 * half-updated.
 *
 * Covers:
 *  - Instructor conflict: a standalone class with the same instructor overlaps
 *    the new time on one series date → 409, all series classes untouched.
 *  - Room conflict: a standalone class in the same room overlaps the new time
 *    on one series date → 409, all series classes untouched.
 *  - After removing the conflicting classes the same PATCH succeeds and every
 *    (non-past, non-detached) class is updated.
 *
 * The throwaway instructor has NO availability records, so the availability
 * pre-check is a no-op and only the double-booking path is exercised.
 * Runs against the live dev server through the HTTPS Replit domain (session
 * cookies are Secure even in dev). Everything created here is deleted after.
 */

const TEST_ADMIN_EMAIL = 'e2e-series-conflict-admin@test.local';
const TEST_ADMIN_PASSWORD = 'e2e-series-conflict-pw-1';
const TEST_INSTRUCTOR_EMAIL = 'e2e-series-conflict-instructor@test.local';
const TEST_ROOM = 'E2E-Conflict-Room';

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
let instructorId: number;
let seriesId: string;
let seriesDates: string[] = [];
const standaloneIds: number[] = [];

async function fetchSeriesRows() {
  const { rows } = await db.query(
    `SELECT id, date, time, duration, instructor_id, room, detached_from_series
     FROM classes WHERE series_id = $1 ORDER BY date`,
    [seriesId],
  );
  return rows as Array<{
    id: number;
    date: string;
    time: string;
    duration: number;
    instructor_id: number | null;
    room: string | null;
    detached_from_series: boolean;
  }>;
}

async function createStandaloneClass(opts: {
  date: string;
  time: string;
  duration: number;
  instructorId?: number | null;
  room?: string | null;
}) {
  const { rows } = await db.query(
    `INSERT INTO classes (course_type, class_type, class_number, date, time, duration,
                          instructor_id, room, max_students, status, lesson_type)
     VALUES ('auto', 'theory', 98, $1, $2, $3, $4, $5, 10, 'scheduled', 'regular')
     RETURNING id`,
    [opts.date, opts.time, opts.duration, opts.instructorId ?? null, opts.room ?? null],
  );
  standaloneIds.push(rows[0].id);
  return rows[0].id as number;
}

test.describe.serial('Series-wide edit conflict pre-validation (all-or-nothing)', () => {
  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    const hash = bcrypt.hashSync(TEST_ADMIN_PASSWORD, 10);
    await db.query(
      `INSERT INTO users (email, role, password, first_name, last_name)
       VALUES ($1, 'admin', $2, 'E2E', 'ConflictTest')
       ON CONFLICT (email) DO UPDATE SET password = $2, role = 'admin'`,
      [TEST_ADMIN_EMAIL, hash],
    );

    // Instructor with no availability records → availability check is a no-op.
    const { rows } = await db.query(
      `INSERT INTO instructors (first_name, last_name, email, status)
       VALUES ('E2E', 'ConflictInstructor', $1, 'active')
       ON CONFLICT (email) DO UPDATE SET status = 'active'
       RETURNING id`,
      [TEST_INSTRUCTOR_EMAIL],
    );
    instructorId = rows[0].id;

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
      if (standaloneIds.length > 0) {
        await db.query(`DELETE FROM classes WHERE id = ANY($1::int[])`, [standaloneIds]);
      }
      if (instructorId) {
        await db.query(`DELETE FROM instructors WHERE id = $1`, [instructorId]);
      }
      await db.query(`DELETE FROM users WHERE email = $1`, [TEST_ADMIN_EMAIL]);
      await db.end();
    }
    if (api) await api.dispose();
  });

  test('setup: generate a future-only series with an instructor', async () => {
    // All dates in the future so every class is a series-edit target.
    const now = new Date();
    const anchorDow = addDays(now, 3).getDay();
    const res = await api.post('/api/admin/classes/bulk', {
      data: {
        courseType: 'auto',
        classType: 'theory',
        classNumber: 98,
        daysOfWeek: [anchorDow],
        time: '06:00',
        duration: 45,
        maxStudents: 12,
        lessonType: 'regular',
        instructorId,
        startDate: localDateStr(addDays(now, 2)),
        endDate: localDateStr(addDays(now, 24)),
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    seriesId = body.seriesId;
    seriesDates = body.dates;
    expect(seriesDates.length).toBeGreaterThanOrEqual(3);

    const rows = await fetchSeriesRows();
    expect(rows.length).toBe(seriesDates.length);
    for (const r of rows) {
      expect(r.instructor_id).toBe(instructorId);
      expect(r.time).toBe('06:00');
    }
  });

  test('instructor conflict on one date → 409 and NO series class is modified', async () => {
    // Standalone class with the SAME instructor at 07:00 on the middle series
    // date. Moving the whole series to 07:00 overlaps it on that one date.
    const conflictDate = seriesDates[1];
    await createStandaloneClass({
      date: conflictDate,
      time: '07:00',
      duration: 45,
      instructorId,
    });

    const res = await api.patch(`/api/class-series/${seriesId}`, {
      data: { scope: 'all', updates: { time: '07:00' } },
    });
    expect(res.status(), await res.text()).toBe(409);
    const body = await res.json();
    expect(Array.isArray(body.conflicts)).toBe(true);
    expect(body.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(body.conflicts.join('\n')).toContain(conflictDate);
    expect(body.conflicts.join('\n')).toContain('instructor');
    expect(body.message).toContain('No classes were changed');

    // All-or-nothing: every series class must be completely untouched.
    const rows = await fetchSeriesRows();
    expect(rows.length).toBe(seriesDates.length);
    for (const r of rows) {
      expect(r.time, `class on ${r.date} must keep its original time`).toBe('06:00');
      expect(r.duration).toBe(45);
      expect(r.instructor_id).toBe(instructorId);
      expect(r.detached_from_series).toBe(false);
    }
  });

  test('room conflict on one date → 409 and NO series class is modified', async () => {
    // Give the series a room first (no schedule change; nothing overlaps yet
    // at 06:00 so this must succeed).
    const setRoom = await api.patch(`/api/class-series/${seriesId}`, {
      data: { scope: 'all', updates: { room: TEST_ROOM } },
    });
    expect(setRoom.status(), await setRoom.text()).toBe(200);

    // Standalone class in the SAME room (different instructor: none) at 08:00
    // on the last series date.
    const conflictDate = seriesDates[seriesDates.length - 1];
    await createStandaloneClass({
      date: conflictDate,
      time: '08:00',
      duration: 45,
      room: TEST_ROOM,
    });

    const res = await api.patch(`/api/class-series/${seriesId}`, {
      data: { scope: 'all', updates: { time: '08:00' } },
    });
    expect(res.status(), await res.text()).toBe(409);
    const body = await res.json();
    expect(Array.isArray(body.conflicts)).toBe(true);
    expect(body.conflicts.join('\n')).toContain(conflictDate);
    expect(body.conflicts.join('\n')).toContain(TEST_ROOM);
    expect(body.message).toContain('No classes were changed');

    const rows = await fetchSeriesRows();
    for (const r of rows) {
      expect(r.time, `class on ${r.date} must keep its original time`).toBe('06:00');
      expect(r.room).toBe(TEST_ROOM);
    }
  });

  test('same PATCH succeeds once the conflicting classes are removed', async () => {
    await db.query(`DELETE FROM classes WHERE id = ANY($1::int[])`, [standaloneIds]);
    standaloneIds.length = 0;

    const res = await api.patch(`/api/class-series/${seriesId}`, {
      data: { scope: 'all', updates: { time: '07:00' } },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(seriesDates.length);

    const rows = await fetchSeriesRows();
    for (const r of rows) {
      expect(r.time).toBe('07:00');
    }
  });
});
