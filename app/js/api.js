import { API as RAW } from '../config.js';
// Forgive common typos in config.js: missing https://, trailing slash, trailing /api
const API = (/^https?:\/\//i.test(RAW.trim()) ? RAW.trim() : 'https://' + RAW.trim()).replace(/\/+$/, '').replace(/\/api$/i, '');
// remember=true keeps the login on this device (localStorage); false forgets it when the browser/app is closed (sessionStorage).
export const getToken = () => localStorage.getItem('tk') || sessionStorage.getItem('tk');
export function setToken(t, remember = true) {
  localStorage.removeItem('tk'); sessionStorage.removeItem('tk');
  if (t) (remember ? localStorage : sessionStorage).setItem('tk', t);
}
export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' }, t = getToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  let r;
  try { r = await fetch(API + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error('No internet connection or server not reachable'); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && t && path !== '/auth/login') { setToken(null); window.dispatchEvent(new Event('auth-expired')); }
  if (!r.ok) throw new Error(d.error || `Error ${r.status} from ${r.url}`);   // shows which address answered, to spot a wrong API address
  return d;
}
