/* ---------------------------------------------------------------------------
 * 01-util.js — DOM builder, icons and small helpers.
 * All text coming from the workbook is inserted as text nodes (never as HTML).
 * ------------------------------------------------------------------------- */

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === '') continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}

/** h('div.card.big', {class, style:{}, data:{}, tip, onclick, ...attrs}, ...children) */
function h(spec, props, ...kids) {
  const parts = spec.split('.');
  const el = document.createElement(parts[0] || 'div');
  if (parts.length > 1) el.className = parts.slice(1).join(' ');
  if (props != null && (typeof props !== 'object' || props.nodeType || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style') {
        for (const p in v) {
          if (v[p] == null) continue;
          if (p.startsWith('--')) el.style.setProperty(p, v[p]);
          else el.style[p] = v[p];
        }
      } else if (k === 'data') { for (const p in v) if (v[p] != null) el.dataset[p] = v[p]; }
      else if (k === 'tip') el.dataset.tip = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (typeof v === 'boolean') { if (k in el) el[k] = v; else el.setAttribute(k, ''); }
      else el.setAttribute(k, v);
    }
  }
  return append(el, kids);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'tip') el.dataset.tip = v;
      else if (k === 'data') { for (const p in v) el.dataset[p] = v[p]; }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
  }
  return append(el, kids);
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
/** Like el.append(), but flattens arrays and skips null/false (use these instead of the native method). */
function add(el, ...kids) { return append(el, kids); }
function fill(el, ...kids) { clear(el); return append(el, kids); }

