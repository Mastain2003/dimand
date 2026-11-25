import { API } from '../config.js';
export const getToken = () => localStorage.getItem('tk');
export const setToken = (t) => (t ? localStorage.setItem('tk', t) : localStorage.removeItem('tk'));
export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' }, t = getToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  let r;
  try { r = await fetch(API + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error('No internet connection or server not reachable'); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && t && path !== '/auth/login') { setToken(null); window.dispatchEvent(new Event('auth-expired')); }
  if (!r.ok) throw new Error(d.error || 'Error ' + r.status);
  return d;
}
