-- Disable the public, hard-coded credentials previously assigned to the
-- dedicated demo student and instructor. Keep the records and related demo
-- data intact; an authorized password reset can establish a new credential.
UPDATE "students"
SET "password" = NULL
WHERE lower("email") = 'demo.student@example.com';

UPDATE "instructors"
SET "password" = NULL
WHERE lower("email") = 'demo.instructor@example.com';