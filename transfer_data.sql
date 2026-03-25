-- Clear target database first
TRUNCATE TABLE IF EXISTS students, instructors, classes, communications CASCADE;

-- Insert instructors first (referenced by students)
INSERT INTO instructors (first_name, last_name, email, phone, specializations, license_number, status) VALUES 
('Mike', 'Johnson', 'mike.johnson@mortys.com', '(604) 555-1001', 'Auto, Road Test Prep', 'LIC-BC-001', 'active'),
('Sarah', 'Williams', 'sarah.williams@mortys.com', '(604) 555-1002', 'Motorcycle, Class 6', 'LIC-BC-002', 'active'),
('David', 'Brown', 'david.brown@mortys.com', '(604) 555-1003', 'Auto, Defensive Driving', 'LIC-BC-003', 'active'),
('Jennifer', 'Garcia', 'jennifer.garcia@mortys.com', '(604) 555-1004', 'Auto, Senior Training', 'LIC-BC-004', 'active'),
('Robert', 'Martinez', 'robert.martinez@mortys.com', '(604) 555-1005', 'Motorcycle, Scooter', 'LIC-BC-005', 'active'),
('Lisa', 'Anderson', 'lisa.anderson@mortys.com', '(604) 555-1006', 'Auto, Commercial', 'LIC-BC-006', 'active');

-- Insert students with all development data
INSERT INTO students (first_name, last_name, email, phone, home_phone, date_of_birth, address, city, postal_code, province, course_type, status, progress, instructor_id, favorite_instructor_id, attestation_number, emergency_contact, emergency_phone, enrollment_date, primary_language) VALUES 
('Koshila', 'Warapperuma', 'koshilasandanu2@gmail.com', '(604) 555-2001', NULL, '1995-01-01', '123 Main Street', 'Vancouver', 'V5K 1A1', 'BC', 'moto', 'completed', 100, 2, 2, 'ATT-2024-KOSHILA', 'Emergency Contact', '(604) 555-2002', '2024-01-15', 'English'),
('John', 'Smith', 'john.smith@email.com', '(604) 555-2003', '(604) 555-2004', '1992-03-15', '456 Oak Avenue', 'Burnaby', 'V5H 2B2', 'BC', 'auto', 'active', 75, 1, 1, 'ATT-2024-001', 'Jane Smith', '(604) 555-2005', '2024-02-01', 'English'),
('Emma', 'Davis', 'emma.davis@email.com', '(604) 555-2006', NULL, '1998-07-22', '789 Pine Street', 'Richmond', 'V6X 3C3', 'BC', 'auto', 'active', 60, 3, 3, 'ATT-2024-002', 'Robert Davis', '(604) 555-2007', '2024-02-15', 'English'),
('Sarah', 'Johnson', 'sarah.johnson@example.com', '(604) 555-2008', '(604) 555-2009', '1995-03-15', '123 Elm Street', 'Vancouver', 'V5K 1A1', 'BC', 'auto', 'active', 75, 1, 4, 'ATT-2024-003', 'John Johnson', '(604) 555-2010', '2024-01-20', 'English'),
('Mike', 'Chen', 'mike.chen@example.com', '(604) 555-2011', NULL, '1992-07-22', '456 Maple Avenue', 'Burnaby', 'V5H 2B2', 'BC', 'moto', 'active', 40, 2, 2, 'ATT-2024-004', 'Lisa Chen', '(604) 555-2012', '2024-03-01', 'English'),
('Alex', 'Rodriguez', 'alex.rodriguez@example.com', '(604) 555-2013', '(604) 555-2014', '1993-09-10', '789 Cedar Road', 'Richmond', 'V6X 3C3', 'BC', 'auto', 'active', 85, 4, 4, 'ATT-2024-005', 'Carmen Rodriguez', '(604) 555-2015', '2024-02-10', 'Spanish'),
('Emily', 'Wilson', 'emily.wilson@email.com', '(604) 555-2016', NULL, '1997-12-05', '321 Birch Street', 'Surrey', 'V3T 4D4', 'BC', 'auto', 'completed', 100, 5, 5, 'ATT-2024-006', 'Mark Wilson', '(604) 555-2017', '2024-01-10', 'English'),
('James', 'Brown', 'james.brown@email.com', '(604) 555-2018', '(604) 555-2019', '1994-06-18', '654 Spruce Avenue', 'Coquitlam', 'V3J 5E5', 'BC', 'moto', 'active', 30, 5, 2, 'ATT-2024-007', 'Susan Brown', '(604) 555-2020', '2024-03-15', 'English'),
('Lisa', 'Martinez', 'lisa.martinez@email.com', '(604) 555-2021', NULL, '1996-11-30', '987 Fir Lane', 'Delta', 'V4K 6F6', 'BC', 'auto', 'active', 90, 6, 6, 'ATT-2024-008', 'Carlos Martinez', '(604) 555-2022', '2024-01-25', 'Spanish'),
('David', 'Taylor', 'david.taylor@email.com', '(604) 555-2023', '(604) 555-2024', '1991-04-12', '159 Hemlock Drive', 'North Vancouver', 'V7M 7G7', 'BC', 'auto', 'active', 45, 3, 1, 'ATT-2024-009', 'Michelle Taylor', '(604) 555-2025', '2024-02-20', 'English'),
('Jessica', 'Anderson', 'jessica.anderson@email.com', '(604) 555-2026', NULL, '1999-08-25', '753 Poplar Way', 'West Vancouver', 'V7V 8H8', 'BC', 'moto', 'active', 65, 5, 5, 'ATT-2024-010', 'Kevin Anderson', '(604) 555-2027', '2024-03-10', 'English'),
('Michael', 'Thomas', 'michael.thomas@email.com', '(604) 555-2028', '(604) 555-2029', '1990-01-14', '951 Willow Street', 'Langley', 'V2Y 9I9', 'BC', 'auto', 'active', 55, 4, 4, 'ATT-2024-011', 'Rachel Thomas', '(604) 555-2030', '2024-02-25', 'English'),
('Amanda', 'Clark', 'amanda.clark@email.com', '(604) 555-2031', NULL, '1996-05-08', '147 Cypress Avenue', 'Richmond', 'V6Y 2A2', 'BC', 'auto', 'active', 35, 1, 3, 'ATT-2024-012', 'Paul Clark', '(604) 555-2032', '2024-03-20', 'English'),
('Ryan', 'Lewis', 'ryan.lewis@email.com', '(604) 555-2033', '(604) 555-2034', '1993-10-17', '258 Aspen Road', 'Burnaby', 'V5G 3B3', 'BC', 'moto', 'active', 70, 2, 2, 'ATT-2024-013', 'Sharon Lewis', '(604) 555-2035', '2024-01-30', 'English'),
('Nicole', 'Walker', 'nicole.walker@email.com', '(604) 555-2036', NULL, '1994-12-22', '369 Dogwood Street', 'Vancouver', 'V5L 4C4', 'BC', 'auto', 'active', 80, 6, 6, 'ATT-2024-014', 'Tom Walker', '(604) 555-2037', '2024-02-05', 'French');

