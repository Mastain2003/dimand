import { h } from './ui.js';
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); kids.forEach((c) => c != null && e.append(c.nodeType ? c : document.createTextNode(c))); return e; };

// Horizontal bars. rows: [{label, v, ghost?, note?}]  ghost = last year's value (red tick); fmt formats numbers.
export function hbars(rows, fmt) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.v, r.ghost || 0)));
  return h('div', {}, rows.map((r) => h('div', { class: 'hb' }, h('div', { class: 'hbl', title: r.label }, r.label),
    h('div', { class: 'hbt' }, h('div', { class: 'hbf' + (r.alt ? ' alt' : ''), style: `width:${(r.v / max) * 100}%` }), r.ghost != null && r.ghost > 0 && h('div', { class: 'hbg', style: `left:calc(${(r.ghost / max) * 100}% - 1px)` })),
    h('div', { class: 'hbv' }, fmt(r.v), r.note || ''))));
}
// Line chart. xs: labels, a: current series values, b: last-year series values (optional). Returns an <svg>.
export function lineChart(xs, a, b, fmt) {
  const W = 360, H = 170, L = 38, R = 8, T = 10, Bm = 22, max = Math.max(1, ...a, ...(b || [])), n = xs.length, X = (i) => L + (n <= 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R)), Y = (v) => T + (1 - v / max) * (H - T - Bm);
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  for (let k = 0; k <= 3; k++) { const v = (max * k) / 3, y = Y(v); svg.append(s('line', { x1: L, x2: W - R, y1: y, y2: y, style: 'stroke:var(--ln);stroke-width:1' }), s('text', { x: L - 4, y: y + 3, 'text-anchor': 'end' }, fmt(v, true))); }
  [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, o) => n > 0 && o.indexOf(v) === i).forEach((i) => svg.append(s('text', { x: X(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, xs[i])));
  if (b && b.some((v) => v > 0)) svg.append(s('path', { d: path(b), style: 'fill:none;stroke:var(--mu);stroke-width:1.6;stroke-dasharray:4 3' }));
  svg.append(s('path', { d: path(a), style: 'fill:none;stroke:var(--ac);stroke-width:2.2;stroke-linejoin:round' }));
  if (n <= 45) a.forEach((v, i) => svg.append(s('circle', { cx: X(i), cy: Y(v), r: 2.2, style: 'fill:var(--ac)' })));
  return svg;
}
