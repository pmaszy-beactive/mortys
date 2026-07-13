---
name: Dev auth testing
description: How to test authenticated admin/student endpoints with curl in this project
---
The Express session cookie is set with the Secure flag even in development, so curl over `http://localhost:5000` logs in (200) but never stores/sends the cookie — subsequent requests get 401.

**Why:** trust-proxy + secure cookies are enabled for the Replit HTTPS proxy.

**How to apply:** test authenticated endpoints via `https://$REPLIT_DEV_DOMAIN` with a cookie jar (`curl -c jar` on login, `-b jar` after). Admin login is `POST /api/auth/login` with `{username, password}` (username = email).

No dev admin password is known. Create a throwaway admin instead: generate a hash with `node -e "console.log(require('bcryptjs').hashSync('pw',10))"` (bcryptjs, not bcrypt, is what resolves at repo root), INSERT into `users` (email, role='admin', password), log in, then DELETE the user (and any test rows) when done.

**Automated API tests:** Playwright is set up (playwright.config.ts, e2e/). For authenticated API tests, use `playwright.request.newContext({ baseURL: https://REPLIT_DEV_DOMAIN })` (not localhost, same Secure-cookie reason), create a throwaway admin via pg + bcryptjs in beforeAll, log in via POST /api/auth/login, and clean up rows + user in afterAll. See e2e/course-start-date-guards.spec.ts as the reference pattern.
