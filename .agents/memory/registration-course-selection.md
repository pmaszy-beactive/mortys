---
name: Registration course selection
description: Availability contract for first-class options shown during public student registration.
---

Only show a registration start-date option when it resolves to a future, scheduled, non-extra Theory 1 class for the same course and time with an open seat.

**Why:** start-date metadata can outlive the class it originally represented. Advertising that stale row lets a student select an option that auto-enrollment cannot honor and triggers a manual-enrollment alert.

**How to apply:** filter public choices against the live class and enrollment count, not only the start-date row. Do not use the app-wide infinite query cache for this list: refresh when Course Selection opens, while it remains open, and when focus returns. Revalidate the selection when registration starts, and keep final enrollment race-safe in the booking transaction.