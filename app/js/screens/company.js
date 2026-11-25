import { put, h, formModal, seg, toast, loading, fail, paise } from '../ui.js';
import { api } from '../api.js';
import { money, istToday, dshort, statusTag, ledgerTable, balText, lineQty, lineAmt, total } from '../lib.js';
import { linesSheet, dispatchDialog } from './shared.js';
import { products } from './products.js';
import { priceLists } from './prices.js';
import { masters } from './masters.js';
import { distributors } from './dist.js';

const F = { status: 'new', session: '', date: istToday() };
const SQ = { new: 'sent', open: 'accepted,part_dispatched', done: 'dispatched,rejected,cancelled' };
const MODES = ['Cash', 'UPI', 'Cheque', 'Bank transfer'].map((m) => ({ v: m, l: m }));

export async function orders(root, ctx) {
  loading(root);
  const q = new URLSearchParams({ status: SQ[F.status] }); if (F.session) q.set('session', F.session); if (F.date) q.set('date', F.date);
  const sq = new URLSearchParams(); if (F.date) sq.set('date', F.date); if (F.session) sq.set('session', F.session);
  let os, perms, sum = null;
  try { [os, perms] = await Promise.all([api('/c/orders?' + q), api('/c/perms')]); if (F.date) sum = await api('/c/summary?' + sq); } catch (e) { return fail(root, e); }
  const reload = () => orders(root, ctx);
  const edit = async (o) => { let prods; try { prods = await api(`/c/distributors/${o.distributor_id}/products`); } catch (e) { return toast(e.message); }
    linesSheet({ title: `Edit order #${o.id} · ${o.distributor_name}`, intro: 'Change quantities or rates, add or remove products. The distributor is notified.', lines: o.approved || o.items, prods, noteLabel: 'Reason (optional, shown to distributor)', saveLabel: 'Save & accept',
      onSave: async (items, note) => { await api('/c/orders/' + o.id, { method: 'PUT', body: { items, note } }); toast('Order updated'); reload(); } }); };
  const reject = (o) => formModal('Reject order', [{ k: 'reason', label: `Reason for rejecting #${o.id}` }], {}, async (x) => { await api(`/c/orders/${o.id}/reject`, { method: 'POST', body: { reason: x.reason } }); toast('Rejected'); reload(); }, 'Reject');
  const session = (o) => formModal('Change session', [{ k: 's', label: `Order #${o.id} is ${o.session}. Move to:`, type: 'select', options: [{ v: 'AM', l: 'AM' }, { v: 'PM', l: 'PM' }] }, { k: 'note', label: 'Note (optional)' }], { s: o.session === 'AM' ? 'PM' : 'AM' }, async (x) => { await api(`/c/orders/${o.id}/session`, { method: 'PATCH', body: { session: x.s, note: x.note } }); toast('Session changed'); reload(); });
  const accept = async (o) => { try { await api(`/c/orders/${o.id}/accept`, { method: 'POST' }); toast('Accepted'); reload(); } catch (e) { toast(e.message); } };
  const create = async () => {
    const ds = await api('/distributors'); const act = ds.filter((d) => d.active && d.price_list_id); if (!act.length) return toast('No distributor with a price list yet');
    formModal('Order on behalf of a distributor', [{ k: 'did', label: 'Distributor', type: 'select', options: act.map((d) => ({ v: d.id, l: `${d.name} (${d.city_name})` })) }, { k: 's', label: 'Session', type: 'select', options: [{ v: 'AM', l: 'AM' }, { v: 'PM', l: 'PM' }] }, { k: 'date', label: 'Date', type: 'date' }], { date: istToday() }, async (x) => {
      const prods = await api(`/c/distributors/${x.did}/products`);
      linesSheet({ title: 'New order', intro: 'After the distributor cutoff a note is required (for example "per phone call").', lines: [], prods, noteLabel: 'Note (required after cutoff)', saveLabel: 'Create order',
        onSave: async (items, note) => { if (!items.length) throw new Error('Add at least one product'); const r = await api(`/c/distributors/${x.did}/orders`, { method: 'POST', body: { session: x.s, date: x.date, items, note } }); toast(r.override ? 'Order created (cutoff override logged)' : 'Order created'); reload(); } });
    }, 'Next');
  };
  const card = (o) => { const lines = o.approved || o.items;
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, `${o.distributor_name}`), statusTag(o.status === 'sent' ? 'submitted' : o.status)), h('small', {}, `#${o.id} · ${o.city_name} · ${o.session} · ${dshort(o.order_date)}${o.is_supplementary ? ' · supplementary' : ''}`),
      lines.map((l) => h('div', { class: 'row' }, h('span', {}, `${l.name}: ${lineQty(o.units, l)}`), h('small', {}, o.dispatched_base[l.product_id] ? `sent ${+o.dispatched_base[l.product_id].toFixed(2)}/${l.qty_base}` : ''))), h('b', {}, money(total(lines))),
      h('div', { class: 'wrap' }, o.status === 'sent' && perms.approve_orders && h('button', { class: 'btn sm', onclick: () => accept(o) }, 'Accept'),
        ['sent', 'accepted'].includes(o.status) && perms.approve_orders && h('button', { class: 'btn sm ghost', onclick: () => edit(o) }, 'Edit'),
        ['sent', 'accepted', 'part_dispatched'].includes(o.status) && perms.dispatch && h('button', { class: 'btn sm', onclick: () => dispatchDialog({ title: `Dispatch · ${o.distributor_name} #${o.id}`, lines, got: o.dispatched_base, url: `/c/orders/${o.id}/dispatch`, done: reload }) }, 'Dispatch'),
        ['sent', 'accepted'].includes(o.status) && perms.approve_orders && h('button', { class: 'btn sm ghost', onclick: () => session(o) }, 'Change session'),
        ['sent', 'accepted'].includes(o.status) && perms.approve_orders && h('button', { class: 'btn sm ghost', onclick: () => reject(o) }, 'Reject'))); };
  put(root, h('div', { class: 'row' }, h('h2', {}, 'Distributor orders'), perms.approve_orders && h('button', { class: 'btn', onclick: create }, '+ New')),
    seg([['new', 'New'], ['open', 'To dispatch'], ['done', 'Done']], F.status, (k) => { F.status = k; reload(); }), seg([['', 'AM + PM'], ['AM', 'AM'], ['PM', 'PM']], F.session, (k) => { F.session = k; reload(); }),
    h('label', {}, h('span', {}, 'Date (empty = all dates)'), h('input', { type: 'date', value: F.date, onchange: (e) => { F.date = e.target.value; reload(); } })),
    sum && sum.products.length > 0 && h('div', { class: 'card', style: 'margin-top:10px' }, h('b', {}, `Total demand · ${dshort(sum.date)}${F.session ? ' ' + F.session : ''}`),
      sum.products.map((p) => h('div', { class: 'row' }, h('span', {}, p.name), h('b', {}, lineQty(sum.units, { product_id: p.product_id, base_unit: p.base_unit, qty_base: p.qty_base })))), h('h3', {}, 'By distributor'),
      sum.distributors.map((d) => h('div', { class: 'row' }, h('span', {}, `${d.name} (${d.orders})`), h('span', {}, money(d.amount_paise))))),
    h('div', { style: 'height:8px' }), os.length ? os.map(card) : h('p', { class: 'mu' }, 'No orders here.'));
}

