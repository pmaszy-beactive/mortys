import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * API tests for student search (GET /api/students).
 *
 * Guards against regressions in DatabaseStorage.searchStudents — full-name
 * search once broke silently because a duplicate method shadowed the correct
 * implementation. Covers:
 *  - partial first-name search
 *  - full-name "First Last" search
 *  - double-spaced full-name input (whitespace normalization)
 *  - status filter combined with a search term
 *  - isTransfer filter
 *
 * Runs against the live dev server with an authenticated admin session over
 * the HTTPS Replit domain (session cookies are Secure even in dev).
 * Seeds and cleans up its own student rows with unique, unmistakable names.
 */

const TEST_ADMIN_EMAIL = 'e2e-student-search-admin@test.local';
const TEST_ADMIN_PASSWORD = 'e2e-search-test-pw-1';

const UNIQUE = 'Zqsearchton';
const FIRST = 'Zebulora';
const LAST = UNIQUE;
const STUDENT_EMAIL = 'e2e-search-student@test.local';
const TRANSFER_FIRST = 'Yttrix';
const TRANSFER_LAST = UNIQUE;
const TRANSFER_EMAIL = 'e2e-search-transfer@test.local';

const baseURL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : 'http://localhost:5000';

let api: APIRequestContext;
let db: Client;
let studentId: number;
let transferStudentId: number;

async function search(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await api.get(`/api/students?${qs}`);
  expect(res.ok(), `search failed: ${res.status()} ${await res.text()}`).toBe(true);
  return res.json() as Promise<{ students: any[]; total: number }>;
}

test.describe.serial('Student search API', () => {
  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    const hash = bcrypt.hashSync(TEST_ADMIN_PASSWORD, 10);
    await db.query(
      `INSERT INTO users (email, role, password, first_name, last_name)
       VALUES ($1, 'admin', $2, 'E2E', 'SearchTest')
       ON CONFLICT (email) DO UPDATE SET password = $2, role = 'admin'`,
      [TEST_ADMIN_EMAIL, hash],
    );

    // Clean leftovers from previous runs.
    await db.query(`DELETE FROM students WHERE email IN ($1, $2)`, [STUDENT_EMAIL, TRANSFER_EMAIL]);

    const insert = await db.query(
      `INSERT INTO students (first_name, last_name, email, phone, date_of_birth, address,
                             course_type, status, emergency_contact, emergency_phone)
       VALUES ($1, $2, $3, '555-0100', '2008-01-15', '1 Test St',
               'auto', 'active', 'E2E Contact', '555-0101')
       RETURNING id`,
      [FIRST, LAST, STUDENT_EMAIL],
    );
    studentId = insert.rows[0].id;

    const insertTransfer = await db.query(
      `INSERT INTO students (first_name, last_name, email, phone, date_of_birth, address,
                             course_type, status, emergency_contact, emergency_phone, transferred_from)
       VALUES ($1, $2, $3, '555-0102', '2008-02-20', '2 Test St',
               'auto', 'inactive', 'E2E Contact', '555-0103', 'Other Driving School')
       RETURNING id`,
      [TRANSFER_FIRST, TRANSFER_LAST, TRANSFER_EMAIL],
    );
    transferStudentId = insertTransfer.rows[0].id;

    api = await playwrightRequest.newContext({ baseURL });
    const login = await api.post('/api/auth/login', {
      data: { username: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
    });
    expect(login.ok(), `admin login failed: ${login.status()} ${await login.text()}`).toBe(true);
  });

  test.afterAll(async () => {
    if (db) {
      await db.query(`DELETE FROM students WHERE email IN ($1, $2)`, [STUDENT_EMAIL, TRANSFER_EMAIL]);
      await db.query(`DELETE FROM users WHERE email = $1`, [TEST_ADMIN_EMAIL]);
      await db.end();
    }
    if (api) await api.dispose();
  });

  test('partial first-name search finds the student', async () => {
    const result = await search({ searchTerm: FIRST.slice(0, 6) });
    expect(result.students.map((s) => s.id)).toContain(studentId);
  });

  test('partial last-name search finds both seeded students', async () => {
    const result = await search({ searchTerm: UNIQUE.toLowerCase(), limit: '50' });
    const ids = result.students.map((s) => s.id);
    expect(ids).toContain(studentId);
    expect(ids).toContain(transferStudentId);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  test('full name "First Last" search finds the student', async () => {
    const result = await search({ searchTerm: `${FIRST} ${LAST}` });
    const ids = result.students.map((s) => s.id);
    expect(ids).toContain(studentId);
    expect(ids).not.toContain(transferStudentId);
  });

  test('double-spaced full name still finds the student', async () => {
    const result = await search({ searchTerm: `${FIRST}  ${LAST}` });
    expect(result.students.map((s) => s.id)).toContain(studentId);
  });

  test('case-insensitive full-name search works', async () => {
    const result = await search({ searchTerm: `${FIRST} ${LAST}`.toUpperCase() });
    expect(result.students.map((s) => s.id)).toContain(studentId);
  });

  test('status filter narrows results within a search term', async () => {
    const active = await search({ searchTerm: UNIQUE, status: 'active', limit: '50' });
    const activeIds = active.students.map((s) => s.id);
    expect(activeIds).toContain(studentId);
    expect(activeIds).not.toContain(transferStudentId);

    const inactive = await search({ searchTerm: UNIQUE, status: 'inactive', limit: '50' });
    const inactiveIds = inactive.students.map((s) => s.id);
    expect(inactiveIds).toContain(transferStudentId);
    expect(inactiveIds).not.toContain(studentId);
  });

  test('isTransfer filter returns only transfer students', async () => {
    const result = await search({ searchTerm: UNIQUE, isTransfer: 'true', limit: '50' });
    const ids = result.students.map((s) => s.id);
    expect(ids).toContain(transferStudentId);
    expect(ids).not.toContain(studentId);
  });

  test('search with no match returns empty results, not an error', async () => {
    const result = await search({ searchTerm: 'zz-no-such-student-xyzzy-99' });
    expect(result.students.length).toBe(0);
    expect(result.total).toBe(0);
  });
});
