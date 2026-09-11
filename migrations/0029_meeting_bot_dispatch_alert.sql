-- A nullable unique key lets operational notification producers make event
-- creation idempotent without affecting existing notification types.
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "dedupe_key" text;

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_key_unique"
  ON "notifications" ("dedupe_key");