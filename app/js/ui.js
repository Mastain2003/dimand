// Tiny DOM helpers (no framework, no build step).
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false || k === 'value') continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(9)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  if (props && props.value !== undefined && props.value !== null) e.value = props.value;
  return e;
}
export const rs = (p) => (p == null ? '' : (p / 100).toFixed(2).replace(/\.00$/, ''));
export const paise = (s) => (String(s).trim() === '' || isNaN(+s) ? null : Math.round(parseFloat(s) * 100));
export function toast(msg) { const t = h('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); }
// Panels (bottom sheets). They do NOT close when you tap outside. They close with the X button, Cancel, the device Back button, or when the action finishes.
const stack = []; let ignorePop = 0;
window.addEventListener('popstate', () => { if (ignorePop > 0) { ignorePop--; return; } const top = stack[stack.length - 1]; if (top) top(true); });
export function modal(title, content, actions = [], opts = {}) {
  const ov = h('div', { class: 'ov' });
  let closed = false;
  const close = (fromBack) => {
    if (closed) return; closed = true; ov.remove();
    const i = stack.indexOf(close); if (i >= 0) stack.splice(i, 1);
    if (fromBack !== true) { ignorePop++; history.back(); }   // remove the history entry this panel added
  };
  ov.append(h('div', { class: 'sheet' + (opts.tall ? ' tall' : '') }, h('div', { class: 'row' }, h('h2', {}, title), h('button', { class: 'x', 'aria-label': 'Close', onclick: () => close() }, '✕')), content,
    actions.length ? h('div', { class: 'btns' }, actions.map((a) => h('button', { class: 'btn ' + (a.cls || ''), onclick: () => a.run(close) }, a.label))) : null));
  document.body.append(ov);
  history.pushState({ panel: 1 }, ''); stack.push(close);
  return { close };
}
export function formModal(title, fields, init, onSave, saveLabel = 'Save') {
  const inputs = {}, err = h('div', { class: 'err' });
  const body = h('div', {}, fields.map((f) => {
    let el;
    if (f.type === 'select') el = h('select', {}, (f.options || []).map((o) => h('option', { value: o.v }, o.l)));
    else if (f.type === 'checkbox') el = h('input', { type: 'checkbox' });
    else el = h('input', { type: f.type || 'text', step: 'any', autocomplete: 'off', placeholder: f.ph || '' });
    const v = init && init[f.k];
    if (f.type === 'checkbox') el.checked = !!v; else if (v != null) el.value = v;
    inputs[f.k] = el;
    return h('label', { class: f.type === 'checkbox' ? 'chk' : '' }, h('span', {}, f.label), f.type === 'password' ? pwBox(el) : el, f.hint && h('small', {}, f.hint));
  }), err);
  return modal(title, body, [{ label: 'Cancel', cls: 'ghost', run: (c) => c() }, { label: saveLabel, run: async (close) => {
    const out = {};
    for (const f of fields) out[f.k] = f.type === 'checkbox' ? inputs[f.k].checked : inputs[f.k].value.trim();
    try { err.textContent = ''; await onSave(out); close(); } catch (e) { err.textContent = e.message; }
  } }]);
}
export function confirmBox(title, text, okLabel, onOk, danger) {
  modal(title, h('p', {}, text), [{ label: 'Cancel', cls: 'ghost', run: (c) => c() }, { label: okLabel, cls: danger ? 'danger' : '', run: async (c) => { await onOk(); c(); } }]);
}
export function showSecret(name, mobile, pw) {
  modal('Temporary password', h('div', {}, h('p', {}, `Give this to ${name} (login: ${mobile}). It is shown only once and must be changed at first login.`), h('div', { class: 'secret' }, pw)),
    [{ label: 'Copy', cls: 'ghost', run: () => { navigator.clipboard?.writeText(pw); toast('Copied'); } }, { label: 'Done', run: (c) => c() }]);
}
export const seg = (items, cur, on) => h('div', { class: 'seg' }, items.map(([k, l]) => h('button', { class: k === cur ? 'on' : '', onclick: () => on(k) }, l)));
export const loading = (root) => root.replaceChildren(h('p', { class: 'mu' }, 'Loading…'));
export const fail = (root, e) => root.replaceChildren(h('div', { class: 'card' }, h('b', {}, 'Could not load'), h('p', { class: 'err' }, e.message)));
// Like root.replaceChildren but accepts arrays and ignores false/null (so `cond && node` is safe).
export const put = (root, ...kids) => root.replaceChildren(...kids.flat(9).filter((x) => x != null && x !== false));
// Wraps a password <input> with a Show/Hide button.
export function pwBox(input) {
  const b = h('button', { type: 'button', class: 'pwtoggle', onclick: () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; } }, 'Show');
  return h('div', { class: 'pwwrap' }, input, b);
}
