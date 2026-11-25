import { put, h, rs, paise, formModal, toast, loading, fail } from '../ui.js';
import { api } from '../api.js';

const TYPES = [{ v: 'distributor', l: 'Distributor' }, { v: 'retailer', l: 'Retailer' }, { v: 'mrp', l: 'MRP' }, { v: 'institutional', l: 'Institutional' }];

export async function priceLists(root, ctx) {
  loading(root);
  let lists;
  try { lists = await api('/price-lists'); } catch (e) { return fail(root, e); }
  const reload = () => priceLists(root, ctx);
  const add = () => formModal('New price list', [
    { k: 'name', label: 'Name (e.g. Institution – Hostels)' }, { k: 'type', label: 'Type', type: 'select', options: TYPES },
    { k: 'src', label: 'Copy rates from (optional)', type: 'select', options: [{ v: '', l: '— start empty —' }, ...lists.map((l) => ({ v: l.id, l: l.name }))] },
    { k: 'pct', label: 'Change copied rates by % (e.g. -5 or 8)', type: 'number' }], { type: 'retailer' }, async (o) => {
    if (!o.name) throw new Error('Name is required');
    const r = await api('/price-lists', { method: 'POST', body: { name: o.name, type: o.type, active: 1 } });
    if (o.src) await api(`/price-lists/${r.id}/copy-from/${o.src}`, { method: 'POST', body: { percent: +o.pct || 0 } });
    toast('List created'); reload();
  }, 'Create');
  const rename = (l) => formModal('Edit price list', [{ k: 'name', label: 'Name' }, { k: 'type', label: 'Type', type: 'select', options: TYPES }, { k: 'active', label: 'Active', type: 'checkbox' }],
    { ...l, active: !!l.active }, async (o) => { await api('/price-lists/' + l.id, { method: 'PUT', body: { name: o.name, type: o.type, active: o.active ? 1 : 0 } }); toast('Saved'); reload(); });
  put(root, h('div', { class: 'row' }, h('h2', {}, 'Price lists'), !ctx.ro && h('button', { class: 'btn', onclick: add }, '+ New list')),
    lists.length ? lists.map((l) => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, l.name), h('span', { class: 'tag ' + (l.active ? '' : 'off') }, l.active ? l.type : 'inactive')),
      h('div', { class: 'wrap' }, h('button', { class: 'btn sm', onclick: () => editor(root, ctx, l, reload) }, ctx.ro ? 'View rates' : 'Rates'), !ctx.ro && h('button', { class: 'btn sm ghost', onclick: () => rename(l) }, 'Edit list')))) : h('p', { class: 'mu' }, 'No price lists yet. Create a Distributor list and a Retailer list first, plus an MRP list.'));
}

async function editor(root, ctx, l, back) {
  loading(root);
  let items;
  try { items = await api(`/price-lists/${l.id}/items`); } catch (e) { return fail(root, e); }
  const dirty = new Map(), eff = h('input', { type: 'date', value: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) });
  const miss = h('small', {});
  const count = () => { const n = items.filter((i) => (dirty.has(i.product_id) ? dirty.get(i.product_id) : i.rate_paise) == null).length; miss.textContent = n ? `${n} product(s) have no rate in this list` : 'All products have a rate'; };
  const rows = items.map((i) => {
    const el = h('input', { type: 'number', step: 'any', inputmode: 'decimal', value: rs(i.rate_paise), disabled: ctx.ro });
    const tr = h('tr', { class: i.rate_paise == null ? 'miss' : '' }, h('td', {}, i.name, h('br'), h('small', {}, `per ${i.base_unit}${i.active ? '' : ' · hidden'}`)), h('td', { class: 'r' }, el));
    el.addEventListener('input', () => { const p = paise(el.value); dirty.set(i.product_id, p); tr.className = p == null ? 'miss' : ''; count(); });
    return tr;
  });
  count();
  const save = async () => {
    const out = [...dirty].filter(([id, p]) => p != null && p !== items.find((i) => i.product_id === id).rate_paise).map(([product_id, rate_paise]) => ({ product_id, rate_paise }));
    if (!out.length) return toast('No changes');
    try { await api(`/price-lists/${l.id}/items`, { method: 'PUT', body: { items: out, effective_from: eff.value } }); toast('Rates saved'); editor(root, ctx, l, back); } catch (e) { toast(e.message); }
  };
  put(root, h('button', { class: 'btn sm ghost', onclick: back }, '← All lists'), h('h2', {}, l.name), h('small', {}, `${l.type} list · rates are per base unit, in ₹`),
    h('div', { class: 'card', style: 'margin-top:10px' }, items.length ? h('table', {}, rows) : h('p', { class: 'mu' }, 'Add products first (Products tab).')), miss,
    !ctx.ro && items.length > 0 && h('div', { class: 'card' }, h('label', {}, h('span', {}, 'New rates apply from'), eff), h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: save }, 'Save rates'))));
}
