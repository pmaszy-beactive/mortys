import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * API test for GET /api/students/stats (Active Students dashboard card).
 *
 * Guards against regressions where the stats route silently breaks — e.g.
 * route reordering so /api/students/:id swallows /api/students/stats, or a
 * broken count query — which would show a wrong Active Students total.
 *
 * Seeds known students (active + inactive), asserts the endpoint's
 * activeCount matches the database truth, and cleans up after itself.
 *
 * Runs against the live dev server with an authenticated admin session over
 * the HTTPS Replit domain (session cookie is Secure even in dev).
 */

const TEST_ADMIN_EMAIL = 'e2e-students-stats-admin@test.local';
const TEST_ADMIN_PASSWORD = 'e2e-stats-test-pw-1';

const SEED_EMAILS = [
  'e2e-stats-active-1@test.local',
  'e2e-stats-active-2@test.local',
  'e2e-stats-active-3@test.local',
  'e2e-stats-inactive-1@test.local',
];

const baseURL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : 'http://localhost:5000';

let api: APIRequestContext;
let db: Client;

async function dbActiveCount(): Promise<number> {
  const res = await db.query(`SELECT COUNT(*)::int AS count FROM students WHERE status = 'active'`);
  return res.rows[0].count;
}

async function fetchStats() {
  const res = await api.get('/api/students/stats');
  expect(res.status(), `stats request failed: ${res.status()} ${await res.text()}`).toBe(200);
  const body = await res.json();
  expect(typeof body.activeCount, `unexpected stats body: ${JSON.stringify(body)}`).toBe('number');
  return body as { activeCount: number };
}

test.describe.serial('Students stats API', () => {
  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    // Throwaway admin account for an authenticated session.
    const hash = bcrypt.hashSync(TEST_ADMIN_PASSWORD, 10);
    await db.query(
      `INSERT INTO users (email, role, password, first_name, last_name)
       VALUES ($1, 'admin', $2, 'E2E', 'StatsTest')
       ON CONFLICT (email) DO UPDATE SET password = $2, role = 'admin'`,
      [TEST_ADMIN_EMAIL, hash],
    );

    // Clean leftovers from previous runs.
    await db.query(`DELETE FROM students WHERE email = ANY($1)`, [SEED_EMAILS]);

    api = await playwrightRequest.newContext({ baseURL });
    const login = await api.post('/api/auth/login', {
      data: { username: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
    });
    expect(login.ok(), `admin login failed: ${login.status()} ${await login.text()}`).toBe(true);
  });

  test.afterAll(async () => {
    if (db) {
      await db.query(`DELETE FROM students WHERE email = ANY($1)`, [SEED_EMAILS]);
      await db.query(`DELETE FROM users WHERE email = $1`, [TEST_ADMIN_EMAIL]);
      await db.end();
    }
    if (api) await api.dispose();
  });

  test('activeCount matches the database before seeding', async () => {
    const stats = await fetchStats();
    expect(stats.activeCount).toBe(await dbActiveCount());
  });

  test('activeCount reflects newly seeded active students, ignoring inactive ones', async () => {
    const baseline = (await fetchStats()).activeCount;

    // Seed 3 active + 1 inactive student with known emails.
    for (const [i, email] of SEED_EMAILS.entries()) {
      const status = email.includes('inactive') ? 'inactive' : 'active';
      await db.query(
        `INSERT INTO students (first_name, last_name, email, phone, date_of_birth, address,
                               course_type, status, emergency_contact, emergency_phone)
         VALUES ('E2E', $1, $2, '555-0200', '2008-03-10', '3 Test St',
                 'auto', $3, 'E2E Contact', '555-0201')`,
        [`Stats${i}`, email, status],
      );
    }

    const stats = await fetchStats();
    // Exactly the 3 active seeds are added; the inactive seed must not count.
    expect(stats.activeCount).toBe(baseline + 3);
    // And it must equal the database truth, not a fallback value.
    expect(stats.activeCount).toBe(await dbActiveCount());
  });

  test('activeCount drops back after seeded students are removed', async () => {
    const before = (await fetchStats()).activeCount;
    await db.query(`DELETE FROM students WHERE email = ANY($1)`, [SEED_EMAILS]);

    const stats = await fetchStats();
    expect(stats.activeCount).toBe(before - 3);
    expect(stats.activeCount).toBe(await dbActiveCount());
  });

  test('stats route is not swallowed by /api/students/:id', async () => {
    // If route ordering regressed, /api/students/stats would hit the :id
    // handler, which parses "stats" as NaN and returns 404/500 — never a
    // JSON body with a numeric activeCount.
    const res = await api.get('/api/students/stats');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.activeCount).toBe('number');
    expect(body).not.toHaveProperty('message');
  });
});
