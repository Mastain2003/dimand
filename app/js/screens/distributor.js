import { put, h, modal, formModal, confirmBox, showSecret, seg, toast, loading, fail, paise } from '../ui.js';
import { api } from '../api.js';
import { money, rateStr, istToday, dshort, total, lineAmt, statusTag, itemsText, nosText, packText, ledgerTable, balText, orderUnits, groupProducts } from '../lib.js';
import { demandBuilder } from './retailer.js';
import { accountCard } from './settings.js';

const MODES = ['Cash', 'UPI', 'Cheque', 'Bank transfer'].map((m) => ({ v: m, l: m }));
const F = { status: 'pending', session: '', date: '' };
const STATUS_Q = { pending: 'submitted', open: 'approved,part_dispatched', done: 'dispatched,rejected,cancelled' };

// ---------- approval sheet: edit quantity and rate per line, add products ----------
async function approveSheet(d, done) {
  let prods; try { prods = await api(`/d/retailers/${d.retailer_id}/products`); } catch (e) { return toast(e.message); }
  const rows = (d.approved || d.items).map((l) => ({ ...l })), box = h('div'), tot = h('b'), err = h('div', { class: 'err' });
  const unitsOf = (pid, cur) => prods.find((p) => p.product_id === pid)?.units || [{ unit_name: cur, factor: 1 }];
  const draw = () => {
    box.replaceChildren(...rows.map((r, i) => {
      const us = unitsOf(r.product_id, r.unit), f = () => us.find((u) => u.unit_name === r.unit)?.factor || 1;
      const sub = h('small', {}), calc = () => { sub.textContent = `= ${money(Math.round(r.qty * f() * r.rate_paise))}`; tot.textContent = money(rows.reduce((s, x) => s + Math.round(x.qty * (unitsOf(x.product_id, x.unit).find((u) => u.unit_name === x.unit)?.factor || 1) * x.rate_paise), 0)); };
      const unit = h('select', { onchange: () => { r.unit = unit.value; calc(); } }, orderUnits(us, r.unit).map((u) => h('option', { value: u.unit_name }, u.unit_name))); unit.value = r.unit;
      const qty = h('input', { type: 'number', step: 'any', value: r.qty, oninput: () => { r.qty = +qty.value; calc(); } });
      const rate = h('input', { type: 'number', step: 'any', value: rateStr(r.rate_paise), oninput: () => { r.rate_paise = Math.round(parseFloat(rate.value || 0) * 1e6) / 1e4; calc(); } });
      calc();
      return h('div', { class: 'arow' }, h('div', { class: 'row' }, h('b', {}, r.name), h('button', { class: 'x', onclick: () => { rows.splice(i, 1); draw(); } }, '✕')),
        h('div', { class: 'g' }, h('label', {}, h('span', {}, 'Qty'), qty), h('label', {}, h('span', {}, 'Unit'), unit), h('label', {}, h('span', {}, `Rate ₹/${r.base_unit}`), rate)), sub);
    }));
    tot.textContent = tot.textContent || '';
  };
  const add = h('select', {}, h('option', { value: '' }, '+ Add another product'), groupProducts(prods.filter((p) => !rows.some((r) => r.product_id === p.product_id))).map(([g, items]) => h('optgroup', { label: g }, items.map((p) => h('option', { value: p.product_id }, p.name)))));
  add.onchange = () => { const p = prods.find((x) => x.product_id === +add.value); if (p) { const u = orderUnits(p.units)[0].unit_name; rows.push({ product_id: p.product_id, name: p.name, base_unit: p.base_unit, unit: u, qty: 1, qty_base: 1, rate_paise: p.rate_paise }); draw(); add.querySelector(`option[value="${p.product_id}"]`)?.remove(); add.value = ''; } };
  draw();
  modal(`${d.status === 'approved' ? 'Edit approval' : 'Approve'} · ${d.shop_name} #${d.id}`, h('div', {}, h('small', {}, `Retailer asked: ${packText(d.items)}. Rates default to the retailer's price list; you can change them for this demand.`), box, add, h('div', { class: 'row', style: 'margin-top:10px' }, h('span', {}, 'Total'), tot), err),
    [{ label: 'Cancel', cls: 'ghost', run: (c) => c() }, { label: 'Approve', run: async (c) => {
      try { await api(`/d/demands/${d.id}/approve`, { method: 'POST', body: { items: rows.map((r) => ({ product_id: r.product_id, unit: r.unit, qty: r.qty, rate_paise: r.rate_paise })) } }); toast('Approved'); c(); done(); } catch (e) { err.textContent = e.message; } } }]);
}

