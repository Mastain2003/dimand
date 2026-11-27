import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { hashPassword, verifyPassword, signJwt, verifyJwt, tempPassword } from './auth.js';
import { mountRetail } from './retail.js';
import { mountCompany } from './company.js';
import { mountReports } from './reports.js';
import { mountImport } from './import.js';

const app = new Hono();
app.use('/api/*', cors());
app.onError((e, c) => c.json({ error: /UNIQUE/.test(e.message) ? 'Already exists (duplicate value)' : e.message }, 400));

// ---------- helpers ----------
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const iter = (c) => +c.env.PBKDF2_ITER || 50000;
const auth = (...roles) => async (c, next) => {
  const t = (c.req.header('Authorization') || '').replace('Bearer ', '');
  const u = t && (await verifyJwt(t, c.env.JWT_SECRET));
  if (!u) return c.json({ error: 'Please log in again' }, 401);
  if (roles.length && !roles.includes(u.role)) return c.json({ error: 'Not allowed' }, 403);
  c.set('u', u);
  await next();
};
const ADMIN = auth('admin'), STAFF = auth('admin', 'assistant');
const all = async (stmt) => (await stmt.all()).results;

// Generic CRUD for simple master tables. Only whitelisted columns can be written.
function crud(path, table, cols, extraSelect) {
  app.get(`/api/${path}`, STAFF, async (c) => c.json(await all(c.env.DB.prepare(extraSelect || `SELECT * FROM ${table} ORDER BY id`))));
  app.post(`/api/${path}`, ADMIN, async (c) => {
    const b = await c.req.json(), k = cols.filter((x) => b[x] !== undefined);
    const r = await c.env.DB.prepare(`INSERT INTO ${table} (${k}) VALUES (${k.map(() => '?')})`).bind(...k.map((x) => b[x])).run();
    return c.json({ id: r.meta.last_row_id });
  });
  app.put(`/api/${path}/:id`, ADMIN, async (c) => {
    const b = await c.req.json(), k = cols.filter((x) => b[x] !== undefined);
    if (!k.length) return c.json({ error: 'Nothing to update' }, 400);
    await c.env.DB.prepare(`UPDATE ${table} SET ${k.map((x) => x + '=?')} WHERE id=?`).bind(...k.map((x) => b[x]), c.req.param('id')).run();
    return c.json({ ok: true });
  });
}

// ---------- branding (public read, admin write) ----------
const BRAND_KEYS = ['brand_name', 'brand_short', 'brand_color', 'brand_logo'];
app.get('/api/brand', async (c) => {
  const rows = await all(c.env.DB.prepare(`SELECT key,value FROM settings WHERE key LIKE 'brand_%'`));
  const m = Object.fromEntries(rows.map((r) => [r.key.slice(6), r.value]));
  return c.json(m); // {name, short, color, logo(data URL)}
});
app.put('/api/brand', ADMIN, async (c) => {
  const b = await c.req.json(), st = [];
  for (const k of BRAND_KEYS) {
    const v = b[k.slice(6)];
    if (v === undefined) continue;
    if (k === 'brand_logo' && (!/^data:image\/(png|jpeg|webp);base64,/.test(v) || v.length > 400000)) return c.json({ error: 'Logo must be a PNG/JPG/WebP under about 300 KB' }, 400);
    st.push(c.env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, String(v)));
  }
  if (st.length) await c.env.DB.batch(st);
  return c.json({ ok: true });
});

// ---------- first-time setup: creates the first admin (works only while there are no users) ----------
app.post('/api/setup', async (c) => {
  const b = await c.req.json();
  const n = await c.env.DB.prepare('SELECT COUNT(*) n FROM users').first('n');
  if (n > 0) return c.json({ error: 'Setup already done' }, 403);
  if (!c.env.SETUP_KEY || b.setup_key !== c.env.SETUP_KEY) return c.json({ error: 'Wrong setup key' }, 403);
  if (!b.mobile || !b.name || (b.password || '').length < 6) return c.json({ error: 'Name, mobile and a password of 6+ characters needed' }, 400);
  await c.env.DB.prepare("INSERT INTO users(mobile,name,role,password_hash,must_change_password) VALUES(?,?,'admin',?,0)").bind(b.mobile, b.name, await hashPassword(b.password, iter(c))).run();
  return c.json({ ok: true });
});

