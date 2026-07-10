-- Seed the 23 vehicles from the demo fleet into production
-- ON CONFLICT (license_plate) DO NOTHING makes this safe to re-run

INSERT INTO vehicles (vehicle_number, license_plate, make, model, year, vehicle_type, color, vin, status, registration_expiry, insurance_expiry, last_maintenance_date, maintenance_notes, fuel_type, transmission, notes)
VALUES
  (NULL, 'FSV9293',  'Toyota',    'Prius',           2019, 'auto', NULL, 'JTDKDTB39K1628397', 'active', '2026-06-30', NULL, NULL, NULL, 'hybrid',   'automatic', 'Assigned: Erik'),
  (NULL, 'FTD7511',  'Toyota',    'RAV4',            2015, 'auto', NULL, '2T3DFREV5FW263338', 'active', '2026-08-31', NULL, NULL, NULL, 'gasoline', 'automatic', 'Assigned: Anatol'),
  (NULL, 'FVC2129',  'Hyundai',   'Ioniq',           2020, 'auto', NULL, 'KMHC75LJ3LU076539', 'active', '2026-04-30', NULL, NULL, NULL, 'hybrid',   'automatic', 'Assigned: Tze'),
  (1,    'FMN6370',  'Toyota',    'Corolla',         2013, 'auto', NULL, '2T1BU4EE6DC116632', 'active', '2026-10-31', NULL, NULL, NULL, 'gasoline', 'automatic', 'Standard'),
  (NULL, 'FVB1468',  'Ford',      'Mustang',         2021, 'auto', NULL, '3FMTK1SS8MMA24900', 'active', '2026-07-31', NULL, NULL, NULL, 'electric', 'automatic', 'Assigned: Oren'),
  (NULL, 'FVC2183',  'Chevrolet', 'Bolt',            2020, 'auto', NULL, '1G1FY6S07L4134836', 'active', '2026-06-30', NULL, NULL, NULL, 'electric', 'automatic', 'Assigned: Richard'),
  (NULL, 'FSV9530',  'Toyota',    'Corolla',         2018, 'auto', NULL, '2T1BURHE3JC970871', 'active', '2026-06-30', NULL, NULL, NULL, 'gasoline', 'automatic', 'Gary / Spare'),
  (NULL, 'FRJ5516',  'Toyota',    'Corolla iM',      2018, 'auto', NULL, 'JTNKARJE8JJ572395', 'active', '2026-08-31', NULL, NULL, NULL, 'gasoline', 'automatic', 'Assigned: Guy'),
  (NULL, 'FVC2463',  'Hyundai',   'Kona',            2023, 'auto', NULL, 'KM8K23AG9PU189407', 'active', '2026-07-31', NULL, NULL, NULL, 'gasoline', 'automatic', 'Assigned: Sean'),
  (NULL, 'FNY6575',  'Toyota',    'Corolla',         2015, 'auto', NULL, '2T1BURHE7FC368305', 'active', '2026-06-30', NULL, NULL, NULL, 'gasoline', 'automatic', 'Assigned: Eli'),
  (NULL, 'FLV7082',  'Toyota',    'Prius',           2015, 'auto', NULL, 'JTDKDTB30F1577264', 'active', '2026-06-30', NULL, NULL, NULL, 'hybrid',   'automatic', 'Assigned: Earl'),
  (NULL, 'FMY7714',  'Toyota',    'Prius',           2016, 'auto', NULL, 'JTDKDTB36G1119441', 'active', '2026-08-31', NULL, NULL, NULL, 'hybrid',   'automatic', 'Assigned: Marcel'),
  (NULL, 'FSY4930',  'Lexus',     'CT200h',          2014, 'auto', NULL, 'JTHKD5BH3E2186415', 'active', '2026-08-31', NULL, NULL, NULL, 'hybrid',   'automatic', 'Assigned: Andrew'),
  (NULL, 'FRF5269',  'Toyota',    'Corolla iM',      2017, 'auto', NULL, 'JTNKARJE7HJ528396', 'active', '2026-07-31', NULL, NULL, NULL, 'gasoline', 'automatic', 'Assigned: Andre'),
  (NULL, 'FJJ3639',  'Toyota',    'Prius',           2018, 'auto', NULL, 'JTDKDTB38J1618071', 'active', '2026-07-31', NULL, NULL, NULL, 'hybrid',   'automatic', 'Assigned: Aqib'),
  (NULL, 'FSF1308',  'Toyota',    'Corolla',         2015, 'auto', NULL, '2T1BURHE4FC309020', 'active', '2026-04-30', NULL, NULL, NULL, 'gasoline', 'automatic', 'Assigned: Uli'),
  (NULL, 'FME5174',  'Toyota',    'Prius',           2018, 'auto', NULL, 'JTDKDTB38J1604445', 'active', '2026-07-31', NULL, NULL, NULL, 'hybrid',   'automatic', 'Assigned: Humi'),
  (NULL, 'FTK5601',  'Toyota',    'Corolla Hatch',   2022, 'auto', NULL, 'JTNK4MBE9N3167133', 'active', '2026-06-01', NULL, NULL, NULL, 'gasoline', 'automatic', 'Assigned: Jack'),
  (NULL, 'FTM5544',  'Toyota',    'Corolla Hatch',   2021, 'auto', NULL, 'JTNK4MBE5M3129686', 'active', '2026-08-31', NULL, NULL, NULL, 'gasoline', 'automatic', 'Assigned: Peter'),
  (NULL, 'FTS8145',  'Toyota',    'Corolla Hatch',   2021, 'auto', NULL, 'JTNK4MBE5M3131275', 'active', '2026-05-01', NULL, NULL, NULL, 'gasoline', 'automatic', 'Assigned: Michael (No Mags)'),
  (2,    'FTL1961',  'Toyota',    'RAV4',            2014, 'auto', NULL, '2T3RFREV5EW180657', 'active', '2026-04-30', NULL, NULL, NULL, 'gasoline', 'automatic', 'Phil / Peter (Moto)'),
  (NULL, 'FWA9081',  'Toyota',    'Corolla Hatch',   2023, 'auto', NULL, 'JTNK4MBE5P3204357', 'active', '2026-10-31', NULL, NULL, NULL, 'gasoline', 'automatic', 'Assigned: Shahid'),
  (23,   'FWC3497',  'Toyota',    'Corolla Hatch',   2021, 'auto', NULL, 'JTNK4MBE9M3115841', 'active', '2026-12-31', NULL, NULL, NULL, 'gasoline', 'automatic', 'Spare')
ON CONFLICT (license_plate) DO NOTHING;