let cur = null;
export async function ledgers(root, ctx) {
  if (cur) return ledgerDetail(root, ctx);
  loading(root);
  let ls; try { ls = await api('/c/ledgers'); } catch (e) { return fail(root, e); }
  const t = ls.reduce((s, l) => s + l.balance_paise, 0);
  put(root, h('h2', {}, 'Distributor ledgers'), h('div', { class: 'card row' }, h('span', {}, 'Total receivable'), h('b', {}, money(t))),
    ls.map((l) => h('div', { class: 'card row', onclick: () => { cur = l; ledgers(root, ctx); } }, h('div', {}, h('b', {}, l.name), h('div', { class: 'mu' }, l.city_name)), h('b', { class: l.balance_paise > 0 ? 'err' : '' }, balText(l.balance_paise)))));
}
async function ledgerDetail(root, ctx) {
  loading(root);
  let L, perms; try { [L, perms] = await Promise.all([api(`/c/distributors/${cur.id}/ledger`), api('/c/perms')]); } catch (e) { cur = null; return fail(root, e); }
  const again = () => ledgerDetail(root, ctx), bal = L.entries.length ? L.entries[L.entries.length - 1].balance_paise : 0;
  const pay = () => formModal('Payment from distributor', [{ k: 'amount', label: 'Amount (₹)', type: 'number' }, { k: 'mode', label: 'Mode', type: 'select', options: MODES }, { k: 'date', label: 'Date', type: 'date' }, { k: 'note', label: 'Note (optional)' }], { date: istToday() },
    async (o) => { const p = paise(o.amount); if (!p || p <= 0) throw new Error('Enter an amount'); await api('/c/payments', { method: 'POST', body: { distributor_id: cur.id, amount_paise: p, mode: o.mode, pay_date: o.date, note: o.note } }); toast('Payment saved'); again(); });
  const reverse = (e) => formModal('Reverse payment', [{ k: 'reason', label: `Reverse ${money(e.cr_paise)} paid on ${dshort(e.entry_date)}? Reason:` }], {}, async (o) => { await api(`/c/payments/${e.pay_id}/reverse`, { method: 'POST', body: { reason: o.reason } }); toast('Reversed'); again(); }, 'Reverse');
  put(root, h('button', { class: 'btn sm ghost', onclick: () => { cur = null; ledgers(root, ctx); } }, '← All distributors'), h('h2', {}, cur.name), h('div', { class: 'card row' }, h('span', {}, 'Balance'), h('b', { style: 'font-size:20px' }, balText(bal))),
    perms.admin && h('div', { class: 'wrap' }, h('button', { class: 'btn sm', onclick: pay }, '+ Payment received')), h('h3', {}, 'Ledger'), h('div', { class: 'card' }, ledgerTable(L.entries, perms.admin ? reverse : null)));
}

let sub = 'dist';
export async function catalog(root, ctx) {
  const body = h('div');
  put(root, seg([['dist', 'Distributors'], ['prod', 'Products'], ['price', 'Price lists'], ['geo', 'Routes']], sub, (k) => { sub = k; catalog(root, ctx); }), body);
  ({ dist: distributors, prod: products, price: priceLists, geo: masters })[sub](body, ctx);
}
