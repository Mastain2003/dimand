import { h, toast, modal } from './ui.js';
import { fmtTime } from './lib.js';
import { api, getToken, setToken } from './api.js';
import { distributors } from './screens/dist.js';
import { products } from './screens/products.js';
import { priceLists } from './screens/prices.js';
import { masters } from './screens/masters.js';
import { settings, account, changePassword, accountCard } from './screens/settings.js';
import { newDemand, myDemands, myLedger, myPrices } from './screens/retailer.js';
import { inbox, retailers, distAccount } from './screens/distributor.js';
import { dCompany } from './screens/dcompany.js';
import { orders, ledgers, catalog } from './screens/company.js';
import { dashboard } from './screens/dashboard.js';

const root = document.getElementById('app');
const DEF = { name: 'Sanchi UDS', short: 'Sanchi', color: '#1a1fd1', logo: 'icons/icon-192.png' };
let brand = { ...DEF, ...JSON.parse(localStorage.getItem('brand') || '{}') }, user = null;

function applyBrand() {
  document.documentElement.style.setProperty('--ac', brand.color);
  document.title = brand.name;
  document.querySelector('meta[name=theme-color]').content = brand.color;
  document.querySelector('link[rel=icon]').href = brand.logo;
  const hi = document.querySelector('header.top img'), hb = document.querySelector('header.top b');
  if (hi) hi.src = brand.logo; if (hb) hb.textContent = brand.name;
}
async function refreshBrand() {
  try { brand = { ...DEF, ...(await api('/brand')) }; localStorage.setItem('brand', JSON.stringify(brand)); } catch {}
  applyBrand(); ctx.brand = brand;
}
const ctx = { get user() { return user; }, brand, ro: true, refreshBrand, logout() { setToken(null); user = null; start(); } };

function loginScreen() {
  const m = h('input', { type: 'tel', placeholder: 'Mobile number', autocomplete: 'username' }), p = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' }), err = h('div', { class: 'err' });
  const go = async () => {
    err.textContent = '';
    try { const r = await api('/auth/login', { method: 'POST', body: { mobile: m.value.trim(), password: p.value } }); setToken(r.token); user = r.user; afterLogin(); } catch (e) { err.textContent = e.message; }
  };
  p.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  root.replaceChildren(h('div', { class: 'login' }, h('img', { src: brand.logo, alt: '' }), h('h2', {}, brand.name),
    h('div', { class: 'card' }, h('label', {}, h('span', {}, 'Mobile number'), m), h('label', {}, h('span', {}, 'Password'), p), err, h('div', { class: 'btns' }, h('button', { class: 'btn', style: 'width:100%', onclick: go }, 'Log in'))),
    h('small', {}, 'Forgot password? Ask your distributor (retailers) or the company (distributors) to reset it.')));
}
function afterLogin() {
  if (user.must_change_password) {
    root.replaceChildren(h('div', { class: 'login' }, h('img', { src: brand.logo }), h('h2', {}, 'Set a new password'), h('p', { class: 'mu' }, 'You are using a temporary password. Please choose your own to continue.'),
      h('button', { class: 'btn', onclick: () => changePassword(true, () => { user.must_change_password = false; showApp(); }) }, 'Change password')));
  } else showApp();
}
const soon = async (r) => r.replaceChildren(h('h2', {}, 'Welcome'), h('div', { class: 'card' }, h('p', {}, 'Demand, payments and ledger screens are coming in the next phase.')), accountCard(ctx));
const T = {
  admin: [['dash', 'Dashboard', '📊', dashboard], ['orders', 'Orders', '📥', orders], ['ledger', 'Ledger', '📒', ledgers], ['catalog', 'Masters', '🗂️', catalog], ['set', 'Settings', '⚙️', settings]],
  assistant: [['dash', 'Dashboard', '📊', dashboard], ['orders', 'Orders', '📥', orders], ['ledger', 'Ledger', '📒', ledgers], ['catalog', 'Masters', '🗂️', catalog], ['me', 'Account', '👤', account]],
  distributor: [['inbox', 'Demands', '📥', inbox], ['rets', 'Retailers', '🏪', retailers], ['co', 'Company', '🏭', dCompany], ['me', 'Account', '👤', distAccount]],
  retailer: [['order', 'Order', '🛒', newDemand], ['mine', 'My demands', '📋', myDemands], ['ledger', 'Ledger', '📒', myLedger], ['prices', 'Prices', '🏷️', myPrices], ['me', 'Account', '👤', account]],
};
function showApp() {
  ctx.ro = user.role !== 'admin';
  const tabs = T[user.role] || [['home', 'Home', '🏠', soon], ['me', 'Account', '👤', account]];
  const main = h('main'), nav = h('nav', { class: 'tabs' }), badge = h('i', { style: 'display:none' });
  const bell = h('button', { class: 'bell', onclick: async () => { try { const r = await api('/notifications'); modal('Notifications', h('div', {}, r.items.length ? r.items.map((n) => h('div', { class: 'card', style: n.is_read ? '' : 'border-left:4px solid var(--ac)' }, h('div', {}, n.message), h('small', {}, fmtTime(n.at)))) : h('p', { class: 'mu' }, 'Nothing yet.')), [{ label: 'Close', run: (c) => c() }]); await api('/notifications/read', { method: 'POST' }); badge.style.display = 'none'; } catch (e) { toast(e.message); } } }, '🔔', badge);
  const refreshBell = () => api('/notifications').then((r) => { badge.textContent = r.unread; badge.style.display = r.unread ? '' : 'none'; }).catch(() => {});
  const draw = () => {
    const k = location.hash.slice(1), t = tabs.find((x) => x[0] === k) || tabs[0];
    nav.replaceChildren(...tabs.map((x) => h('button', { class: x === t ? 'on' : '', onclick: () => { location.hash = x[0]; } }, h('span', {}, x[2]), x[1])));
    t[3](main, ctx); refreshBell();
  };
  window.onhashchange = draw;
  root.replaceChildren(h('header', { class: 'top' }, h('img', { src: brand.logo, alt: '' }), h('b', {}, brand.name), h('small', {}, user.name), bell), main, nav);
  draw();
}
async function start() {
  await refreshBrand();
  if (getToken()) { try { user = await api('/me'); return afterLogin(); } catch { setToken(null); } }
  loginScreen();
}
window.addEventListener('auth-expired', () => { toast('Session expired, please log in'); user = null; loginScreen(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
start();
