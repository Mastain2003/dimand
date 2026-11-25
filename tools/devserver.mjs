// Local test server: runs the REAL api code on SQLite (node:sqlite) instead of Cloudflare D1.  node tools/devserver.mjs [port]
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import fs from 'node:fs';
import app from '../api/src/index.js';
const sql = new DatabaseSync(':memory:');
for (const f of fs.readdirSync('migrations').sort()) sql.exec(fs.readFileSync('migrations/' + f, 'utf8'));
class Stmt {
  constructor(sql_, args = []) { this.q = sql_; this.a = args; }
  bind(...a) { return new Stmt(this.q, a); }
  all() { return { results: sql.prepare(this.q).all(...this.a) }; }
  first(col) { const r = sql.prepare(this.q).get(...this.a) || null; return col ? (r ? r[col] : null) : r; }
  run() { const r = sql.prepare(this.q).run(...this.a); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; }
}
const DB = { prepare: (q) => new Stmt(q), batch(list) { sql.exec('BEGIN'); try { const out = list.map((s) => s.run()); sql.exec('COMMIT'); return out; } catch (e) { sql.exec('ROLLBACK'); throw e; } } };
const env = { DB, JWT_SECRET: 'test-secret', SETUP_KEY: 'k', PBKDF2_ITER: '1000' };
http.createServer(async (rq, rs) => {
  const body = ['GET', 'HEAD', 'OPTIONS'].includes(rq.method) ? undefined : await new Promise((r) => { let d = ''; rq.on('data', (x) => (d += x)); rq.on('end', () => r(d)); });
  const res = await app.fetch(new Request('http://x' + rq.url, { method: rq.method, headers: rq.headers, body: body || undefined }), env);
  rs.writeHead(res.status, Object.fromEntries(res.headers)); rs.end(await res.text());
}).listen(+process.argv[2] || 8787, () => console.log('dev API ready'));
