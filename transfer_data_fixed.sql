-- Check data counts in target database
SELECT 
  (SELECT COUNT(*) FROM students) as students_count,
  (SELECT COUNT(*) FROM instructors) as instructors_count,
  (SELECT COUNT(*) FROM classes) as classes_count;
