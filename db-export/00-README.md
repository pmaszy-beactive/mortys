# Database Export Files for Production Migration

## Data Summary
Your development database contains:
- **Users**: 5 records
- **Locations**: 4 records
- **School Permits**: 9 records
- **Vehicles**: 127 records
- **Instructors**: 77 records
- **Students**: 13,088 records (TOO LARGE for SQL export)
- **Classes**: 1,822 records (TOO LARGE for SQL export)
- **Contracts**: 40 records
- **Evaluations**: 68 records

## Files Provided (Small Tables)
Run these in order in the production database console:

1. `01-users.sql` - Admin users
2. `02-locations.sql` - Branch locations
3. `03-school-permits.sql` - Permit configurations
4. `04-vehicles.sql` - Vehicle fleet

## For Large Tables (Students, Classes, Instructors)

The students table has 13,000+ records which is too large to export as SQL statements. 

### Recommended Options:

**Option 1: Contact Replit Support**
Email support@replit.com and request a database clone from development to production. This is the safest and fastest method for large datasets.

**Option 2: Use Database Panel Export**
1. Go to the **Database** tab in Replit
2. Select your **Development** database
3. Click on each table (students, classes, instructors)
4. Export as CSV
5. Switch to **Production** database
6. Import the CSV files

**Option 3: Selective Migration**
If you only need recent/active data, I can generate filtered exports:
- Only active students
- Only upcoming classes
- Only current instructors

## Import Order (Important!)
When importing to production, run in this order to respect foreign key relationships:

1. users
2. locations
3. school_permits
4. vehicles
5. instructors
6. students
7. classes
8. class_enrollments
9. contracts
10. evaluations
11. Other dependent tables

## After Import
Reset all sequences by running:
```sql
SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id::int), 0) FROM users WHERE id ~ '^\d+$'));
SELECT setval('locations_id_seq', (SELECT MAX(id) FROM locations));
SELECT setval('school_permits_id_seq', (SELECT MAX(id) FROM school_permits));
SELECT setval('vehicles_id_seq', (SELECT MAX(id) FROM vehicles));
SELECT setval('instructors_id_seq', (SELECT MAX(id) FROM instructors));
SELECT setval('students_id_seq', (SELECT MAX(id) FROM students));
SELECT setval('classes_id_seq', (SELECT MAX(id) FROM classes));
```
