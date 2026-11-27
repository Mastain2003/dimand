// Phase 3: retailers, demands (AM/PM), approval, dispatch to retailers, payments, retailer ledgers.
import { hashPassword, tempPassword } from './auth.js';

import { all as _all, nowIST, amt, sum, inList, bump, audit, buildLines, salesStatements } from './util.js';
const RATE = '(SELECT rate_paise FROM price_list_items WHERE price_list_id=? AND product_id=p.id AND effective_from<=? ORDER BY effective_from DESC LIMIT 1)';

export function mountRetail(app, { auth, all, iter }) {
  const D = auth('distributor'), R = auth('retailer');
  const myRet = async (c, id) => { const r = await c.env.DB.prepare('SELECT * FROM retailers WHERE id=? AND distributor_id=?').bind(id, c.get('u').pid).first(); if (!r) throw new Error('Retailer not found'); return r; };
  const meRet = async (c) => { const r = await c.env.DB.prepare('SELECT * FROM retailers WHERE id=? AND active=1').bind(c.get('u').pid).first(); if (!r) throw new Error('Retailer account is not active'); return r; };
  const myDem = async (c, id) => { const d = await c.env.DB.prepare('SELECT * FROM demands WHERE id=? AND distributor_id=?').bind(id, c.get('u').pid).first(); if (!d) throw new Error('Demand not found'); return d; };

  async function cutoffsFor(db, distId, retId) {
    const rows = await all(db.prepare('SELECT retailer_id,am_cutoff,pm_cutoff FROM retailer_cutoffs WHERE distributor_id=? AND (retailer_id IS NULL OR retailer_id=?)').bind(distId, retId));
    const r = rows.find((x) => x.retailer_id === retId) || rows.find((x) => x.retailer_id === null) || { am_cutoff: '09:00', pm_cutoff: '16:00' };
    return { AM: r.am_cutoff, PM: r.pm_cutoff };
  }
  async function productsFor(db, ret) {
    if (!ret.price_list_id) throw new Error('No price list is assigned to this retailer yet');
    const t = nowIST().date, mrp = await db.prepare("SELECT id FROM price_lists WHERE type='mrp' AND active=1 ORDER BY id LIMIT 1").first('id');
    const rows = await all(db.prepare(`SELECT p.id product_id,p.name,p.base_unit,p.group_id,g.name group_name,${RATE} rate_paise,${mrp ? RATE : 'NULL'} mrp_paise FROM products p LEFT JOIN product_groups g ON g.id=p.group_id WHERE p.active=1 ORDER BY p.name`).bind(ret.price_list_id, t, ...(mrp ? [mrp, t] : [])));
    const us = await all(db.prepare('SELECT product_id,unit_name,factor FROM product_units'));
    return rows.filter((r) => r.rate_paise != null).map((r) => ({ ...r, units: us.filter((u) => u.product_id === r.product_id) }));
  }
  async function decorate(db, rows) {
    const ids = rows.map((r) => r.id).slice(0, 90);
    const dd = ids.length ? await all(db.prepare(`SELECT demand_id,dispatch_date,items_json FROM demand_dispatches WHERE demand_id IN (${inList(ids)}) ORDER BY id`).bind(...ids)) : [];
    return rows.map((r) => {
      const ds = dd.filter((x) => x.demand_id === r.id).map((x) => ({ date: x.dispatch_date, items: JSON.parse(x.items_json) })), got = {};
      ds.forEach((d) => d.items.forEach((i) => { got[i.product_id] = (got[i.product_id] || 0) + i.qty_base; }));
      const { items_json, approved_json, ...rest } = r;
      return { ...rest, items: JSON.parse(items_json), approved: approved_json ? JSON.parse(approved_json) : null, dispatches: ds, dispatched_base: got };
    });
  }
  async function ledgerOf(db, type, id) {
    const rows = await all(db.prepare(`SELECT l.id,l.entry_date,l.session,l.dr_paise,l.cr_paise,l.source_type,l.source_id,dd.demand_id,p.id pay_id,p.mode,p.note,p.reversed_of,
      EXISTS(SELECT 1 FROM payments q WHERE q.reversed_of=p.id) reversed
      FROM ledger_entries l LEFT JOIN demand_dispatches dd ON l.source_type='demand_dispatch' AND dd.id=l.source_id
      LEFT JOIN payments p ON l.source_type IN ('payment','reversal') AND p.id=l.source_id
      WHERE l.account_type=? AND l.account_id=? ORDER BY l.entry_date,l.id`).bind(type, id));
    let b = 0;
    return rows.map((r) => ({ ...r, balance_paise: (b += r.dr_paise - r.cr_paise) }));
  }
  async function createDemand(c, ret, body, upline) {
    const db = c.env.DB, now = nowIST(), session = body.session;
    if (!['AM', 'PM'].includes(session)) throw new Error('Choose AM or PM');
    const date = body.demand_date || now.date, okDates = upline ? [now.yesterday, now.date, now.tomorrow] : [now.date, now.tomorrow];
    if (!okDates.includes(date)) throw new Error('Demand date must be today or tomorrow');
    if (!upline && date === now.date) { const co = await cutoffsFor(db, ret.distributor_id, ret.id); if (now.hm >= co[session]) throw new Error(`${session} cutoff (${co[session]}) has passed. Place it for tomorrow instead.`); }
    const pm = new Map((await productsFor(db, ret)).map((p) => [p.product_id, p]));
    const lines = await buildLines(db, body.items, (p) => pm.get(p.id)?.rate_paise);
    const r = await db.prepare('INSERT INTO demands(retailer_id,distributor_id,demand_date,session,items_json,note) VALUES(?,?,?,?,?,?)').bind(ret.id, ret.distributor_id, date, session, JSON.stringify(lines), body.note ?? null).run();
    return { id: r.meta.last_row_id, total_paise: sum(lines) };
  }

  // ======== distributor: retailers ========
  app.get('/api/d/price-lists', D, async (c) => c.json(await all(c.env.DB.prepare("SELECT id,name,type FROM price_lists WHERE active=1 AND type IN ('retailer','institutional') ORDER BY name"))));
  app.get('/api/d/retailers', D, async (c) => c.json(await all(c.env.DB.prepare(`SELECT r.*, u.mobile, u.id user_id, pl.name price_list_name, COALESCE(b.balance_paise,0) balance_paise
    FROM retailers r LEFT JOIN users u ON u.role='retailer' AND u.party_id=r.id LEFT JOIN price_lists pl ON pl.id=r.price_list_id
    LEFT JOIN account_balances b ON b.account_type='retailer' AND b.account_id=r.id WHERE r.distributor_id=? ORDER BY r.shop_name`).bind(c.get('u').pid))));
  app.post('/api/d/retailers', D, async (c) => {
    const b = await c.req.json(), db = c.env.DB, did = c.get('u').pid;
    if (!b.shop_name || !b.mobile) throw new Error('Shop name and mobile are required');
    let pl = b.price_list_id || (await db.prepare("SELECT id FROM price_lists WHERE type='retailer' AND active=1 ORDER BY id LIMIT 1").first('id'));
    const tmp = b.password || tempPassword();
    const id = (await db.prepare('INSERT INTO retailers(distributor_id,shop_name,address,gstin,price_list_id) VALUES(?,?,?,?,?)').bind(did, b.shop_name, b.address ?? null, b.gstin ?? null, pl ?? null).run()).meta.last_row_id;
    try { await db.prepare("INSERT INTO users(mobile,name,role,party_id,password_hash) VALUES(?,?,'retailer',?,?)").bind(String(b.mobile).trim(), b.shop_name, id, await hashPassword(tmp, iter(c))).run(); }
    catch (e) { await db.prepare('DELETE FROM retailers WHERE id=?').bind(id).run(); throw e; }
    return c.json({ id, temp_password: tmp });
  });
  app.put('/api/d/retailers/:id', D, async (c) => {
    const b = await c.req.json(), r = await myRet(c, c.req.param('id')), db = c.env.DB;
    await db.prepare('UPDATE retailers SET shop_name=COALESCE(?,shop_name),address=COALESCE(?,address),gstin=COALESCE(?,gstin),price_list_id=COALESCE(?,price_list_id),active=COALESCE(?,active) WHERE id=?').bind(b.shop_name ?? null, b.address ?? null, b.gstin ?? null, b.price_list_id ?? null, b.active ?? null, r.id).run();
    if (b.mobile) await db.prepare("UPDATE users SET mobile=? WHERE role='retailer' AND party_id=?").bind(String(b.mobile).trim(), r.id).run();
    if (b.active !== undefined && b.active !== null) await db.prepare("UPDATE users SET active=? WHERE role='retailer' AND party_id=?").bind(b.active ? 1 : 0, r.id).run();
    return c.json({ ok: true });
  });
  app.get('/api/d/retailers/:id/products', D, async (c) => c.json(await productsFor(c.env.DB, await myRet(c, c.req.param('id')))));
  app.get('/api/d/retailers/:id/ledger', D, async (c) => { const r = await myRet(c, c.req.param('id')); return c.json({ retailer: r, entries: await ledgerOf(c.env.DB, 'retailer', r.id) }); });
  app.post('/api/d/retailers/:id/demands', D, async (c) => c.json(await createDemand(c, await myRet(c, c.req.param('id')), await c.req.json(), true)));  // phone orders, cutoff does not apply

  // ======== distributor: cutoffs for own retailers ========
  app.get('/api/d/cutoffs', D, async (c) => {
    const did = c.get('u').pid, rows = await all(c.env.DB.prepare('SELECT x.retailer_id,x.am_cutoff,x.pm_cutoff,r.shop_name FROM retailer_cutoffs x LEFT JOIN retailers r ON r.id=x.retailer_id WHERE x.distributor_id=?').bind(did));
    const own = await c.env.DB.prepare('SELECT am_cutoff,pm_cutoff FROM distributor_cutoffs WHERE distributor_id=?').bind(did).first();
    return c.json({ default: rows.find((r) => r.retailer_id === null) || { am_cutoff: '09:00', pm_cutoff: '16:00' }, overrides: rows.filter((r) => r.retailer_id !== null), company_cutoff: own });
  });
  app.put('/api/d/cutoffs', D, async (c) => {  // {retailer_id|null, am_cutoff, pm_cutoff}
    const b = await c.req.json(), did = c.get('u').pid, db = c.env.DB;
    if (!/^\d\d:\d\d$/.test(b.am_cutoff || '') || !/^\d\d:\d\d$/.test(b.pm_cutoff || '')) throw new Error('Enter cutoff times like 09:00');
    const rid = b.retailer_id || null; if (rid) await myRet(c, rid);
    await db.batch([rid ? db.prepare('DELETE FROM retailer_cutoffs WHERE distributor_id=? AND retailer_id=?').bind(did, rid) : db.prepare('DELETE FROM retailer_cutoffs WHERE distributor_id=? AND retailer_id IS NULL').bind(did),
      db.prepare('INSERT INTO retailer_cutoffs(distributor_id,retailer_id,am_cutoff,pm_cutoff) VALUES(?,?,?,?)').bind(did, rid, b.am_cutoff, b.pm_cutoff)]);
    return c.json({ ok: true });
  });
  app.delete('/api/d/cutoffs/:rid', D, async (c) => { await c.env.DB.prepare('DELETE FROM retailer_cutoffs WHERE distributor_id=? AND retailer_id=?').bind(c.get('u').pid, c.req.param('rid')).run(); return c.json({ ok: true }); });

  // ======== distributor: demand inbox, approve, reject, session change, dispatch ========
  app.get('/api/d/demands', D, async (c) => {
    const q = c.req.query(), w = ['d.distributor_id=?'], a = [c.get('u').pid];
    if (q.date) { w.push('d.demand_date=?'); a.push(q.date); }
    if (q.session) { w.push('d.session=?'); a.push(q.session); }
    if (q.status) { const s = q.status.split(','); w.push(`d.status IN (${inList(s)})`); a.push(...s); }
    if (q.retailer_id) { w.push('d.retailer_id=?'); a.push(q.retailer_id); }
    const rows = await all(c.env.DB.prepare(`SELECT d.*, r.shop_name FROM demands d JOIN retailers r ON r.id=d.retailer_id WHERE ${w.join(' AND ')} ORDER BY d.id DESC LIMIT 100`).bind(...a));
    return c.json(await decorate(c.env.DB, rows));
  });
  app.post('/api/d/demands/:id/approve', D, async (c) => {  // {items:[{product_id,unit,qty,rate_paise}]}  rate per BASE unit, locked on the line
    const b = await c.req.json(), db = c.env.DB, d = await myDem(c, c.req.param('id'));
    if (!['submitted', 'approved'].includes(d.status)) throw new Error('This demand can no longer be approved or edited');
    if (d.company_order_id) throw new Error('Already sent to the company. Pull it out of the order first.');
    if (await db.prepare('SELECT 1 x FROM demand_dispatches WHERE demand_id=? LIMIT 1').bind(d.id).first()) throw new Error('Dispatch already started');
    const asked = new Map(JSON.parse(d.items_json).map((i) => [i.product_id, i.rate_paise]));
    const lines = await buildLines(db, b.items, (p, i) => (i.rate_paise !== undefined && i.rate_paise !== '' && i.rate_paise !== null ? +i.rate_paise : asked.get(p.id)));
    await db.batch([db.prepare("UPDATE demands SET status='approved',approved_json=? WHERE id=?").bind(JSON.stringify(lines), d.id), audit(db, c.get('u').uid, 'approve', 'demand', d.id, d.approved_json ? JSON.parse(d.approved_json) : JSON.parse(d.items_json), lines)]);
    return c.json({ ok: true, total_paise: sum(lines) });
  });
  app.post('/api/d/demands/:id/reject', D, async (c) => {
    const b = await c.req.json().catch(() => ({})), db = c.env.DB, d = await myDem(c, c.req.param('id'));
    if (!['submitted', 'approved'].includes(d.status) || d.company_order_id) throw new Error('This demand cannot be rejected now');
    if (await db.prepare('SELECT 1 x FROM demand_dispatches WHERE demand_id=? LIMIT 1').bind(d.id).first()) throw new Error('Dispatch already started');
    await db.batch([db.prepare("UPDATE demands SET status='rejected',note=? WHERE id=?").bind(b.reason ?? d.note, d.id), audit(db, c.get('u').uid, 'reject', 'demand', d.id, { status: d.status }, { status: 'rejected' }, b.reason)]);
    return c.json({ ok: true });
  });
  app.patch('/api/d/demands/:id/session', D, async (c) => {
    const b = await c.req.json(), db = c.env.DB, d = await myDem(c, c.req.param('id'));
    if (!['AM', 'PM'].includes(b.session)) throw new Error('Choose AM or PM');
    if (d.company_order_id) throw new Error('Already sent to the company. Pull it out of the order first.');
    if (!['submitted', 'approved'].includes(d.status) || (await db.prepare('SELECT 1 x FROM demand_dispatches WHERE demand_id=? LIMIT 1').bind(d.id).first())) throw new Error('Session cannot be changed after dispatch or rejection');
    await db.batch([db.prepare('UPDATE demands SET session=? WHERE id=?').bind(b.session, d.id), audit(db, c.get('u').uid, 'session_change', 'demand', d.id, { session: d.session }, { session: b.session })]);
    return c.json({ ok: true });
  });
  app.post('/api/d/demands/:id/dispatch', D, async (c) => {  // {items:[{product_id, qty_base}], dispatch_date?, close_short?}
    const b = await c.req.json(), db = c.env.DB, d = await myDem(c, c.req.param('id'));
    if (!['approved', 'part_dispatched'].includes(d.status)) throw new Error('Approve the demand before dispatching');
    const ap = JSON.parse(d.approved_json), prev = await all(db.prepare('SELECT items_json FROM demand_dispatches WHERE demand_id=?').bind(d.id)), got = {};
    prev.forEach((p) => JSON.parse(p.items_json).forEach((i) => { got[i.product_id] = (got[i.product_id] || 0) + i.qty_base; }));
    const lines = [];
    for (const it of b.items || []) {
      const q = +it.qty_base; if (!(q > 0)) continue;
      const a = ap.find((x) => x.product_id === +it.product_id); if (!a) throw new Error('Item is not in the approved demand');
      if (q > a.qty_base - (got[a.product_id] || 0) + 1e-6) throw new Error(`Too much of ${a.name}: only ${+(a.qty_base - (got[a.product_id] || 0)).toFixed(3)} ${a.base_unit} left`);
      lines.push({ product_id: a.product_id, name: a.name, base_unit: a.base_unit, qty_base: q, rate_paise: a.rate_paise, amount_paise: Math.round(q * a.rate_paise) });
      got[a.product_id] = (got[a.product_id] || 0) + q;
    }
    if (!lines.length && !b.close_short) throw new Error('Enter a quantity to dispatch');
    const done = b.close_short || ap.every((a) => a.qty_base - (got[a.product_id] || 0) < 1e-6), status = done ? 'dispatched' : 'part_dispatched', total = lines.reduce((s, l) => s + l.amount_paise, 0), date = b.dispatch_date || nowIST().date;
    const st = [];
    if (lines.length) st.push(db.prepare('INSERT INTO demand_dispatches(demand_id,dispatch_date,items_json) VALUES(?,?,?)').bind(d.id, date, JSON.stringify(lines)),
      db.prepare("INSERT INTO ledger_entries(account_type,account_id,entry_date,session,dr_paise,source_type,source_id) VALUES('retailer',?,?,?,?,'demand_dispatch',last_insert_rowid())").bind(d.retailer_id, date, d.session, total),
      bump(db, 'retailer', d.retailer_id, total), ...(await salesStatements(db, 'distributor', date, d.session, d.distributor_id, lines)));
    st.push(db.prepare('UPDATE demands SET status=? WHERE id=?').bind(status, d.id));
    await db.batch(st);
    return c.json({ ok: true, status, total_paise: total });
  });

  // ======== distributor: payments from retailers ========
  app.post('/api/d/payments', D, async (c) => {
    const b = await c.req.json(), db = c.env.DB, ret = await myRet(c, b.retailer_id), amount = Math.round(+b.amount_paise);
    if (!(amount > 0)) throw new Error('Enter an amount');
    const date = b.pay_date || nowIST().date;
    await db.batch([db.prepare("INSERT INTO payments(from_type,from_id,to_type,to_id,amount_paise,mode,pay_date,note,created_by) VALUES('retailer',?,'distributor',?,?,?,?,?,?)").bind(ret.id, ret.distributor_id, amount, b.mode ?? null, date, b.note ?? null, c.get('u').uid),
      db.prepare("INSERT INTO ledger_entries(account_type,account_id,entry_date,cr_paise,source_type,source_id) VALUES('retailer',?,?,?,'payment',last_insert_rowid())").bind(ret.id, date, amount), bump(db, 'retailer', ret.id, -amount)]);
    return c.json({ ok: true });
  });
  app.post('/api/d/payments/:id/reverse', D, async (c) => {  // entries are never deleted; a reversal entry cancels the payment
    const db = c.env.DB, p = await db.prepare("SELECT * FROM payments WHERE id=? AND from_type='retailer' AND to_id=?").bind(c.req.param('id'), c.get('u').pid).first();
    if (!p || p.reversed_of) throw new Error('Payment not found');
    if (await db.prepare('SELECT 1 x FROM payments WHERE reversed_of=?').bind(p.id).first()) throw new Error('Already reversed');
    const b = await c.req.json().catch(() => ({})), date = nowIST().date;
    await db.batch([db.prepare("INSERT INTO payments(from_type,from_id,to_type,to_id,amount_paise,mode,pay_date,note,reversed_of,created_by) VALUES('retailer',?,'distributor',?,?,?,?,?,?,?)").bind(p.from_id, p.to_id, p.amount_paise, p.mode, date, b.reason ?? 'Reversal', p.id, c.get('u').uid),
      db.prepare("INSERT INTO ledger_entries(account_type,account_id,entry_date,dr_paise,source_type,source_id) VALUES('retailer',?,?,?,'reversal',last_insert_rowid())").bind(p.from_id, date, p.amount_paise), bump(db, 'retailer', p.from_id, p.amount_paise),
      audit(db, c.get('u').uid, 'payment_reverse', 'payment', p.id, { amount_paise: p.amount_paise }, null, b.reason)]);
    return c.json({ ok: true });
  });

  // ======== retailer ========
  app.get('/api/r/info', R, async (c) => {
    const r = await meRet(c), now = nowIST(), db = c.env.DB;
    const x = await db.prepare('SELECT d.name distributor_name, COALESCE(b.balance_paise,0) balance_paise FROM distributors d LEFT JOIN account_balances b ON b.account_type=\'retailer\' AND b.account_id=? WHERE d.id=?').bind(r.id, r.distributor_id).first();
    return c.json({ shop_name: r.shop_name, ...x, now, cutoffs: await cutoffsFor(db, r.distributor_id, r.id) });
  });
  app.get('/api/r/products', R, async (c) => c.json(await productsFor(c.env.DB, await meRet(c))));
  app.post('/api/r/demands', R, async (c) => c.json(await createDemand(c, await meRet(c), await c.req.json(), false)));
  app.get('/api/r/demands', R, async (c) => {
    const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
    return c.json(await decorate(c.env.DB, await all(c.env.DB.prepare('SELECT * FROM demands WHERE retailer_id=? AND demand_date>=? ORDER BY id DESC LIMIT 90').bind(c.get('u').pid, since))));
  });
  app.put('/api/r/demands/:id', R, async (c) => {  // edit items while still waiting for approval and before cutoff
    const b = await c.req.json(), db = c.env.DB, ret = await meRet(c), d = await db.prepare('SELECT * FROM demands WHERE id=? AND retailer_id=?').bind(c.req.param('id'), ret.id).first(), now = nowIST();
    if (!d) throw new Error('Demand not found');
    if (d.status !== 'submitted') throw new Error('Only demands waiting for approval can be edited');
    if (d.demand_date === now.date) { const co = await cutoffsFor(db, ret.distributor_id, ret.id); if (now.hm >= co[d.session]) throw new Error(`${d.session} cutoff (${co[d.session]}) has passed`); }
    const pm = new Map((await productsFor(db, ret)).map((p) => [p.product_id, p])), lines = await buildLines(db, b.items, (p) => pm.get(p.id)?.rate_paise);
    await db.prepare('UPDATE demands SET items_json=? WHERE id=?').bind(JSON.stringify(lines), d.id).run();
    return c.json({ ok: true, total_paise: sum(lines) });
  });
  app.post('/api/r/demands/:id/cancel', R, async (c) => {
    const r = await c.env.DB.prepare("UPDATE demands SET status='cancelled' WHERE id=? AND retailer_id=? AND status='submitted'").bind(c.req.param('id'), c.get('u').pid).run();
    if (!r.meta.changes) throw new Error('Only demands waiting for approval can be cancelled');
    return c.json({ ok: true });
  });
  app.get('/api/r/ledger', R, async (c) => { const e = await ledgerOf(c.env.DB, 'retailer', c.get('u').pid); return c.json({ entries: e, balance_paise: e.length ? e[e.length - 1].balance_paise : 0 }); });

  // ======== admin maintenance ========
  app.post('/api/admin/rebuild-balances', auth('admin'), async (c) => {
    const db = c.env.DB;
    await db.batch([db.prepare('DELETE FROM account_balances'), db.prepare('INSERT INTO account_balances SELECT account_type,account_id,SUM(dr_paise-cr_paise) FROM ledger_entries GROUP BY account_type,account_id')]);
    return c.json({ ok: true });
  });
}
