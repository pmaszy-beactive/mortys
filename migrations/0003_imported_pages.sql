CREATE TABLE IF NOT EXISTS "imported_pages" (
"id" serial PRIMARY KEY NOT NULL,
"url_hash" text NOT NULL,
"content_hash" text NOT NULL,
"page_type" text NOT NULL,
"url" text,
"student_legacy_id" text,
"status" text DEFAULT 'imported' NOT NULL,
"created_count" integer DEFAULT 0 NOT NULL,
"updated_count" integer DEFAULT 0 NOT NULL,
"skipped_count" integer DEFAULT 0 NOT NULL,
"message" text,
"imported_at" timestamp DEFAULT now() NOT NULL,
CONSTRAINT "imported_pages_url_hash_unique" UNIQUE("url_hash")
);
