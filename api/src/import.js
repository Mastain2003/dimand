// Phase 5: bulk import from Excel/CSV rows (the browser reads the file and sends rows in small chunks).
// POST /api/admin/import {kind, rows, offset, dry_run}. dry_run only validates. Re-importing updates existing rows (matched by mobile / name).
import { all, nowIST, inList, bump } from './util.js';
import { hashPassword, tempPassword } from './auth.js';

const t = (v) => String(v ?? '').trim();
const normKey = (k) => String(k).toLowerCase().replace(/[\s_\-.]+/g, '');
const get = (r, ...names) => { for (const [k, v] of Object.entries(r)) if (names.includes(normKey(k))) return v; return ''; };
const mob = (v) => { let d = t(v).replace(/\D/g, ''); if (d.length > 10 && d.startsWith('91')) d = d.slice(-10); if (d.length === 11 && d[0] === '0') d = d.slice(1); return d.length === 10 ? d : null; };
const num = (v) => { const n = parseFloat(t(v).replace(/,/g, '')); return Number.isNaN(n) ? null : n; };
const time = (v) => { const s = t(v); if (!s) return ''; const m = s.match(/^(\d{1,2})(?::(\d\d))?(?::\d\d)?\s*(am|pm)?$/i); if (!m) return null; let h = +m[1]; const ap = (m[3] || '').toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return h > 23 ? null : `${String(h).padStart(2, '0')}:${m[2] || '00'}`; };
const lc = (s) => t(s).toLowerCase();

