import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * Regression tests for the "maximum 2 classes per day" booking policy.
 *
 * Covers:
 *  - A 2nd same-day booking (different time) succeeds.
 *  - A 3rd same-day booking is blocked with a message referencing the 2-per-day limit.
 *  - Enrollments in classes cancelled by the school do NOT consume a daily slot.
 *  - Same date + same time conflict is still blocked.
 *
 * Runs against the live dev server with an authenticated student session
 * (Bearer token). Uses far-future dates (year 2035) and cleans up after itself.
 */

const STUDENT_EMAIL = 'e2e-daily-limit-student@test.local';
const STUDENT_PASSWORD = 'e2e-daily-limit-pw-1';
const TEST_DATE = '2035-04-10';

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
  time: string,
  status = 'scheduled',
): Promise<number> {
  const res = await db.query(
    `INSERT INTO classes (course_type, class_type, class_number, date, time, duration, max_students, status)
     VALUES ('auto', 'theory', $1, $2, $3, 120, 15, $4) RETURNING id`,
    [classNumber, TEST_DATE, time, status],
  );
  classIds[key] = res.rows[0].id;
  return res.rows[0].id;
}

function bookClass(id: number) {
  return api.post(`/api/student/classes/${id}/book`);
}

test.describe.serial('Daily 2-class booking limit', () => {
  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    // Clean leftovers from previous runs
    const prev = await db.query(`SELECT id FROM students WHERE email = $1`, [STUDENT_EMAIL]);
    for (const row of prev.rows) {
      await db.query(`DELETE FROM class_enrollments WHERE student_id = $1`, [row.id]);
      await db.query(`DELETE FROM students WHERE id = $1`, [row.id]);
    }
    await db.query(
      `DELETE FROM classes WHERE date IN ($1, '2035-04-01') AND course_type = 'auto' AND class_number BETWEEN 1 AND 5 AND max_students = 15 AND id NOT IN (SELECT COALESCE(class_id, 0) FROM class_enrollments)`,
      [TEST_DATE],
    );

    // Throwaway student with an active portal account
    const hash = bcrypt.hashSync(STUDENT_PASSWORD, 10);
    const studentRes = await db.query(
      `INSERT INTO students (first_name, last_name, email, phone, date_of_birth, address, course_type, status,
                             emergency_contact, emergency_phone, password, account_status)
       VALUES ('E2E', 'DailyLimit', $1, '514-000-0000', '2005-01-01', '1 Test St', 'auto', 'active',
               'EC', '514-000-0001', $2, 'active') RETURNING id`,
      [STUDENT_EMAIL, hash],
    );
    studentId = studentRes.rows[0].id;

    // Attended Theory 1 in the past so Theory 2/3/4 are bookable (phase rules)
    const t1 = await createClass('t1past', 1, '09:00');
    await db.query(`UPDATE classes SET date = '2035-04-01' WHERE id = $1`, [t1]);
    await db.query(
      `INSERT INTO class_enrollments (class_id, student_id, attendance_status) VALUES ($1, $2, 'attended')`,
      [t1, studentId],
    );

    // Same-day classes at different times
    await createClass('a', 2, '09:00');
    await createClass('b', 3, '13:00');
    await createClass('c', 4, '16:00');
    await createClass('d', 4, '13:00'); // same date + time as b

    // Log in as the student and keep the Bearer token
    const ctx = await playwrightRequest.newContext({ baseURL });
    const login = await ctx.post('/api/student/login', {
      data: { email: STUDENT_EMAIL, password: STUDENT_PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = await login.json();
    await ctx.dispose();
    api = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
  });

  test.afterAll(async () => {
    await db.query(`DELETE FROM class_enrollments WHERE student_id = $1`, [studentId]);
    await db.query(`DELETE FROM classes WHERE id = ANY($1::int[])`, [Object.values(classIds)]);
    await db.query(`DELETE FROM students WHERE id = $1`, [studentId]);
    await db.end();
    await api.dispose();
  });

  test('1st booking of the day succeeds', async () => {
    const res = await bookClass(classIds.a);
    expect(res.ok()).toBeTruthy();
  });

  test('2nd same-day booking at a different time succeeds', async () => {
    const res = await bookClass(classIds.b);
    expect(res.ok()).toBeTruthy();
  });

  test('3rd same-day booking is blocked with a 2-per-day message', async () => {
    const res = await bookClass(classIds.c);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.policyViolation).toBe('max_2_classes_per_day');
    expect(body.message).toContain('maximum of 2 classes per day');
  });

  test('a class cancelled by the school does not consume a daily slot', async () => {
    // School cancels class A — the student still has an enrollment row, but the
    // class itself is no longer scheduled.
    await db.query(`UPDATE classes SET status = 'cancelled' WHERE id = $1`, [classIds.a]);
    const res = await bookClass(classIds.c);
    expect(res.ok()).toBeTruthy();
  });

  test('same date + same time is still blocked as a conflict', async () => {
    // Free a slot so the daily limit isn't what blocks this booking
    await db.query(`UPDATE classes SET status = 'cancelled' WHERE id = $1`, [classIds.c]);
    const res = await bookClass(classIds.d);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('time conflict');
  });
});
