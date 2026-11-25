// Password hashing (PBKDF2) and JWT (HS256) using WebCrypto only.
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pbkdf2(pw, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
const same = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

// Stored format: pbkdf2$<iterations>$<salt>$<hash>. Iterations live in the hash, so they can be changed later.
export async function hashPassword(pw, iter = 50000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iter}$${b64u(salt)}$${b64u(await pbkdf2(pw, salt, iter))}`;
}
export async function verifyPassword(pw, stored) {
  const [, it, s, h] = stored.split('$');
  return same(b64u(await pbkdf2(pw, unb64u(s), +it)), h);
}

const hmacKey = (secret) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
export async function signJwt(payload, secret, ttl = 7 * 86400) {
  const h = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64u(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttl })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
export async function verifyJwt(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64u(s), enc.encode(`${h}.${p}`)))) return null;
    const d = JSON.parse(new TextDecoder().decode(unb64u(p)));
    return d.exp > Date.now() / 1000 ? d : null;
  } catch { return null; }
}
export const tempPassword = () => {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => a[b % a.length]).join('');
};
