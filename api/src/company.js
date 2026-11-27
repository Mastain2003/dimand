// Phase 4: distributor -> company orders, company approval/edit/dispatch, distributor ledger, payments, notifications.
import { all, nowIST, amt, sum, inList, bump, audit, notifyStaff, notifyDist, buildLines, unitsFor, ratesOf, salesStatements } from './util.js';

const money = (p) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const OPEN = ['sent', 'accepted'];   // order not yet touched by dispatch

export function mountCompany(app, { auth }) {
  const STAFF = auth('admin', 'assistant'), D = auth('distributor'), ADMIN = auth('admin');
  // Assistant permissions (set by admin in Settings). Admin always passes.
  const P = (name) => [STAFF, async (c, next) => {
    if (c.get('u').role === 'assistant') {
      const p = JSON.parse(await c.env.DB.prepare("SELECT value FROM settings WHERE key='assistant_perms'").first('value') || '{}');
      if (!p[name]) return c.json({ error: 'You do not have permission for this. Ask the admin.' }, 403);
    }
    await next();
  }];
  const cutoffOf = async (db, did) => { const r = await db.prepare('SELECT am_cutoff,pm_cutoff FROM distributor_cutoffs WHERE distributor_id=?').bind(did).first(); return { AM: r?.am_cutoff || '09:00', PM: r?.pm_cutoff || '16:00' }; };
  const isOpen = async (db, did, date, session) => { const now = nowIST(), co = (await cutoffOf(db, did))[session]; return { cutoff: co, open: date > now.date || (date === now.date && now.hm < co) }; };
  const sess = (s) => { if (!['AM', 'PM'].includes(s)) throw new Error('Choose AM or PM'); return s; };
  const myOrder = async (c, id) => { const o = await c.env.DB.prepare('SELECT o.*, d.name distributor_name FROM company_orders o JOIN distributors d ON d.id=o.distributor_id WHERE o.id=?').bind(id).first(); if (!o) throw new Error('Order not found'); return o; };

  async function decorate(db, rows) {
    const ids = rows.map((r) => r.id).slice(0, 90);
    const dd = ids.length ? await all(db.prepare(`SELECT order_id,dispatch_date,items_json FROM company_dispatches WHERE order_id IN (${inList(ids)}) ORDER BY id`).bind(...ids)) : [];
    const parsed = rows.map((r) => ({ ...r, items: JSON.parse(r.items_json), approved: r.approved_json ? JSON.parse(r.approved_json) : null }));
    const units = await unitsFor(db, parsed.flatMap((r) => [...r.items, ...(r.approved || [])].map((l) => l.product_id)));
    return parsed.map(({ items_json, approved_json, ...r }) => {
      const ds = dd.filter((x) => x.order_id === r.id).map((x) => ({ date: x.dispatch_date, items: JSON.parse(x.items_json) })), got = {};
      ds.forEach((d) => d.items.forEach((i) => { got[i.product_id] = (got[i.product_id] || 0) + i.qty_base; }));
      return { ...r, dispatches: ds, dispatched_base: got, total_paise: sum(r.approved || r.items), units };
    });
  }
  async function ledgerOf(db, id) {
    const rows = await all(db.prepare(`SELECT l.id,l.entry_date,l.session,l.dr_paise,l.cr_paise,l.source_type,l.source_id,cd.order_id,p.id pay_id,p.mode,p.note,p.reversed_of,
      EXISTS(SELECT 1 FROM payments q WHERE q.reversed_of=p.id) reversed FROM ledger_entries l
      LEFT JOIN company_dispatches cd ON l.source_type='company_dispatch' AND cd.id=l.source_id LEFT JOIN payments p ON l.source_type IN ('payment','reversal') AND p.id=l.source_id
      WHERE l.account_type='distributor' AND l.account_id=? ORDER BY l.entry_date,l.id`).bind(id));
    let b = 0; return rows.map((r) => ({ ...r, balance_paise: (b += r.dr_paise - r.cr_paise) }));
  }
  // Approved, not-yet-sent retailer demands for one date+session, added up per product at the distributor's company rates.
  async function preview(c, date, session) {
    const db = c.env.DB, did = c.get('u').pid, now = nowIST();
    const dist = await db.prepare('SELECT * FROM distributors WHERE id=?').bind(did).first();
    const dems = await all(db.prepare("SELECT d.id,d.approved_json,r.shop_name FROM demands d JOIN retailers r ON r.id=d.retailer_id WHERE d.distributor_id=? AND d.demand_date=? AND d.session=? AND d.status='approved' AND d.company_order_id IS NULL ORDER BY r.shop_name").bind(did, date, session));
    const agg = new Map();
    dems.forEach((d) => JSON.parse(d.approved_json).forEach((l) => { const a = agg.get(l.product_id) || { product_id: l.product_id, name: l.name, base_unit: l.base_unit, qty: 0 }; a.qty += l.qty_base; agg.set(l.product_id, a); }));
    const rates = await ratesOf(db, dist.price_list_id, [...agg.keys()], now.date), missing = [];
    const items = [...agg.values()].map((a) => { if (!rates.has(a.product_id)) missing.push(a.name); const q = +a.qty.toFixed(4); return { product_id: a.product_id, name: a.name, base_unit: a.base_unit, unit: a.base_unit, qty: q, qty_base: q, rate_paise: rates.get(a.product_id) ?? 0 }; });
    const existing = await all(db.prepare("SELECT id,status FROM company_orders WHERE distributor_id=? AND order_date=? AND session=? AND status NOT IN ('cancelled','rejected')").bind(did, date, session));
    return { date, session, ...(await isOpen(db, did, date, session)), is_supplementary: existing.length > 0, existing, demands: dems.map((d) => ({ id: d.id, shop_name: d.shop_name })), items, units: await unitsFor(db, items.map((i) => i.product_id)), missing, total_paise: sum(items) };
  }

  // ======== distributor side ========
  app.get('/api/d/company-orders/preview', D, async (c) => { const q = c.req.query(); return c.json(await preview(c, q.date || nowIST().date, sess(q.session))); });
  app.post('/api/d/company-orders', D, async (c) => {
    const b = await c.req.json(), db = c.env.DB, did = c.get('u').pid, p = await preview(c, b.date || nowIST().date, sess(b.session));
    if (!p.open) throw new Error(`${p.session} cutoff (${p.cutoff}) has passed. Please ask the company to add this order.`);
    if (!p.items.length) throw new Error('No approved retailer demands are waiting for this session');
    if (p.missing.length) throw new Error('The company has not set a price for: ' + p.missing.join(', '));
    const id = (await db.prepare("INSERT INTO company_orders(distributor_id,order_date,session,status,is_supplementary,items_json) VALUES(?,?,?,'sent',?,?)").bind(did, p.date, p.session, p.is_supplementary ? 1 : 0, JSON.stringify(p.items)).run()).meta.last_row_id;
    const dn = (await db.prepare('SELECT name FROM distributors WHERE id=?').bind(did).first('name')), ids = p.demands.map((d) => d.id);
    await db.batch([db.prepare(`UPDATE demands SET company_order_id=? WHERE id IN (${inList(ids)}) AND company_order_id IS NULL AND status='approved'`).bind(id, ...ids),
      notifyStaff(db, `${dn} sent ${p.session} ${p.is_supplementary ? 'supplementary ' : ''}order #${id} (${money(p.total_paise)})`, 'order', id)]);
    return c.json({ id, total_paise: p.total_paise });
  });
  app.get('/api/d/company-orders', D, async (c) => {
    const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
    return c.json(await decorate(c.env.DB, await all(c.env.DB.prepare('SELECT o.*, d.name distributor_name FROM company_orders o JOIN distributors d ON d.id=o.distributor_id WHERE o.distributor_id=? AND o.order_date>=? ORDER BY o.id DESC LIMIT 80').bind(c.get('u').pid, since))));
  });
  app.get('/api/d/company-ledger', D, async (c) => { const e = await ledgerOf(c.env.DB, c.get('u').pid); return c.json({ entries: e, balance_paise: e.length ? e[e.length - 1].balance_paise : 0 }); });
  // Option A: pull one retailer demand out of a sent order (until the company starts dispatching), optionally moving it to the other session.
  app.post('/api/d/demands/:id/pull-out', D, async (c) => {
    const b = await c.req.json().catch(() => ({})), db = c.env.DB, u = c.get('u');
    const d = await db.prepare('SELECT * FROM demands WHERE id=? AND distributor_id=?').bind(c.req.param('id'), u.pid).first();
    if (!d) throw new Error('Demand not found'); if (!d.company_order_id) throw new Error('This demand is not in a company order');
    const o = await myOrder(c, d.company_order_id);
    if (!OPEN.includes(o.status)) throw new Error('The company has already started dispatching this order. Please call the company.');
    const sub = (lines) => lines && lines.map((l) => { const take = JSON.parse(d.approved_json).filter((x) => x.product_id === l.product_id).reduce((s, x) => s + x.qty_base, 0), nb = +(l.qty_base - take).toFixed(4); return { ...l, qty: l.qty_base ? +(l.qty * nb / l.qty_base).toFixed(4) : 0, qty_base: nb }; }).filter((l) => l.qty_base > 1e-6);
    const items = sub(JSON.parse(o.items_json)), approved = sub(o.approved_json && JSON.parse(o.approved_json)), empty = !items.length;
    const newSession = b.session && ['AM', 'PM'].includes(b.session) ? b.session : d.session;
    await db.batch([db.prepare('UPDATE company_orders SET items_json=?, approved_json=?, status=? WHERE id=?').bind(JSON.stringify(items), approved ? JSON.stringify(approved) : null, empty ? 'cancelled' : o.status, o.id),
      db.prepare('UPDATE demands SET company_order_id=NULL, session=? WHERE id=?').bind(newSession, d.id),
      audit(db, u.uid, 'pull_from_order', 'demand', d.id, { order_id: o.id, session: d.session }, { session: newSession }, b.reason),
      notifyStaff(db, `${o.distributor_name} pulled a retailer demand out of ${o.session} order #${o.id}${newSession !== d.session ? ` and moved it to ${newSession}` : ''}${empty ? ' (order is now empty, cancelled)' : ''}`, 'order', o.id)]);
    return c.json({ ok: true, order_cancelled: empty });
  });

  // ======== company side ========
  app.get('/api/c/perms', STAFF, async (c) => c.json(c.get('u').role === 'admin' ? { approve_orders: true, dispatch: true, view_ledgers: true, admin: true } : { ...JSON.parse(await c.env.DB.prepare("SELECT value FROM settings WHERE key='assistant_perms'").first('value')), admin: false }));
  app.get('/api/c/orders', STAFF, async (c) => {
    const q = c.req.query(), w = ['1=1'], a = [];
    if (q.date) { w.push('o.order_date=?'); a.push(q.date); } if (q.session) { w.push('o.session=?'); a.push(q.session); } if (q.distributor_id) { w.push('o.distributor_id=?'); a.push(q.distributor_id); }
    if (q.status) { const s = q.status.split(','); w.push(`o.status IN (${inList(s)})`); a.push(...s); }
    return c.json(await decorate(c.env.DB, await all(c.env.DB.prepare(`SELECT o.*, d.name distributor_name, ci.name city_name FROM company_orders o JOIN distributors d ON d.id=o.distributor_id JOIN cities ci ON ci.id=d.city_id WHERE ${w.join(' AND ')} ORDER BY o.id DESC LIMIT 150`).bind(...a))));
  });
  app.get('/api/c/summary', STAFF, async (c) => {
    const q = c.req.query(), date = q.date || nowIST().date, w = ["o.order_date=?", "o.status IN ('sent','accepted','part_dispatched','dispatched')"], a = [date];
    if (q.session) { w.push('o.session=?'); a.push(q.session); }
    const rows = await all(c.env.DB.prepare(`SELECT o.id,o.distributor_id,d.name,o.items_json,o.approved_json FROM company_orders o JOIN distributors d ON d.id=o.distributor_id WHERE ${w.join(' AND ')}`).bind(...a));
    const prods = new Map(), dists = new Map();
    rows.forEach((o) => { const lines = JSON.parse(o.approved_json || o.items_json), x = dists.get(o.distributor_id) || { distributor_id: o.distributor_id, name: o.name, orders: 0, amount_paise: 0 }; x.orders++; x.amount_paise += sum(lines); dists.set(o.distributor_id, x);
      lines.forEach((l) => { const p = prods.get(l.product_id) || { product_id: l.product_id, name: l.name, base_unit: l.base_unit, qty_base: 0, amount_paise: 0 }; p.qty_base = +(p.qty_base + l.qty_base).toFixed(4); p.amount_paise += amt(l); prods.set(l.product_id, p); }); });
    const products = [...prods.values()].sort((x, y) => x.name.localeCompare(y.name));
    return c.json({ date, products, distributors: [...dists.values()].sort((x, y) => x.name.localeCompare(y.name)), units: await unitsFor(c.env.DB, products.map((p) => p.product_id)) });
  });
  app.get('/api/c/distributors/:id/products', STAFF, async (c) => {
    const db = c.env.DB, d = await db.prepare('SELECT price_list_id FROM distributors WHERE id=?').bind(c.req.param('id')).first();
    if (!d || !d.price_list_id) throw new Error('This distributor has no price list yet');
    const ps = await all(db.prepare('SELECT p.id product_id,p.name,p.base_unit,g.name group_name,(SELECT rate_paise FROM price_list_items WHERE price_list_id=? AND product_id=p.id AND effective_from<=? ORDER BY effective_from DESC LIMIT 1) rate_paise FROM products p LEFT JOIN product_groups g ON g.id=p.group_id WHERE p.active=1 ORDER BY p.name').bind(d.price_list_id, nowIST().date));
    const us = await all(db.prepare('SELECT product_id,unit_name,factor FROM product_units'));
    return c.json(ps.filter((p) => p.rate_paise != null).map((p) => ({ ...p, units: us.filter((u) => u.product_id === p.product_id) })));
  });
  app.post('/api/c/orders/:id/accept', ...P('approve_orders'), async (c) => {
    const db = c.env.DB, o = await myOrder(c, c.req.param('id'));
    if (o.status !== 'sent') throw new Error('Only new orders can be accepted');
    await db.batch([db.prepare("UPDATE company_orders SET status='accepted', approved_json=items_json WHERE id=?").bind(o.id), notifyDist(db, o.distributor_id, `Your ${o.session} order #${o.id} was accepted`, 'order', o.id)]);
    return c.json({ ok: true });
  });
  app.put('/api/c/orders/:id', ...P('approve_orders'), async (c) => {  // {items:[{product_id,unit,qty,rate_paise?}], note}
    const b = await c.req.json(), db = c.env.DB, u = c.get('u'), o = await myOrder(c, c.req.param('id'));
    if (!OPEN.includes(o.status)) throw new Error('This order can no longer be edited (dispatch started, rejected or cancelled)');
    const was = new Map(JSON.parse(o.approved_json || o.items_json).map((l) => [l.product_id, l.rate_paise]));
    const dist = await db.prepare('SELECT price_list_id FROM distributors WHERE id=?').bind(o.distributor_id).first(), rates = await ratesOf(db, dist.price_list_id, (b.items || []).map((i) => +i.product_id), nowIST().date);
    const lines = await buildLines(db, b.items, (p, i) => (i.rate_paise !== undefined && i.rate_paise !== '' && i.rate_paise !== null ? +i.rate_paise : was.get(p.id) ?? rates.get(p.id)));
    await db.batch([db.prepare("UPDATE company_orders SET status='accepted', approved_json=? WHERE id=?").bind(JSON.stringify(lines), o.id), audit(db, u.uid, 'order_edit', 'company_order', o.id, JSON.parse(o.approved_json || o.items_json), lines, b.note),
      notifyDist(db, o.distributor_id, `Company changed your ${o.session} order #${o.id}${b.note ? ' (' + b.note + ')' : ''}`, 'order', o.id)]);
    return c.json({ ok: true, total_paise: sum(lines) });
  });
  app.post('/api/c/orders/:id/reject', ...P('approve_orders'), async (c) => {
    const b = await c.req.json().catch(() => ({})), db = c.env.DB, u = c.get('u'), o = await myOrder(c, c.req.param('id'));
    if (!OPEN.includes(o.status)) throw new Error('This order can no longer be rejected');
    await db.batch([db.prepare("UPDATE company_orders SET status='rejected' WHERE id=?").bind(o.id), db.prepare('UPDATE demands SET company_order_id=NULL WHERE company_order_id=?').bind(o.id),
      audit(db, u.uid, 'order_reject', 'company_order', o.id, { status: o.status }, { status: 'rejected' }, b.reason), notifyDist(db, o.distributor_id, `Company rejected your ${o.session} order #${o.id}${b.reason ? ': ' + b.reason : ''}. You can send it again.`, 'order', o.id)]);
    return c.json({ ok: true });
  });
  app.patch('/api/c/orders/:id/session', ...P('approve_orders'), async (c) => {  // only the company can move a distributor's order between AM and PM
    const b = await c.req.json(), db = c.env.DB, u = c.get('u'), o = await myOrder(c, c.req.param('id')), s = sess(b.session);
    if (!OPEN.includes(o.status)) throw new Error('Session cannot be changed after dispatch has started');
    await db.batch([db.prepare('UPDATE company_orders SET session=? WHERE id=?').bind(s, o.id), audit(db, u.uid, 'session_change', 'company_order', o.id, { session: o.session }, { session: s }, b.note),
      notifyDist(db, o.distributor_id, `Company moved your order #${o.id} from ${o.session} to ${s}`, 'order', o.id)]);
    return c.json({ ok: true });
  });
  app.post('/api/c/orders/:id/dispatch', ...P('dispatch'), async (c) => {  // {items:[{product_id,qty_base}], dispatch_date?, close_short?}
    const b = await c.req.json(), db = c.env.DB, o = await myOrder(c, c.req.param('id'));
    if (!['sent', 'accepted', 'part_dispatched'].includes(o.status)) throw new Error('This order cannot be dispatched');
    const ap = JSON.parse(o.approved_json || o.items_json), prev = await all(db.prepare('SELECT items_json FROM company_dispatches WHERE order_id=?').bind(o.id)), got = {};
    prev.forEach((p) => JSON.parse(p.items_json).forEach((i) => { got[i.product_id] = (got[i.product_id] || 0) + i.qty_base; }));
    const lines = [];
    for (const it of b.items || []) {
      const q = +it.qty_base; if (!(q > 0)) continue;
      const a = ap.find((x) => x.product_id === +it.product_id); if (!a) throw new Error('Item is not in this order');
      const left = a.qty_base - (got[a.product_id] || 0); if (q > left + 1e-6) throw new Error(`Too much of ${a.name}: only ${+left.toFixed(3)} ${a.base_unit} left`);
      lines.push({ product_id: a.product_id, name: a.name, base_unit: a.base_unit, qty_base: q, rate_paise: a.rate_paise, amount_paise: Math.round(q * a.rate_paise) }); got[a.product_id] = (got[a.product_id] || 0) + q;
    }
    if (!lines.length && !b.close_short) throw new Error('Enter a quantity to dispatch');
    const done = b.close_short || ap.every((a) => a.qty_base - (got[a.product_id] || 0) < 1e-6), status = done ? 'dispatched' : 'part_dispatched', total = lines.reduce((s, l) => s + l.amount_paise, 0), date = b.dispatch_date || nowIST().date, st = [];
    if (lines.length) st.push(db.prepare('INSERT INTO company_dispatches(order_id,dispatch_date,items_json) VALUES(?,?,?)').bind(o.id, date, JSON.stringify(lines)),
      db.prepare("INSERT INTO ledger_entries(account_type,account_id,entry_date,session,dr_paise,source_type,source_id) VALUES('distributor',?,?,?,?,'company_dispatch',last_insert_rowid())").bind(o.distributor_id, date, o.session, total), bump(db, 'distributor', o.distributor_id, total),
      notifyDist(db, o.distributor_id, `Dispatched against ${o.session} order #${o.id}: ${money(total)}${done ? ' (order complete)' : ''}`, 'order', o.id), ...(await salesStatements(db, 'company', date, o.session, o.distributor_id, lines)));
    st.push(db.prepare('UPDATE company_orders SET status=? WHERE id=?').bind(status, o.id));
    await db.batch(st);
    return c.json({ ok: true, status, total_paise: total });
  });
  app.post('/api/c/distributors/:id/orders', ...P('approve_orders'), async (c) => {  // order created by the company for a distributor (e.g. after a phone call)
    const b = await c.req.json(), db = c.env.DB, u = c.get('u'), did = +c.req.param('id'), session = sess(b.session), now = nowIST(), date = b.date || now.date;
    const dist = await db.prepare('SELECT * FROM distributors WHERE id=?').bind(did).first(); if (!dist) throw new Error('Distributor not found');
    if (!dist.price_list_id) throw new Error('This distributor has no price list yet');
    const late = !(await isOpen(db, did, date, session)).open;
    if (late && !(b.note || '').trim()) throw new Error('The distributor cutoff has passed. Please enter a note, for example "per phone call".');
    const rates = await ratesOf(db, dist.price_list_id, (b.items || []).map((i) => +i.product_id), now.date), lines = await buildLines(db, b.items, (p, i) => (i.rate_paise !== undefined && i.rate_paise !== '' && i.rate_paise !== null ? +i.rate_paise : rates.get(p.id)));
    const prior = await db.prepare("SELECT COUNT(*) n FROM company_orders WHERE distributor_id=? AND order_date=? AND session=? AND status NOT IN ('cancelled','rejected')").bind(did, date, session).first('n');
    const id = (await db.prepare("INSERT INTO company_orders(distributor_id,order_date,session,status,is_supplementary,items_json,approved_json) VALUES(?,?,?,'accepted',?,?,?)").bind(did, date, session, prior > 0 ? 1 : 0, JSON.stringify(lines), JSON.stringify(lines)).run()).meta.last_row_id;
    await db.batch([audit(db, u.uid, late ? 'company_override' : 'order_create', 'company_order', id, null, lines, b.note), notifyDist(db, did, `Company created ${session} order #${id} for you (${money(sum(lines))})${b.note ? ' - ' + b.note : ''}`, 'order', id)]);
    return c.json({ id, total_paise: sum(lines), override: late });
  });

  // ======== ledgers and payments (distributor <-> company) ========
  app.get('/api/c/ledgers', ...P('view_ledgers'), async (c) => c.json(await all(c.env.DB.prepare("SELECT d.id,d.name,ci.name city_name,COALESCE(b.balance_paise,0) balance_paise FROM distributors d JOIN cities ci ON ci.id=d.city_id LEFT JOIN account_balances b ON b.account_type='distributor' AND b.account_id=d.id ORDER BY d.name"))));
  app.get('/api/c/distributors/:id/ledger', ...P('view_ledgers'), async (c) => c.json({ entries: await ledgerOf(c.env.DB, +c.req.param('id')) }));
  app.post('/api/c/payments', ADMIN, async (c) => {
    const b = await c.req.json(), db = c.env.DB, did = +b.distributor_id, amount = Math.round(+b.amount_paise), date = b.pay_date || nowIST().date;
    if (!(amount > 0)) throw new Error('Enter an amount'); if (!(await db.prepare('SELECT 1 x FROM distributors WHERE id=?').bind(did).first())) throw new Error('Distributor not found');
    await db.batch([db.prepare("INSERT INTO payments(from_type,from_id,to_type,to_id,amount_paise,mode,pay_date,note,created_by) VALUES('distributor',?,'company',NULL,?,?,?,?,?)").bind(did, amount, b.mode ?? null, date, b.note ?? null, c.get('u').uid),
      db.prepare("INSERT INTO ledger_entries(account_type,account_id,entry_date,cr_paise,source_type,source_id) VALUES('distributor',?,?,?,'payment',last_insert_rowid())").bind(did, date, amount), bump(db, 'distributor', did, -amount),
      notifyDist(db, did, `Company recorded your payment of ${money(amount)}`, 'payment', did)]);
    return c.json({ ok: true });
  });
  app.post('/api/c/payments/:id/reverse', ADMIN, async (c) => {
    const db = c.env.DB, p = await db.prepare("SELECT * FROM payments WHERE id=? AND from_type='distributor' AND to_type='company'").bind(c.req.param('id')).first();
    if (!p || p.reversed_of) throw new Error('Payment not found'); if (await db.prepare('SELECT 1 x FROM payments WHERE reversed_of=?').bind(p.id).first()) throw new Error('Already reversed');
    const b = await c.req.json().catch(() => ({})), date = nowIST().date;
    await db.batch([db.prepare("INSERT INTO payments(from_type,from_id,to_type,to_id,amount_paise,mode,pay_date,note,reversed_of,created_by) VALUES('distributor',?,'company',NULL,?,?,?,?,?,?)").bind(p.from_id, p.amount_paise, p.mode, date, b.reason ?? 'Reversal', p.id, c.get('u').uid),
      db.prepare("INSERT INTO ledger_entries(account_type,account_id,entry_date,dr_paise,source_type,source_id) VALUES('distributor',?,?,?,'reversal',last_insert_rowid())").bind(p.from_id, date, p.amount_paise), bump(db, 'distributor', p.from_id, p.amount_paise),
      audit(db, c.get('u').uid, 'payment_reverse', 'payment', p.id, { amount_paise: p.amount_paise }, null, b.reason)]);
    return c.json({ ok: true });
  });

  // ======== notifications (any logged-in user) ========
  const ANY = auth();
  app.get('/api/notifications', ANY, async (c) => {
    const uid = c.get('u').uid, items = await all(c.env.DB.prepare('SELECT id,message,ref_type,ref_id,is_read,at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').bind(uid));
    return c.json({ unread: items.filter((i) => !i.is_read).length, items });
  });
  app.post('/api/notifications/read', ANY, async (c) => { await c.env.DB.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0').bind(c.get('u').uid).run(); return c.json({ ok: true }); });
}
