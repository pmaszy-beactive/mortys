---
name: Meeting bot dispatch safety
description: Safety rules for preventing duplicate paid Backbone Meeting Bot dispatches.
---

Treat a timed-out or network-failed Backbone bot dispatch as uncertain, not failed. Do not automatically retry it or allow a manual retry until staff verify whether Backbone created the meeting. Serialize dispatch claims durably and invalidate stale queued work with a generation token.

**Why:** Backbone's Meeting Bot API does not document an idempotency key. Retrying after an ambiguous upstream outcome can send multiple paid bots into the same Zoom class.

**How to apply:** Any dispatch path, retry control, or job-queue change must preserve one-at-a-time claims, reject stale generations before the external call, and block retries while the prior result is uncertain.