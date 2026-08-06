---
name: Registration card capture
description: Sign-up card step conventions — capability token, SetupIntent, transfer at onboarding completion, booking gate.
---

- Pre-verification registration endpoints are unauthenticated and registration IDs are sequential. Any endpoint keyed on a registrationId that can mutate money-adjacent state MUST require the high-entropy `cardCaptureToken` stored in `onboardingData` and returned only in the register response (constant-time compare).
  **Why:** code review flagged card-poisoning via ID enumeration on the sign-up card endpoints.
  **How to apply:** any new pre-account endpoint (documents, payments, etc.) keyed by registrationId needs the same capability-token pattern.
- Sign-up card flow: Stripe customer + SetupIntent (`payment_method_types: ["card"]` — omitting it breaks server/test confirm with "return_url required") stashed in `onboardingData.stripeCustomerId` / `pendingCard`; transferred atomically (single DB tx) to the student at complete-onboarding. Cosmetic Stripe customer update is non-blocking.
- Booking gate: classes with classNumber > 1 require a saved payment method; enforced server-side in the book endpoint (`policyViolation: "card_required"`), client maps it to a card drawer and resumes the booking.
- Booking prereq engine counts a class as completed only when the enrollment has `attendance_status = 'attended'` (not 'present') and is not cancelled.