/* --- icons: 16x16 stroke icons, drawn as paths (no external assets) ---------- */
const ICONS = {
  overview: ['M2.5 2.5H7v5H2.5z', 'M9 2.5h4.5v3H9z', 'M9 7.5h4.5v6H9z', 'M2.5 9.5H7v4H2.5z'],
  matrix: ['M2.5 2.5h11v11h-11z', 'M2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11'],
  risk: ['M8 1.8 14.2 8 8 14.2 1.8 8z', 'M8 5.2v3.3', 'M8 10.7v.1'],
  threat: ['M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z'],
  rmi: ['M8 1.6 13 3.4v4.1c0 3.1-2 5.4-5 6.9-3-1.5-5-3.8-5-6.9V3.4z', 'M5.8 8 7.3 9.5l2.9-3'],
  group: ['M8 2 14 5 8 8 2 5z', 'M2 8l6 3 6-3', 'M2 11l6 3 6-3'],
  assumption: ['M5.6 10.4a4.2 4.2 0 1 1 4.8 0c-.4.3-.7.8-.7 1.3H6.3c0-.5-.3-1-.7-1.3z', 'M6.6 14h2.8'],
  component: ['M8 1.8 13.5 5v6L8 14.2 2.5 11V5z', 'M2.5 5 8 8.2 13.5 5', 'M8 8.2v6'],
  flow: ['M2 3.5h3.5v3H2z', 'M2 9.5h3.5v3H2z', 'M10.5 6.5H14v3h-3.5z', 'M5.5 5c2.5 0 2.5 3 5 3', 'M5.5 11c2.5 0 2.5-3 5-3'],
  issues: ['M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4z', 'M8 5v3.5', 'M8 10.8v.1'],
  format: ['M3 4.4V2.8h10v1.6', 'M8 2.8v10.4', 'M6 13.2h4'],
  consistency: ['M6.8 5H5a3 3 0 0 0 0 6h1.8', 'M9.2 5H11a3 3 0 0 1 0 6H9.2', 'M8 2.2v1.6', 'M8 12.2v1.6'],
  warning: ['M8 2.2 14.3 13.2H1.7z', 'M8 6.6v3', 'M8 11.4v.1'],
  search: ['M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10z', 'm10.6 10.6 3.4 3.4'],
  close: ['M3.5 3.5l9 9M12.5 3.5l-9 9'],
  chevron: ['M6 3.5 10.5 8 6 12.5'],
  back: ['M13 8H3', 'M7 4 3 8l4 4'],
  arrow: ['M3 8h10', 'M9 4l4 4-4 4'],
  sun: ['M8 10.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z', 'M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1'],
  moon: ['M13.5 9.5A5.8 5.8 0 0 1 6.5 2.5a5.8 5.8 0 1 0 7 7z'],
  folder: ['M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.4 1.6h5.6c.7 0 1.2.5 1.2 1.2v6c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z'],
  reload: ['M13.5 8a5.5 5.5 0 1 1-1.6-3.9', 'M13.5 2.5v2.8h-2.8'],
  file: ['M4 1.8h5.5L12.5 5v9.2H4z', 'M9.3 1.8V5h3.2', 'M6 8h4.5M6 10.5h4.5'],
  info: ['M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4z', 'M8 7.2V11', 'M8 5v.1'],
  lock: ['M4 7.2h8v6.3H4z', 'M5.8 7.2V5a2.2 2.2 0 0 1 4.4 0v2.2'],
  eye: ['M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z', 'M8 9.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z'],
  offline: ['M2 2l12 12', 'M4.2 7.3a5.6 5.6 0 0 1 2-1.2M9.9 6.1a5.6 5.6 0 0 1 2 1.2M6.3 9.7a2.7 2.7 0 0 1 3.4 0', 'M8 12.2v.1'],
  check: ['M3 8.5 6.5 12 13 4.5'],
  target: ['M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z', 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'],
  open: ['M9 2.5h4.5V7', 'M13.5 2.5 8 8', 'M12 9.5V13H3V4h3.5'],
  tag: ['M2.5 2.5h5l6 6-5 5-6-6z', 'M5.2 5.2v.1'],
  dot: ['M8 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
};

function icon(name, size, cls) {
  const el = svg('svg', {
    viewBox: '0 0 16 16', width: size || 16, height: size || 16, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    class: 'ico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true',
  });
  for (const d of (ICONS[name] || ICONS.dot)) el.append(svg('path', { d }));
  return el;
}

/* --- generic helpers ------------------------------------------------------- */
function str(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v).replace(/\r\n?/g, '\n').trim();
}
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v.trim().replace(',', '.')))) return Number(v.trim().replace(',', '.'));
  return null;
}
function colName(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
function natCmp(a, b) { return collator.compare(String(a), String(b)); }
function uniq(arr) { return [...new Set(arr)]; }
function groupBy(arr, fn) { const m = new Map(); for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function sum(arr, fn) { let s = 0; for (const x of arr) s += fn ? (fn(x) || 0) : (x || 0); return s; }
function maxOf(arr, fn) { let m = null; for (const x of arr) { const v = fn(x); if (v != null && (m == null || v > m)) m = v; } return m; }

/** Loose comparison key: case, spacing, typographic variants and trailing punctuation are ignored. */
function looseKey(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[‐-―−]/g, '-').replace(/[‘’‚‛]/g, "'").replace(/[“-‟]/g, '"')
    .replace(/[\s ]+/g, ' ').replace(/[\s.;,:]+$/, '').trim();
}

/** Human explanation of why two near-identical strings are not identical. */
function diffHint(a, b) {
  if (a === b) return 'identical';
  if (a.toLowerCase() === b.toLowerCase()) return 'differs only in upper/lower case';
  const ws = (s) => s.replace(/[\s ]+/g, ' ');
  if (ws(a) === ws(b)) return 'differs only in spacing (double or non-breaking spaces)';
  const tp = (s) => s.replace(/[\s.;,:]+$/, '');
  if (tp(a) === tp(b)) return 'differs only in trailing punctuation';
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ctx = (s) => (i > 12 ? '…' : '') + s.slice(Math.max(0, i - 12), i) + '▸' + s.slice(i, i + 14) + (s.length > i + 14 ? '…' : '');
  return 'first difference at character ' + (i + 1) + ': “' + ctx(a) + '” vs “' + ctx(b) + '”';
}

/** Dice coefficient on character bigrams (0..1) for "closest line" suggestions. */
function bigrams(s) { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; }
function dice(ba, bb, la, lb) {
  if (la < 2 || lb < 2) return 0;
  let inter = 0;
  const [small, big] = ba.size < bb.size ? [ba, bb] : [bb, ba];
  for (const [g, c] of small) { const d = big.get(g); if (d) inter += Math.min(c, d); }
  return (2 * inter) / (la - 1 + lb - 1);
}
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function fmtTime(d) { return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