function dispatchSheet(d, done) {
  const got = d.dispatched_base || {}, date = h('input', { type: 'date', value: istToday() }), short = h('input', { type: 'checkbox' }), err = h('div', { class: 'err' });
  const ins = d.approved.map((l) => { const left = +(l.qty_base - (got[l.product_id] || 0)).toFixed(4), el = h('input', { type: 'number', step: 'any', value: left > 0 ? left : 0 }); return { l, left, el }; });
  modal(`Dispatch · ${d.shop_name} #${d.id}`, h('div', {}, h('small', {}, 'Enter what you are sending now, in base units. Items not sent stay pending for another dispatch.'),
    ins.map(({ l, left, el }) => h('div', { class: 'arow' }, h('div', { class: 'row' }, h('b', {}, l.name), h('small', {}, `ordered ${l.qty_base} · left ${left} ${l.base_unit}`)), h('label', {}, h('span', {}, `Sending now (${l.base_unit}) @ ${money(l.rate_paise)}`), el))),
    h('label', {}, h('span', {}, 'Dispatch date'), date), h('label', { class: 'chk' }, short, h('span', {}, 'Close this demand now (anything left is cancelled)')), err),
    [{ label: 'Cancel', cls: 'ghost', run: (c) => c() }, { label: 'Dispatch', run: async (c) => {
      try { const r = await api(`/d/demands/${d.id}/dispatch`, { method: 'POST', body: { dispatch_date: date.value, close_short: short.checked, items: ins.map(({ l, el }) => ({ product_id: l.product_id, qty_base: +el.value })) } }); toast(`Dispatched · ${money(r.total_paise)} added to ledger`); c(); done(); } catch (e) { err.textContent = e.message; } } }]);
}

