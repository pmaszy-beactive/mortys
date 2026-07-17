import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * API regression tests for booking policy create/edit.
 *
 * Booking policy create/edit was completely broken (500 on every create with
 * dates); these tests pin the fixed behavior:
 *  - POST /api/booking-policies with ISO date strings (effectiveFrom/effectiveTo)
 *  - POST with null dates
 *  - Partial PATCH omitting dates must NOT null out the stored dates
 *  - PATCH with changeReason bumps the version and records a version row
 *  - 400 on invalid dates / invalid values
 *
 * Runs against the live dev server with an authenticated admin session.
 * The session cookie is Secure even in dev, so requests must go through the
 * HTTPS Replit domain rather than http://localhost:5000.
 *
 * Everything created here (policies, version rows, the throwaway admin) is
 * deleted afterwards.
 */

const TEST_ADMIN_EMAIL = 'e2e-booking-policy-admin@test.local';
const TEST_ADMIN_PASSWORD = 'e2e-policy-test-pw-1';
const POLICY_NAME_PREFIX = 'E2E Policy Save Test';

const baseURL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : 'http://localhost:5000';

let api: APIRequestContext;
let db: Client;
const createdIds: number[] = [];

async function createPolicy(body: Record<string, unknown>) {
  return api.post('/api/booking-policies', { data: body });
}

test.describe.serial('Booking policy save regressions', () => {
  test.beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    const hash = bcrypt.hashSync(TEST_ADMIN_PASSWORD, 10);
    await db.query(
      `INSERT INTO users (email, role, password, first_name, last_name)
       VALUES ($1, 'admin', $2, 'E2E', 'PolicyTest')
       ON CONFLICT (email) DO UPDATE SET password = $2, role = 'admin'`,
      [TEST_ADMIN_EMAIL, hash],
    );

    // Remove leftovers from previous runs.
    await db.query(
      `DELETE FROM booking_policy_versions WHERE policy_id IN
         (SELECT id FROM booking_policies WHERE name LIKE $1)`,
      [`${POLICY_NAME_PREFIX}%`],
    );
    await db.query(`DELETE FROM booking_policies WHERE name LIKE $1`, [`${POLICY_NAME_PREFIX}%`]);

    api = await playwrightRequest.newContext({ baseURL });
    const login = await api.post('/api/auth/login', {
      data: { username: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
    });
    expect(login.ok(), `admin login failed: ${login.status()} ${await login.text()}`).toBe(true);
  });

  test.afterAll(async () => {
    if (db) {
      await db.query(
        `DELETE FROM booking_policy_versions WHERE policy_id IN
           (SELECT id FROM booking_policies WHERE name LIKE $1)`,
        [`${POLICY_NAME_PREFIX}%`],
      );
      await db.query(`DELETE FROM booking_policies WHERE name LIKE $1`, [`${POLICY_NAME_PREFIX}%`]);
      await db.query(`DELETE FROM users WHERE email = $1`, [TEST_ADMIN_EMAIL]);
      await db.end();
    }
    if (api) await api.dispose();
  });

  let datedPolicyId: number;

  test('POST with ISO date strings creates the policy (201)', async () => {
    const res = await createPolicy({
      name: `${POLICY_NAME_PREFIX} dated`,
      policyType: 'max_bookings_per_day',
      courseType: 'auto',
      classType: 'driving',
      value: 2,
      isActive: true,
      description: 'e2e dated policy',
      effectiveFrom: '2035-01-01T00:00:00.000Z',
      effectiveTo: '2035-12-31T00:00:00.000Z',
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    datedPolicyId = body.id;
    createdIds.push(datedPolicyId);
    expect(body.name).toBe(`${POLICY_NAME_PREFIX} dated`);
    expect(body.value).toBe(2);
    expect(new Date(body.effectiveFrom).toISOString()).toBe('2035-01-01T00:00:00.000Z');
    expect(new Date(body.effectiveTo).toISOString()).toBe('2035-12-31T00:00:00.000Z');
    expect(body.version).toBe(1);
  });

  test('POST with null dates creates the policy (201)', async () => {
    const res = await createPolicy({
      name: `${POLICY_NAME_PREFIX} null dates`,
      policyType: 'max_duration',
      value: 120,
      isActive: true,
      effectiveFrom: null,
      effectiveTo: null,
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    createdIds.push(body.id);
    expect(body.effectiveFrom).toBeNull();
    expect(body.effectiveTo).toBeNull();
  });

  test('partial PATCH omitting dates does not null out stored dates', async () => {
    const res = await api.patch(`/api/booking-policies/${datedPolicyId}`, {
      data: { value: 3 },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.value).toBe(3);
    expect(body.effectiveFrom).not.toBeNull();
    expect(body.effectiveTo).not.toBeNull();
    expect(new Date(body.effectiveFrom).toISOString()).toBe('2035-01-01T00:00:00.000Z');
    expect(new Date(body.effectiveTo).toISOString()).toBe('2035-12-31T00:00:00.000Z');
    // No changeReason → no version bump.
    expect(body.version).toBe(1);
  });

  test('PATCH with changeReason bumps the version and records history', async () => {
    const res = await api.patch(`/api/booking-policies/${datedPolicyId}`, {
      data: {
        value: 4,
        effectiveTo: '2036-06-30T00:00:00.000Z',
        changeReason: 'e2e version bump test',
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.value).toBe(4);
    expect(body.version).toBe(2);
    expect(new Date(body.effectiveTo).toISOString()).toBe('2036-06-30T00:00:00.000Z');

    const versionsRes = await api.get(`/api/booking-policies/${datedPolicyId}/versions`);
    expect(versionsRes.ok()).toBe(true);
    const versions = await versionsRes.json();
    expect(versions.length).toBe(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].value).toBe(3);
    expect(versions[0].changeReason).toBe('e2e version bump test');
  });

  test('POST with an invalid date returns 400', async () => {
    const res = await createPolicy({
      name: `${POLICY_NAME_PREFIX} bad date`,
      policyType: 'max_duration',
      value: 60,
      isActive: true,
      effectiveFrom: 'not-a-date',
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.errors).toHaveProperty('effectiveFrom');
  });

  test('POST with an invalid value returns 400', async () => {
    const res = await createPolicy({
      name: `${POLICY_NAME_PREFIX} bad value`,
      policyType: 'max_duration',
      value: 'not-a-number',
      isActive: true,
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.errors).toHaveProperty('value');
  });

  test('PATCH with an invalid date returns 400 and leaves the policy unchanged', async () => {
    const res = await api.patch(`/api/booking-policies/${datedPolicyId}`, {
      data: { effectiveTo: 'garbage' },
    });
    expect(res.status()).toBe(400);

    const check = await api.get(`/api/booking-policies/${datedPolicyId}`);
    const body = await check.json();
    expect(body.value).toBe(4);
    expect(new Date(body.effectiveTo).toISOString()).toBe('2036-06-30T00:00:00.000Z');
  });
});
