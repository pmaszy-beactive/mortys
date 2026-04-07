ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_password_token" varchar UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_password_expiry" timestamp;
