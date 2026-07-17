import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * Student-portal enforcement tests for the max_bookings_per_week,
 * min_booking_notice, and max_pending_bookings booking policies
 * (checkWeeklyNoticePendingPolicies in server/routes.ts, applied to
 * POST /api/student/classes/:classId/book).
 *
 * Covers:
 *  - Weekly limit: with max_bookings_per_week = 1, the 2nd booking within the
 *    same Mon-Sun week is blocked (400 + policyViolation max_bookings_per_week).
 *  - Pending limit: with max_pending_bookings = 1 and an existing upcoming
 *    unconfirmed booking, another booking is blocked (400 + max_pending_bookings).
 *  - Minimum notice: with min_booking_notice = 48 hours, a class starting
 *    tomorrow is blocked (400 + min_booking_notice), and the same booking
 *    succeeds once the policy is removed.
 *  - The available-classes listing (GET /api/student/classes/available)
 *    annotates classes blocked by these policies with bookingAllowed: false,
 *    a blockingReason, and a blockingRule so the UI can grey them out.
 *
 * Runs against the live dev server with an authenticated student session
 * (Bearer token). Uses future dates ~6-7 months out (inside the listing's
 * 13-month window) for week/pending tests and cleans up every row it creates.
 */

const STUDENT_EMAIL = 'e2e-wnp-policy-student@test.local';
const STUDENT_PASSWORD = 'e2e-wnp-policy-pw-1';

// Dates must stay inside the available-classes listing window (today ..
// today + 13 months), so compute them relative to "now": a Monday ~6 months
// out plus a Thursday in the same Mon-Sun week, and a Wednesday in a
// different week ~7 months out for the pending-bookings test.
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const now = new Date();
// Days until next Monday (1 = Monday), always at least 7 to stay future.
const daysToMonday = ((8 - now.getDay()) % 7) + 7;
const WEEK_DATE_A = isoDaysFromNow(daysToMonday + 26 * 7); // Monday
const WEEK_DATE_B = isoDaysFromNow(daysToMonday + 26 * 7 + 3); // same-week Thursday
const OTHER_WEEK_DATE = isoDaysFromNow(daysToMonday + 30 * 7 + 2); // different week

const POLICY_NAMES = [
  'E2E Weekly Limit 1',
  'E2E Pending Limit 1',
  'E2E Min Notice 48h',
];

const baseURL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : 'http://localhost:5000';

let api: APIRequestContext;
let db: Client;
let studentId: number;
const classIds: Record<string, number> = {};

async function createClass(
  key: string,
  classNumber: number,
  date: string,
  time: string,
): Promise<number> {
  const res = await db.query(
    `INSERT INTO classes (course_type, class_type, class_number, date, time, duration, max_students, status)
     VALUES ('auto', 'theory', $1, $2, $3, 120, 15, 'scheduled') RETURNING id`,
    [classNumber, date, time],
  );
  classIds[key] = res.rows[0].id;
  return res.rows[0].id;
}

async function insertPolicy(name: string, policyType: string, value: number) {
  await db.query(
    `INSERT INTO booking_policies (name, policy_type, value, is_active) VALUES ($1, $2, $3, true)`,
    [name, policyType, value],
  );
}

async function deletePolicy(name: string) {
  await db.query(`DELETE FROM booking_policies WHERE name = $1`, [name]);
}

function bookClass(id: number) {
  return api.post(`/api/student/classes/${id}/book`);
}

async function fetchAvailable(): Promise<any[]> {
  const res = await api.get('/api/student/classes/available');
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  expect(Array.isArray(body.classes)).toBe(true);
  return body.classes;
}

