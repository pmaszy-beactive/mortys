-- Locations Export
-- Run this in production database console

INSERT INTO locations (id, name, address, city, province, postal_code, country, phone, email, location_code, is_active, is_primary, capacity, facilities, operating_hours, notes, created_at, updated_at) VALUES (1, 'New Location Name', 'New Address', 'New City', 'New Province', 'N1N 1N1', 'New Country', '(111) 222-3333', 'new@example.com', 'NLN', true, false, NULL, NULL, '{}', 'New notes for the location', '2025-07-27 09:12:32.104', '2025-09-16 18:58:55.277');
INSERT INTO locations (id, name, address, city, province, postal_code, country, phone, email, location_code, is_active, is_primary, capacity, facilities, operating_hours, notes, created_at, updated_at) VALUES (2, 'Dollard-des-Ormeaux Branch', '4000 Sources Blvd, Dollard-Des-Ormeaux, QC H9B 2C8', 'Dollard-des-Ormeaux', 'Quebec', 'H9B 2C8', 'Canada', '(514) 555-0102', 'ddo@mortys.com', '', true, false, NULL, NULL, '{"Monday":{"closed":false}}', '', '2025-07-27 09:12:32.131', '2025-10-24 19:06:27.45');
INSERT INTO locations (id, name, address, city, province, postal_code, country, phone, email, location_code, is_active, is_primary, capacity, facilities, operating_hours, notes, created_at, updated_at) VALUES (11, 'Downtown', 'Main Street', 'Calgary', 'Alberta', 'T2B 2GH', 'Canada', '', '', '', true, false, NULL, NULL, '{}', '', '2025-11-10 20:16:45.93381', '2025-11-10 20:17:20.008');
INSERT INTO locations (id, name, address, city, province, postal_code, country, phone, email, location_code, is_active, is_primary, capacity, facilities, operating_hours, notes, created_at, updated_at) VALUES (3, 'Laval Branch', '1500 Blvd. Chomedey, Laval, QC H7V 2X2', 'Laval', 'Quebec', 'H7V 2X2', 'Canada', '(450) 555-0103', 'laval@mortys.com', '', true, true, NULL, NULL, '{"Sunday":{"closed":true}}', '', '2025-07-27 09:12:32.153', '2025-11-10 20:23:59.313');

-- Reset sequence
SELECT setval('locations_id_seq', (SELECT MAX(id) FROM locations));