export async function inbox(root, ctx) {
  loading(root);
  const q = new URLSearchParams({ status: STATUS_Q[F.status] }); if (F.session) q.set('session', F.session); if (F.date) q.set('date', F.date);
  let ds; try { ds = await api('/d/demands?' + q); } catch (e) { return fail(root, e); }
  const reload = () => inbox(root, ctx);
  const sessionSheet = (d) => formModal('Change session', [{ k: 's', label: `Demand #${d.id} is now ${d.session}. Move to:`, type: 'select', options: [{ v: 'AM', l: 'AM' }, { v: 'PM', l: 'PM' }] }], { s: d.session === 'AM' ? 'PM' : 'AM' }, async (o) => { await api(`/d/demands/${d.id}/session`, { method: 'PATCH', body: { session: o.s } }); toast('Session changed'); reload(); });
  const rejectSheet = (d) => formModal('Reject demand', [{ k: 'reason', label: 'Reason (shown to the retailer)' }], {}, async (o) => { await api(`/d/demands/${d.id}/reject`, { method: 'POST', body: { reason: o.reason } }); toast('Rejected'); reload(); }, 'Reject');
  const pullSheet = (d) => formModal(`Pull demand #${d.id} out of company order #${d.company_order_id}`, [{ k: 's', label: 'Then move it to', type: 'select', options: [{ v: '', l: `Keep in ${d.session}` }, { v: d.session === 'AM' ? 'PM' : 'AM', l: `${d.session === 'AM' ? 'PM' : 'AM'} session` }] }, { k: 'reason', label: 'Reason (the company is told)' }], {},
    async (o) => { const r = await api(`/d/demands/${d.id}/pull-out`, { method: 'POST', body: { session: o.s || undefined, reason: o.reason } }); toast(r.order_cancelled ? 'Pulled out. The order is now empty and cancelled.' : 'Pulled out. The company has been notified.'); reload(); }, 'Pull out');
  const card = (d) => {
    const lines = d.approved || d.items, got = d.dispatched_base || {};
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, d.shop_name), statusTag(d.status)), h('small', {}, `#${d.id} · ${d.session} · ${dshort(d.demand_date)}${d.company_order_id ? ' · in company order #' + d.company_order_id : ''}`),
      h('div', {}, nosText(lines)), h('small', {}, `${d.approved ? 'Approved' : 'Requested'} ${money(total(lines))}${Object.keys(got).length ? ' · sent so far ' + lines.map((l) => `${l.name} ${+(got[l.product_id] || 0).toFixed(2)}/${l.qty_base}`).join(', ') : ''}`),
      h('div', { class: 'wrap' }, ['submitted', 'approved'].includes(d.status) && !d.dispatches.length && !d.company_order_id && h('button', { class: 'btn sm', onclick: () => approveSheet(d, reload) }, d.status === 'approved' ? 'Edit approval' : 'Approve / edit'),
        ['approved', 'part_dispatched'].includes(d.status) && h('button', { class: 'btn sm', onclick: () => dispatchSheet(d, reload) }, 'Dispatch'),
        ['submitted', 'approved'].includes(d.status) && !d.dispatches.length && !d.company_order_id && h('button', { class: 'btn sm ghost', onclick: () => sessionSheet(d) }, 'Change session'),
        ['submitted', 'approved'].includes(d.status) && !d.dispatches.length && !d.company_order_id && h('button', { class: 'btn sm ghost', onclick: () => rejectSheet(d) }, 'Reject'),
        d.company_order_id && d.status === 'approved' && !d.dispatches.length && h('button', { class: 'btn sm ghost', onclick: () => pullSheet(d) }, 'Pull out of company order')));
  };
  const sums = {}; ds.filter((d) => !['rejected', 'cancelled'].includes(d.status)).forEach((d) => (d.approved || d.items).forEach((l) => { const k = l.name; sums[k] = sums[k] || { q: 0, b: l.base_unit }; sums[k].q += l.qty_base; }));
  put(root, h('h2', {}, 'Retailer demands'),
    seg([['pending', 'Waiting'], ['open', 'To dispatch'], ['done', 'Done']], F.status, (k) => { F.status = k; reload(); }), seg([['', 'AM + PM'], ['AM', 'AM'], ['PM', 'PM']], F.session, (k) => { F.session = k; reload(); }),
    h('label', {}, h('span', {}, 'Date (leave empty for all)'), h('input', { type: 'date', value: F.date, onchange: (e) => { F.date = e.target.value; reload(); } })),
    Object.keys(sums).length > 0 && h('div', { class: 'card', style: 'margin-top:10px' }, h('b', {}, `Total of these ${ds.length} demands`), Object.entries(sums).map(([n, v]) => h('div', { class: 'row' }, h('span', {}, n), h('b', {}, `${+v.q.toFixed(2)} ${v.b}`)))),
    h('div', { style: 'height:8px' }), ds.length ? ds.map(card) : h('p', { class: 'mu' }, 'Nothing here.'));
}

