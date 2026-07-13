import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * API tests for the start-date change safety net (handleStartDateChange in
 * server/services/auto-enroll.ts), driven through the real admin routes:
 *
 *  - PATCH /api/admin/course-start-dates/:id (reschedule) moves enrolled
 *    students from the old Theory 1 class to the class matching the new date,
 *    reports them in enrollmentReport.moved, and records a schedule_change
 *    notification for the student.
 *  - Rescheduling onto a date with no matching Theory 1 class escalates the
 *    students in enrollmentReport.needsAttention (they stay enrolled in their
 *    current class) and records a start_date_change office notification.
 *  - Rescheduling onto a date whose Theory 1 class is already full escalates
 *    instead of dropping the student.
 *  - Cancelling (PATCH status: cancelled) and deleting (DELETE) a start date
 *    with enrolled students flags them as needing attention and leaves their
 *    enrollment untouched.
 *
 * Runs against the live dev server with an authenticated admin session.
 * The session cookie is Secure even in dev, so requests must go through the
 * HTTPS Replit domain rather than http://localhost:5000.
 *
 * All seeded rows (admin, students, classes, enrollments, start dates) use
 * far-future 2036 dates / @test.local emails and are deleted afterwards,
 * including the notification rows the reconciliation creates.
 */

const TEST_ADMIN_EMAIL = 'e2e-start-date-recon-admin@test.local';
const TEST_ADMIN_PASSWORD = 'e2e-recon-test-pw-1';
const STUDENT_A_EMAIL = 'e2e-recon-student-a@test.local';
const STUDENT_B_EMAIL = 'e2e-recon-student-b@test.local';

const COURSE_TYPE = 'auto';
const TIME = '18:00';
const DATE_OLD = '2036-04-07'; // class A — student A starts here
const DATE_NEW = '2036-04-14'; // class B — student A gets moved here
const DATE_NOMATCH = '2036-04-21'; // no Theory 1 class exists on this date
const DATE_FULL = '2036-04-28'; // class C — maxStudents: 1, pre-filled by student B
const ALL_DATES = [DATE_OLD, DATE_NEW, DATE_NOMATCH, DATE_FULL];

const baseURL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : 'http://localhost:5000';

let api: APIRequestContext;
let db: Client;

let studentAId: number;
let studentBId: number;
let classOldId: number;
let classNewId: number;
let classFullId: number;
let startDateId: number;
let maxNotificationIdBefore = 0;

async function seedStudent(email: string, firstName: string): Promise<number> {
  const res = await db.query(
    `INSERT INTO students (first_name, last_name, email, phone, date_of_birth, address,
                           course_type, status, emergency_contact, emergency_phone)
     VALUES ($1, 'ReconTest', $2, '514-555-0100', '2008-01-15', '123 Test St',
             $3, 'active', 'Test Contact', '514-555-0101')
     ON CONFLICT (email) DO UPDATE SET status = 'active'
     RETURNING id`,
    [firstName, email, COURSE_TYPE],
  );
  return res.rows[0].id;
}

async function seedTheory1Class(date: string, maxStudents: number): Promise<number> {
  const res = await db.query(
    `INSERT INTO classes (course_type, class_type, class_number, date, time, duration, max_students, status)
     VALUES ($1, 'theory', 1, $2, $3, 120, $4, 'scheduled')
     RETURNING id`,
    [COURSE_TYPE, date, TIME, maxStudents],
  );
  return res.rows[0].id;
}

async function activeEnrollments(studentId: number): Promise<number[]> {
  const res = await db.query(
    `SELECT class_id FROM class_enrollments
     WHERE student_id = $1 AND cancelled_at IS NULL`,
    [studentId],
  );
  return res.rows.map((r: any) => r.class_id);
}

async function cleanupSeededData() {
  // Notifications created by the reconciliation during this run (and their
  // deliveries) — scoped to rows newer than the pre-test high-water mark that
  // reference our seeded students/classes.
  const classIds = [classOldId, classNewId, classFullId].filter(Boolean);
  const studentIds = [studentAId, studentBId].filter(Boolean);
  if (classIds.length > 0 || studentIds.length > 0) {
    const notifIds = (
      await db.query(
        `SELECT id FROM notifications
         WHERE id > $1
           AND notification_type IN ('schedule_change', 'start_date_change')
           AND (
             (payload->>'classId')::int = ANY($2::int[])
             OR EXISTS (
               SELECT 1 FROM jsonb_array_elements(COALESCE(payload::jsonb->'studentIds', '[]'::jsonb)) el
               WHERE el::text::int = ANY($3::int[])
             )
           )`,
        [maxNotificationIdBefore, classIds, studentIds],
      )
    ).rows.map((r: any) => r.id);
    if (notifIds.length > 0) {
      await db.query(`DELETE FROM notification_deliveries WHERE notification_id = ANY($1::int[])`, [notifIds]);
      await db.query(`DELETE FROM notifications WHERE id = ANY($1::int[])`, [notifIds]);
    }
  }

  await db.query(
    `DELETE FROM class_enrollments WHERE student_id IN (SELECT id FROM students WHERE email IN ($1, $2))`,
    [STUDENT_A_EMAIL, STUDENT_B_EMAIL],
  );
  await db.query(
    `DELETE FROM classes WHERE course_type = $1 AND class_type = 'theory' AND class_number = 1 AND date = ANY($2::text[])`,
    [COURSE_TYPE, ALL_DATES],
  );
  await db.query(`DELETE FROM students WHERE email IN ($1, $2)`, [STUDENT_A_EMAIL, STUDENT_B_EMAIL]);
  await db.query(
    `DELETE FROM course_start_dates WHERE course_type = $1 AND start_date = ANY($2::text[])`,
    [COURSE_TYPE, ALL_DATES],
  );
  await db.query(`DELETE FROM users WHERE email = $1`, [TEST_ADMIN_EMAIL]);
}