// ---------- auth ----------
app.post('/api/auth/login', async (c) => {
  const { mobile, password, remember } = await c.req.json();
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE mobile=? AND active=1').bind(String(mobile || '').trim()).first();
  if (!u || !(await verifyPassword(String(password || ''), u.password_hash))) return c.json({ error: 'Wrong mobile or password' }, 401);
  const token = await signJwt({ uid: u.id, role: u.role, pid: u.party_id }, c.env.JWT_SECRET, remember ? 30 * 86400 : 86400);   // 30 days if "keep me logged in", else 1 day
  return c.json({ token, user: { id: u.id, name: u.name, role: u.role, party_id: u.party_id, must_change_password: !!u.must_change_password } });
});
app.get('/api/me', auth(), async (c) => {
  const u = c.get('u');
  const r = await c.env.DB.prepare('SELECT id,name,mobile,role,party_id,must_change_password FROM users WHERE id=?').bind(u.uid).first();
  return r ? c.json(r) : c.json({ error: 'Please log in again' }, 401);
});
app.post('/api/auth/change-password', auth(), async (c) => {
  const { old_password, new_password } = await c.req.json(), u = c.get('u');
  if ((new_password || '').length < 6) return c.json({ error: 'New password must be 6+ characters' }, 400);
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(u.uid).first();
  if (!row || !(await verifyPassword(old_password || '', row.password_hash))) return c.json({ error: 'Old password is wrong' }, 400);
  await c.env.DB.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').bind(await hashPassword(new_password, iter(c)), u.uid).run();
  return c.json({ ok: true });
});
// Forgot password = reset by upline: admin resets anyone, a distributor resets only their own retailers.
app.post('/api/users/:id/reset-password', auth('admin', 'distributor'), async (c) => {
  const u = c.get('u'), id = c.req.param('id');
  const t = await c.env.DB.prepare('SELECT id,role,party_id FROM users WHERE id=?').bind(id).first();
  if (!t) return c.json({ error: 'User not found' }, 404);
  if (u.role === 'distributor') {
    const ok = t.role === 'retailer' && (await c.env.DB.prepare('SELECT 1 x FROM retailers WHERE id=? AND distributor_id=?').bind(t.party_id, u.pid).first());
    if (!ok) return c.json({ error: 'Not allowed' }, 403);
  }
  const tmp = tempPassword();
  await c.env.DB.prepare('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?').bind(await hashPassword(tmp, iter(c)), id).run();
  return c.json({ temp_password: tmp }); // shown once; user must change it at next login
});

// ---------- users (admin) ----------
app.get('/api/users', ADMIN, async (c) => c.json(await all(c.env.DB.prepare('SELECT id,name,mobile,role,party_id,active FROM users ORDER BY id'))));
app.post('/api/users', ADMIN, async (c) => { // create assistants (distributor/retailer users are created with their records)
  const b = await c.req.json();
  if (b.role !== 'assistant' && b.role !== 'admin') return c.json({ error: 'Only admin/assistant users are created here' }, 400);
  const tmp = b.password || tempPassword();
  const r = await c.env.DB.prepare('INSERT INTO users(mobile,name,role,password_hash) VALUES(?,?,?,?)').bind(b.mobile, b.name, b.role, await hashPassword(tmp, iter(c))).run();
  return c.json({ id: r.meta.last_row_id, temp_password: tmp });
});
app.put('/api/users/:id', ADMIN, async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare('UPDATE users SET name=COALESCE(?,name), active=COALESCE(?,active) WHERE id=?').bind(b.name ?? null, b.active ?? null, c.req.param('id')).run();
  return c.json({ ok: true });
});
app.get('/api/settings/assistant-perms', ADMIN, async (c) => c.json(JSON.parse(await c.env.DB.prepare("SELECT value FROM settings WHERE key='assistant_perms'").first('value'))));
app.put('/api/settings/assistant-perms', ADMIN, async (c) => {
  const b = await c.req.json();
  const p = { approve_orders: !!b.approve_orders, dispatch: !!b.dispatch, view_ledgers: !!b.view_ledgers, view_reports: !!b.view_reports };
  await c.env.DB.prepare("UPDATE settings SET value=? WHERE key='assistant_perms'").bind(JSON.stringify(p)).run();
  return c.json(p);
});

// ---------- masters ----------
crud('routes', 'routes', ['name']);
crud('cities', 'cities', ['name', 'route_id'], 'SELECT c.*, r.name route_name FROM cities c JOIN routes r ON r.id=c.route_id ORDER BY c.name');
crud('groups', 'product_groups', ['name']);
crud('price-lists', 'price_lists', ['name', 'type', 'active']);