// ---------- retailers ----------
export async function retailers(root, ctx) {
  loading(root);
  let rs, pls; try { [rs, pls] = await Promise.all([api('/d/retailers'), api('/d/price-lists')]); } catch (e) { return fail(root, e); }
  const reload = () => retailers(root, ctx);
  let q = ''; const list = h('div');
  const fields = (isNew) => [{ k: 'shop_name', label: 'Shop name' }, { k: 'mobile', label: 'Login mobile number', type: 'tel' }, { k: 'address', label: 'Address (optional)' }, { k: 'gstin', label: 'GSTIN (optional)' },
    { k: 'price_list_id', label: 'Price list', type: 'select', options: pls.map((p) => ({ v: p.id, l: `${p.name} (${p.type})` })) }, ...(isNew ? [] : [{ k: 'active', label: 'Active', type: 'checkbox' }])];
  const body = (o, upd) => ({ shop_name: o.shop_name, mobile: o.mobile, address: o.address || null, gstin: o.gstin || null, price_list_id: o.price_list_id ? +o.price_list_id : null, ...(upd ? { active: o.active ? 1 : 0 } : {}) });
  const add = () => formModal('Add retailer', fields(true), {}, async (o) => { if (!o.shop_name || !o.mobile) throw new Error('Shop name and mobile are required'); const r = await api('/d/retailers', { method: 'POST', body: body(o) }); reload(); showSecret(o.shop_name, o.mobile, r.temp_password); }, 'Create');
  const draw = () => list.replaceChildren(...rs.filter((r) => `${r.shop_name} ${r.mobile || ''}`.toLowerCase().includes(q)).map((r) => h('div', { class: 'card row', onclick: () => detail(root, ctx, r, reload) }, h('div', {}, h('b', {}, r.shop_name), !r.active && h('span', { class: 'tag off' }, ' inactive'), h('div', { class: 'mu' }, `${r.mobile || ''} · ${r.price_list_name || 'no price list'}`)), h('b', { class: r.balance_paise > 0 ? 'err' : '' }, balText(r.balance_paise)))), ...(rs.length ? [] : [h('p', { class: 'mu' }, 'Add your first retailer.')]));
  draw();
  ctx.retailerFields = { fields, body };
  put(root, h('div', { class: 'row' }, h('h2', {}, `Retailers (${rs.length})`), h('button', { class: 'btn', onclick: add }, '+ Add')), h('input', { placeholder: 'Search shop or mobile', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } }), h('div', { style: 'height:10px' }), list);
}

async function detail(root, ctx, r, back) {
  loading(root);
  let L; try { L = await api(`/d/retailers/${r.id}/ledger`); } catch (e) { return fail(root, e); }
  const bal = L.entries.length ? L.entries[L.entries.length - 1].balance_paise : 0, again = () => detail(root, ctx, r, back);
  const pay = () => formModal('Payment received', [{ k: 'amount', label: 'Amount (₹)', type: 'number' }, { k: 'mode', label: 'Mode', type: 'select', options: MODES }, { k: 'date', label: 'Date', type: 'date' }, { k: 'note', label: 'Note (optional)' }], { date: istToday() },
    async (o) => { const p = paise(o.amount); if (!p || p <= 0) throw new Error('Enter an amount'); await api('/d/payments', { method: 'POST', body: { retailer_id: r.id, amount_paise: p, mode: o.mode, pay_date: o.date, note: o.note } }); toast('Payment saved'); again(); });
  const reverse = (e) => formModal('Reverse payment', [{ k: 'reason', label: `Reverse ${money(e.cr_paise)} paid on ${dshort(e.entry_date)}? Reason:` }], {}, async (o) => { await api(`/d/payments/${e.pay_id}/reverse`, { method: 'POST', body: { reason: o.reason } }); toast('Reversed'); again(); }, 'Reverse');
  const edit = () => formModal('Edit retailer', ctx.retailerFields.fields(false), { ...r, active: !!r.active }, async (o) => { await api('/d/retailers/' + r.id, { method: 'PUT', body: ctx.retailerFields.body(o, true) }); toast('Saved'); back(); });
  const demand = async () => {
    let products, info; try { products = await api(`/d/retailers/${r.id}/products`); } catch (e) { return toast(e.message); }
    const t = istToday(), sessions = { AM: { date: t, note: 'Today' }, PM: { date: t, note: 'Today' }, default: 'AM' }, m = modal(`Demand for ${r.shop_name}`, h('div', {}, h('small', {}, 'Phone/visit order. Cutoff times do not apply to you.'),
      demandBuilder({ products, sessions, label: 'Create demand', onSubmit: async (b) => { await api(`/d/retailers/${r.id}/demands`, { method: 'POST', body: b }); m.close(); toast('Demand created, find it under Demands'); } })), [], { tall: true });
  };
  put(root, h('button', { class: 'btn sm ghost', onclick: back }, '← Retailers'), h('h2', {}, r.shop_name), h('small', {}, `${r.mobile || ''} · ${r.price_list_name || 'no price list'}`),
    h('div', { class: 'card row', style: 'margin-top:8px' }, h('span', {}, 'Balance'), h('b', { style: 'font-size:20px' }, balText(bal))),
    h('div', { class: 'wrap' }, h('button', { class: 'btn sm', onclick: pay }, '+ Payment'), h('button', { class: 'btn sm', onclick: demand }, '+ Demand'), h('button', { class: 'btn sm ghost', onclick: edit }, 'Edit'),
      r.user_id && h('button', { class: 'btn sm ghost', onclick: () => confirmBox('Reset password', `New temporary password for ${r.shop_name}?`, 'Reset', async () => { const x = await api(`/users/${r.user_id}/reset-password`, { method: 'POST' }); showSecret(r.shop_name, r.mobile, x.temp_password); }) }, 'Reset password')),
    h('h3', {}, 'Ledger'), h('div', { class: 'card' }, ledgerTable(L.entries, reverse)));
}

