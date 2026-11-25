import { put, h, seg, loading, fail, toast } from '../ui.js';
import { api } from '../api.js';
import { money, istToday } from '../lib.js';
import { hbars, lineChart } from '../charts.js';

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const F = { level: 'company', range: '30', from: '', to: '', session: '', route_id: '', city_id: '', distributor_id: '', group_id: '', product_id: '', metric: 'amount', by: 'distributor', cmp: '' };
let lookups = null;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortMoney = (p) => { const r = p / 100; return r >= 1e7 ? '₹' + +(r / 1e7).toFixed(1) + 'Cr' : r >= 1e5 ? '₹' + +(r / 1e5).toFixed(1) + 'L' : r >= 1e3 ? '₹' + +(r / 1e3).toFixed(1) + 'k' : '₹' + Math.round(r); };
const pct = (cur, prev) => (prev > 0 ? `${cur >= prev ? '+' : '−'}${Math.abs(Math.round(((cur - prev) / prev) * 100))}%` : '');
const cls = (cur, prev) => (prev > 0 ? (cur >= prev ? 'up' : 'dn') : '');

function range() {
  const to = F.range === 'custom' ? F.to || istToday() : istToday(), from = F.range === 'custom' ? F.from || addDays(to, -29) : F.range === 'year' ? `${to.slice(0, 4)}-01-01` : addDays(to, -(+F.range - 1));
  return { from, to };
}
const qs = (extra = {}) => { const q = new URLSearchParams({ level: F.level }); for (const k of ['session', 'route_id', 'city_id', 'distributor_id', 'group_id', 'product_id']) if (F[k]) q.set(k, F[k]); for (const [k, v] of Object.entries(extra)) q.set(k, v); return q; };

