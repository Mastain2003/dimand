import { put, h, formModal, seg, toast, loading, fail } from '../ui.js';
import { api } from '../api.js';

let which = 'routes';
export async function masters(root, ctx) {
  const defs = { routes: { label: 'Routes', path: '/routes', title: 'route' }, cities: { label: 'Cities', path: '/cities', title: 'city' }, groups: { label: 'Product groups', path: '/groups', title: 'group' } };
  const d = defs[which];
  loading(root);
  let rows, routes = [];
  try { [rows, routes] = await Promise.all([api(d.path), which === 'cities' ? api('/routes') : []]); } catch (e) { return fail(root, e); }
  const reload = () => masters(root, ctx);
  const fields = which === 'cities' ? [{ k: 'name', label: 'City name' }, { k: 'route_id', label: 'Route', type: 'select', options: routes.map((r) => ({ v: r.id, l: r.name })) }] : [{ k: 'name', label: 'Name' }];
  const open = (r) => {
    if (which === 'cities' && !routes.length) return toast('Add a route first');
    formModal((r ? 'Edit ' : 'Add ') + d.title, fields, r || {}, async (o) => {
      if (!o.name) throw new Error('Name is required');
      const b = { name: o.name, ...(which === 'cities' ? { route_id: +o.route_id } : {}) };
      await api(r ? `${d.path}/${r.id}` : d.path, { method: r ? 'PUT' : 'POST', body: b }); toast('Saved'); reload();
    });
  };
  put(root, seg(Object.entries(defs).map(([k, v]) => [k, v.label]), which, (k) => { which = k; reload(); }),
    h('div', { class: 'row' }, h('h2', {}, `${d.label} (${rows.length})`), !ctx.ro && h('button', { class: 'btn', onclick: () => open(null) }, '+ Add')),
    which === 'cities' && h('small', {}, 'Each city belongs to exactly one route; distributors in a city follow that route.'),
    rows.map((r) => h('div', { class: 'card row' }, h('div', {}, h('b', {}, r.name), r.route_name && h('div', { class: 'mu' }, r.route_name)), !ctx.ro && h('button', { class: 'btn sm ghost', onclick: () => open(r) }, 'Edit'))),
    !rows.length && h('p', { class: 'mu' }, 'Nothing added yet.'));
}
