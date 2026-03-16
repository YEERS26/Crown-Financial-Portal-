-- ================================================================
-- The Crown Financial Portal v3 — Neon Postgres Schema
-- Run this in: Neon Dashboard → SQL Editor → Run query
-- ================================================================

-- TABLE 1: payment_definitions (master recurring payments)
CREATE TABLE IF NOT EXISTS payment_definitions (
  id            SERIAL PRIMARY KEY,
  name          TEXT          NOT NULL,
  category      TEXT          NOT NULL,
  freq          TEXT          NOT NULL CHECK (freq IN ('Weekly','Monthly','Yearly')),
  weekday       TEXT,
  day_of_month  INT,
  next_date     TEXT,
  amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
  credit_bal    NUMERIC(10,2),
  credit_max    NUMERIC(10,2),
  priority      TEXT          NOT NULL DEFAULT '' CHECK (priority IN ('','Low','High','Urgent')),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- TABLE 2: payment_instances (individual occurrences)
CREATE TABLE IF NOT EXISTS payment_instances (
  id          SERIAL PRIMARY KEY,
  def_id      INT           NOT NULL REFERENCES payment_definitions(id) ON DELETE CASCADE,
  date        TEXT          NOT NULL,
  amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  status      TEXT          NOT NULL DEFAULT '' CHECK (status IN ('','Paid','To be paid')),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(def_id, date)
);

-- SEED: payment_definitions
INSERT INTO payment_definitions (id,name,category,freq,weekday,day_of_month,next_date,amount,credit_bal,credit_max,priority) VALUES
  (1,  'Mandy''s',                     'Staff & Labour',                'Weekly',  'Mon', NULL, NULL,         285.00,   NULL,      NULL,   'High'),
  (2,  'East Riding Council',           'Property & Premises Costs',    'Yearly',  NULL,  NULL, '2026-06-06', 180.00,   180.00,    180.00, 'Urgent'),
  (3,  'TV Licence',                    'Licences & Compliance',        'Yearly',  NULL,  NULL, '2026-06-05', 174.00,   174.00,    174.00, 'Low'),
  (4,  'ICO',                           'Licences & Compliance',        'Yearly',  NULL,  NULL, '2026-06-06', 47.00,    47.00,     47.00,  ''),
  (5,  'Coors Beer Order',              'Alcohol & Stock Purchases',    'Weekly',  'Mon', NULL, NULL,         1500.00,  NULL,      NULL,   ''),
  (6,  'Bounce Back Loan',              'Finance & Loans',              'Monthly', NULL,  10,   NULL,         824.74,   1620.27,   10000,  'High'),
  (7,  'EON Next Gas',                  'Utilities & Energy',           'Monthly', NULL,  17,   NULL,         749.62,   NULL,      NULL,   ''),
  (8,  'Maxen Power Electric',          'Utilities & Energy',           'Weekly',  'Tue', NULL, NULL,         350.00,   1967.07,   5000,   ''),
  (9,  'Close Brothers (Solar)',        'Utilities & Energy',           'Monthly', NULL,  24,   NULL,         790.99,   24479.15,  30000,  ''),
  (10, 'Kingsway (Drakes)',             'Kitchen & Equipment',          'Monthly', NULL,  23,   NULL,         724.31,   23177.92,  30000,  ''),
  (11, 'Close Kitchen Equipment',       'Kitchen & Equipment',          'Monthly', NULL,  14,   NULL,         757.20,   24987.60,  30000,  ''),
  (12, 'TNT Sports',                    'Media & Entertainment',        'Monthly', NULL,  9,    NULL,         193.02,   NULL,      NULL,   ''),
  (13, 'PPL PRS LTD',                   'Licences & Compliance',        'Monthly', NULL,  22,   NULL,         209.57,   NULL,      NULL,   ''),
  (14, 'Johnson Textile',               'Staff & Labour',               'Monthly', NULL,  22,   NULL,         448.00,   NULL,      NULL,   ''),
  (15, 'BT Group',                      'Telecoms & IT',                'Monthly', NULL,  27,   NULL,         93.76,    NULL,      NULL,   ''),
  (16, 'HMRC VAT',                      'Tax & Government',             'Monthly', NULL,  10,   NULL,         0.00,     0.00,      NULL,   ''),
  (17, 'Scottish Water',                'Utilities & Energy',           'Monthly', NULL,  23,   NULL,         178.00,   NULL,      NULL,   ''),
  (18, 'Close Compare',                 'Finance & Loans',              'Monthly', NULL,  3,    NULL,         90.21,    NULL,      NULL,   ''),
  (19, 'East Riding Yorkshire',         'Property & Premises Costs',    'Monthly', NULL,  1,    NULL,         219.00,   612.00,    2000,   ''),
  (20, 'Sky Business',                  'Media & Entertainment',        'Monthly', NULL,  20,   NULL,         317.41,   0.00,      NULL,   ''),
  (21, 'Scottish Power (Old Electric)', 'Utilities & Energy',           'Monthly', NULL,  24,   NULL,         201.50,   1206.95,   5000,   ''),
  (22, 'Dransfield (Games Machines)',   'Property & Premises Costs',    'Monthly', NULL,  26,   NULL,         192.00,   NULL,      NULL,   ''),
  (23, 'GoCardless (Bins)',             'Property & Premises Costs',    'Monthly', NULL,  26,   NULL,         126.00,   NULL,      NULL,   ''),
  (24, 'Marketplace Mercha',            'Licences & Compliance',        'Monthly', NULL,  2,    NULL,         24.00,    NULL,      NULL,   ''),
  (25, 'Tesco Card',                    'Alcohol & Stock Purchases',    'Monthly', NULL,  4,    NULL,         750.00,   5980.54,   10000,  ''),
  (26, 'Rent',                          'Property & Premises Costs',    'Weekly',  'Wed', NULL, NULL,         750.00,   NULL,      NULL,   '')
ON CONFLICT (id) DO NOTHING;

-- SEED: payment_instances
INSERT INTO payment_instances (id,def_id,date,amount,status) VALUES
  (101,1, '2026-03-17',285.00,  'Paid'),
  (102,2, '2026-06-06',180.00,  'To be paid'),
  (103,3, '2026-06-05',174.00,  ''),
  (104,4, '2026-06-06',47.00,   ''),
  (105,5, '2026-03-17',1500.00, ''),
  (106,5, '2026-03-24',1500.00, ''),
  (107,6, '2026-04-10',824.74,  'To be paid'),
  (108,7, '2026-03-17',749.62,  'Paid'),
  (109,8, '2026-03-18',350.00,  'To be paid'),
  (110,8, '2026-03-25',350.00,  ''),
  (111,9, '2026-03-24',790.99,  'Paid'),
  (112,10,'2026-03-23',724.31,  'To be paid'),
  (113,11,'2026-03-14',757.20,  'To be paid'),
  (114,12,'2026-03-09',193.02,  'Paid'),
  (115,13,'2026-03-22',209.57,  'Paid'),
  (116,14,'2026-03-22',448.00,  'Paid'),
  (117,15,'2026-03-27',93.76,   'Paid'),
  (118,16,'2026-03-10',0.00,    'To be paid'),
  (119,17,'2026-03-23',178.00,  'To be paid'),
  (120,18,'2026-03-03',90.21,   'Paid'),
  (121,19,'2026-04-01',219.00,  'Paid'),
  (122,20,'2026-03-20',317.41,  'To be paid'),
  (123,21,'2026-03-24',201.50,  'Paid'),
  (124,22,'2026-03-26',192.00,  'Paid'),
  (125,23,'2026-03-26',126.00,  'Paid'),
  (126,24,'2026-03-02',24.00,   'Paid'),
  (127,25,'2026-04-04',750.00,  'To be paid'),
  (128,26,'2026-02-26',750.00,  'Paid'),
  (129,26,'2026-03-16',750.00,  'Paid'),
  (130,1, '2026-03-24',285.00,  ''),
  (131,1, '2026-03-31',285.00,  ''),
  (132,5, '2026-03-31',1500.00, ''),
  (133,8, '2026-04-01',350.00,  ''),
  (134,26,'2026-03-23',750.00,  ''),
  (135,26,'2026-03-30',750.00,  '')
ON CONFLICT (def_id,date) DO NOTHING;

-- Reset sequences
SELECT setval('payment_definitions_id_seq', (SELECT MAX(id) FROM payment_definitions));
SELECT setval('payment_instances_id_seq',   (SELECT MAX(id) FROM payment_instances));
