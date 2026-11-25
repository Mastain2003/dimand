import { put, h, rs, paise, modal, toast, loading, fail } from '../ui.js';
import { api } from '../api.js';

export async function products(root, ctx) {
  loading(root);
  let ps, groups, lists;
  try { [ps, groups, lists] = await Promise.all([api('/products'), api('/groups'), api('/price-lists')]); } catch (e) { return fail(root, e); }
  const reload = () => products(root, ctx);
  let q = '';
  const list = h('div');
  const gname = (id) => groups.find((g) => g.id === id)?.name || 'No group';
  const card = (p) => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, p.name), h('span', { class: 'tag ' + (p.active ? '' : 'off') }, p.active ? 'Active' : 'Hidden')),
    h('div', { class: 'mu' }, `${gname(p.group_id)} · base unit: ${p.base_unit}`),
    h('small', {}, p.units.filter((u) => u.factor !== 1).map((u) => `1 ${u.unit_name} = ${u.factor} ${p.base_unit}`).join(' · ') || 'No other units'),
    !ctx.ro && h('div', { class: 'wrap' }, h('button', { class: 'btn sm ghost', onclick: () => form(p) }, 'Edit / rates')));
  const draw = () => list.replaceChildren(...ps.filter((p) => p.name.toLowerCase().includes(q)).map(card), ...(ps.length ? [] : [h('p', { class: 'mu' }, 'No products yet.')]));

  async function form(p) {
    let rates;
    try { rates = p ? await api(`/products/${p.id}/rates`) : lists.filter((l) => l.active).map((l) => ({ price_list_id: l.id, name: l.name, type: l.type, rate_paise: null })); } catch (e) { return toast(e.message); }
    const f = { name: h('input', { value: p?.name || '' }), base: h('input', { value: p?.base_unit || '', placeholder: 'ltr, kg, nos' }),
      group: h('select', {}, h('option', { value: '' }, '— none —'), groups.map((g) => h('option', { value: g.id }, g.name))), active: h('input', { type: 'checkbox' }) };
    f.group.value = p?.group_id ?? ''; f.active.checked = p ? !!p.active : false;
    const alts = [0, 1, 2].map((i) => { const u = p?.units.filter((x) => x.factor !== 1)[i]; return { n: h('input', { value: u?.unit_name || '', placeholder: 'crate, carton, can' }), f: h('input', { type: 'number', step: 'any', value: u?.factor || '', placeholder: 'base units' }) }; });
    const rin = rates.map((r) => ({ r, el: h('input', { type: 'number', step: 'any', inputmode: 'decimal', value: rs(r.rate_paise), placeholder: 'missing' }) }));
    const err = h('div', { class: 'err' });
    const body = h('div', {},
      h('label', {}, h('span', {}, 'Product name'), f.name), h('label', {}, h('span', {}, 'Group'), f.group),
      h('label', {}, h('span', {}, 'Base unit (rates are per base unit)'), f.base, p && h('small', {}, 'Do not change the base unit once orders exist.')),
      h('h3', {}, 'Other units (1 unit = how many base units)'), ...alts.map((a) => h('div', { class: 'alt', style: 'margin-bottom:6px' }, a.n, a.f)),
      h('h3', {}, 'Rates per base unit (₹)'), rin.length ? h('div', { class: 'rates' }, rin.map(({ r, el }) => [h('span', {}, `${r.name} `, h('small', {}, r.type)), el])) : h('p', { class: 'mu' }, 'Create price lists first (Price lists tab).'),
      h('label', { class: 'chk' }, f.active, h('span', {}, 'Active (visible for ordering). Fill every rate first.')), err);
    modal(p ? 'Edit product' : 'Add product', body, [{ label: 'Cancel', cls: 'ghost', run: (c) => c() }, { label: 'Save', run: async (close) => {
      try {
        const base = f.base.value.trim();
        if (!f.name.value.trim() || !base) throw new Error('Name and base unit are required');
        const units = alts.filter((a) => a.n.value.trim() && +a.f.value > 0).map((a) => ({ unit_name: a.n.value.trim(), factor: +a.f.value }));
        const changed = rin.filter(({ r, el }) => paise(el.value) !== null && paise(el.value) !== r.rate_paise).map(({ r, el }) => ({ price_list_id: r.price_list_id, rate_paise: paise(el.value) }));
        const b = { name: f.name.value.trim(), group_id: f.group.value ? +f.group.value : null, base_unit: base, gst_rate: p?.gst_rate || 0, active: f.active.checked, units, rates: changed };
        await api(p ? '/products/' + p.id : '/products', { method: p ? 'PUT' : 'POST', body: b });
        toast('Saved'); close(); reload();
      } catch (e) { err.textContent = e.message; }
    } }]);
  }
  draw();
  put(root, h('div', { class: 'row' }, h('h2', {}, `Products (${ps.length})`), !ctx.ro && h('button', { class: 'btn', onclick: () => form(null) }, '+ Add')),
    h('input', { placeholder: 'Search products', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } }), h('div', { style: 'height:10px' }), list);
}
