import { put, h, modal, toast, loading, fail, confirmBox } from '../ui.js';
import { api } from '../api.js';
import { money, istToday, dshort, total, statusTag, itemsText, ledgerTable, balText, lineAmt } from '../lib.js';
import { accountCard } from './settings.js';

// Shared by retailer ("Order") and distributor ("demand on behalf of a retailer").
export function demandBuilder({ products, existing, sessions, onSubmit, label = 'Send demand' }) {
  const st = new Map((existing?.items || []).map((i) => [i.product_id, { unit: i.unit, qty: i.qty }]));
  let session = existing ? existing.session : sessions.default;
  const tot = h('b', {}), sessEl = h('div', { class: 'sess' });
  const drawSess = () => sessEl.replaceChildren(...['AM', 'PM'].map((s) => h('button', { class: s === session ? 'on' : '', disabled: !!existing && s !== session, onclick: () => { session = s; drawSess(); } }, h('b', {}, s), h('small', {}, existing ? dshort(existing.demand_date) : sessions[s].note))));
  const calc = () => { let t = 0; for (const p of products) { const s = st.get(p.product_id); if (s && +s.qty > 0) t += Math.round(+s.qty * (p.units.find((u) => u.unit_name === s.unit)?.factor || 1) * p.rate_paise); } tot.textContent = money(t); };
  const rows = products.map((p) => {
    const s = st.get(p.product_id) || { unit: p.base_unit, qty: '' }, units = [...p.units].sort((a, b) => a.factor - b.factor);
    const rate = h('small', {}), per = () => (p.units.find((u) => u.unit_name === s.unit)?.factor || 1);
    const upd = () => { rate.textContent = `${money(p.rate_paise * per())} / ${s.unit}${p.mrp_paise ? ` · MRP ${money(p.mrp_paise * per())}` : ''}`; };
    const sel = h('select', { onchange: () => { s.unit = sel.value; upd(); calc(); if (+s.qty > 0) st.set(p.product_id, s); } }, units.map((u) => h('option', { value: u.unit_name }, u.unit_name)));
    sel.value = s.unit;
    const q = h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: '0', value: s.qty, oninput: () => { s.qty = q.value; if (+q.value > 0) st.set(p.product_id, s); else st.delete(p.product_id); calc(); } });
    upd();
    return h('div', { class: 'prow', 'data-n': p.name.toLowerCase() }, h('div', {}, h('b', {}, p.name), rate), sel, q);
  });
  const search = h('input', { placeholder: 'Search product', oninput: () => rows.forEach((r) => { r.style.display = r.dataset.n.includes(search.value.toLowerCase()) ? '' : 'none'; }) });
  const go = async () => {
    const items = products.filter((p) => +st.get(p.product_id)?.qty > 0).map((p) => ({ product_id: p.product_id, unit: st.get(p.product_id).unit, qty: +st.get(p.product_id).qty }));
    if (!items.length) return toast('Enter a quantity for at least one product');
    try { await onSubmit({ session, demand_date: existing ? existing.demand_date : sessions[session].date, items }); } catch (e) { toast(e.message); }
  };
  drawSess(); calc();
  return h('div', {}, sessEl, search, h('div', { class: 'card', style: 'margin-top:8px' }, rows.length ? rows : h('p', { class: 'mu' }, 'No products are available for you yet. Ask your distributor.')),
    h('div', { class: 'card bar row' }, h('div', {}, h('small', {}, 'Total'), h('br'), tot), h('button', { class: 'btn', onclick: go }, label)));
}

