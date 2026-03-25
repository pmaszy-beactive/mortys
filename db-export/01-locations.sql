-- Locations Export
-- Generated: 2026-01-13T14:44:40.223Z

INSERT INTO locations (id, name, address, city, province, postal_code, phone, email, is_active) VALUES
(1, 'New Location Name', 'New Address', 'New City', 'New Province', 'N1N 1N1', '(111) 222-3333', 'new@example.com', TRUE),
(2, 'Dollard-des-Ormeaux Branch', '4000 Sources Blvd, Dollard-Des-Ormeaux, QC H9B 2C8', 'Dollard-des-Ormeaux', 'Quebec', 'H9B 2C8', '(514) 555-0102', 'ddo@mortys.com', TRUE),
(11, 'Downtown', 'Main Street', 'Calgary', 'Alberta', 'T2B 2GH', '', '', TRUE),
(3, 'Laval Branch', '1500 Blvd. Chomedey, Laval, QC H7V 2X2', 'Laval', 'Quebec', 'H7V 2X2', '(450) 555-0103', 'laval@mortys.com', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Reset sequence
SELECT setval('locations_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM locations), false);
