import { put, h, formModal, confirmBox, showSecret, toast, loading, fail, modal } from '../ui.js';
import { api, setToken } from '../api.js';
import { importScreen } from './import.js';

export function changePassword(forced, done) {
  formModal('Change password', [{ k: 'o', label: 'Current password', type: 'password' }, { k: 'n', label: 'New password (6+ characters)', type: 'password' }, { k: 'c', label: 'Repeat new password', type: 'password' }], {}, async (v) => {
    if (v.n !== v.c) throw new Error('New passwords do not match');
    await api('/auth/change-password', { method: 'POST', body: { old_password: v.o, new_password: v.n } }); toast('Password changed'); done && done();
  });
}
export function accountCard(ctx) {
  return h('div', { class: 'card' }, h('b', {}, ctx.user.name), h('div', { class: 'mu' }, `Role: ${ctx.user.role}`),
    h('div', { class: 'wrap' }, h('button', { class: 'btn sm ghost', onclick: () => changePassword(false) }, 'Change password'), h('button', { class: 'btn sm danger', onclick: ctx.logout }, 'Log out')));
}
export async function account(root, ctx) { put(root, h('h2', {}, 'Account'), accountCard(ctx)); }

function logoToDataUrl(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const s = 192, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d'); const k = Math.min(s / img.width, s / img.height); x.drawImage(img, (s - img.width * k) / 2, (s - img.height * k) / 2, img.width * k, img.height * k); URL.revokeObjectURL(url); res(c.toDataURL('image/png')); };
    img.onerror = () => rej(new Error('Could not read that image')); img.src = url;
  });
}

export async function settings(root, ctx) {
  loading(root);
  let users, perms;
  try { [users, perms] = await Promise.all([api('/users'), api('/settings/assistant-perms')]); } catch (e) { return fail(root, e); }
  const reload = () => settings(root, ctx), b = ctx.brand;
  const file = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: async (e) => {
    try { const f = e.target.files[0]; if (!f) return; await api('/brand', { method: 'PUT', body: { logo: await logoToDataUrl(f) } }); await ctx.refreshBrand(); toast('Logo updated'); reload(); } catch (x) { toast(x.message); }
  } });
  const editBrand = () => formModal('Company name and colour', [{ k: 'name', label: 'Company name' }, { k: 'short', label: 'Short name' }, { k: 'color', label: 'Brand colour', type: 'color' }], b,
    async (o) => { await api('/brand', { method: 'PUT', body: o }); await ctx.refreshBrand(); toast('Saved'); reload(); });
  const addUser = () => formModal('Add user', [{ k: 'name', label: 'Name' }, { k: 'mobile', label: 'Login mobile', type: 'tel' }, { k: 'role', label: 'Role', type: 'select', options: [{ v: 'assistant', l: 'Company assistant (approves distributor demands)' }, { v: 'admin', l: 'Admin (full access)' }] }], { role: 'assistant' },
    async (o) => { if (!o.name || !o.mobile) throw new Error('Name and mobile are required'); const r = await api('/users', { method: 'POST', body: o }); reload(); showSecret(o.name, o.mobile, r.temp_password); }, 'Create');
  const pchk = (k, l) => { const c = h('input', { type: 'checkbox' }); c.checked = !!perms[k]; c.onchange = async () => { perms[k] = c.checked; try { await api('/settings/assistant-perms', { method: 'PUT', body: perms }); toast('Saved'); } catch (e) { toast(e.message); } }; return h('label', { class: 'chk' }, c, h('span', {}, l)); };
  const staff = users.filter((u) => u.role === 'admin' || u.role === 'assistant');
  put(root, h('h2', {}, 'Settings'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'row', style: 'justify-content:flex-start' }, h('img', { src: b.logo, width: 52, height: 52, style: 'border-radius:50%' }), h('div', {}, h('b', {}, b.name), h('div', { class: 'mu' }, `${b.short} · ${b.color}`)))),
      h('div', { class: 'wrap' }, h('button', { class: 'btn sm ghost', onclick: editBrand }, 'Name / colour'), h('button', { class: 'btn sm ghost', onclick: () => file.click() }, 'Change logo'), file),
      h('small', {}, 'Changes show in the app and on the login page. Home-screen icon changes need a new app build.')),
    h('div', { class: 'row' }, h('h3', {}, 'Staff logins'), h('button', { class: 'btn sm', onclick: addUser }, '+ Add')),
    staff.map((u) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, u.name), h('span', { class: 'tag ' + (u.active ? '' : 'off') }, u.active ? u.role : 'inactive')), h('div', { class: 'mu' }, u.mobile),
      h('div', { class: 'wrap' }, h('button', { class: 'btn sm ghost', onclick: () => confirmBox('Reset password', `New temporary password for ${u.name}?`, 'Reset', async () => { const r = await api(`/users/${u.id}/reset-password`, { method: 'POST' }); showSecret(u.name, u.mobile, r.temp_password); }) }, 'Reset password'),
        u.id !== ctx.user.id && h('button', { class: 'btn sm ghost', onclick: async () => { try { await api('/users/' + u.id, { method: 'PUT', body: { active: u.active ? 0 : 1 } }); reload(); } catch (e) { toast(e.message); } } }, u.active ? 'Deactivate' : 'Activate')))),
    h('h3', {}, 'What the company assistant may do'), h('div', { class: 'card' }, pchk('approve_orders', 'Approve / edit / reject distributor demands'), pchk('dispatch', 'Record dispatches to distributors'), pchk('view_ledgers', 'View distributor ledgers'), pchk('view_reports', 'View the dashboard and reports')),
    h('h3', {}, 'Data'), h('div', { class: 'card row' }, h('span', {}, 'Import routes, distributors, retailers, products, prices and balances from Excel'), h('button', { class: 'btn sm', onclick: () => importScreen(root, ctx, reload) }, 'Import')),
    h('h3', {}, 'My account'), accountCard(ctx));
}
