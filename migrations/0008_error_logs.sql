-- Server error logs: every HTTP 500+ response is recorded here with the
-- exception, stack trace, logged-in user and sanitized request context so
-- admins can review and reproduce failures. Entries auto-delete after 30
-- days via an in-app daily cleanup. Guarded so this is a no-op where it exists.
CREATE TABLE IF NOT EXISTS error_logs (
  id serial PRIMARY KEY,
  status_code integer NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  message text NOT NULL,
  stack text,
  user_id text,
  user_email text,
  request_context json,
  created_at timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON error_logs (created_at);
