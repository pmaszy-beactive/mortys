---
name: Registration authentication flow
description: Security and product invariants for OTP verification, password creation, onboarding access, and automatic login.
---

Registration requires email OTP verification before password creation. A successful OTP exchange issues a high-entropy registration capability stored only in session storage; onboarding reads and mutations require that capability.

**Why:** numeric registration IDs are guessable, and returning an auto-login token from an unprotected completion endpoint would expose student accounts. The old random-placeholder password plus activation email also created a confusing second password flow.

**How to apply:** require an explicitly set password before completion, never put the capability in a URL, never send activation/reset email as part of successful registration, and return the normal student authentication token only after capability-protected completion.

Completion must remain idempotent: retries may return the already-created student session but must never create a duplicate account. Forgot/reset password remains a separate recovery flow.