// ---------- account + cutoffs ----------
export async function distAccount(root, ctx) {
  loading(root);
  let c, rs; try { [c, rs] = await Promise.all([api('/d/cutoffs'), api('/d/retailers')]); } catch (e) { return fail(root, e); }
  const reload = () => distAccount(root, ctx);
  const setDefault = () => formModal('Default retailer cutoff', [{ k: 'am', label: 'AM demands accepted until', type: 'time' }, { k: 'pm', label: 'PM demands accepted until', type: 'time' }], { am: c.default.am_cutoff, pm: c.default.pm_cutoff },
    async (o) => { await api('/d/cutoffs', { method: 'PUT', body: { retailer_id: null, am_cutoff: o.am, pm_cutoff: o.pm } }); toast('Saved'); reload(); });
  const setOver = () => formModal('Cutoff for one retailer', [{ k: 'rid', label: 'Retailer', type: 'select', options: rs.map((r) => ({ v: r.id, l: r.shop_name })) }, { k: 'am', label: 'AM until', type: 'time' }, { k: 'pm', label: 'PM until', type: 'time' }], { am: c.default.am_cutoff, pm: c.default.pm_cutoff },
    async (o) => { await api('/d/cutoffs', { method: 'PUT', body: { retailer_id: +o.rid, am_cutoff: o.am, pm_cutoff: o.pm } }); toast('Saved'); reload(); });
  put(root, h('h2', {}, 'Account'), accountCard(ctx),
    h('h3', {}, 'Retailer order cutoff times'), h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', {}, `AM until ${c.default.am_cutoff} · PM until ${c.default.pm_cutoff}`), h('button', { class: 'btn sm ghost', onclick: setDefault }, 'Change')),
      h('small', {}, 'After the cutoff retailers can only order for tomorrow. You can still edit and create demands yourself.')),
    c.overrides.map((o) => h('div', { class: 'card row' }, h('span', {}, `${o.shop_name}: AM ${o.am_cutoff} · PM ${o.pm_cutoff}`), h('button', { class: 'btn sm ghost', onclick: async () => { await api('/d/cutoffs/' + o.retailer_id, { method: 'DELETE' }); reload(); } }, 'Remove'))),
    h('button', { class: 'btn sm ghost', onclick: setOver }, '+ Different cutoff for a retailer'),
    c.company_cutoff && h('p', { class: 'mu' }, `Set by the company for your orders to them: AM ${c.company_cutoff.am_cutoff} · PM ${c.company_cutoff.pm_cutoff}`));
}
