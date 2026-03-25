-- School Permits Export
-- Run this in production database console

INSERT INTO school_permits (id, permit_code, location, course_types, start_number, end_number, total_numbers, available_numbers, is_active, created_at, updated_at) VALUES (1, 'L-020', 'Montreal Downtown', '["auto"]', 3276842, 3277041, 200, 180, true, '2025-09-05 12:37:22.507046', '2025-09-05 12:37:22.507046');
INSERT INTO school_permits (id, permit_code, location, course_types, start_number, end_number, total_numbers, available_numbers, is_active, created_at, updated_at) VALUES (2, 'L-390', 'Montreal Downtown', '["moto", "scooter"]', 4150001, 4150100, 100, 95, true, '2025-09-05 12:37:22.507046', '2025-09-05 12:37:22.507046');
INSERT INTO school_permits (id, permit_code, location, course_types, start_number, end_number, total_numbers, available_numbers, is_active, created_at, updated_at) VALUES (5, 'L-022', 'Laval', '["auto"]', 3277242, 3277441, 200, 165, true, '2025-09-05 12:37:22.507046', '2025-09-05 12:37:22.507046');
INSERT INTO school_permits (id, permit_code, location, course_types, start_number, end_number, total_numbers, available_numbers, is_active, created_at, updated_at) VALUES (6, 'L-023', 'Kirkland', '["auto"]', 3277442, 3277541, 100, 92, true, '2025-09-05 12:37:22.507046', '2025-09-05 12:37:22.507046');
INSERT INTO school_permits (id, permit_code, location, course_types, start_number, end_number, total_numbers, available_numbers, is_active, created_at, updated_at) VALUES (7, 'L-392', 'Kirkland', '["scooter"]', 4150151, 4150200, 50, 45, true, '2025-09-05 12:37:22.507046', '2025-09-05 12:37:22.507046');
INSERT INTO school_permits (id, permit_code, location, course_types, start_number, end_number, total_numbers, available_numbers, is_active, created_at, updated_at) VALUES (8, 'L-024', 'Vaudreuil', '["auto"]', 3277542, 3277641, 100, 88, true, '2025-09-05 12:37:22.507046', '2025-09-05 12:37:22.507046');
INSERT INTO school_permits (id, permit_code, location, course_types, start_number, end_number, total_numbers, available_numbers, is_active, created_at, updated_at) VALUES (9, 'L-025', 'Cote St. Luc', '["auto"]', 3277642, 3277741, 100, 85, true, '2025-09-05 12:37:22.507046', '2025-09-05 12:37:22.507046');
INSERT INTO school_permits (id, permit_code, location, course_types, start_number, end_number, total_numbers, available_numbers, is_active, created_at, updated_at) VALUES (4, 'L-391', 'New Location Name', '["moto","scooter"]', 4150101, 4150150, 50, 48, true, '2025-09-05 12:37:22.507046', '2025-10-24 19:16:33.121');
INSERT INTO school_permits (id, permit_code, location, course_types, start_number, end_number, total_numbers, available_numbers, is_active, created_at, updated_at) VALUES (3, 'L-021', 'Laval Branch', '["auto"]', 3277042, 3277241, 200, 175, true, '2025-09-05 12:37:22.507046', '2025-11-10 20:14:52.909');

-- Reset sequence
SELECT setval('school_permits_id_seq', (SELECT MAX(id) FROM school_permits));
