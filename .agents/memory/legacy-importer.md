---
name: Legacy JSON importer & gap-analysis report
description: Non-obvious facts about server/services/json-importer.ts and its separate gap-analysis mirror, learned from diagnosing "dropped data" reports.
---

# Gap-analysis report mirrors the importer — and can drift

`server/services/import-gap-analysis.ts` re-implements the importer's parsing logic
in its own helpers (date detection, attestation/reservation classification). It is a
SEPARATE copy, not shared code, so it can diverge from `json-importer.ts`.

**Why:** A "Gap Analysis" report once claimed ~96% of zoom + online-test files were
empty and 100% of attestations were missing — all false. The real importer was fine;
the report's `looksLikeDate` had a bug.

**How to apply:** Before "fixing" a parser because the report says data is empty,
verify the claim against the real on-disk JSON (e.g. quick Python over `import-seed/`).
The report can cry wolf. If you change a parser, update the matching mirror helper in
the gap-analysis module in lockstep or the report goes stale.

# Where the data actually lives (non-obvious source shapes)

- **Attestation numbers** are NOT in `label_values` (always empty on those pages).
  The SAAQ attestation page is flat `text_content` like
  `03203701 A-106 Denis, ...` or, when a permit code leads,
  `D200404040106 03304400 L-020 Dissou, ...`. The attestation number is the first
  pure-numeric 6–9 digit token among the first ~3 whitespace tokens.
- **Reservation pages are FUTURE open bookable slots, not attended lessons** — the
  action column is always "Reserve" and every date is on/after the scrape date. The
  activity (Theory N vs Driving/practical) is in the page HEADING
  (`"Name - reserve Theory 3"`), NOT in the table rows (rows are only
  Location/Date/Time/Reserve). Per user decision these import as lesson records with
  `status="scheduled"`, lessonType from the heading (theory→120min, else driving→60min).
  Do not record them as "completed" — that invents attendance history.

# Genuinely unfixable empties (don't chase these)

Some "empty" pages have no extractable data at source: login-gated online-test pages
("Active test is only available when logged in as a student"), headingless zoom pages,
admin nav/report registration pages with no `studentUserId` links, and coursetransfer
stubs for new students with no phase progress.