test.describe.serial('Start-date change enrollment reconciliation', () => {
  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    // Throwaway admin account for an authenticated session.
    const hash = bcrypt.hashSync(TEST_ADMIN_PASSWORD, 10);
    await db.query(
      `INSERT INTO users (email, role, password, first_name, last_name)
       VALUES ($1, 'admin', $2, 'E2E', 'ReconTest')
       ON CONFLICT (email) DO UPDATE SET password = $2, role = 'admin'`,
      [TEST_ADMIN_EMAIL, hash],
    );

    // Clean slate in case a previous run died mid-way.
    studentAId = 0; studentBId = 0; classOldId = 0; classNewId = 0; classFullId = 0;
    await cleanupSeededData();
    await db.query(
      `INSERT INTO users (email, role, password, first_name, last_name)
       VALUES ($1, 'admin', $2, 'E2E', 'ReconTest')
       ON CONFLICT (email) DO UPDATE SET password = $2, role = 'admin'`,
      [TEST_ADMIN_EMAIL, hash],
    );

    maxNotificationIdBefore =
      (await db.query(`SELECT COALESCE(MAX(id), 0) AS max FROM notifications`)).rows[0].max;

    // Seed: two students, Theory 1 classes on three of the four dates
    // (DATE_NOMATCH intentionally has none), student A enrolled in the old
    // class, student B filling the 1-seat class on DATE_FULL.
    studentAId = await seedStudent(STUDENT_A_EMAIL, 'ReconMover');
    studentBId = await seedStudent(STUDENT_B_EMAIL, 'ReconOccupant');
    classOldId = await seedTheory1Class(DATE_OLD, 15);
    classNewId = await seedTheory1Class(DATE_NEW, 15);
    classFullId = await seedTheory1Class(DATE_FULL, 1);
    await db.query(
      `INSERT INTO class_enrollments (class_id, student_id, attendance_status) VALUES ($1, $2, 'registered')`,
      [classOldId, studentAId],
    );
    await db.query(
      `INSERT INTO class_enrollments (class_id, student_id, attendance_status) VALUES ($1, $2, 'registered')`,
      [classFullId, studentBId],
    );

    api = await playwrightRequest.newContext({ baseURL });
    const login = await api.post('/api/auth/login', {
      data: { username: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
    });
    expect(login.ok(), `admin login failed: ${login.status()} ${await login.text()}`).toBe(true);

    const created = await api.post('/api/admin/course-start-dates', {
      data: {
        courseType: COURSE_TYPE,
        module: 1,
        startDate: DATE_OLD,
        startTime: TIME,
        status: 'active',
        notes: 'e2e reconciliation test',
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    startDateId = (await created.json()).id;
  });

  test.afterAll(async () => {
    if (db) {
      await cleanupSeededData();
      await db.end();
    }
    if (api) await api.dispose();
  });

  test('rescheduling moves the enrolled student to the matching class and reports it', async () => {
    const res = await api.patch(`/api/admin/course-start-dates/${startDateId}`, {
      data: { startDate: DATE_NEW },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.startDate).toBe(DATE_NEW);

    const report = body.enrollmentReport;
    expect(report.action).toBe('rescheduled');
    expect(report.affected).toBe(1);
    expect(report.moved.map((m: any) => m.studentId)).toEqual([studentAId]);
    expect(report.needsAttention).toEqual([]);

    // DB truth: old enrollment soft-cancelled, new active enrollment in class B.
    expect(await activeEnrollments(studentAId)).toEqual([classNewId]);
    const oldRow = await db.query(
      `SELECT cancelled_at FROM class_enrollments WHERE class_id = $1 AND student_id = $2`,
      [classOldId, studentAId],
    );
    expect(oldRow.rows.length).toBe(1);
    expect(oldRow.rows[0].cancelled_at).not.toBeNull();

    // The student was alerted about the move.
    const notif = await db.query(
      `SELECT id FROM notifications n
       WHERE n.id > $1 AND n.notification_type = 'schedule_change'
         AND (n.payload->>'classId')::int = $2
         AND EXISTS (
           SELECT 1 FROM notification_deliveries d
           WHERE d.notification_id = n.id AND d.recipient_type = 'student' AND d.recipient_id = $3
         )`,
      [maxNotificationIdBefore, classNewId, String(studentAId)],
    );
    expect(notif.rows.length).toBeGreaterThan(0);
  });

  test('rescheduling to a date with no matching class escalates instead of dropping', async () => {
    const res = await api.patch(`/api/admin/course-start-dates/${startDateId}`, {
      data: { startDate: DATE_NOMATCH },
    });
    expect(res.status(), await res.text()).toBe(200);
    const report = (await res.json()).enrollmentReport;

    expect(report.action).toBe('rescheduled');
    expect(report.affected).toBe(1);
    expect(report.moved).toEqual([]);
    expect(report.needsAttention.map((s: any) => s.studentId)).toEqual([studentAId]);
    expect(report.needsAttention[0].note).toContain('no matching class');
    expect(report.officeNotified).toBe(true);

    // The student was NOT dropped — still actively enrolled in class B.
    expect(await activeEnrollments(studentAId)).toEqual([classNewId]);

    // The office got a start_date_change alert naming the student.
    const notif = await db.query(
      `SELECT id FROM notifications
       WHERE id > $1 AND notification_type = 'start_date_change'
         AND payload::jsonb->'studentIds' @> $2::jsonb`,
      [maxNotificationIdBefore, JSON.stringify([studentAId])],
    );
    expect(notif.rows.length).toBeGreaterThan(0);
  });

  test('rescheduling to a date whose class is full escalates the student', async () => {
    // Move the start date back onto DATE_NEW first. There is no Theory 1 class
    // on DATE_NOMATCH, so this hop is a reconciliation no-op by design.
    const back = await api.patch(`/api/admin/course-start-dates/${startDateId}`, {
      data: { startDate: DATE_NEW },
    });
    expect(back.status(), await back.text()).toBe(200);
    expect((await back.json()).enrollmentReport.action).toBe('none');

    // Now reschedule onto the date whose only class has 1 seat, already taken.
    const res = await api.patch(`/api/admin/course-start-dates/${startDateId}`, {
      data: { startDate: DATE_FULL },
    });
    expect(res.status(), await res.text()).toBe(200);
    const report = (await res.json()).enrollmentReport;

    expect(report.action).toBe('rescheduled');
    expect(report.moved).toEqual([]);
    expect(report.needsAttention.map((s: any) => s.studentId)).toEqual([studentAId]);
    expect(report.needsAttention[0].note).toContain('full');
    expect(report.officeNotified).toBe(true);

    // Student A keeps their existing enrollment; student B keeps the seat.
    expect(await activeEnrollments(studentAId)).toEqual([classNewId]);
    expect(await activeEnrollments(studentBId)).toEqual([classFullId]);
  });

  test('cancelling a start date flags its enrolled students as needing attention', async () => {
    // The start date now sits on DATE_FULL, whose class holds student B.
    const res = await api.patch(`/api/admin/course-start-dates/${startDateId}`, {
      data: { status: 'cancelled' },
    });
    expect(res.status(), await res.text()).toBe(200);
    const report = (await res.json()).enrollmentReport;

    expect(report.action).toBe('cancelled');
    expect(report.affected).toBe(1);
    expect(report.needsAttention.map((s: any) => s.studentId)).toEqual([studentBId]);
    expect(report.officeNotified).toBe(true);

    // Enrollment left untouched (the class itself may still run).
    expect(await activeEnrollments(studentBId)).toEqual([classFullId]);

    // Student B was told about the cancellation.
    const notif = await db.query(
      `SELECT id FROM notifications n
       WHERE n.id > $1 AND n.notification_type = 'schedule_change'
         AND n.title LIKE 'Course Start Date Cancelled%'
         AND EXISTS (
           SELECT 1 FROM notification_deliveries d
           WHERE d.notification_id = n.id AND d.recipient_type = 'student' AND d.recipient_id = $2
         )`,
      [maxNotificationIdBefore, String(studentBId)],
    );
    expect(notif.rows.length).toBeGreaterThan(0);
  });

  test('deleting a start date flags its enrolled students as needing attention', async () => {
    // Fresh active start date on DATE_NEW, whose class holds student A.
    const created = await api.post('/api/admin/course-start-dates', {
      data: {
        courseType: COURSE_TYPE,
        module: 1,
        startDate: DATE_NEW,
        startTime: TIME,
        status: 'active',
        notes: 'e2e reconciliation delete test',
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const deleteTargetId = (await created.json()).id;

    const res = await api.delete(`/api/admin/course-start-dates/${deleteTargetId}`);
    expect(res.status(), await res.text()).toBe(200);
    const report = (await res.json()).enrollmentReport;

    expect(report.action).toBe('cancelled');
    expect(report.affected).toBe(1);
    expect(report.needsAttention.map((s: any) => s.studentId)).toEqual([studentAId]);
    expect(report.officeNotified).toBe(true);

    // Student A is still enrolled — flagged, not dropped.
    expect(await activeEnrollments(studentAId)).toEqual([classNewId]);
  });
});
