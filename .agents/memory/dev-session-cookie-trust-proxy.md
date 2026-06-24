---
name: Dev session cookie requires trust proxy behind Replit HTTPS proxy
description: Why admin login "succeeds" but every next request is 401 in the Replit preview, and the trust-proxy fix
---

# "no scraped data found" / instant 401 after a 200 login = missing trust proxy

In the Replit preview the app runs behind an HTTPS proxy that terminates TLS and
forwards plain HTTP to localhost:5000. The dev session cookie is configured
`secure: true` + `sameSite: "none"` (correct for the cross-origin iframe). BUT
express-session will only emit a `secure` cookie when Express believes the
request is HTTPS. Without `app.set("trust proxy", 1)`, `req.secure` is false (it
sees the localhost HTTP hop), so the Set-Cookie is silently dropped.

**Symptom:** `POST /api/auth/login` returns 200 with the user object, but the very
next `GET /api/auth/user` (and every other authed call, e.g.
`GET /api/import/manifest`) returns 401. To a non-technical user this surfaces as
"no scraped data found" because the manifest endpoint is auth-protected.

**Root cause / fix:** `trust proxy` was only set inside `setupAuth` (production
path). Dev never set it. Fix = `app.set("trust proxy", 1)` near the top of
registerRoutes, BEFORE any `session()` middleware, so it applies in both envs.

**Verify like this:** real login over `https://$REPLIT_DEV_DOMAIN` and confirm the
response has `set-cookie: connect.sid=...; Secure; SameSite=None`, then reuse the
cookie jar on `/api/auth/user` (expect 200). Admin default seed password is in
server/init-db.ts.

**Note:** student/instructor flows already worked around third-party-cookie
blocking with Bearer tokens (see server/student-auth.ts); admin still relies on
the session cookie, so the secure-cookie emission must work.
