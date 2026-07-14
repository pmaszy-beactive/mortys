-- Recurring class series tracking: classes generated together via bulk
-- "Generate Schedule" share a series_id so they can be edited/deleted as a
-- group. Individually edited classes are flagged detached so series-wide
-- edits don't clobber them. Guarded so this is a no-op where they exist.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS series_id text;--> statement-breakpoint
ALTER TABLE classes ADD COLUMN IF NOT EXISTS detached_from_series boolean NOT NULL DEFAULT false;
