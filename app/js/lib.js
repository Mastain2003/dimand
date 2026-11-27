import { h } from './ui.js';
export const money = (p) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const rateStr = (p) => String(+(p / 100).toFixed(4));
export const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const dshort = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const lineAmt = (l) => Math.round(l.qty_base * l.rate_paise);
export const total = (lines) => (lines || []).reduce((s, l) => s + lineAmt(l), 0);
export const balText = (p) => (p > 0 ? `${money(p)} due` : p < 0 ? `${money(-p)} advance` : '₹0');
export const STATUS = { submitted: 'Waiting', approved: 'Approved', part_dispatched: 'Part dispatched', dispatched: 'Dispatched', rejected: 'Rejected', cancelled: 'Cancelled' };
export const statusTag = (s) => h('span', { class: 'tag ' + (['rejected', 'cancelled'].includes(s) ? 'off' : '') }, STATUS[s] || s);
export const itemsText = (lines) => lines.map((l) => `${l.name} ${l.qty} ${l.unit}`).join(', ');
// Greedy conversion of base-unit quantity into units, e.g. 30 ltr -> "2 crate + 6 ltr"
export function qtyText(units, base, q) {
  const out = []; for (const u of [...units].sort((a, b) => b.factor - a.factor)) { const c = Math.floor(q / u.factor + 1e-9); if (c > 0) { out.push(`${c} ${u.unit_name}`); q -= c * u.factor; } }
  if (q > 1e-9) out.push(`${+q.toFixed(2)} ${base}`); return out.join(' + ') || '0';
}
export function ledgerTable(entries, onReverse) {
  const detail = (e) => e.source_type === 'demand_dispatch' ? `Dispatch · demand #${e.demand_id}${e.session ? ' ' + e.session : ''}` : e.source_type === 'company_dispatch' ? `Dispatch · order #${e.order_id}${e.session ? ' ' + e.session : ''}` : e.source_type === 'opening' ? 'Opening balance' : e.source_type === 'reversal' ? 'Payment reversed' : `Payment${e.mode ? ' · ' + e.mode : ''}${e.note ? ' · ' + e.note : ''}`;
  if (!entries.length) return h('p', { class: 'mu' }, 'No entries yet.');
  return h('div', { style: 'overflow-x:auto' }, h('table', { class: 'led' }, h('tr', {}, ['Date', 'Detail', 'Dispatch', 'Paid', 'Balance'].map((x) => h('th', {}, x))),
    [...entries].reverse().map((e) => h('tr', {}, h('td', {}, dshort(e.entry_date)), h('td', { style: 'text-align:left;white-space:normal' }, detail(e), onReverse && e.source_type === 'payment' && !e.reversed && h('button', { class: 'x', style: 'font-size:12px', onclick: () => onReverse(e) }, 'reverse'), e.reversed && source(e)),
      h('td', {}, e.dr_paise ? money(e.dr_paise) : ''), h('td', {}, e.cr_paise ? money(e.cr_paise) : ''), h('td', {}, money(e.balance_paise))))));
}
const source = () => h('small', {}, ' (reversed)');
export const fmtTime = (at) => new Date(at.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });


// Final quantities are always shown in the base unit (nos), never as "2 crate + 6".
export const lineQty = (units, l) => `${+(+l.qty_base).toFixed(2)} ${l.base_unit}`;
export const nosText = (lines) => lines.map((l) => `${l.name} ${+(+l.qty_base).toFixed(2)} ${l.base_unit}`).join(', ');
// What a retailer typed, with the nos total: "Milk 2 crate (24 nos)"
export const packText = (lines) => lines.map((l) => `${l.name} ${l.qty} ${l.unit}${l.unit !== l.base_unit ? ` (${+(+l.qty_base).toFixed(2)} ${l.base_unit})` : ''}`).join(', ');
// Units an order can be taken in: packs (nos, crate, jar, box ...), never litre/kg/g/ml. `keep` = a unit already used (old demands).
const MEASURE = new Set(['ltr', 'litre', 'liter', 'litres', 'liters', 'l', 'lt', 'kg', 'kgs', 'kilo', 'g', 'gm', 'gms', 'gram', 'grams', 'ml']);
export const isMeasure = (u) => MEASURE.has(String(u).trim().toLowerCase());
export function orderUnits(units, keep) {
  const sorted = [...units].sort((a, b) => a.factor - b.factor), ok = sorted.filter((u) => !isMeasure(u.unit_name) || u.unit_name === keep);
  return ok.length ? ok : sorted;   // a product with only litre/kg units can still be ordered
}
// Products grouped by product group (groups A-Z, "Other" last): [[groupName, [products]], ...]
export function groupProducts(prods) {
  const m = new Map();
  [...prods].sort((a, b) => (a.group_name || '\uffff').localeCompare(b.group_name || '\uffff') || a.name.localeCompare(b.name)).forEach((p) => { const k = p.group_name || 'Other'; if (!m.has(k)) m.set(k, []); m.get(k).push(p); });
  return [...m];
}