// ---------- products (+ unit conversions + rates in price lists) ----------
async function saveProduct(c, id) {
  const b = await c.req.json(), db = c.env.DB, isNew = !id;
  if (!b.name || !b.base_unit) return c.json({ error: 'Name and base unit are required' }, 400);
  if (id) await db.prepare('UPDATE products SET name=?,group_id=?,base_unit=?,gst_rate=?,active=? WHERE id=?').bind(b.name, b.group_id ?? null, b.base_unit, b.gst_rate ?? 0, b.active ? 1 : 0, id).run();
  else id = (await db.prepare('INSERT INTO products(name,group_id,base_unit,gst_rate,active) VALUES(?,?,?,?,?)').bind(b.name, b.group_id ?? null, b.base_unit, b.gst_rate ?? 0, b.active ? 1 : 0).run()).meta.last_row_id;
  const st = [];
  if (Array.isArray(b.units) || isNew) {   // a new product always gets its base-unit row
    b.units = b.units || [];
    st.push(db.prepare('DELETE FROM product_units WHERE product_id=?').bind(id));
    st.push(db.prepare('INSERT INTO product_units(product_id,unit_name,factor) VALUES(?,?,1)').bind(id, b.base_unit));
    for (const u of b.units) if (u.unit_name && u.unit_name !== b.base_unit && +u.factor > 0) st.push(db.prepare('INSERT INTO product_units(product_id,unit_name,factor) VALUES(?,?,?)').bind(id, u.unit_name, +u.factor));
  }
  const eff = b.effective_from || todayIST();
  for (const r of b.rates || []) st.push(db.prepare('INSERT INTO price_list_items(price_list_id,product_id,rate_paise,effective_from) VALUES(?,?,?,?) ON CONFLICT(price_list_id,product_id,effective_from) DO UPDATE SET rate_paise=excluded.rate_paise').bind(r.price_list_id, id, Math.round(r.rate_paise), eff));
  if (st.length) await db.batch(st);
  return c.json({ id });
}
app.get('/api/products', STAFF, async (c) => {
  const db = c.env.DB, ps = await all(db.prepare('SELECT * FROM products ORDER BY name')), us = await all(db.prepare('SELECT * FROM product_units'));
  return c.json(ps.map((p) => ({ ...p, units: us.filter((u) => u.product_id === p.id) })));
});
app.post('/api/products', ADMIN, (c) => saveProduct(c, null));
app.put('/api/products/:id', ADMIN, (c) => saveProduct(c, +c.req.param('id')));
// Rates of one product in every price list (for the "Add product" screen). Blank rate = missing.
app.get('/api/products/:id/rates', STAFF, async (c) => {
  const id = c.req.param('id'), t = todayIST();
  return c.json(await all(c.env.DB.prepare(`SELECT l.id price_list_id, l.name, l.type, i.rate_paise, i.effective_from FROM price_lists l
    LEFT JOIN price_list_items i ON i.price_list_id=l.id AND i.product_id=?1 AND i.effective_from=(SELECT MAX(effective_from) FROM price_list_items x WHERE x.price_list_id=l.id AND x.product_id=?1 AND x.effective_from<=?2)
    WHERE l.active=1 ORDER BY l.type,l.name`).bind(id, t)));
});

// ---------- price list items ----------
app.get('/api/price-lists/:id/items', STAFF, async (c) => {
  const id = c.req.param('id'), t = todayIST();
  return c.json(await all(c.env.DB.prepare(`SELECT p.id product_id, p.name, p.base_unit, p.active, i.rate_paise, i.effective_from FROM products p
    LEFT JOIN price_list_items i ON i.product_id=p.id AND i.price_list_id=?1 AND i.effective_from=(SELECT MAX(effective_from) FROM price_list_items x WHERE x.price_list_id=?1 AND x.product_id=p.id AND x.effective_from<=?2)
    ORDER BY p.name`).bind(id, t)));
});
app.put('/api/price-lists/:id/items', ADMIN, async (c) => {  // bulk set rates: {items:[{product_id, rate_paise}], effective_from?}
  const b = await c.req.json(), id = c.req.param('id'), eff = b.effective_from || todayIST();
  const st = (b.items || []).map((r) => c.env.DB.prepare('INSERT INTO price_list_items(price_list_id,product_id,rate_paise,effective_from) VALUES(?,?,?,?) ON CONFLICT(price_list_id,product_id,effective_from) DO UPDATE SET rate_paise=excluded.rate_paise').bind(id, r.product_id, Math.round(r.rate_paise), eff));
  if (st.length) await c.env.DB.batch(st);
  return c.json({ saved: st.length });
});
// Copy another list, optionally +/- percent (e.g. new institutional list = retailer list - 5%)
app.post('/api/price-lists/:id/copy-from/:src', ADMIN, async (c) => {
  const b = await c.req.json().catch(() => ({})), pct = +b.percent || 0, t = todayIST();
  const rows = await all(c.env.DB.prepare(`SELECT i.product_id, i.rate_paise FROM price_list_items i WHERE i.price_list_id=?1 AND i.effective_from=(SELECT MAX(effective_from) FROM price_list_items x WHERE x.price_list_id=?1 AND x.product_id=i.product_id AND x.effective_from<=?2)`).bind(c.req.param('src'), t));
  const st = rows.map((r) => c.env.DB.prepare('INSERT INTO price_list_items(price_list_id,product_id,rate_paise,effective_from) VALUES(?,?,?,?) ON CONFLICT(price_list_id,product_id,effective_from) DO UPDATE SET rate_paise=excluded.rate_paise').bind(c.req.param('id'), r.product_id, Math.round(r.rate_paise * (1 + pct / 100)), t));
  if (st.length) await c.env.DB.batch(st);
  return c.json({ copied: st.length });
});