const KINDS = {
  async routes(rows, X, bad, R) {
    const seen = new Set();
    rows.forEach((r, i) => { const n = t(get(r, 'route', 'name', 'routename')); if (!n) return bad(i, 'Route name is empty'); if (seen.has(lc(n))) return bad(i, 'Duplicate route in this file'); seen.add(lc(n)); R.st.push(X.db.prepare('INSERT OR IGNORE INTO routes(name) VALUES(?)').bind(n)); R.ok++; });
  },
  async cities(rows, X, bad, R) {
    const routes = new Map((await all(X.db.prepare('SELECT id,name FROM routes'))).map((r) => [lc(r.name), r.id])), seen = new Set();
    rows.forEach((r, i) => {
      const n = t(get(r, 'city', 'name', 'cityname')), rn = t(get(r, 'route', 'routename'));
      if (!n) return bad(i, 'City name is empty'); if (!routes.has(lc(rn))) return bad(i, `Route "${rn}" not found (add it in the Routes sheet first)`); if (seen.has(lc(n))) return bad(i, 'Duplicate city in this file'); seen.add(lc(n));
      R.st.push(X.db.prepare('INSERT INTO cities(name,route_id) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET route_id=excluded.route_id').bind(n, routes.get(lc(rn)))); R.ok++;
    });
  },
  async pricelists(rows, X, bad, R) {
    rows.forEach((r, i) => {
      const n = t(get(r, 'name', 'pricelist', 'pricelistname')), ty = lc(get(r, 'type'));
      if (!n) return bad(i, 'Price list name is empty'); if (!['distributor', 'retailer', 'mrp', 'institutional'].includes(ty)) return bad(i, 'Type must be distributor, retailer, mrp or institutional');
      R.st.push(X.db.prepare('INSERT INTO price_lists(name,type,active) VALUES(?,?,1) ON CONFLICT(name) DO UPDATE SET type=excluded.type').bind(n, ty)); R.ok++;
    });
  },
  async products(rows, X, bad, R) {
    const db = X.db, pls = new Map((await all(db.prepare('SELECT id,name FROM price_lists'))).map((p) => [lc(p.name), p.id]));
    const names = [...new Set(rows.map((r) => t(get(r, 'product', 'name', 'productname'))).filter(Boolean))];
    const ex = new Map(names.length ? (await all(db.prepare(`SELECT id,name FROM products WHERE name IN (${inList(names)})`).bind(...names))).map((p) => [p.name, p.id]) : []);
    const KNOWN = ['product', 'name', 'productname', 'group', 'baseunit', 'unit', 'unit2', 'factor2', 'unit3', 'factor3', 'unit4', 'factor4', 'active', 'sno', 'srno', '#'], seen = new Set();
    rows.forEach((r, i) => {
      const name = t(get(r, 'product', 'name', 'productname')), base = t(get(r, 'baseunit', 'unit')), group = t(get(r, 'group')) || null;
      if (!name) return bad(i, 'Product name is empty'); if (!base) return bad(i, 'Base unit is empty (ltr, kg, nos ...)'); if (seen.has(name)) return bad(i, 'Duplicate product in this chunk'); seen.add(name);
      const units = []; for (const [u, f] of [['unit2', 'factor2'], ['unit3', 'factor3'], ['unit4', 'factor4']]) { const un = t(get(r, u)); if (!un) continue; const fv = num(get(r, f)); if (!(fv > 0)) return bad(i, `${u}: "${un}" needs a factor above 0 (how many ${base})`); if (lc(un) !== lc(base)) units.push([un, fv]); }
      const rates = []; let rowBad = false;
      for (const [k, v] of Object.entries(r)) {
        if (KNOWN.includes(normKey(k)) || t(v) === '') continue;
        const pl = pls.get(lc(k)); if (!pl) { R.warn.add(`Column "${k}" is not a price list name, ignored`); continue; }
        const n = num(v); if (n === null || n < 0) { bad(i, `Rate in "${k}" is not a number`); rowBad = true; break; } rates.push([pl, Math.round(n * 100)]);
      }
      if (rowBad) return;
      const aRaw = t(get(r, 'active')), active = aRaw === '' ? null : ['0', 'no', 'n', 'false', 'inactive'].includes(lc(aRaw)) ? 0 : 1, id = ex.get(name);
      const pid = id ? [String(id), []] : ['(SELECT id FROM products WHERE name=? ORDER BY id DESC LIMIT 1)', [name]];
      if (group) R.st.push(db.prepare('INSERT OR IGNORE INTO product_groups(name) VALUES(?)').bind(group));
      if (id) R.st.push(db.prepare('UPDATE products SET group_id=(SELECT id FROM product_groups WHERE name=?),base_unit=?,active=COALESCE(?,active) WHERE id=?').bind(group, base, active, id));
      else R.st.push(db.prepare('INSERT INTO products(name,group_id,base_unit,active) VALUES(?,(SELECT id FROM product_groups WHERE name=?),?,?)').bind(name, group, base, active ?? 0));
      R.st.push(db.prepare(`DELETE FROM product_units WHERE product_id=${pid[0]}`).bind(...pid[1]));
      for (const [un, f] of [[base, 1], ...units]) R.st.push(db.prepare(`INSERT INTO product_units(product_id,unit_name,factor) VALUES(${pid[0]},?,?)`).bind(...pid[1], un, f));
      for (const [pl, rp] of rates) R.st.push(db.prepare(`INSERT INTO price_list_items(price_list_id,product_id,rate_paise,effective_from) VALUES(?,${pid[0]},?,?) ON CONFLICT(price_list_id,product_id,effective_from) DO UPDATE SET rate_paise=excluded.rate_paise`).bind(pl, ...pid[1], rp, X.today));
      R.ok++;
    });
  },
  async distributors(rows, X, bad, R) {
    const db = X.db, cities = new Map((await all(db.prepare('SELECT id,name FROM cities'))).map((c) => [lc(c.name), c.id])), pls = new Map((await all(db.prepare("SELECT id,name FROM price_lists WHERE type='distributor'"))).map((p) => [lc(p.name), p.id]));
    const mobs = rows.map((r) => mob(get(r, 'mobile', 'phone', 'mobileno'))).filter(Boolean), ex = new Map(mobs.length ? (await all(db.prepare(`SELECT mobile,role,party_id FROM users WHERE mobile IN (${inList(mobs)})`).bind(...mobs))).map((u) => [u.mobile, u]) : []), seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], name = t(get(r, 'name', 'distributor', 'distributorname')), city = t(get(r, 'city')), m = mob(get(r, 'mobile', 'phone', 'mobileno')), plName = t(get(r, 'pricelist', 'distributorpricelist')), gstin = t(get(r, 'gstin')) || null, am = time(get(r, 'amcutoff', 'am')), pm = time(get(r, 'pmcutoff', 'pm'));
      if (!name) { bad(i, 'Distributor name is empty'); continue; } if (!cities.has(lc(city))) { bad(i, `City "${city}" not found (add it in the Cities sheet first)`); continue; }
      if (!m) { bad(i, 'Mobile must be a 10-digit number'); continue; } if (seen.has(m)) { bad(i, 'Same mobile appears twice in this chunk'); continue; } seen.add(m);
      if (plName && !pls.has(lc(plName))) { bad(i, `Price list "${plName}" is not a distributor-type price list`); continue; } if (am === null || pm === null) { bad(i, 'Cutoff times must look like 09:00'); continue; }
      const pl = plName ? pls.get(lc(plName)) : null, u = ex.get(m);
      if (u && u.role !== 'distributor') { bad(i, 'This mobile already belongs to another kind of user'); continue; }
      if (u) { R.st.push(db.prepare('UPDATE distributors SET name=?,city_id=?,gstin=COALESCE(?,gstin),price_list_id=COALESCE(?,price_list_id) WHERE id=?').bind(name, cities.get(lc(city)), gstin, pl, u.party_id)); if (am || pm) R.st.push(db.prepare('INSERT INTO distributor_cutoffs(distributor_id,am_cutoff,pm_cutoff) VALUES(?,?,?) ON CONFLICT(distributor_id) DO UPDATE SET am_cutoff=COALESCE(?,am_cutoff),pm_cutoff=COALESCE(?,pm_cutoff)').bind(u.party_id, am || '09:00', pm || '16:00', am || null, pm || null)); }
      else {
        const pw = X.dry ? '' : tempPassword(), hash = X.dry ? '' : await hashPassword(pw, 1000);   // temporary password; the user must change it at first login
        R.st.push(db.prepare('INSERT INTO distributors(name,city_id,gstin,price_list_id) VALUES(?,?,?,?)').bind(name, cities.get(lc(city)), gstin, pl),
          db.prepare("INSERT INTO users(mobile,name,role,party_id,password_hash) VALUES(?,?,'distributor',last_insert_rowid(),?)").bind(m, name, hash),
          db.prepare('INSERT INTO distributor_cutoffs(distributor_id,am_cutoff,pm_cutoff) VALUES((SELECT party_id FROM users WHERE mobile=?),?,?)').bind(m, am || '09:00', pm || '16:00'));
        R.creds.push({ role: 'distributor', name, mobile: m, password: pw });
      }
      R.ok++;
    }
  },
  async retailers(rows, X, bad, R) {
    const db = X.db, dists = await all(db.prepare("SELECT d.id,d.name,u.mobile FROM distributors d LEFT JOIN users u ON u.role='distributor' AND u.party_id=d.id")), byKey = new Map();
    dists.forEach((d) => { for (const k of [lc(d.name), d.mobile]) if (k) byKey.set(k, byKey.has(k) ? 'dup' : d); });
    const pls = new Map((await all(db.prepare("SELECT id,name,type FROM price_lists WHERE type IN ('retailer','institutional')"))).map((p) => [lc(p.name), p])), dflt = (await db.prepare("SELECT id FROM price_lists WHERE type='retailer' AND active=1 ORDER BY id LIMIT 1").first('id')) ?? null;
    const mobs = rows.map((r) => mob(get(r, 'mobile', 'phone', 'mobileno'))).filter(Boolean), ex = new Map(mobs.length ? (await all(db.prepare(`SELECT u.mobile,u.role,u.party_id,r.distributor_id FROM users u LEFT JOIN retailers r ON u.role='retailer' AND r.id=u.party_id WHERE u.mobile IN (${inList(mobs)})`).bind(...mobs))).map((u) => [u.mobile, u]) : []), seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], shop = t(get(r, 'shopname', 'shop', 'retailer', 'name')), dn = t(get(r, 'distributor', 'distributorname', 'distributormobile')), m = mob(get(r, 'mobile', 'phone', 'mobileno')), plName = t(get(r, 'pricelist', 'retailerpricelist')), addr = t(get(r, 'address')) || null, gstin = t(get(r, 'gstin')) || null;
      if (!shop) { bad(i, 'Shop name is empty'); continue; } const d = byKey.get(lc(dn)) || byKey.get(mob(dn) || ''); if (d === 'dup') { bad(i, `Distributor "${dn}" matches more than one distributor; use the distributor's mobile number`); continue; } if (!d) { bad(i, `Distributor "${dn}" not found`); continue; }
      if (!m) { bad(i, 'Mobile must be a 10-digit number'); continue; } if (seen.has(m)) { bad(i, 'Same mobile appears twice in this chunk'); continue; } seen.add(m);
      if (plName && !pls.has(lc(plName))) { bad(i, `Price list "${plName}" is not a retailer/institutional price list`); continue; } const pl = plName ? pls.get(lc(plName)).id : dflt, u = ex.get(m);
      if (u && u.role !== 'retailer') { bad(i, 'This mobile already belongs to another kind of user'); continue; } if (u && u.distributor_id !== d.id) { bad(i, 'This retailer already belongs to another distributor'); continue; }
      if (u) R.st.push(db.prepare('UPDATE retailers SET shop_name=?,address=COALESCE(?,address),gstin=COALESCE(?,gstin),price_list_id=COALESCE(?,price_list_id) WHERE id=?').bind(shop, addr, gstin, plName ? pl : null, u.party_id));
      else {
        const pw = X.dry ? '' : tempPassword(), hash = X.dry ? '' : await hashPassword(pw, 1000);
        R.st.push(db.prepare('INSERT INTO retailers(distributor_id,shop_name,address,gstin,price_list_id) VALUES(?,?,?,?,?)').bind(d.id, shop, addr, gstin, pl), db.prepare("INSERT INTO users(mobile,name,role,party_id,password_hash) VALUES(?,?,'retailer',last_insert_rowid(),?)").bind(m, shop, hash));
        R.creds.push({ role: 'retailer', name: shop, mobile: m, password: pw, distributor: d.name });
      }
      R.ok++;
    }
  },
  async balances(rows, X, bad, R) {   // opening balances: one ledger entry per account, only once
    const db = X.db, dists = await all(db.prepare("SELECT d.id,d.name,u.mobile FROM distributors d LEFT JOIN users u ON u.role='distributor' AND u.party_id=d.id")), dm = new Map();
    dists.forEach((d) => { dm.set(lc(d.name), d); if (d.mobile) dm.set(d.mobile, d); });
    const mobs = rows.map((r) => mob(get(r, 'who', 'mobile', 'retailer', 'name'))).filter(Boolean), rm = new Map(mobs.length ? (await all(db.prepare(`SELECT mobile,party_id FROM users WHERE role='retailer' AND mobile IN (${inList(mobs)})`).bind(...mobs))).map((u) => [u.mobile, u.party_id]) : []);
    const acc = rows.map((r) => { const ty = lc(get(r, 'type')), w = t(get(r, 'who', 'mobile', 'retailer', 'name')); return ty === 'retailer' ? ['retailer', rm.get(mob(w))] : ty === 'distributor' ? ['distributor', (dm.get(lc(w)) || dm.get(mob(w) || ''))?.id] : [null, null]; });
    const have = new Set(); for (const ty of ['retailer', 'distributor']) { const ids = acc.filter((a) => a[0] === ty && a[1]).map((a) => a[1]); if (ids.length) (await all(db.prepare(`SELECT account_id FROM ledger_entries WHERE account_type=? AND source_type='opening' AND account_id IN (${inList(ids)})`).bind(ty, ...ids))).forEach((x) => have.add(ty + x.account_id)); }
    const seen = new Set();
    rows.forEach((r, i) => {
      const [ty, id] = acc[i], amount = num(get(r, 'amount')), dc = lc(get(r, 'drcr', 'dr/cr', 'drorcr')) || 'dr', date = t(get(r, 'date')) || X.today;
      if (!ty) return bad(i, 'Type must be retailer or distributor'); if (!id) return bad(i, `${ty} "${t(get(r, 'who', 'mobile', 'retailer', 'name'))}" not found (import them first)`);
      if (!(amount > 0)) return bad(i, 'Amount must be above 0'); if (!['dr', 'cr'].includes(dc)) return bad(i, 'Dr/Cr must be Dr (they owe) or Cr (advance)'); if (!/^\d{4}-\d\d-\d\d$/.test(date)) return bad(i, 'Date must look like 2026-04-01');
      if (have.has(ty + id) || seen.has(ty + id)) return bad(i, 'An opening balance already exists for this account'); seen.add(ty + id);
      const p = Math.round(amount * 100), sign = dc === 'dr' ? 1 : -1;
      R.st.push(db.prepare("INSERT INTO ledger_entries(account_type,account_id,entry_date,dr_paise,cr_paise,source_type,source_id) VALUES(?,?,?,?,?,'opening',0)").bind(ty, id, date, sign > 0 ? p : 0, sign < 0 ? p : 0), bump(db, ty, id, sign * p)); R.ok++;
    });
  },
};

export function mountImport(app, { auth }) {
  app.post('/api/admin/import', auth('admin'), async (c) => {
    const b = await c.req.json(), h = KINDS[b.kind], rows = Array.isArray(b.rows) ? b.rows : [];
    if (!h) throw new Error('Unknown sheet type'); if (rows.length > 60) throw new Error('Send at most 60 rows at a time');
    const R = { st: [], errors: [], creds: [], ok: 0, warn: new Set() }, off = +b.offset || 0, X = { db: c.env.DB, dry: !!b.dry_run, today: nowIST().date };
    await h(rows, X, (i, message) => R.errors.push({ row: off + i + 2, message }), R);   // row numbers match the Excel row (row 1 = header)
    if (!X.dry && R.st.length) await c.env.DB.batch(R.st);
    return c.json({ kind: b.kind, total: rows.length, valid: R.ok, errors: R.errors, warnings: [...R.warn], credentials: X.dry ? [] : R.creds, dry_run: X.dry });
  });
}
