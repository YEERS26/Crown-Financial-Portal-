-- ================================================================
-- The Crown Financial Portal v3 — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → Run
-- ================================================================

-- ================================================================
-- TABLE 1: payment_definitions
-- Master records — one row per recurring payment
-- ================================================================
create table if not exists public.payment_definitions (
  id            serial primary key,
  name          text not null,
  category      text not null,
  freq          text not null check (freq in ('Weekly','Monthly','Yearly')),
  weekday       text,           -- 'Mon','Tue' etc — for Weekly payments
  day_of_month  int,            -- 1–31 — for Monthly payments
  next_date     text,           -- 'YYYY-MM-DD' — for Yearly payments
  amount        numeric(10,2)   not null default 0,
  credit_bal    numeric(10,2),  -- null = no credit account
  credit_max    numeric(10,2),  -- original/max credit for progress bar
  priority      text            not null default '' check (priority in ('','Low','High','Urgent')),
  created_at    timestamptz     not null default now(),
  updated_at    timestamptz     not null default now()
);

-- ================================================================
-- TABLE 2: payment_instances
-- Individual payment occurrences — one row per actual payment date
-- ================================================================
create table if not exists public.payment_instances (
  id            serial primary key,
  def_id        int not null references public.payment_definitions(id) on delete cascade,
  date          text not null,  -- 'YYYY-MM-DD'
  amount        numeric(10,2)   not null default 0,
  status        text            not null default '' check (status in ('','Paid','To be paid')),
  created_at    timestamptz     not null default now(),
  updated_at    timestamptz     not null default now(),
  unique(def_id, date)          -- prevent duplicate instances per payment per date
);

-- ================================================================
-- AUTO-UPDATE updated_at
-- ================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists defs_updated_at   on public.payment_definitions;
drop trigger if exists insts_updated_at  on public.payment_instances;

create trigger defs_updated_at  before update on public.payment_definitions for each row execute function public.set_updated_at();
create trigger insts_updated_at before update on public.payment_instances    for each row execute function public.set_updated_at();

-- ================================================================
-- ROW LEVEL SECURITY — only authenticated users can access data
-- ================================================================
alter table public.payment_definitions enable row level security;
alter table public.payment_instances   enable row level security;

drop policy if exists "Auth read defs"   on public.payment_definitions;
drop policy if exists "Auth write defs"  on public.payment_definitions;
drop policy if exists "Auth read insts"  on public.payment_instances;
drop policy if exists "Auth write insts" on public.payment_instances;
drop policy if exists "Auth insert defs"  on public.payment_definitions;
drop policy if exists "Auth insert insts" on public.payment_instances;
drop policy if exists "Auth delete defs"  on public.payment_definitions;
drop policy if exists "Auth delete insts" on public.payment_instances;

create policy "Auth read defs"    on public.payment_definitions for select using (auth.role()='authenticated');
create policy "Auth insert defs"  on public.payment_definitions for insert with check (auth.role()='authenticated');
create policy "Auth write defs"   on public.payment_definitions for update using (auth.role()='authenticated');
create policy "Auth delete defs"  on public.payment_definitions for delete using (auth.role()='authenticated');

create policy "Auth read insts"   on public.payment_instances for select using (auth.role()='authenticated');
create policy "Auth insert insts" on public.payment_instances for insert with check (auth.role()='authenticated');
create policy "Auth write insts"  on public.payment_instances for update using (auth.role()='authenticated');
create policy "Auth delete insts" on public.payment_instances for delete using (auth.role()='authenticated');

-- ================================================================
-- SEED: payment_definitions (26 payments)
-- ================================================================
insert into public.payment_definitions
  (id, name, category, freq, weekday, day_of_month, next_date, amount, credit_bal, credit_max, priority)
