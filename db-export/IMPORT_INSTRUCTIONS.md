# Production Import Instructions

## Export Summary
- **Locations:** 4
- **Instructors:** 77
- **Students:** 35315 (in 8 batch files)
- **Generated:** 2026-01-13T14:44:42.094Z

## Files to Import (IN ORDER!)

```
01-locations.sql      <- Import FIRST (required by instructors and students)
02-instructors.sql    <- Import SECOND (required by students)
03-students-batch-01.sql           <- Import students
03-students-batch-02.sql           <- Import students
03-students-batch-03.sql           <- Import students
03-students-batch-04.sql           <- Import students
03-students-batch-05.sql           <- Import students
03-students-batch-06.sql           <- Import students
03-students-batch-07.sql           <- Import students
03-students-batch-08.sql           <- Import students
```

## Safety Features
- All student records have `account_status = 'pending_invite'`
- No passwords, tokens, or invite codes are set
- **Students cannot log in until formally invited through the admin portal**
- No password reset emails will be triggered

## Import Steps

### Step 1: Clear existing data (if replacing)
```sql
-- WARNING: This deletes all existing data!
TRUNCATE TABLE students CASCADE;
TRUNCATE TABLE instructors CASCADE;
TRUNCATE TABLE locations CASCADE;
```

### Step 2: Import in order
```bash
# Import locations first
psql $DATABASE_URL -f 01-locations.sql

# Import instructors second
psql $DATABASE_URL -f 02-instructors.sql

# Import students (all batch files)
psql $DATABASE_URL -f 03-students-batch-01.sql
psql $DATABASE_URL -f 03-students-batch-02.sql
psql $DATABASE_URL -f 03-students-batch-03.sql
psql $DATABASE_URL -f 03-students-batch-04.sql
psql $DATABASE_URL -f 03-students-batch-05.sql
psql $DATABASE_URL -f 03-students-batch-06.sql
psql $DATABASE_URL -f 03-students-batch-07.sql
psql $DATABASE_URL -f 03-students-batch-08.sql
```

### Step 3: Verify import
```sql
SELECT 'locations' as table_name, COUNT(*) as count FROM locations
UNION ALL
SELECT 'instructors', COUNT(*) FROM instructors
UNION ALL
SELECT 'students', COUNT(*) FROM students;
```

## After Import
1. Students will have `account_status = 'pending_invite'`
2. Use the admin portal to send invitations when ready
3. Students will receive an email with a link to set their password
