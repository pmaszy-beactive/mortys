ALTER TABLE "classes" ADD COLUMN IF NOT EXISTS "legacy_class_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_classes_legacy_class_id" ON "classes" ("legacy_class_id");
