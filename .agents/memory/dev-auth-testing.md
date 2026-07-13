---
name: Dev auth testing
description: How to test authenticated admin/student endpoints with curl in this project
---
The Express session cookie is set with the Secure flag even in development, so curl over `http://localhost:5000` logs in (200) but never stores/sends the cookie — subsequent requests get 401.

**Why:** trust-proxy + secure cookies are enabled for the Replit HTTPS proxy.

**How to apply:** test authenticated endpoints via `https://$REPLIT_DEV_DOMAIN` with a cookie jar (`curl -c jar` on login, `-b jar` after). Admin login is `POST /api/auth/login` with `{username, password}` (username = email).
