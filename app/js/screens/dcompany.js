import { put, h, seg, toast, loading, fail } from '../ui.js';
import { api } from '../api.js';
import { money, istToday, dshort, statusTag, ledgerTable, balText, lineQty, total } from '../lib.js';

let tab = 'send', sdate = istToday(), ssess = 'AM';
export async function dCompany(root, ctx) {
  const body = h('div'), again = () => dCompany(root, ctx);
  put(root, h('h2', {}, 'Company'), seg([['send', 'Send order'], ['orders', 'My orders'], ['ledger', 'Account']], tab, (k) => { tab = k; again(); }), body);
  ({ send: sendView, orders: ordersView, ledger: ledgerView })[tab](body, ctx, again);
}
async function sendView(root, ctx, again) {
  loading(root);
  let p; try { p = await api(`/d/company-orders/preview?date=${sdate}&session=${ssess}`); } catch (e) { return fail(root, e); }
  const send = async () => { try { const r = await api('/d/company-orders', { method: 'POST', body: { date: sdate, session: ssess } }); toast(`Order #${r.id} sent to the company`); tab = 'orders'; again(); } catch (e) { toast(e.message); } };
  const can = p.open && p.items.length && !p.missing.length;
  put(root, h('div', { class: 'row' }, h('label', { style: 'flex:1' }, h('span', {}, 'For date'), h('input', { type: 'date', value: sdate, onchange: (e) => { sdate = e.target.value || istToday(); again(); } }))),
    seg([['AM', 'AM'], ['PM', 'PM']], ssess, (k) => { ssess = k; again(); }),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, `${p.session} · ${dshort(p.date)}`), h('span', { class: 'tag ' + (p.open ? '' : 'off') }, p.open ? `Open till ${p.cutoff}` : `Cutoff ${p.cutoff} passed`)),
      p.is_supplementary && h('small', {}, 'An order for this session was already sent, so this will go as a supplementary order.'),
      p.items.length ? [p.items.map((l) => h('div', { class: 'row', style: 'padding:4px 0;border-bottom:1px solid var(--ln)' }, h('span', {}, `${l.name}: ${lineQty(p.units, l)}`), h('span', { class: 'mu' }, money(Math.round(l.qty_base * l.rate_paise))))),
        h('div', { class: 'row', style: 'margin-top:8px' }, h('b', {}, 'Payable to company'), h('b', {}, money(p.total_paise))), h('small', {}, `From ${p.demands.length} retailer demand(s): ${p.demands.map((d) => d.shop_name).join(', ')}`)] : h('p', { class: 'mu' }, 'No approved retailer demands are waiting for this session. Approve demands first (Demands tab).'),
      p.missing.length > 0 && h('div', { class: 'err' }, 'The company has not set a price for: ' + p.missing.join(', ')),
      !p.open && h('div', { class: 'err' }, 'You cannot send after the cutoff. Please call the company; they can add it for you.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn', disabled: !can, onclick: send }, 'Send to company'))));
}
async function ordersView(root, ctx) {
  loading(root);
  let os; try { os = await api('/d/company-orders'); } catch (e) { return fail(root, e); }
  const edited = (o) => o.approved && JSON.stringify(o.approved.map((l) => [l.product_id, l.qty_base])) !== JSON.stringify(o.items.map((l) => [l.product_id, l.qty_base]));
  put(root, os.length ? os.map((o) => { const lines = o.approved || o.items;
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, `#${o.id} · ${o.session} · ${dshort(o.order_date)}`), statusTag(o.status === 'sent' ? 'submitted' : o.status)), o.is_supplementary ? h('small', {}, 'Supplementary order') : null,
      lines.map((l) => h('div', { class: 'row' }, h('span', {}, `${l.name}: ${lineQty(o.units, l)}`), h('small', {}, o.dispatched_base[l.product_id] ? `received ${+o.dispatched_base[l.product_id].toFixed(2)}/${l.qty_base} ${l.base_unit}` : ''))),
      h('div', { class: 'row', style: 'margin-top:6px' }, h('b', {}, money(total(lines))), edited(o) && h('small', {}, 'Company changed the quantities'))); }) : h('p', { class: 'mu' }, 'No orders in the last 45 days.'));
}
async function ledgerView(root) {
  loading(root);
  let l; try { l = await api('/d/company-ledger'); } catch (e) { return fail(root, e); }
  put(root, h('div', { class: 'card row' }, h('span', {}, 'Balance with company'), h('b', { style: 'font-size:20px' }, balText(l.balance_paise))), h('div', { class: 'card' }, ledgerTable(l.entries)));
}