values
  (1,  'Mandy''s',                        'Staff & Labour',                  'Weekly',  'Mon', null, null,         285.00,    null,      null,   'High'),
  (2,  'East Riding Council',              'Property & Premises Costs',       'Yearly',  null,  null, '2026-06-06', 180.00,    180.00,    180.00, 'Urgent'),
  (3,  'TV Licence',                       'Licences & Compliance',           'Yearly',  null,  null, '2026-06-05', 174.00,    174.00,    174.00, 'Low'),
  (4,  'ICO',                              'Licences & Compliance',           'Yearly',  null,  null, '2026-06-06', 47.00,     47.00,     47.00,  ''),
  (5,  'Coors Beer Order',                 'Alcohol & Stock Purchases',       'Weekly',  'Mon', null, null,         1500.00,   null,      null,   ''),
  (6,  'Bounce Back Loan',                 'Finance & Loans',                 'Monthly', null,  10,   null,         824.74,    1620.27,   10000,  'High'),
  (7,  'EON Next Gas',                     'Utilities & Energy',              'Monthly', null,  17,   null,         749.62,    null,      null,   ''),
  (8,  'Maxen Power Electric',             'Utilities & Energy',              'Weekly',  'Tue', null, null,         350.00,    1967.07,   5000,   ''),
  (9,  'Close Brothers (Solar)',           'Utilities & Energy',              'Monthly', null,  24,   null,         790.99,    24479.15,  30000,  ''),
  (10, 'Kingsway (Drakes)',                'Kitchen & Equipment (Finance)',   'Monthly', null,  23,   null,         724.31,    23177.92,  30000,  ''),
  (11, 'Close Kitchen Equipment',          'Kitchen & Equipment (Finance)',   'Monthly', null,  14,   null,         757.20,    24987.60,  30000,  ''),
  (12, 'TNT Sports',                       'Media & Entertainment',           'Monthly', null,  9,    null,         193.02,    null,      null,   ''),
  (13, 'PPL PRS LTD',                      'Licences & Compliance',           'Monthly', null,  22,   null,         209.57,    null,      null,   ''),
  (14, 'Johnson Textile',                  'Staff & Labour',                  'Monthly', null,  22,   null,         448.00,    null,      null,   ''),
  (15, 'BT Group',                         'Telecoms & IT',                   'Monthly', null,  27,   null,         93.76,     null,      null,   ''),
  (16, 'HMRC VAT',                         'Tax & Government',                'Monthly', null,  10,   null,         0.00,      0.00,      null,   ''),
  (17, 'Scottish Water',                   'Utilities & Energy',              'Monthly', null,  23,   null,         178.00,    null,      null,   ''),
  (18, 'Close Compare',                    'Finance & Loans',                 'Monthly', null,  3,    null,         90.21,     null,      null,   ''),
  (19, 'East Riding Yorkshire',            'Property & Premises Costs',       'Monthly', null,  1,    null,         219.00,    612.00,    2000,   ''),
  (20, 'Sky Business',                     'Media & Entertainment',           'Monthly', null,  20,   null,         317.41,    0.00,      null,   ''),
  (21, 'Scottish Power (Old Electric)',    'Utilities & Energy',              'Monthly', null,  24,   null,         201.50,    1206.95,   5000,   ''),
  (22, 'Dransfield (Games Machines)',      'Property & Premises Costs',       'Monthly', null,  26,   null,         192.00,    null,      null,   ''),
  (23, 'GoCardless (Bins)',                'Property & Premises Costs',       'Monthly', null,  26,   null,         126.00,    null,      null,   ''),
  (24, 'Marketplace Mercha',               'Licences & Compliance',           'Monthly', null,  2,    null,         24.00,     null,      null,   ''),
  (25, 'Tesco Card',                       'Alcohol & Stock Purchases',       'Monthly', null,  4,    null,         750.00,    5980.54,   10000,  ''),
  (26, 'Rent',                             'Property & Premises Costs',       'Weekly',  'Wed', null, null,         750.00,    null,      null,   '')
on conflict (id) do nothing;

-- ================================================================
-- SEED: payment_instances (known historical + current instances)
-- ================================================================
insert into public.payment_instances (id, def_id, date, amount, status) values
  (101, 1,  '2026-03-17', 285.00,  'Paid'),
  (102, 2,  '2026-06-06', 180.00,  'To be paid'),
  (103, 3,  '2026-06-05', 174.00,  ''),
  (104, 4,  '2026-06-06', 47.00,   ''),
  (105, 5,  '2026-03-17', 1500.00, ''),
  (106, 5,  '2026-03-24', 1500.00, ''),
  (107, 6,  '2026-04-10', 824.74,  'To be paid'),
  (108, 7,  '2026-03-17', 749.62,  'Paid'),
  (109, 8,  '2026-03-18', 350.00,  'To be paid'),
  (110, 8,  '2026-03-25', 350.00,  ''),
  (111, 9,  '2026-03-24', 790.99,  'Paid'),
  (112, 10, '2026-03-23', 724.31,  'To be paid'),
  (113, 11, '2026-03-14', 757.20,  'To be paid'),
  (114, 12, '2026-03-09', 193.02,  'Paid'),
  (115, 13, '2026-03-22', 209.57,  'Paid'),
  (116, 14, '2026-03-22', 448.00,  'Paid'),
  (117, 15, '2026-03-27', 93.76,   'Paid'),
  (118, 16, '2026-03-10', 0.00,    'To be paid'),
  (119, 17, '2026-03-23', 178.00,  'To be paid'),
  (120, 18, '2026-03-03', 90.21,   'Paid'),
  (121, 19, '2026-04-01', 219.00,  'Paid'),
  (122, 20, '2026-03-20', 317.41,  'To be paid'),
  (123, 21, '2026-03-24', 201.50,  'Paid'),
  (124, 22, '2026-03-26', 192.00,  'Paid'),
  (125, 23, '2026-03-26', 126.00,  'Paid'),
  (126, 24, '2026-03-02', 24.00,   'Paid'),
  (127, 25, '2026-04-04', 750.00,  'To be paid'),
  (128, 26, '2026-02-26', 750.00,  'Paid'),
  (129, 26, '2026-03-16', 750.00,  'Paid'),
  (130, 1,  '2026-03-24', 285.00,  ''),
  (131, 1,  '2026-03-31', 285.00,  ''),
  (132, 5,  '2026-03-31', 1500.00, ''),
  (133, 8,  '2026-04-01', 350.00,  ''),
  (134, 26, '2026-03-23', 750.00,  ''),
  (135, 26, '2026-03-30', 750.00,  '')
on conflict (def_id, date) do nothing;

-- Reset sequences
select setval('public.payment_definitions_id_seq', (select max(id) from public.payment_definitions));
select setval('public.payment_instances_id_seq',   (select max(id) from public.payment_instances));