export async function dashboard(root, ctx) {
  loading(root);
  try { if (!lookups) { const [routes, cities, dists, groups, prods] = await Promise.all([api('/routes'), api('/cities'), api('/distributors'), api('/groups'), api('/products')]); lookups = { routes, cities, dists, groups, prods }; } } catch (e) { return fail(root, e); }
  const { from, to } = range(), cmpDate = F.cmp || addDays(istToday(), -1), L = lookups;
  const prod = F.product_id ? L.prods.find((p) => p.id === +F.product_id) : null, metric = F.metric === 'qty' && prod ? 'qty' : 'amount';
  const fmt = (v, short) => (metric === 'amount' ? (short ? shortMoney(v) : money(Math.round(v))) : `${+(+v).toFixed(short ? 0 : 1)} ${short ? '' : prod.base_unit}`.trim());
  let cmp, trend, brk;
  try { [cmp, trend, brk] = await Promise.all([api('/c/reports/compare?' + qs({ date: cmpDate })), api('/c/reports/trend?' + qs({ from, to })), api('/c/reports/breakdown?' + qs({ from, to, by: F.by }))]); } catch (e) { return fail(root, e); }
  const redraw = () => dashboard(root, ctx), V = (o) => (metric === 'amount' ? o.amount : o.qty);
  const sel = (key, label, opts, onchange) => h('label', {}, h('span', {}, label), (() => { const e = h('select', { onchange: () => { F[key] = e.value; onchange && onchange(); redraw(); } }, h('option', { value: '' }, 'All'), opts.map((o) => h('option', { value: o.id }, o.name))); e.value = F[key]; return e; })());
  const cities = L.cities.filter((c) => !F.route_id || c.route_id === +F.route_id), dists = L.dists.filter((d) => (!F.route_id || d.route_id === +F.route_id) && (!F.city_id || d.city_id === +F.city_id)), prods = L.prods.filter((p) => !F.group_id || p.group_id === +F.group_id);
  // trend series with zero-filled gaps
  const keys = [], step = trend.bucket === 'day' ? (d) => addDays(d, 1) : (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
  for (let k = trend.bucket === 'day' ? trend.from : trend.from.slice(0, 7), end = trend.bucket === 'day' ? trend.to : trend.to.slice(0, 7); k <= end && keys.length < 400; k = step(k)) keys.push(k);
  const cur = new Map(trend.rows.map((r) => [r.d, V(r)])), prv = new Map(trend.prev.map((r) => [r.d, V(r)])), lab = (k) => (trend.bucket === 'day' ? `${+k.slice(8)} ${MON[+k.slice(5, 7) - 1]}` : `${MON[+k.slice(5, 7) - 1]} ${k.slice(2, 4)}`);
  const total = keys.reduce((s, k) => s + (cur.get(k) || 0), 0), totalPrev = keys.reduce((s, k) => s + (prv.get(k) || 0), 0);
  const cmpRows = [['Selected day', V(cmp.value)], ['Same day last year', V(cmp.ly_same_day), cmp.ly_date], [`Last year, per day`, V(cmp.ly_avg)], ['Last month, per day', V(cmp.lm_avg)]];
  put(root, h('h2', {}, 'Dashboard'),
    seg([['company', 'To distributors'], ['distributor', 'To retailers']], F.level, (k) => { F.level = k; redraw(); }),
    seg([['7', '7d'], ['30', '30d'], ['90', '90d'], ['year', 'Year'], ['custom', 'Custom']], F.range, (k) => { F.range = k; redraw(); }),
    F.range === 'custom' && h('div', { class: 'filters' }, h('label', {}, h('span', {}, 'From'), h('input', { type: 'date', value: F.from || from, onchange: (e) => { F.from = e.target.value; redraw(); } })), h('label', {}, h('span', {}, 'To'), h('input', { type: 'date', value: F.to || to, onchange: (e) => { F.to = e.target.value; redraw(); } }))),
    h('div', { class: 'card', style: 'margin-top:8px' }, h('div', { class: 'filters' }, sel('route_id', 'Route', L.routes, () => { F.city_id = ''; F.distributor_id = ''; }), sel('city_id', 'City', cities, () => { F.distributor_id = ''; }), sel('distributor_id', 'Distributor', dists), sel('session', 'Session', [{ id: 'AM', name: 'AM' }, { id: 'PM', name: 'PM' }]),
      sel('group_id', 'Product group', L.groups, () => { F.product_id = ''; }), sel('product_id', 'Product', prods)),
      h('div', { style: 'margin-top:8px' }, seg([['amount', '₹ Amount'], ['qty', 'Quantity']], metric, (k) => { if (k === 'qty' && !prod) return toast('Pick a product to see quantity'); F.metric = k; redraw(); }), h('small', {}, prod ? `Quantity is in ${prod.base_unit}.` : 'Quantity needs one product selected.'))),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, `${lab(keys[0] || from)} – ${lab(keys[keys.length - 1] || to)}`), h('b', { style: 'font-size:20px' }, fmt(total))), totalPrev > 0 ? h('small', {}, `Same period last year ${fmt(totalPrev)} `, h('b', { class: cls(total, totalPrev) }, pct(total, totalPrev))) : h('small', {}, 'No data for the same period last year'),
      h('div', { style: 'margin-top:8px' }, lineChart(keys.map(lab), keys.map((k) => cur.get(k) || 0), keys.map((k) => prv.get(k) || 0), fmt)), h('div', { class: 'legend' }, h('span', {}, h('i'), 'This period'), h('span', {}, h('i', { class: 'p' }), 'Last year'))),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, 'Compare a day'), h('input', { type: 'date', style: 'width:auto', value: cmp.date, onchange: (e) => { F.cmp = e.target.value; redraw(); } })),
      hbars(cmpRows.map(([label, v], i) => ({ label, v, alt: i > 0 })), fmt), h('div', { style: 'margin-top:6px' }, cmpRows.slice(1).map(([label, v]) => h('div', { class: 'row' }, h('small', {}, `vs ${label.toLowerCase()}`), h('b', { class: cls(cmpRows[0][1], v) }, pct(cmpRows[0][1], v) || '–')))), h('small', {}, `Averages are per calendar day: last year = ${cmp.notes.ly_avg}; last month = ${cmp.notes.lm_avg}.`)),
    h('div', { class: 'card' }, h('b', {}, 'Compare'), seg([['distributor', 'Distributor'], ['city', 'City'], ['route', 'Route'], ['product', 'Product'], ['group', 'Group'], ['session', 'AM/PM']], F.by, (k) => { F.by = k; redraw(); }),
      brk.rows.length ? [hbars(brk.rows.slice(0, 15).map((r) => ({ label: r.label, v: V({ amount: r.amount, qty: r.qty }), ghost: metric === 'amount' ? r.prev_amount : r.prev_qty, note: ` ${pct(V({ amount: r.amount, qty: r.qty }), metric === 'amount' ? r.prev_amount : r.prev_qty)}` })), fmt), h('div', { class: 'legend' }, h('span', {}, h('i'), 'This period'), h('span', {}, h('i', { style: 'background:var(--er);width:2px;height:10px' }), 'Same period last year'))] : h('p', { class: 'mu' }, 'No sales in this period yet. Sales appear here when dispatches are recorded.'),
      brk.bucket === 'month' ? h('small', {}, 'Periods over 92 days are counted in whole months.') : null));
}