test.describe.serial('Weekly / notice / pending booking policies (student portal)', () => {
  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    // Clean leftovers from previous runs.
    for (const name of POLICY_NAMES) await deletePolicy(name);
    const prev = await db.query(`SELECT id FROM students WHERE email = $1`, [STUDENT_EMAIL]);
    for (const row of prev.rows) {
      await db.query(
        `DELETE FROM classes WHERE id IN (SELECT class_id FROM class_enrollments WHERE student_id = $1)
           AND class_type = 'theory' AND max_students = 15`,
        [row.id],
      );
      await db.query(`DELETE FROM class_enrollments WHERE student_id = $1`, [row.id]);
      await db.query(`DELETE FROM students WHERE id = $1`, [row.id]);
    }

    // Throwaway student with an active portal account.
    const hash = bcrypt.hashSync(STUDENT_PASSWORD, 10);
    const studentRes = await db.query(
      `INSERT INTO students (first_name, last_name, email, phone, date_of_birth, address, course_type, status,
                             emergency_contact, emergency_phone, password, account_status)
       VALUES ('E2E', 'WnpPolicy', $1, '514-000-0002', '2005-01-01', '1 Test St', 'auto', 'active',
               'EC', '514-000-0003', $2, 'active') RETURNING id`,
      [STUDENT_EMAIL, hash],
    );
    studentId = studentRes.rows[0].id;

    // Attended Theory 1 in the past so later theory classes are bookable
    // (phase rules) and so this enrollment never counts as pending.
    const t1 = await createClass('t1past', 1, '2026-01-05', '09:00');
    await db.query(
      `INSERT INTO class_enrollments (class_id, student_id, attendance_status) VALUES ($1, $2, 'attended')`,
      [t1, studentId],
    );

    // Bookable classes:
    await createClass('weekA', 2, WEEK_DATE_A, '09:00'); // same Mon-Sun week...
    await createClass('weekB', 3, WEEK_DATE_B, '13:00'); // ...as this one
    await createClass('otherWeek', 4, OTHER_WEEK_DATE, '09:00');

    // A class starting tomorrow (well inside a 48-hour notice window).
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await createClass('tomorrow', 2, tomorrow, '23:00');

    // Log in as the student and keep the Bearer token.
    const ctx = await playwrightRequest.newContext({ baseURL });
    const login = await ctx.post('/api/student/login', {
      data: { email: STUDENT_EMAIL, password: STUDENT_PASSWORD },
    });
    expect(login.ok(), `student login failed: ${login.status()} ${await login.text()}`).toBeTruthy();
    const { token } = await login.json();
    await ctx.dispose();
    api = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
  });

  test.afterAll(async () => {
    if (db) {
      for (const name of POLICY_NAMES) await deletePolicy(name);
      if (studentId) {
        await db.query(`DELETE FROM class_enrollments WHERE student_id = $1`, [studentId]);
        await db.query(`DELETE FROM students WHERE id = $1`, [studentId]);
      }
      const ids = Object.values(classIds);
      if (ids.length) await db.query(`DELETE FROM classes WHERE id = ANY($1::int[])`, [ids]);
      await db.end();
    }
    if (api) await api.dispose();
  });

  test('max_bookings_per_week = 1 blocks a 2nd booking in the same week', async () => {
    await insertPolicy('E2E Weekly Limit 1', 'max_bookings_per_week', 1);
    try {
      // 1st booking of the week succeeds.
      const first = await bookClass(classIds.weekA);
      expect(first.ok(), await first.text()).toBeTruthy();

      // Available-classes listing marks the same-week class as blocked so
      // the UI can grey it out.
      const classes = await fetchAvailable();
      const weekB = classes.find((c: any) => c.id === classIds.weekB);
      expect(weekB, 'weekB class missing from available listing').toBeTruthy();
      expect(weekB.bookingAllowed).toBe(false);
      expect(weekB.blockingRule).toBe('max_bookings_per_week');
      expect(weekB.blockingReason).toContain('Weekly booking limit reached');

      // 2nd booking in the same Mon-Sun week is blocked.
      const second = await bookClass(classIds.weekB);
      expect(second.status()).toBe(400);
      const body = await second.json();
      expect(body.policyViolation).toBe('max_bookings_per_week');
      expect(body.message).toContain('Weekly booking limit reached');
      expect(body.message).toContain('Maximum bookings per week is 1');
    } finally {
      await deletePolicy('E2E Weekly Limit 1');
    }
  });

  test('max_pending_bookings = 1 blocks a booking when one upcoming booking is pending', async () => {
    // The student still holds the weekA booking (registered, future, scheduled).
    await insertPolicy('E2E Pending Limit 1', 'max_pending_bookings', 1);
    try {
      // Listing greys out the class before the student even tries to book.
      const classes = await fetchAvailable();
      const otherWeek = classes.find((c: any) => c.id === classIds.otherWeek);
      expect(otherWeek, 'otherWeek class missing from available listing').toBeTruthy();
      expect(otherWeek.bookingAllowed).toBe(false);
      expect(otherWeek.blockingRule).toBe('max_pending_bookings');
      expect(otherWeek.blockingReason).toContain('Pending booking limit reached');

      const res = await bookClass(classIds.otherWeek);
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.policyViolation).toBe('max_pending_bookings');
      expect(body.message).toContain('Pending booking limit reached');
      expect(body.message).toContain('Maximum pending bookings is 1');
    } finally {
      await deletePolicy('E2E Pending Limit 1');
    }
  });

  test('min_booking_notice = 48 blocks a class starting tomorrow', async () => {
    await insertPolicy('E2E Min Notice 48h', 'min_booking_notice', 48);
    try {
      // Listing greys out the too-soon class.
      const classes = await fetchAvailable();
      const tomorrowCls = classes.find((c: any) => c.id === classIds.tomorrow);
      expect(tomorrowCls, 'tomorrow class missing from available listing').toBeTruthy();
      expect(tomorrowCls.bookingAllowed).toBe(false);
      expect(tomorrowCls.blockingRule).toBe('min_booking_notice');
      expect(tomorrowCls.blockingReason).toContain('hour(s) notice');

      const res = await bookClass(classIds.tomorrow);
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.policyViolation).toBe('min_booking_notice');
      expect(body.message).toContain('at least 48 hour(s) notice');
    } finally {
      await deletePolicy('E2E Min Notice 48h');
    }
  });

  test('the same tomorrow class books fine once the notice policy is removed', async () => {
    // With no policies active the listing marks it bookable again.
    const classes = await fetchAvailable();
    const tomorrowCls = classes.find((c: any) => c.id === classIds.tomorrow);
    expect(tomorrowCls, 'tomorrow class missing from available listing').toBeTruthy();
    expect(tomorrowCls.bookingAllowed).toBe(true);

    const res = await bookClass(classIds.tomorrow);
    expect(res.ok(), await res.text()).toBeTruthy();
  });
});