let editing = null;
export async function newDemand(root, ctx) {
  loading(root);
  let info, products; try { [info, products] = await Promise.all([api('/r/info'), api('/r/products')]); } catch (e) { return fail(root, e); }
  const ex = editing; editing = null;
  const now = info.now, sessions = {};
  for (const s of ['AM', 'PM']) { const open = now.hm < info.cutoffs[s]; sessions[s] = { open, date: open ? now.date : now.tomorrow, note: open ? `Today · till ${info.cutoffs[s]}` : `Tomorrow · today's cutoff passed` }; }
  sessions.default = sessions.AM.open ? 'AM' : sessions.PM.open ? 'PM' : 'AM';
  put(root, h('h2', {}, ex ? `Edit demand #${ex.id}` : 'New demand'), h('small', {}, `${info.shop_name} · supplier: ${info.distributor_name}`),
    h('div', { style: 'height:8px' }), demandBuilder({ products, existing: ex, sessions, label: ex ? 'Save changes' : 'Send demand', onSubmit: async (b) => {
      if (ex) await api('/r/demands/' + ex.id, { method: 'PUT', body: { items: b.items } }); else await api('/r/demands', { method: 'POST', body: b });
      toast(ex ? 'Demand updated' : 'Demand sent'); location.hash = 'mine';
    } }));
}

export async function myDemands(root, ctx) {
  loading(root);
  let ds; try { ds = await api('/r/demands'); } catch (e) { return fail(root, e); }
  const reload = () => myDemands(root, ctx);
  const card = (d) => {
    const ap = d.approved, got = d.dispatched_base || {};
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, `#${d.id} · ${d.session} · ${dshort(d.demand_date)}`), statusTag(d.status)),
      h('div', {}, itemsText(d.items)), h('small', {}, `Requested ${money(total(d.items))}`),
      ap && h('div', { style: 'margin-top:6px' }, h('b', {}, 'Approved: '), ap.map((l) => h('div', {}, `${l.name} ${l.qty} ${l.unit} @ ${money(l.rate_paise * (l.qty_base / l.qty))}/${l.unit} = ${money(lineAmt(l))}${got[l.product_id] ? ` · sent ${+got[l.product_id].toFixed(2)}/${l.qty_base} ${l.base_unit}` : ''}`))),
      d.dispatches.length > 0 && h('small', {}, `Dispatched on ${d.dispatches.map((x) => dshort(x.date)).join(', ')}`), d.note && d.status === 'rejected' && h('div', { class: 'err' }, 'Reason: ' + d.note),
      d.status === 'submitted' && h('div', { class: 'wrap' }, h('button', { class: 'btn sm ghost', onclick: () => { editing = d; location.hash = 'order'; } }, 'Edit'),
        h('button', { class: 'btn sm ghost', onclick: () => confirmBox('Cancel demand', `Cancel demand #${d.id}?`, 'Cancel demand', async () => { try { await api(`/r/demands/${d.id}/cancel`, { method: 'POST' }); toast('Cancelled'); reload(); } catch (e) { toast(e.message); } }, true) }, 'Cancel')));
  };
  put(root, h('h2', {}, 'My demands'), ds.length ? ds.map(card) : h('p', { class: 'mu' }, 'No demands in the last 45 days.'));
}

export async function myLedger(root, ctx) {
  loading(root);
  let l; try { l = await api('/r/ledger'); } catch (e) { return fail(root, e); }
  put(root, h('h2', {}, 'My ledger'), h('div', { class: 'card row' }, h('span', {}, 'Balance'), h('b', { style: 'font-size:20px' }, balText(l.balance_paise))), h('div', { class: 'card' }, ledgerTable(l.entries)));
}

export async function myPrices(root, ctx) {
  loading(root);
  let ps; try { ps = await api('/r/products'); } catch (e) { return fail(root, e); }
  const list = h('div'), draw = (q) => list.replaceChildren(...ps.filter((p) => p.name.toLowerCase().includes(q)).map((p) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, p.name), h('span', {}, h('b', {}, money(p.rate_paise)), ` / ${p.base_unit}`)),
    p.mrp_paise && h('small', {}, `MRP ${money(p.mrp_paise)} / ${p.base_unit}`), h('div', {}, h('small', {}, p.units.filter((u) => u.factor !== 1).map((u) => `1 ${u.unit_name} = ${money(p.rate_paise * u.factor)} (MRP ${p.mrp_paise ? money(p.mrp_paise * u.factor) : '-'})`).join(' · '))))));
  draw('');
  put(root, h('h2', {}, 'Products and prices'), h('input', { placeholder: 'Search', oninput: (e) => draw(e.target.value.toLowerCase()) }), h('div', { style: 'height:8px' }), list);
}
