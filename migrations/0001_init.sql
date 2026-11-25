-- Sanchi UDS: Cloudflare D1 (SQLite) schema, migration 0001
-- Conventions: money = integer paise, quantity = base units (integer or real),
-- dates = 'YYYY-MM-DD' (IST), timestamps = ISO text, session = 'AM' | 'PM'.
-- Balances are NEVER stored: they are SUM(dr_paise) - SUM(cr_paise) on ledger_entries.

PRAGMA foreign_keys = ON;

-- ---------- Price lists (admin can add any number) ----------
CREATE TABLE price_lists (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('distributor','retailer','mrp','institutional')),
  active INTEGER NOT NULL DEFAULT 1
);

-- ---------- Geography ----------
CREATE TABLE routes (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE
);
CREATE TABLE cities (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  route_id INTEGER NOT NULL REFERENCES routes(id)   -- each city sits on exactly one route
);
CREATE TABLE distributors (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  gstin TEXT, price_list_id INTEGER REFERENCES price_lists(id),   -- a 'distributor' type list
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE retailers (
  id INTEGER PRIMARY KEY,
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  shop_name TEXT NOT NULL, address TEXT, gstin TEXT,
  price_list_id INTEGER REFERENCES price_lists(id),               -- 'retailer' or 'institutional' list
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_retailers_dist ON retailers(distributor_id);

-- ---------- Users and auth ----------
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  mobile TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,                                   -- optional, for email reset
  role TEXT NOT NULL CHECK (role IN ('admin','assistant','distributor','retailer')),
  party_id INTEGER,                             -- distributors.id or retailers.id (NULL for admin/assistant)
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE reset_tokens (
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL, expires_at TEXT NOT NULL
);

-- ---------- Settings and cutoffs ----------
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES
 ('gst_enabled','0'),('timezone','Asia/Kolkata'),
 ('brand_name','Sanchi UDS'),('brand_short','Sanchi'),('brand_color','#1a1fd1'),
 ('assistant_perms','{"approve_orders":true,"dispatch":true,"view_ledgers":false}');

-- Set by company, controls when a distributor may send/edit orders to company
CREATE TABLE distributor_cutoffs (
  distributor_id INTEGER PRIMARY KEY REFERENCES distributors(id),
  am_cutoff TEXT NOT NULL DEFAULT '09:00', pm_cutoff TEXT NOT NULL DEFAULT '16:00'
);
-- Set by distributor; retailer_id NULL = distributor default, else per-retailer override
CREATE TABLE retailer_cutoffs (
  id INTEGER PRIMARY KEY,
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  retailer_id INTEGER REFERENCES retailers(id),
  am_cutoff TEXT NOT NULL, pm_cutoff TEXT NOT NULL,
  UNIQUE (distributor_id, retailer_id)
);

-- ---------- Products and prices ----------
CREATE TABLE product_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  group_id INTEGER REFERENCES product_groups(id),
  base_unit TEXT NOT NULL,                      -- ltr, kg, nos ...
  gst_rate REAL NOT NULL DEFAULT 0,             -- used only if gst_enabled
  active INTEGER NOT NULL DEFAULT 0              -- new products stay hidden until admin switches on
);
CREATE TABLE product_units (                    -- 1 unit_name = factor base units
  product_id INTEGER NOT NULL REFERENCES products(id),
  unit_name TEXT NOT NULL, factor REAL NOT NULL CHECK (factor > 0),
  PRIMARY KEY (product_id, unit_name)
);
-- Rate per base unit of a product in a price list. Latest effective_from <= today applies.
CREATE TABLE price_list_items (
  price_list_id INTEGER NOT NULL REFERENCES price_lists(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  rate_paise INTEGER NOT NULL CHECK (rate_paise >= 0),
  effective_from TEXT NOT NULL,
  PRIMARY KEY (price_list_id, product_id, effective_from)
);
-- Distributor edits a retailer's rate on the approved demand line itself (locked there).

-- ---------- Company orders (distributor -> company) ----------
-- items_json: [{product_id, unit, qty, qty_base, rate_paise}]  rate = distributor rate, locked on the line
CREATE TABLE company_orders (
  id INTEGER PRIMARY KEY,
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  order_date TEXT NOT NULL,
  session TEXT NOT NULL CHECK (session IN ('AM','PM')),
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','accepted','rejected','part_dispatched','dispatched','cancelled')),
  is_supplementary INTEGER NOT NULL DEFAULT 0,
  items_json TEXT NOT NULL,                     -- as sent
  approved_json TEXT,                           -- as edited/accepted by company
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_co_dist_date ON company_orders(distributor_id, order_date, session);
CREATE TABLE company_dispatches (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES company_orders(id),
  dispatch_date TEXT NOT NULL, items_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Retailer demands (retailer -> distributor) ----------
-- Many demands per retailer/date/session are allowed (no unique key).
-- items_json: requested; approved_json: after distributor edits (qty + locked rate_paise)
CREATE TABLE demands (
  id INTEGER PRIMARY KEY,
  retailer_id INTEGER NOT NULL REFERENCES retailers(id),
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  demand_date TEXT NOT NULL,
  session TEXT NOT NULL CHECK (session IN ('AM','PM')),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','approved','rejected','part_dispatched','dispatched','cancelled')),
  items_json TEXT NOT NULL,
  approved_json TEXT,
  company_order_id INTEGER REFERENCES company_orders(id),  -- set when included in a sent order
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_dem_dist ON demands(distributor_id, demand_date, session, status);
CREATE INDEX idx_dem_ret ON demands(retailer_id, demand_date);
CREATE TABLE demand_dispatches (
  id INTEGER PRIMARY KEY,
  demand_id INTEGER NOT NULL REFERENCES demands(id),
  dispatch_date TEXT NOT NULL, items_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Money ----------
-- Payment direction: retailer -> distributor, or distributor -> company
CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  from_type TEXT NOT NULL CHECK (from_type IN ('retailer','distributor')),
  from_id INTEGER NOT NULL,
  to_type TEXT NOT NULL CHECK (to_type IN ('distributor','company')),
  to_id INTEGER,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  mode TEXT, pay_date TEXT NOT NULL, note TEXT,
  reversed_of INTEGER REFERENCES payments(id),  -- a reversal points at the original
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- account_type 'retailer' = what retailer owes distributor; 'distributor' = what distributor owes company
CREATE TABLE ledger_entries (
  id INTEGER PRIMARY KEY,
  account_type TEXT NOT NULL CHECK (account_type IN ('retailer','distributor')),
  account_id INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  session TEXT CHECK (session IN ('AM','PM')),
  dr_paise INTEGER NOT NULL DEFAULT 0,          -- goods dispatched
  cr_paise INTEGER NOT NULL DEFAULT 0,          -- payment received / reversal of dispatch
  source_type TEXT NOT NULL,                    -- 'demand_dispatch','company_dispatch','payment','reversal'
  source_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_led_acc ON ledger_entries(account_type, account_id, entry_date);

-- ---------- Reports (rolled up nightly by Cron; dashboards read only these) ----------
-- level 'company' = company -> distributor sales; 'distributor' = distributor -> retailer sales
CREATE TABLE sales_daily (
  sale_date TEXT NOT NULL, session TEXT NOT NULL, level TEXT NOT NULL,
  route_id INTEGER NOT NULL, city_id INTEGER NOT NULL, distributor_id INTEGER NOT NULL,
  group_id INTEGER, product_id INTEGER NOT NULL,
  qty_base REAL NOT NULL, amount_paise INTEGER NOT NULL,
  PRIMARY KEY (sale_date, session, level, distributor_id, product_id)
);
CREATE INDEX idx_sd_geo ON sales_daily(level, sale_date, route_id, city_id);
CREATE INDEX idx_sd_prod ON sales_daily(level, product_id, sale_date);
CREATE TABLE sales_monthly (
  month TEXT NOT NULL, session TEXT NOT NULL, level TEXT NOT NULL,
  route_id INTEGER NOT NULL, city_id INTEGER NOT NULL, distributor_id INTEGER NOT NULL,
  group_id INTEGER, product_id INTEGER NOT NULL,
  qty_base REAL NOT NULL, amount_paise INTEGER NOT NULL, active_days INTEGER NOT NULL,
  PRIMARY KEY (month, session, level, distributor_id, product_id)
);

-- ---------- Audit and notifications ----------
-- Every override, session change, reversal and pull-out is logged here.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,        -- e.g. 'session_change','company_override','pull_from_order','payment_reverse'
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
  old_json TEXT, new_json TEXT,
  note TEXT,                   -- required for company_override (e.g. "per phone call")
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL, ref_type TEXT, ref_id INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notif_user ON notifications(user_id, is_read);
