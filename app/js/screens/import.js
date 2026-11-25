import { put, h, toast } from '../ui.js';
import { api } from '../api.js';

const ORDER = [['routes', 'Routes', ['routes', 'route']], ['cities', 'Cities', ['cities', 'city']], ['pricelists', 'Price lists', ['pricelists', 'pricelist']], ['products', 'Products', ['products', 'product']], ['distributors', 'Distributors', ['distributors', 'distributor']], ['retailers', 'Retailers', ['retailers', 'retailer']], ['balances', 'Opening balances', ['openingbalances', 'balances', 'opening']]];
const CHUNK = 20, norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const loadXLSX = () => (window.XLSX ? Promise.resolve(window.XLSX) : new Promise((res, rej) => { const s = document.createElement('script'); s.src = SHEETJS; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('Could not load the Excel reader. Check your internet connection.')); document.head.append(s); }));
const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
const save = (name, text) => { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name }); document.body.append(a); a.click(); a.remove(); };

export function importScreen(root, ctx, back) {
  let found = [], log = h('div'), busy = false;
  const status = h('div', { class: 'mu' }, 'Choose your filled Excel file.'), list = h('div'), bar = h('div'), prog = h('div', { class: 'prog', style: 'display:none' }, h('div')), go = h('button', { class: 'btn', disabled: true }, 'Import now');
  const setProg = (p) => { prog.style.display = ''; prog.firstChild.style.width = p + '%'; };
  const pick = async (e) => {
    const f = e.target.files[0]; if (!f) return; status.textContent = 'Reading file…'; found = [];
    try {
      const X = await loadXLSX(), wb = X.read(await f.arrayBuffer(), { type: 'array' });
      for (const name of wb.SheetNames) {
        const rows = X.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false, dateNF: 'yyyy-mm-dd' }).filter((r) => Object.values(r).some((v) => String(v).trim() !== '')), key = ORDER.find((o) => o[2].includes(norm(name)));
        if (rows.length && key) found.push({ kind: key[0], label: key[1], sheet: name, rows });
      }
      found.sort((a, b) => ORDER.findIndex((o) => o[0] === a.kind) - ORDER.findIndex((o) => o[0] === b.kind));
      status.textContent = found.length ? 'Ready. These sheets will be imported in this order:' : 'No sheet with data was recognised. Use the template and keep its sheet names.';
      list.replaceChildren(...found.map((s) => h('div', { class: 'card row' }, h('span', {}, `${s.label} (sheet "${s.sheet}")`), h('b', {}, `${s.rows.length} rows`)))); go.disabled = !found.length;
    } catch (x) { status.textContent = x.message; }
  };
  const run = async () => {
    if (busy) return; busy = true; go.disabled = true; const errors = [], creds = [], warns = new Set(); let done = 0; const total = found.reduce((s, x) => s + x.rows.length, 0), counts = {};
    try {
      for (const s of found) for (let i = 0; i < s.rows.length; i += CHUNK) {
        status.textContent = `Importing ${s.label}… ${Math.min(i + CHUNK, s.rows.length)}/${s.rows.length}`;
        const r = await api('/admin/import', { method: 'POST', body: { kind: s.kind, rows: s.rows.slice(i, i + CHUNK), offset: i } });
        counts[s.label] = (counts[s.label] || 0) + r.valid; r.errors.forEach((x) => errors.push([s.label, x.row, x.message])); creds.push(...r.credentials); r.warnings.forEach((w) => warns.add(w)); done = Math.min(total, done + CHUNK); setProg((done / total) * 100);
      }
      status.textContent = errors.length ? `Finished with ${errors.length} row(s) needing attention.` : 'Finished. Everything was imported.'; setProg(100);
    } catch (x) { status.textContent = 'Stopped: ' + x.message + ' Importing is safe to repeat, so fix the problem and run it again.'; }
    log.replaceChildren(h('div', { class: 'card' }, h('b', {}, 'Result'), Object.entries(counts).map(([k, v]) => h('div', { class: 'row' }, h('span', {}, k), h('b', {}, v))), warns.size > 0 && h('small', {}, [...warns].join(' · '))),
      errors.length > 0 && h('div', { class: 'card' }, h('b', {}, `Rows not imported (${errors.length})`), errors.slice(0, 40).map((e) => h('div', { class: 'err', style: 'min-height:0;margin:4px 0' }, `${e[0]} row ${e[1]}: ${e[2]}`)), errors.length > 40 && h('small', {}, `…and ${errors.length - 40} more in the download.`),
        h('div', { class: 'wrap' }, h('button', { class: 'btn sm ghost', onclick: () => save('import-errors.csv', csv([['Sheet', 'Excel row', 'Problem'], ...errors])) }, 'Download error list'))),
      creds.length > 0 && h('div', { class: 'card' }, h('b', {}, `${creds.length} new logins created`), h('p', { class: 'mu' }, 'Temporary passwords are shown only now. Download the sheet and hand them out; each person must set their own password at first login.'),
        h('button', { class: 'btn sm', onclick: () => save('login-sheet.csv', csv([['Role', 'Name', 'Mobile', 'Temporary password', 'Distributor'], ...creds.map((c) => [c.role, c.name, c.mobile, c.password, c.distributor || ''])])) }, 'Download login sheet')));
    busy = false; ctx.imported && ctx.imported();
  };
  go.onclick = run;
  put(root, h('button', { class: 'btn sm ghost', onclick: back }, '← Settings'), h('h2', {}, 'Import from Excel'),
    h('div', { class: 'card' }, h('b', {}, '1. Get the template'), h('p', { class: 'mu' }, 'Fill the sheets you need (Routes, Cities, PriceLists, Products, Distributors, Retailers, OpeningBalances). Keep the sheet names and column titles.'), h('a', { class: 'btn sm', href: 'templates/Sanchi_import_template.xlsx', download: '' }, 'Download template')),
    h('div', { class: 'card' }, h('b', {}, '2. Choose your file'), h('input', { type: 'file', accept: '.xlsx,.xls,.csv', onchange: pick, style: 'margin-top:8px' }), h('div', { style: 'margin-top:8px' }, status), list),
    h('div', { class: 'card' }, h('b', {}, '3. Import'), h('p', { class: 'mu' }, 'Sheets are imported in the right order. Running it again updates existing rows (matched by mobile number or name) instead of duplicating them.'), prog, h('div', { class: 'btns' }, go)), log);
}
