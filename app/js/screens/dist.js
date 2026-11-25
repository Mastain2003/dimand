import { put, h, formModal, confirmBox, showSecret, toast, loading, fail } from '../ui.js';
import { api } from '../api.js';

export async function distributors(root, ctx) {
  loading(root);
  let ds, cities, pls;
  try { [ds, cities, pls] = await Promise.all([api('/distributors'), api('/cities'), api('/price-lists')]); } catch (e) { return fail(root, e); }
  const reload = () => distributors(root, ctx);
  let q = '';
  const list = h('div');
  const fields = (isNew) => [
    { k: 'name', label: 'Distributor name' }, { k: 'mobile', label: 'Login mobile number', type: 'tel' },
    { k: 'city_id', label: 'City (route is set by the city)', type: 'select', options: cities.map((c) => ({ v: c.id, l: `${c.name} · ${c.route_name}` })) },
    { k: 'price_list_id', label: 'Distributor price list', type: 'select', options: [{ v: '', l: '— none —' }, ...pls.filter((p) => p.type === 'distributor' && p.active).map((p) => ({ v: p.id, l: p.name }))] },
    { k: 'gstin', label: 'GSTIN (optional)' },
    { k: 'am_cutoff', label: 'AM order cutoff', type: 'time' }, { k: 'pm_cutoff', label: 'PM order cutoff', type: 'time' },
    ...(isNew ? [] : [{ k: 'active', label: 'Active', type: 'checkbox' }]),
  ];
  const body = (o, d) => ({ name: o.name, mobile: o.mobile, city_id: +o.city_id, price_list_id: o.price_list_id ? +o.price_list_id : null, gstin: o.gstin || null, am_cutoff: o.am_cutoff || undefined, pm_cutoff: o.pm_cutoff || undefined, ...(d ? { active: o.active ? 1 : 0 } : {}) });
  const edit = (d) => formModal('Edit distributor', fields(false), { ...d, active: !!d.active }, async (o) => { await api('/distributors/' + d.id, { method: 'PUT', body: body(o, d) }); toast('Saved'); reload(); });
  const add = () => {
    if (!cities.length) return toast('Add a route and city first (Masters tab)');
    formModal('Add distributor', fields(true), { am_cutoff: '09:00', pm_cutoff: '16:00' }, async (o) => {
      if (!o.name || !o.mobile) throw new Error('Name and mobile are required');
      const r = await api('/distributors', { method: 'POST', body: body(o) }); reload(); showSecret(o.name, o.mobile, r.temp_password);
    }, 'Create');
  };
  const reset = (d) => confirmBox('Reset password', `Create a new temporary password for ${d.name}?`, 'Reset', async () => { const r = await api(`/users/${d.user_id}/reset-password`, { method: 'POST' }); showSecret(d.name, d.mobile, r.temp_password); });
  const card = (d) => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, d.name), !d.active && h('span', { class: 'tag off' }, 'Inactive')),
    h('div', { class: 'mu' }, `${d.city_name} · ${d.route_name} · ${d.mobile || 'no login'}`),
    h('small', {}, `Price list: ${d.price_list_name || 'not set'} · Cutoff AM ${d.am_cutoff || '-'} / PM ${d.pm_cutoff || '-'}`),
    !ctx.ro && h('div', { class: 'wrap' }, h('button', { class: 'btn sm ghost', onclick: () => edit(d) }, 'Edit'), d.user_id && h('button', { class: 'btn sm ghost', onclick: () => reset(d) }, 'Reset password')));
  const draw = () => list.replaceChildren(...ds.filter((d) => `${d.name} ${d.city_name} ${d.mobile || ''}`.toLowerCase().includes(q)).map(card), ...(ds.length ? [] : [h('p', { class: 'mu' }, 'No distributors yet.')]));
  draw();
  put(root, h('div', { class: 'row' }, h('h2', {}, `Distributors (${ds.length})`), !ctx.ro && h('button', { class: 'btn', onclick: add }, '+ Add')),
    h('input', { placeholder: 'Search name, city or mobile', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } }), h('div', { style: 'height:10px' }), list);
}
