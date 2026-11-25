// Helpers shared by retail.js (Phase 3) and company.js (Phase 4).
export const all = async (stmt) => (await stmt.all()).results;
export const nowIST = () => { const t = Date.now() + 5.5 * 3600e3, d = new Date(t).toISOString(); return { date: d.slice(0, 10), hm: d.slice(11, 16), tomorrow: new Date(t + 864e5).toISOString().slice(0, 10), yesterday: new Date(t - 864e5).toISOString().slice(0, 10) }; };
export const amt = (l) => Math.round(l.qty_base * l.rate_paise);
export const sum = (lines) => lines.reduce((s, l) => s + amt(l), 0);
export const inList = (a) => a.map(() => '?').join(',');
export const bump = (db, type, id, delta) => db.prepare('INSERT INTO account_balances(account_type,account_id,balance_paise) VALUES(?,?,?) ON CONFLICT(account_type,account_id) DO UPDATE SET balance_paise=balance_paise+excluded.balance_paise').bind(type, id, delta);
export const audit = (db, uid, action, entity, id, o, n, note) => db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,old_json,new_json,note) VALUES(?,?,?,?,?,?,?)').bind(uid, action, entity, id, o == null ? null : JSON.stringify(o), n == null ? null : JSON.stringify(n), note ?? null);
export const notifyStaff = (db, msg, type, id) => db.prepare("INSERT INTO notifications(user_id,message,ref_type,ref_id) SELECT id,?,?,? FROM users WHERE role IN ('admin','assistant') AND active=1").bind(msg, type, id);
export const notifyDist = (db, distId, msg, type, id) => db.prepare("INSERT INTO notifications(user_id,message,ref_type,ref_id) SELECT id,?,?,? FROM users WHERE role='distributor' AND party_id=? AND active=1").bind(msg, type, id, distId);

// Turns [{product_id, unit, qty, rate_paise?}] into locked lines using two queries (free plan allows few queries per request).
export async function buildLines(db, items, rateFor) {
  const ids = [...new Set((items || []).filter((i) => +i.qty > 0).map((i) => +i.product_id))];
  if (!ids.length) throw new Error('Add at least one item with a quantity');
  const ps = await all(db.prepare(`SELECT id,name,base_unit FROM products WHERE id IN (${inList(ids)})`).bind(...ids));
  const us = await all(db.prepare(`SELECT product_id,unit_name,factor FROM product_units WHERE product_id IN (${inList(ids)})`).bind(...ids));
  return items.filter((i) => +i.qty > 0).map((i) => {
    const p = ps.find((x) => x.id === +i.product_id); if (!p) throw new Error('Unknown product');
    const unit = i.unit || p.base_unit, u = us.find((x) => x.product_id === p.id && x.unit_name === unit);
    if (!u) throw new Error(`"${unit}" is not a unit of ${p.name}`);
    const rate = rateFor(p, i); if (rate == null || !(rate >= 0)) throw new Error(`No rate for ${p.name}`);
    return { product_id: p.id, name: p.name, base_unit: p.base_unit, unit, qty: +i.qty, qty_base: +(+i.qty * u.factor).toFixed(4), rate_paise: +rate };
  });
}
export async function unitsFor(db, ids) {
  ids = [...new Set(ids)]; if (!ids.length) return {};
  const us = await all(db.prepare(`SELECT product_id,unit_name,factor FROM product_units WHERE product_id IN (${inList(ids)})`).bind(...ids)), m = {};
  us.forEach((u) => (m[u.product_id] = m[u.product_id] || []).push({ unit_name: u.unit_name, factor: u.factor })); return m;
}
// Latest rate on or before `date` for the given products in one price list: Map(product_id -> rate_paise)
export async function ratesOf(db, listId, ids, date) {
  const m = new Map(); if (!listId) return m;
  for (let k = 0; k < ids.length; k += 60) {   // D1 allows ~100 bound values per query
    const part = ids.slice(k, k + 60);
    (await all(db.prepare(`SELECT i.product_id,i.rate_paise FROM price_list_items i WHERE i.price_list_id=? AND i.product_id IN (${inList(part)}) AND i.effective_from=(SELECT MAX(x.effective_from) FROM price_list_items x WHERE x.price_list_id=i.price_list_id AND x.product_id=i.product_id AND x.effective_from<=?)`).bind(listId, ...part, date))).forEach((r) => m.set(r.product_id, r.rate_paise));
  }
  return m;
}

// ---- permission helper for assistants (admin always passes) ----
export const perm = (auth, name) => [auth('admin', 'assistant'), async (c, next) => {
  if (c.get('u').role === 'assistant') {
    const p = JSON.parse((await c.env.DB.prepare("SELECT value FROM settings WHERE key='assistant_perms'").first('value')) || '{}');
    if (!p[name]) return c.json({ error: 'You do not have permission for this. Ask the admin.' }, 403);
  }
  await next();
}];

// ---- sales rollups, updated incrementally at every dispatch so dashboards never scan raw orders ----
// level 'company' = company -> distributor, 'distributor' = distributor -> retailers. lines: [{product_id, qty_base, amount_paise}]
const UPS_D = 'INSERT INTO sales_daily(sale_date,session,level,route_id,city_id,distributor_id,group_id,product_id,qty_base,amount_paise) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sale_date,session,level,distributor_id,product_id) DO UPDATE SET qty_base=qty_base+excluded.qty_base, amount_paise=amount_paise+excluded.amount_paise';
const UPS_M = 'INSERT INTO sales_monthly(month,session,level,route_id,city_id,distributor_id,group_id,product_id,qty_base,amount_paise,active_days) VALUES(?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(month,session,level,distributor_id,product_id) DO UPDATE SET qty_base=qty_base+excluded.qty_base, amount_paise=amount_paise+excluded.amount_paise';
export async function salesStatements(db, level, date, session, distId, lines) {
  if (!lines.length) return [];
  const g = await db.prepare('SELECT d.city_id, c.route_id FROM distributors d JOIN cities c ON c.id=d.city_id WHERE d.id=?').bind(distId).first();
  const ids = [...new Set(lines.map((l) => l.product_id))];
  const gm = new Map((await all(db.prepare(`SELECT id,group_id FROM products WHERE id IN (${inList(ids)})`).bind(...ids))).map((p) => [p.id, p.group_id]));
  return lines.flatMap((l) => [db.prepare(UPS_D).bind(date, session, level, g.route_id, g.city_id, distId, gm.get(l.product_id) ?? null, l.product_id, l.qty_base, l.amount_paise),
    db.prepare(UPS_M).bind(date.slice(0, 7), session, level, g.route_id, g.city_id, distId, gm.get(l.product_id) ?? null, l.product_id, l.qty_base, l.amount_paise)]);
}