// ---------- distributors (creates the login too) ----------
app.get('/api/distributors', STAFF, async (c) => c.json(await all(c.env.DB.prepare(`SELECT d.*, c.name city_name, c.route_id, r.name route_name, u.mobile, u.id user_id, pl.name price_list_name,
  dc.am_cutoff, dc.pm_cutoff FROM distributors d JOIN cities c ON c.id=d.city_id JOIN routes r ON r.id=c.route_id
  LEFT JOIN users u ON u.role='distributor' AND u.party_id=d.id LEFT JOIN price_lists pl ON pl.id=d.price_list_id LEFT JOIN distributor_cutoffs dc ON dc.distributor_id=d.id ORDER BY d.name`))));
app.post('/api/distributors', ADMIN, async (c) => {
  const b = await c.req.json(), db = c.env.DB;
  if (!b.name || !b.city_id || !b.mobile) return c.json({ error: 'Name, city and mobile are required' }, 400);
  const tmp = b.password || tempPassword();
  const id = (await db.prepare('INSERT INTO distributors(name,city_id,gstin,price_list_id) VALUES(?,?,?,?)').bind(b.name, b.city_id, b.gstin ?? null, b.price_list_id ?? null).run()).meta.last_row_id;
  try {
    await db.batch([
      db.prepare("INSERT INTO users(mobile,name,role,party_id,password_hash) VALUES(?,?,'distributor',?,?)").bind(b.mobile, b.name, id, await hashPassword(tmp, iter(c))),
      db.prepare('INSERT INTO distributor_cutoffs(distributor_id,am_cutoff,pm_cutoff) VALUES(?,?,?)').bind(id, b.am_cutoff || '09:00', b.pm_cutoff || '16:00'),
    ]);
  } catch (e) { await db.prepare('DELETE FROM distributors WHERE id=?').bind(id).run(); throw e; } // e.g. mobile already used
  return c.json({ id, temp_password: tmp });
});
app.put('/api/distributors/:id', ADMIN, async (c) => {
  const b = await c.req.json(), id = c.req.param('id'), db = c.env.DB;
  await db.prepare('UPDATE distributors SET name=COALESCE(?,name),city_id=COALESCE(?,city_id),gstin=COALESCE(?,gstin),price_list_id=COALESCE(?,price_list_id),active=COALESCE(?,active) WHERE id=?').bind(b.name ?? null, b.city_id ?? null, b.gstin ?? null, b.price_list_id ?? null, b.active ?? null, id).run();
  if (b.am_cutoff || b.pm_cutoff) await db.prepare('UPDATE distributor_cutoffs SET am_cutoff=COALESCE(?,am_cutoff),pm_cutoff=COALESCE(?,pm_cutoff) WHERE distributor_id=?').bind(b.am_cutoff ?? null, b.pm_cutoff ?? null, id).run();
  if (b.mobile) await db.prepare("UPDATE users SET mobile=? WHERE role='distributor' AND party_id=?").bind(b.mobile, id).run();
  return c.json({ ok: true });
});

mountRetail(app, { auth, all, iter });
mountCompany(app, { auth });
mountReports(app, { auth });
mountImport(app, { auth, iter });

app.get('/api/health', (c) => c.json({ ok: true }));
export default app;
