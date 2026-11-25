// Phase 5: dashboard numbers. Everything is read from the small sales_daily / sales_monthly tables.
import { all, nowIST, perm } from './util.js';

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const shiftYear = (d, n) => { const [y, m, day] = d.split('-').map(Number); let t = new Date(Date.UTC(y + n, m - 1, day)); if (t.getUTCMonth() !== m - 1) t = new Date(Date.UTC(y + n, m - 1, 28)); return t.toISOString().slice(0, 10); };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const diffDays = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
const FILTERS = ['session', 'route_id', 'city_id', 'distributor_id', 'group_id', 'product_id'];
const BY = { distributor: 'distributor_id', city: 'city_id', route: 'route_id', product: 'product_id', group: 'group_id', session: 'session' };
const isDate = (s) => /^\d{4}-\d\d-\d\d$/.test(s || '');

function filt(q) {
  const w = ['level=?'], a = [q.level === 'distributor' ? 'distributor' : 'company'];
  for (const k of FILTERS) if (q[k]) { w.push(`${k}=?`); a.push(q[k]); }
  return { w, a };
}

export function mountReports(app, { auth }) {
  const V = perm(auth, 'view_reports');

  // One day versus: the same day last year, last calendar year's daily average, last calendar month's daily average.
  app.get('/api/c/reports/compare', ...V, async (c) => {
    const q = c.req.query(), db = c.env.DB, date = isDate(q.date) ? q.date : addDays(nowIST().date, -1), { w, a } = filt(q);
    const [y, m] = date.split('-').map(Number), pm = m === 1 ? [y - 1, 12] : [y, m - 1], ly = shiftYear(date, -1);
    const day = async (d) => (await db.prepare(`SELECT COALESCE(SUM(amount_paise),0) amount, COALESCE(SUM(qty_base),0) qty FROM sales_daily WHERE sale_date=? AND ${w.join(' AND ')}`).bind(d, ...a).first());
    const mon = async (m1, m2) => (await db.prepare(`SELECT COALESCE(SUM(amount_paise),0) amount, COALESCE(SUM(qty_base),0) qty FROM sales_monthly WHERE month BETWEEN ? AND ? AND ${w.join(' AND ')}`).bind(m1, m2, ...a).first());
    const pad = (n) => String(n).padStart(2, '0'), avg = (r, n) => ({ amount: Math.round(r.amount / n), qty: +(r.qty / n).toFixed(3) });
    const [today, lyDay, lyYear, lmMonth] = await Promise.all([day(date), day(ly), mon(`${y - 1}-01`, `${y - 1}-12`), mon(`${pm[0]}-${pad(pm[1])}`, `${pm[0]}-${pad(pm[1])}`)]);
    return c.json({ date, ly_date: ly, value: today, ly_same_day: lyDay, ly_avg: avg(lyYear, leap(y - 1) ? 366 : 365), lm_avg: avg(lmMonth, daysIn(pm[0], pm[1])), notes: { ly_avg: `average per day in ${y - 1}`, lm_avg: `average per day in ${pm[0]}-${pad(pm[1])}` } });
  });

  // Time series for a range (daily up to 92 days, monthly beyond), with the same range one year earlier lined up for comparison.
  app.get('/api/c/reports/trend', ...V, async (c) => {
    const q = c.req.query(), db = c.env.DB, now = nowIST().date;
    let to = isDate(q.to) ? q.to : now, from = isDate(q.from) ? q.from : addDays(to, -29); if (from > to) [from, to] = [to, from]; if (diffDays(from, to) > 800) from = addDays(to, -800);
    const { w, a } = filt(q), daily = diffDays(from, to) <= 92;
    const run = async (f, t) => daily
      ? all(db.prepare(`SELECT sale_date d, SUM(amount_paise) amount, SUM(qty_base) qty FROM sales_daily WHERE sale_date BETWEEN ? AND ? AND ${w.join(' AND ')} GROUP BY sale_date ORDER BY sale_date`).bind(f, t, ...a))
      : all(db.prepare(`SELECT month d, SUM(amount_paise) amount, SUM(qty_base) qty FROM sales_monthly WHERE month BETWEEN ? AND ? AND ${w.join(' AND ')} GROUP BY month ORDER BY month`).bind(f.slice(0, 7), t.slice(0, 7), ...a));
    const [rows, prevRaw] = await Promise.all([run(from, to), run(shiftYear(from, -1), shiftYear(to, -1))]);
    const prev = prevRaw.map((r) => ({ ...r, d: daily ? shiftYear(r.d, 1) : `${+r.d.slice(0, 4) + 1}${r.d.slice(4)}` }));   // shifted forward so it lines up with the current range
    return c.json({ from, to, bucket: daily ? 'day' : 'month', rows, prev });
  });

  // Totals per distributor / city / route / product / group / session, each next to the same period last year.
  app.get('/api/c/reports/breakdown', ...V, async (c) => {
    const q = c.req.query(), db = c.env.DB, col = BY[q.by] || 'distributor_id', now = nowIST().date;
    let to = isDate(q.to) ? q.to : now, from = isDate(q.from) ? q.from : addDays(to, -29); if (from > to) [from, to] = [to, from]; if (diffDays(from, to) > 800) from = addDays(to, -800);
    const { w, a } = filt(q), daily = diffDays(from, to) <= 92;
    const run = (f, t) => daily
      ? all(db.prepare(`SELECT ${col} k, SUM(amount_paise) amount, SUM(qty_base) qty FROM sales_daily WHERE sale_date BETWEEN ? AND ? AND ${w.join(' AND ')} GROUP BY ${col}`).bind(f, t, ...a))
      : all(db.prepare(`SELECT ${col} k, SUM(amount_paise) amount, SUM(qty_base) qty FROM sales_monthly WHERE month BETWEEN ? AND ? AND ${w.join(' AND ')} GROUP BY ${col}`).bind(f.slice(0, 7), t.slice(0, 7), ...a));
    const [cur, prev] = await Promise.all([run(from, to), run(shiftYear(from, -1), shiftYear(to, -1))]);
    const names = new Map();
    const tbl = { distributor_id: ['distributors', 'name'], city_id: ['cities', 'name'], route_id: ['routes', 'name'], product_id: ['products', 'name'], group_id: ['product_groups', 'name'] }[col];
    if (tbl) (await all(db.prepare(`SELECT id,${tbl[1]} n FROM ${tbl[0]}`))).forEach((r) => names.set(r.id, r.n));
    const keys = new Set([...cur.map((r) => r.k), ...prev.map((r) => r.k)]), cm = new Map(cur.map((r) => [r.k, r])), pmap = new Map(prev.map((r) => [r.k, r]));
    const rows = [...keys].map((k) => ({ key: k, label: col === 'session' ? k : k == null ? 'No group' : names.get(k) || `#${k}`, amount: cm.get(k)?.amount || 0, qty: cm.get(k)?.qty || 0, prev_amount: pmap.get(k)?.amount || 0, prev_qty: pmap.get(k)?.qty || 0 })).sort((x, y) => y.amount - x.amount).slice(0, 60);
    return c.json({ from, to, by: q.by || 'distributor', bucket: daily ? 'day' : 'month', rows });
  });

  // Maintenance: rebuild the rollups from the dispatch records (use only if numbers ever look wrong). Rebuilds whole months from `from`.
  app.post('/api/admin/rebuild-sales', auth('admin'), async (c) => {
    const b = await c.req.json().catch(() => ({})), db = c.env.DB, from = (isDate(b.from) ? b.from : '2000-01-01').slice(0, 7) + '-01';
    const geo = new Map((await all(db.prepare('SELECT d.id,d.city_id,ci.route_id FROM distributors d JOIN cities ci ON ci.id=d.city_id'))).map((r) => [r.id, r]));
    const grp = new Map((await all(db.prepare('SELECT id,group_id FROM products'))).map((p) => [p.id, p.group_id]));
    const rows = [
      ...(await all(db.prepare("SELECT cd.dispatch_date d,o.session,o.distributor_id dist,cd.items_json,'company' level FROM company_dispatches cd JOIN company_orders o ON o.id=cd.order_id WHERE cd.dispatch_date>=?").bind(from))),
      ...(await all(db.prepare("SELECT dd.dispatch_date d,m.session,m.distributor_id dist,dd.items_json,'distributor' level FROM demand_dispatches dd JOIN demands m ON m.id=dd.demand_id WHERE dd.dispatch_date>=?").bind(from)))];
    const day = new Map();
    rows.forEach((r) => JSON.parse(r.items_json).forEach((l) => { const k = [r.d, r.session, r.level, r.dist, l.product_id].join('|'), x = day.get(k) || { r, l, qty: 0, amt: 0 }; x.qty += l.qty_base; x.amt += l.amount_paise; day.set(k, x); }));
    const mon = new Map();
    for (const [k, x] of day) { const p = k.split('|'), mk = [p[0].slice(0, 7), p[1], p[2], p[3], p[4]].join('|'), y = mon.get(mk) || { r: x.r, l: x.l, qty: 0, amt: 0 }; y.qty += x.qty; y.amt += x.amt; mon.set(mk, y); }
    const st = [db.prepare('DELETE FROM sales_daily WHERE sale_date>=?').bind(from), db.prepare('DELETE FROM sales_monthly WHERE month>=?').bind(from.slice(0, 7))];
    const ins = (map, tbl, cols) => { for (const [k, x] of map) { const p = k.split('|'), g = geo.get(x.r.dist); if (!g) continue; st.push(db.prepare(`INSERT INTO ${tbl}(${cols},route_id,city_id,distributor_id,group_id,product_id,qty_base,amount_paise${tbl === 'sales_monthly' ? ',active_days' : ''}) VALUES(?,?,?,?,?,?,?,?,?,?${tbl === 'sales_monthly' ? ',0' : ''})`).bind(p[0], p[1], p[2], g.route_id, g.city_id, x.r.dist, grp.get(x.l.product_id) ?? null, x.l.product_id, x.qty, x.amt)); } };
    ins(day, 'sales_daily', 'sale_date,session,level'); ins(mon, 'sales_monthly', 'month,session,level');
    for (let i = 0; i < st.length; i += 100) await db.batch(st.slice(i, i + 100));
    return c.json({ ok: true, daily_rows: day.size, monthly_rows: mon.size });
  });
}