-- Insert classes
INSERT INTO classes (course_type, class_number, date, time, duration, instructor_id, max_students, status, zoom_link, has_test) VALUES 
('auto', 1, '2025-01-22', '09:00', 120, 1, 15, 'scheduled', 'https://zoom.us/j/auto-class-001', false),
('auto', 2, '2025-01-23', '10:30', 120, 3, 15, 'scheduled', 'https://zoom.us/j/auto-class-002', true),
('moto', 1, '2025-01-24', '13:00', 90, 2, 8, 'scheduled', 'https://zoom.us/j/moto-class-001', false),
('auto', 3, '2025-01-25', '11:00', 120, 4, 15, 'scheduled', 'https://zoom.us/j/auto-class-003', false),
('moto', 2, '2025-01-26', '15:30', 90, 5, 8, 'scheduled', 'https://zoom.us/j/moto-class-002', true),
('auto', 4, '2025-01-29', '08:30', 120, 6, 15, 'scheduled', 'https://zoom.us/j/auto-class-004', false),
('auto', 5, '2025-01-30', '14:00', 120, 1, 15, 'scheduled', 'https://zoom.us/j/auto-class-005', true),
('moto', 3, '2025-01-31', '16:00', 90, 2, 8, 'scheduled', 'https://zoom.us/j/moto-class-003', false),
('auto', 6, '2025-02-01', '12:00', 120, 3, 15, 'scheduled', 'https://zoom.us/j/auto-class-006', false),
('moto', 4, '2025-02-02', '17:00', 90, 5, 8, 'scheduled', 'https://zoom.us/j/moto-class-004', true);
