import { h, modal, toast } from '../ui.js';
import { api } from '../api.js';
import { money, rateStr, istToday } from '../lib.js';

// Edit order lines (qty, unit, rate; add/remove products). Used by the company to edit an order or create one for a distributor.
export function linesSheet({ title, intro, lines, prods, noteLabel, saveLabel, onSave }) {
  const rows = lines.map((l) => ({ ...l })), box = h('div'), tot = h('b'), err = h('div', { class: 'err' }), note = h('input', { placeholder: noteLabel || 'Note (optional)' });
  const f = (r) => (prods.find((p) => p.product_id === r.product_id)?.units || [{ unit_name: r.unit, factor: 1 }]).find((u) => u.unit_name === r.unit)?.factor || 1;
  const recalc = () => { tot.textContent = money(rows.reduce((s, r) => s + Math.round(r.qty * f(r) * r.rate_paise), 0)); };
  const draw = () => {
    box.replaceChildren(...rows.map((r, i) => {
      const us = prods.find((p) => p.product_id === r.product_id)?.units || [{ unit_name: r.unit, factor: 1 }], sub = h('small', {}), calc = () => { sub.textContent = `= ${money(Math.round(r.qty * f(r) * r.rate_paise))}`; recalc(); };
      const unit = h('select', { onchange: () => { r.unit = unit.value; calc(); } }, us.map((u) => h('option', { value: u.unit_name }, u.unit_name))); unit.value = r.unit;
      const qty = h('input', { type: 'number', step: 'any', value: r.qty, oninput: () => { r.qty = +qty.value; calc(); } });
      const rate = h('input', { type: 'number', step: 'any', value: rateStr(r.rate_paise), oninput: () => { r.rate_paise = Math.round(parseFloat(rate.value || 0) * 1e6) / 1e4; calc(); } });
      calc();
      return h('div', { class: 'arow' }, h('div', { class: 'row' }, h('b', {}, r.name), h('button', { class: 'x', onclick: () => { rows.splice(i, 1); draw(); } }, '✕')),
        h('div', { class: 'g' }, h('label', {}, h('span', {}, 'Qty'), qty), h('label', {}, h('span', {}, 'Unit'), unit), h('label', {}, h('span', {}, `Rate ₹/${r.base_unit}`), rate)), sub);
    })); recalc();
  };
  const add = h('select', {}, h('option', { value: '' }, '+ Add product'), prods.map((p) => h('option', { value: p.product_id }, p.name)));
  add.onchange = () => { const p = prods.find((x) => x.product_id === +add.value); if (p && !rows.some((r) => r.product_id === p.product_id)) { rows.push({ product_id: p.product_id, name: p.name, base_unit: p.base_unit, unit: p.base_unit, qty: 1, rate_paise: p.rate_paise }); draw(); } add.value = ''; };
  draw();
  modal(title, h('div', {}, intro && h('small', {}, intro), box, add, h('div', { class: 'row', style: 'margin-top:10px' }, h('span', {}, 'Total'), tot), h('label', {}, h('span', {}, noteLabel || 'Note'), note), err),
    [{ label: 'Cancel', cls: 'ghost', run: (c) => c() }, { label: saveLabel || 'Save', run: async (c) => {
      try { await onSave(rows.map((r) => ({ product_id: r.product_id, unit: r.unit, qty: r.qty, rate_paise: r.rate_paise })), note.value.trim()); c(); } catch (e) { err.textContent = e.message; } } }]);
}

// Dispatch dialog (company -> distributor). lines = approved lines, got = {product_id: base qty already sent}
export function dispatchDialog({ title, lines, got, url, done }) {
  const date = h('input', { type: 'date', value: istToday() }), short = h('input', { type: 'checkbox' }), err = h('div', { class: 'err' });
  const ins = lines.map((l) => { const left = +(l.qty_base - (got[l.product_id] || 0)).toFixed(4); return { l, left, el: h('input', { type: 'number', step: 'any', value: left > 0 ? left : 0 }) }; });
  modal(title, h('div', {}, h('small', {}, 'Enter what is being sent now, in base units. The rest stays pending for another shipment.'),
    ins.map(({ l, left, el }) => h('div', { class: 'arow' }, h('div', { class: 'row' }, h('b', {}, l.name), h('small', {}, `ordered ${l.qty_base} · left ${left} ${l.base_unit}`)), h('label', {}, h('span', {}, `Sending now (${l.base_unit}) @ ${money(l.rate_paise)}`), el))),
    h('label', {}, h('span', {}, 'Dispatch date'), date), h('label', { class: 'chk' }, short, h('span', {}, 'Close this order now (anything left is cancelled)')), err),
    [{ label: 'Cancel', cls: 'ghost', run: (c) => c() }, { label: 'Dispatch', run: async (c) => {
      try { const r = await api(url, { method: 'POST', body: { dispatch_date: date.value, close_short: short.checked, items: ins.map(({ l, el }) => ({ product_id: l.product_id, qty_base: +el.value })) } }); toast(`Dispatched · ${money(r.total_paise)} added to ledger`); c(); done(); } catch (e) { err.textContent = e.message; } } }]);
}
