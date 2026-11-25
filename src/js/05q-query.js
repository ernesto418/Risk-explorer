/* ---------------------------------------------------------------------------
 * 05q-query.js — the search language of the Connections view (pure logic; the
 * UI is in 07c-search.js).
 *
 * A search is an immutable expression tree:
 *   {k:'obj', o}         one object of the model (clicked in a column, or typed as its ID / name)
 *   {k:'ref', name}      a content filter or a saved search of the library, written @name
 *   {k:'not', a}         NOT
 *   {k:'and'|'or', c}    AND / OR over two or more children (same-operator children are flattened)
 * Every term asks a question about one ANCHOR of the view — normally a risk with its threat, components,
 * assumptions, mitigation items and groups: “is it linked to this object / to an object of this filter?”.
 * AND, OR and NOT combine the answers. The columns then show, for every anchor that satisfies the search, the
 * objects it links — restricted to the objects the search names (see qRestrict). Changes return new trees.
 * ------------------------------------------------------------------------- */

const QX = {
  obj: (o) => ({ k: 'obj', o }),
  ref: (name) => ({ k: 'ref', name }),
  not: (a) => (a.k === 'not' ? a.a : { k: 'not', a }),
};
const qIsList = (n) => !!n && (n.k === 'and' || n.k === 'or');

/** Normal form: no empty or single-child AND/OR, no AND inside AND (or OR inside OR), no double NOT. */
function exprSimplify(n) {
  if (!n) return null;
  if (n.k === 'not') { const a = exprSimplify(n.a); return a ? QX.not(a) : null; }
  if (!qIsList(n)) return n;
  const c = [];
  for (const x of n.c.map(exprSimplify)) { if (!x) continue; if (x.k === n.k) c.push(...x.c); else c.push(x); }
  return !c.length ? null : c.length === 1 ? c[0] : { k: n.k, c };
}
/** path = list of steps from the root: a child index for AND/OR, 'a' for the operand of NOT. */
function exprAt(n, path) { for (const s of path) n = s === 'a' ? n.a : n.c[s]; return n; }
function exprSetAt(root, path, v) {
  const go = (n, i) => {
    if (i === path.length) return v;
    const s = path[i];
    if (s === 'a') { const a = go(n.a, i + 1); return a ? { k: 'not', a } : null; }
    const c = n.c.slice(), x = go(c[s], i + 1);
    if (x) c[s] = x; else c.splice(s, 1);
    return { k: n.k, c };
  };
  return exprSimplify(go(root, 0));
}
const exprRemove = (root, path) => exprSetAt(root, path, null);
const exprNegate = (root, path) => exprSetAt(root, path, QX.not(exprAt(root, path)));
/** Adds x to the search: op 'and' | 'or' | 'andnot'. */
function exprAdd(root, x, op) {
  if (op === 'andnot') { x = QX.not(x); op = 'and'; }
  return root ? exprSimplify({ k: op, c: [root, x] }) : x;
}
/**
 * Flips ONE operator of an AND/OR node (the one between child i-1 and child i). The operators of the node are then
 * read with the usual precedence (AND before OR), so “A and B and C” with the second one flipped becomes
 * “(A and B) or C” — the focus bar shows the new grouping as brackets.
 */
function exprToggleOp(root, path, i) {
  const n = exprAt(root, path), ops = n.c.slice(1).map(() => n.k);
  ops[i - 1] = n.k === 'and' ? 'or' : 'and';
  const runs = [[n.c[0]]];
  ops.forEach((op, k) => { if (op === 'or') runs.push([n.c[k + 1]]); else runs[runs.length - 1].push(n.c[k + 1]); });
  const ands = runs.map((r) => (r.length > 1 ? { k: 'and', c: r } : r[0]));
  return exprSetAt(root, path, ands.length > 1 ? { k: 'or', c: ands } : ands[0]);
}
/** Objects and library references of a tree, with neg = true when under an odd number of NOTs. */
function exprAtoms(n, neg, out) {
  out = out || [];
  if (!n) return out;
  if (n.k === 'obj' || n.k === 'ref') out.push({ n, neg: !!neg });
  else if (n.k === 'not') exprAtoms(n.a, !neg, out);
  else n.c.forEach((c) => exprAtoms(c, neg, out));
  return out;
}
/** Object types the search asks for positively (their columns are switched on when a typed search is applied). */
function exprTypes(n, seen) {
  seen = seen || [];
  const out = [];
  for (const { n: a, neg } of exprAtoms(n)) {
    if (neg) continue;
    if (a.k === 'obj') out.push(a.o.type);
    else {
      const it = libGet(a.name);
      if (!it || seen.includes(it.name)) continue;
      if (it.kind === 'filter') out.push(it.type);
      else { const r = qParse(it.expr); if (r.ast) out.push(...exprTypes(r.ast, seen.concat(it.name))); }
    }
  }
  return uniq(out);
}
/** The same search on a newly read workbook: objects are looked up by type and ID; missing ones are dropped. */
function exprRemap(n) {
  if (!n) return null;
  const go = (x) => {
    if (x.k === 'obj') { const o = M.by[x.o.type] && M.by[x.o.type].get(x.o.key || x.o.id); return o && !o.removed ? QX.obj(o) : null; }
    if (x.k === 'ref') return x;
    if (x.k === 'not') { const a = go(x.a); return a ? { k: 'not', a } : null; }
    return { k: x.k, c: x.c.map(go).filter(Boolean) };
  };
  return exprSimplify(go(n));
}

/* ---- names: how objects are written in a search ------------------------------------------------ */
const Q_TYPE_ALIAS = { component: 'component', comp: 'component', assumption: 'assumption', asm: 'assumption', threat: 'threat', risk: 'risk', rmi: 'rmi', item: 'rmi', group: 'group', rmg: 'group' };
let qNamesOf = null, qNamesMap = null;
/** lower-case label (ID, or name of a component) -> objects; removed mitigation items are not searchable. */
function qNames() {
  if (qNamesOf === M && qNamesMap) return qNamesMap;
  const idx = new Map();
  for (const list of [M.components, M.assumptions, M.threats, M.risks, M.rmis, M.groups]) {
    for (const o of list) { const k = objLabel(o).toLowerCase(); if (!k) continue; const l = idx.get(k); if (!l) idx.set(k, [o]); else if (!l.includes(o)) l.push(o); }
  }
  qNamesOf = M; qNamesMap = idx;
  return idx;
}
function qResolve(v, type) {
  const list = (qNames().get(String(v).toLowerCase()) || []).filter((o) => !type || o.type === type);
  if (!list.length && type && M.by[type]) { const o = M.by[type].get(v); if (o && !o.removed) return { o }; } // unique key of a duplicate ID
  if (!list.length) return { err: 'unknown' };
  const types = uniq(list.map((o) => o.type));
  return types.length > 1 ? { err: 'ambiguous', types } : { o: list[0] };
}
function qSuggest(v) {
  const k = String(v).toLowerCase();
  let best = null, bd = 99;
  for (const [lab, list] of qNames()) { if (Math.abs(lab.length - k.length) > 3) continue; const d = levenshtein(k, lab); if (d < bd) { bd = d; best = list[0]; } }
  return best && bd <= Math.max(1, Math.floor(k.length / 4)) ? qObjText(best) : null;
}
const qQuote = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
/** A label as one token: quoted when it has spaces or special characters or reads like a keyword / type prefix. */
function qWord(s) {
  s = String(s);
  const typed = /^([A-Za-z]+):/.exec(s);
  return !s || /[\s()"&|!@\\]/.test(s) || /^(and|or|not)$/i.test(s) || (typed && Q_TYPE_ALIAS[typed[1].toLowerCase()]) ? qQuote(s) : s;
}
/** How an object is written: its ID (or component name); with a type prefix only when that is ambiguous. */
function qObjText(o) {
  const lab = objLabel(o), r = qResolve(lab);
  if (r.o === o) return qWord(lab);
  if (r.err === 'ambiguous' && qResolve(lab, o.type).o === o) return o.type + ':' + qWord(lab);
  return o.type + ':' + qWord(o.key && o.key !== lab ? o.key : lab);
}
function exprToText(n) {
  if (!n) return '';
  const sub = (x) => (qIsList(x) ? '(' + exprToText(x) + ')' : exprToText(x));
  if (n.k === 'obj') return qObjText(n.o);
  if (n.k === 'ref') return '@' + qWord(n.name);
  if (n.k === 'not') return 'NOT ' + sub(n.a);
  return n.c.map(sub).join(n.k === 'and' ? ' AND ' : ' OR ');
}

/* ---- tokenizer and parser -------------------------------------------------------------------------------- */
/** Tokens: ( ) and or not, and atoms {v, ref, type, quoted, open (unterminated quote)} with their positions s..e. */
function qTokens(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const st = i;
    if (c === '(' || c === ')') { i++; out.push({ t: c, s: st, e: i }); continue; }
    if (c === '&' || c === '|') { i += s[i + 1] === c ? 2 : 1; out.push({ t: c === '&' ? 'and' : 'or', s: st, e: i }); continue; }
    if (c === '!') { i++; out.push({ t: 'not', s: st, e: i }); continue; }
    const tok = { t: 'atom', s: st, e: st, v: '', ref: false, type: null, quoted: false, open: false };
    const quoted = () => {
      i++; let v = '';
      while (i < s.length && s[i] !== '"') { if (s[i] === '\\' && i + 1 < s.length) i++; v += s[i++]; }
      if (i < s.length) i++; else tok.open = true;
      tok.quoted = true;
      return v;
    };
    if (c === '@') { tok.ref = true; i++; }
    if (s[i] === '"') tok.v = quoted();
    else {
      let j = i;
      while (j < s.length && !/[\s()"&|!]/.test(s[j])) j++;
      let w = s.slice(i, j);
      i = j;
      const m = !tok.ref && /^([A-Za-z]+):(.*)$/.exec(w);
      if (m && Q_TYPE_ALIAS[m[1].toLowerCase()]) { tok.type = Q_TYPE_ALIAS[m[1].toLowerCase()]; tok.vs = st + m[1].length + 1; w = m[2]; if (!w && s[i] === '"') w = quoted(); }
      if (!tok.ref && !tok.type && /^(and|or|not)$/i.test(w)) { out.push({ t: w.toLowerCase(), s: st, e: i, word: true }); continue; }
      tok.v = w;
    }
    tok.e = i;
    out.push(tok);
  }
  return out;
}
/** Parses a written search. Returns {ast} (null for an empty text) or {err: {msg, s, e}} with the position to mark. */
function qParse(text) {
  text = String(text || '');
  const toks = qTokens(text);
  if (!toks.length) return { ast: null };
  let p = 0;
  const peek = () => toks[p];
  const shown = (t) => text.slice(t.s, t.e);
  const fail = (msg, t) => { const e = new Error(msg); e.q = t ? { s: t.s, e: t.e } : { s: text.length, e: text.length }; throw e; };
  const startsTerm = (t) => t && (t.t === 'atom' || t.t === '(' || t.t === 'not');
  function orExpr() { const c = [andExpr()]; while (peek() && peek().t === 'or') { p++; c.push(andExpr()); } return c.length > 1 ? { k: 'or', c } : c[0]; }
  function andExpr() {
    const c = [unary()];
    for (;;) {
      const t = peek();
      if (t && t.t === 'and') { p++; c.push(unary()); }
      else if (startsTerm(t)) fail('Write AND or OR between “' + shown(toks[p - 1]) + '” and “' + shown(t) + '”.', t);
      else break;
    }
    return c.length > 1 ? { k: 'and', c } : c[0];
  }
  function unary() {
    const t = peek();
    if (!t) fail('The search ends too early: write an ID, a name or @filter after “' + shown(toks[p - 1]) + '”.');
    if (t.t === 'not') { p++; return { k: 'not', a: unary() }; }
    return primary();
  }
  function primary() {
    const t = peek();
    if (t.t === '(') {
      p++;
      if (peek() && peek().t === ')') fail('Empty brackets.', peek());
      const e = orExpr();
      if (!peek() || peek().t !== ')') fail('Missing “)” for the “(” at position ' + (t.s + 1) + '.', t);
      p++;
      return e;
    }
    if (t.t === ')') fail('Unexpected “)”: there is no “(” for it.', t);
    if (t.t !== 'atom') fail('Expected an ID, a name or @filter before “' + shown(t).toUpperCase() + '”.', t);
    if (t.open) fail('Missing closing quote ".', t);
    if (t.ref) {
      p++;
      if (!t.v) fail('Write the name of a content filter or saved search after “@”.', t);
      const it = libGet(t.v);
      if (!it) fail('There is no content filter or saved search called @' + t.v + '.', t);
      return QX.ref(it.name);
    }
    if (!t.v) fail('Write an ID after “' + shown(t) + '”.', t);
    /* a name with spaces may be typed without quotes: the longest run of plain words that is a known name wins */
    let v = t.v, last = t, n = 1;
    if (!t.quoted && !t.type) {
      for (let k = Math.min(8, toks.length - p); k >= 2; k--) {
        const run = toks.slice(p, p + k);
        if (!run.every((x) => x.t === 'atom' && !x.ref && !x.quoted && !x.type)) continue;
        const name = run.map((x) => x.v).join(' ');
        if (qNames().has(name.toLowerCase())) { v = name; last = run[k - 1]; n = k; break; }
      }
    }
    p += n;
    const r = qResolve(v, t.type), span = { s: t.s, e: last.e };
    if (r.o) return QX.obj(r.o);
    if (r.err === 'ambiguous') fail('“' + v + '” is a ' + r.types.map((x) => TYPES[x].label.toLowerCase()).join(' and a ') + ' — write ' + r.types.map((x) => x + ':' + qWord(v)).join(' or ') + '.', span);
    const sg = qSuggest(v);
    fail('Unknown ID or name “' + v + '”' + (t.type ? ' among the ' + TYPES[t.type].plural.toLowerCase() : '') + '.' + (sg ? ' Did you mean ' + sg + '?' : ''), span);
  }
  try {
    const ast = orExpr();
    if (p < toks.length) { const t = toks[p]; fail(t.t === ')' ? 'Unexpected “)”: there is no “(” for it.' : 'Write AND or OR between “' + shown(toks[p - 1]) + '” and “' + shown(t) + '”.', t); }
    return { ast: exprSimplify(ast) };
  } catch (e) {
    if (!e.q) throw e;
    return { err: { msg: e.message, s: e.q.s, e: e.q.e } };
  }
}

/* ---- the library: content filters and saved searches ------------------------------------------------------ */
/**
 * Kept in memory while the tab is open (it survives reloading or opening another workbook). Nothing is stored in the
 * browser: “Download library” saves it as a JSON file and “Load library” reads one back (07c-search.js).
 * filter: {kind:'filter', name, type, field, op, text, whole}   search: {kind:'search', name, expr}
 */
const searchLib = { items: [], dirty: false };
const LIB_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/;
function libGet(name) { const k = String(name).toLowerCase(); return searchLib.items.find((x) => x.name.toLowerCase() === k) || null; }

const FILTER_OPS = [
  { key: 'contains', label: 'contains', word: true }, { key: 'not', label: 'does not contain', word: true },
  { key: 'empty', label: 'is empty' }, { key: 'filled', label: 'is not empty' },
];
const qOpNeedsWord = (op) => !!(FILTER_OPS.find((o) => o.key === op) || {}).word;
const qIdTitles = (list) => list.map((x) => objLabel(x) + (objTitle(x) ? ' ' + objTitle(x) : ''));
const qIdx = (v) => (v == null ? '' : str(v) + ' (' + LEVEL_LABEL[levelOf(v)] + ')');
const qEnum = (item, raw) => (item ? item.label : raw);
const qIssueTexts = (o, cats) => o.issues.filter((i) => cats.includes(i.cat)).map((i) => i.title + ': ' + i.msg + (i.excerpt ? ' “' + i.excerpt + '”' : '') + ' (' + i.code + ')');
/**
 * Attributes a content filter can search in, per object type (the “generic card”). get(o) returns a text or a list
 * of texts; `from` says where the value comes from; rel = derived from links (not part of “Any attribute”).
 */
const FILTER_FIELDS = {
  component: [
    { key: 'name', label: 'Component name', from: 'Column “Affected component” of the risk analysis' },
    { key: 'risks', label: 'Risks', rel: true, from: 'IDs and descriptions of its risks', get: (c) => qIdTitles(c.risks) },
    { key: 'threats', label: 'Threats', rel: true, from: 'Threats of its risks', get: (c) => qIdTitles(uniq(c.risks.map((r) => r.threat).filter(Boolean))) },
    { key: 'assumptions', label: 'Assumptions', rel: true, from: 'Assumptions that name this component', get: (c) => qIdTitles(c.assumptions) },
  ],
  assumption: [
    { key: 'id', label: 'Assumption ID' }, { key: 'title', label: 'Title' }, { key: 'description', label: 'Description' },
    { key: 'components', label: 'Affected components', get: (a) => a.componentsRaw },
    { key: 'validityAlpha', label: 'Validity for Alpha release' }, { key: 'validityBeta', label: 'Validity for Beta release' },
    { key: 'comment', label: 'Comment' },
    { key: 'risks', label: 'Linked risks', rel: true, from: 'Risks that list it under “Related assumptions”', get: (a) => qIdTitles(a.risks) },
  ],
  threat: [
    { key: 'id', label: 'Threat ID' }, { key: 'name', label: 'Threat', from: 'Column “Threat” (G 0.n and name)' },
    { key: 'risks', label: 'Risks', rel: true, from: 'IDs and descriptions of its risks', get: (t) => qIdTitles(t.risks) },
    { key: 'components', label: 'Components affected', rel: true, from: 'Components of its risks', get: (t) => uniq(t.risks.flatMap((r) => r.components)).map((c) => c.name) },
  ],
  risk: [
    { key: 'id', label: 'Risk ID' }, { key: 'description', label: 'Risk description' },
    { key: 'threat', label: 'Threat', from: 'Threat ID and threat name', get: (r) => (r.threat ? r.threat.id + ' ' + r.threat.name : '') },
    { key: 'relevance', label: 'Threat relevance', get: (r) => r.relevanceRaw },
    { key: 'components', label: 'Affected component', get: (r) => r.components.map((c) => c.name) },
    { key: 'coreValues', label: 'Core values at risk', get: (r) => r.coreValues.map((k) => (CFG.coreValues.find((x) => x.key === k) || { label: k }).label) },
    { key: 'assumptions', label: 'Related assumptions', get: (r) => r.assumptionsRaw },
    { key: 'freq', label: 'Frequency of occurrence', get: (r) => qEnum(r.freq, r.freqRaw) },
    { key: 'effect', label: 'Effects', get: (r) => qEnum(r.effect, r.effectRaw) },
    { key: 'index', label: 'Risk index (before)', from: 'Index and level, e.g. “15 (Medium)”', get: (r) => qIdx(r.index) },
    { key: 'category', label: 'Risk Treatment category', get: (r) => qEnum(r.category, r.categoryRaw) },
    { key: 'items', label: 'Mitigation items', rel: true, from: 'RMI IDs of the “RMI ID” cell and the texts of those items', get: (r) => qIdTitles(uniq(r.items.map((o) => o.rmi))) },
    { key: 'groups', label: 'Mitigation groups', rel: true, from: 'Groups of its mitigation items', get: (r) => qIdTitles(r.groups) },
    { key: 'save', label: 'Description for SAVe database' },
    { key: 'freqAfter', label: 'Frequency (after treatment)', get: (r) => qEnum(r.freqAfter, r.freqAfterRaw) },
    { key: 'effectAfter', label: 'Effects (after treatment)', get: (r) => qEnum(r.effectAfter, r.effectAfterRaw) },
    { key: 'residual', label: 'Risk index (after)', from: 'Index after treatment and level; accepted risks keep their initial index', get: (r) => qIdx(r.residual) },
  ],
  rmi: [
    { key: 'id', label: 'RMI ID' }, { key: 'text', label: 'Mitigation item', from: 'Text in “Risk mitigations individual”' },
    { key: 'extDescription', label: 'Extended Description' }, { key: 'comment', label: 'Comment' }, { key: 'responsible', label: 'Responsible' },
    { key: 'groups', label: 'Mitigation groups', rel: true, from: 'Groups whose “RMI ID” cell lists it', get: (m) => qIdTitles(m.groups) },
    { key: 'risks', label: 'Used in risks', rel: true, from: 'Risks whose “RMI ID” cell lists it', get: (m) => qIdTitles(m.risks) },
  ],
  group: [
    { key: 'id', label: 'Group ID' }, { key: 'name', label: 'Security Measure Group' }, { key: 'treatment', label: 'Risk treatment' },
    { key: 'items', label: 'Mitigation items', rel: true, from: 'RMI IDs of its “RMI ID” cell and the texts of those items', get: (g) => qIdTitles(g.rmis) },
    { key: 'risks', label: 'Risks addressed', rel: true, from: 'Risks that use its items', get: (g) => qIdTitles(g.risks) },
  ],
};
const FILTER_ISSUE_FIELDS = [
  { key: 'errors', label: 'Errors', cat: 'consistency', from: 'Format and consistency errors found by the checks (title, message, cell text, check code)', get: (o) => qIssueTexts(o, ['format', 'consistency']) },
  { key: 'warnings', label: 'Warnings', cat: 'warning', from: 'Warnings found by the checks (title, message, cell text, check code)', get: (o) => qIssueTexts(o, ['warning']) },
];
function fieldList(type) { return [{ key: 'any', label: 'Any attribute', any: true, from: 'All own attributes of the object (not its links, errors or warnings)' }].concat(FILTER_FIELDS[type], FILTER_ISSUE_FIELDS); }
function fieldDef(type, key) { return FILTER_FIELDS[type] ? fieldList(type).find((f) => f.key === key) || null : null; }
function fieldValues(o, f) {
  if (f.any) return FILTER_FIELDS[o.type].filter((x) => !x.rel).flatMap((x) => fieldValues(o, x));
  const v = f.get ? f.get(o) : o[f.key];
  return (Array.isArray(v) ? v : [v]).map((x) => str(x)).filter(Boolean);
}
/** Objects a filter of this type can find (removed mitigation items are never searched). */
function qPool(type) { return { component: M.components, assumption: M.assumptions, threat: M.threats, risk: M.risks, rmi: M.rmis, group: M.groups }[type] || []; }
const qNorm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const qEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Case-insensitive search of the word (or phrase); `whole` = not inside a longer word. */
function qWordRx(f, flags) {
  const w = qNorm(f.text || '').trim();
  if (!w) return null;
  const body = w.split(' ').map(qEsc).join('\\s+');
  return new RegExp(f.whole ? '(?<![\\p{L}\\p{N}_])' + body + '(?![\\p{L}\\p{N}_])' : body, 'iu' + (flags || ''));
}
function filterMatcher(f) {
  const fd = fieldDef(f.type, f.field);
  if (!fd) return () => false;
  if (f.op === 'empty') return (o) => !fieldValues(o, fd).length;
  if (f.op === 'filled') return (o) => fieldValues(o, fd).length > 0;
  const rx = qWordRx(f);
  if (!rx) return () => f.op !== 'not';
  const hit = (o) => fieldValues(o, fd).some((v) => rx.test(qNorm(v)));
  return f.op === 'not' ? (o) => !hit(o) : hit;
}
let qSetsOf = null;
const qSets = new Map();
/** The objects a content filter finds in the current workbook (cached per workbook and definition). */
function filterSet(f) {
  if (qSetsOf !== M) { qSets.clear(); qSetsOf = M; }
  const key = JSON.stringify([f.type, f.field, f.op, f.text, !!f.whole]);
  if (!qSets.has(key)) { const m = filterMatcher(f); qSets.set(key, new Set(qPool(f.type).filter(m))); }
  return qSets.get(key);
}
function filterDesc(f) {
  const fd = fieldDef(f.type, f.field), op = FILTER_OPS.find((o) => o.key === f.op);
  return TYPES[f.type].plural + ' · ' + (fd ? fd.label : f.field) + ' ' + (op ? op.label : f.op) + (qOpNeedsWord(f.op) ? ' “' + f.text + '”' + (f.whole ? ' (whole word)' : '') : '');
}
/** Every name a library item refers to (to block deleting a filter that a saved search still uses). */
function libUsers(name) {
  const k = name.toLowerCase();
  return searchLib.items.filter((x) => x.kind === 'search' && qTokens(x.expr).some((t) => t.t === 'atom' && t.ref && t.v.toLowerCase() === k));
}
/** Renames @old to @neu in a written search, token by token (the rest of the text stays as written). */
function qRenameRef(text, old, neu) {
  const k = old.toLowerCase();
  let out = text;
  for (const t of qTokens(text).reverse()) if (t.t === 'atom' && t.ref && t.v.toLowerCase() === k) out = out.slice(0, t.s) + '@' + qWord(neu) + out.slice(t.e);
  return out;
}
function exprRenameRef(n, old, neu) {
  if (!n) return n;
  if (n.k === 'ref') return n.name.toLowerCase() === old.toLowerCase() ? QX.ref(neu) : n;
  if (n.k === 'obj') return n;
  if (n.k === 'not') return { k: 'not', a: exprRenameRef(n.a, old, neu) };
  return { k: n.k, c: n.c.map((c) => exprRenameRef(c, old, neu)) };
}
function exprDropRef(n, name) {
  const go = (x) => (x.k === 'ref' ? (x.name.toLowerCase() === name.toLowerCase() ? null : x) : x.k === 'obj' ? x : x.k === 'not' ? (go(x.a) ? { k: 'not', a: go(x.a) } : null) : { k: x.k, c: x.c.map(go).filter(Boolean) });
  return n ? exprSimplify(go(n)) : n;
}

/* ---- evaluation ------------------------------------------------------------------------------------------- */
const Q_DIMS = ['component', 'assumption', 'threat', 'risk', 'rmi', 'group'];
const qEmptyDims = () => ({ component: [], assumption: [], threat: [], risk: [], rmi: [], group: [] });
/**
 * Anchors = everything the Connections view shows without a search: every visible risk (with what it links), plus the
 * objects no visible risk links — items no risk uses (with their groups), groups without items, components and
 * assumptions without visible risks. d[type] = the objects of that type the anchor links.
 */
function flowAnchors(baseRisks) {
  const vis = new Set(baseRisks), out = [];
  for (const r of baseRisks) out.push({ r, d: { component: r.components, assumption: r.assumptions, threat: r.threat ? [r.threat] : [], risk: [r], rmi: uniq(r.items.map((o) => o.rmi)), group: r.groups } });
  const alone = (o) => !o.risks.some((r) => vis.has(r));
  for (const m of M.rmis) if (alone(m)) out.push({ o: m, d: { ...qEmptyDims(), rmi: [m], group: m.groups } });
  for (const g of M.groups) if (!g.rmis.length) out.push({ o: g, d: { ...qEmptyDims(), group: [g] } });
  for (const c of M.components) if (alone(c)) out.push({ o: c, d: { ...qEmptyDims(), component: [c] } });
  for (const a of M.assumptions) if (alone(a)) out.push({ o: a, d: { ...qEmptyDims(), assumption: [a] } });
  return out;
}
const qErr = (msg) => { const e = new Error(msg); e.qeval = true; return e; };
/** Replaces library references by what they stand for: a filter by the set of objects it finds, a saved search by its tree. */
function qCore(n, stack) {
  if (n.k === 'obj') return { k: 'set', type: n.o.type, objs: new Set([n.o]), obj: n.o };
  if (n.k === 'not') return { k: 'not', a: qCore(n.a, stack) };
  if (qIsList(n)) return { k: n.k, c: n.c.map((c) => qCore(c, stack)) };
  const it = libGet(n.name);
  if (!it) throw qErr('There is no content filter or saved search called @' + n.name + ' (it was deleted or renamed).');
  if (it.kind === 'filter') return { k: 'set', type: it.type, objs: filterSet(it), filter: it };
  if (stack.includes(it.name.toLowerCase())) throw qErr('@' + it.name + ' refers to itself: ' + stack.concat(it.name.toLowerCase()).map((x) => '@' + x).join(' → ') + '.');
  const r = qParse(it.expr);
  if (r.err) throw qErr('Saved search @' + it.name + ': ' + r.err.msg);
  if (!r.ast) throw qErr('Saved search @' + it.name + ' is empty.');
  return qCore(r.ast, stack.concat(it.name.toLowerCase()));
}
const Q_DNF_MAX = 512;
/** Disjunctive normal form: list of conjunctions of literals {set, neg}; null when it would be too large. */
function qDnf(n, neg) {
  if (n.k === 'set') return [[{ set: n, neg: !!neg }]];
  if (n.k === 'not') return qDnf(n.a, !neg);
  const parts = n.c.map((c) => qDnf(c, neg));
  if (parts.some((x) => !x)) return null;
  if ((n.k === 'or') !== !!neg) { const all = parts.flat(); return all.length > Q_DNF_MAX ? null : all; }
  let acc = [[]];
  for (const part of parts) {
    const next = [];
    for (const x of acc) for (const y of part) next.push(x.concat(y));
    if (next.length > Q_DNF_MAX) return null;
    acc = next;
  }
  return acc;
}
const qTest = (set, a) => a.d[set.type].some((x) => set.objs.has(x));
function qBool(n, a) { return n.k === 'set' ? qTest(n, a) : n.k === 'not' ? !qBool(n.a, a) : n.k === 'and' ? n.c.every((c) => qBool(c, a)) : n.c.some((c) => qBool(c, a)); }
/**
 * What one satisfied conjunction shows of an anchor: every column keeps only the objects the conjunction names for it
 * (positive terms); a column it does not name shows everything the anchor links. Groups narrow the items to the items
 * through which the anchor reaches them; the groups column follows the items shown.
 */
function qRestrict(d, conj) {
  const P = {};
  for (const l of conj) if (!l.neg) { const t = l.set.type; if (!P[t]) P[t] = new Set(); for (const o of l.set.objs) P[t].add(o); }
  const keep = (list, S) => (S ? list.filter((x) => S.has(x)) : list);
  const rmi = P.rmi ? keep(d.rmi, P.rmi) : P.group ? d.rmi.filter((m) => m.groups.some((g) => P.group.has(g))) : d.rmi;
  const group = P.group ? keep(d.group, P.group) : d.rmi.length ? uniq(rmi.flatMap((m) => m.groups)) : d.group;
  return { component: keep(d.component, P.component), assumption: keep(d.assumption, P.assumption), threat: d.threat, risk: d.risk, rmi, group };
}
function qMerge(shows) { const out = {}; for (const t of Q_DIMS) out[t] = uniq(shows.flatMap((s) => s[t])); return out; }
/**
 * Evaluates a search on the anchors. Returns { hits: [{a, shows, show}], matched, hidden, error }:
 * shows = one restricted view per satisfied conjunction (edges are drawn per conjunction), show = their union;
 * matched = objects found by positive content filters; hidden = positive terms whose objects are all hidden by
 * “Hide not relevant” (labels, for the explanation when nothing is left).
 */
function evalFocus(ast, baseRisks) {
  const anchors = flowAnchors(baseRisks);
  if (!ast) return { hits: anchors.map((a) => ({ a, shows: [a.d], show: a.d })), matched: new Set(), hidden: [] };
  let core;
  try { core = qCore(ast, []); } catch (e) { if (!e.qeval) throw e; return { hits: [], matched: new Set(), hidden: [], error: e.message }; }
  const dnf = qDnf(core, false), hits = [];
  for (const a of anchors) {
    const shows = [];
    if (dnf) { for (const conj of dnf) if (conj.every((l) => qTest(l.set, a) !== l.neg)) shows.push(qRestrict(a.d, conj)); }
    else if (qBool(core, a)) shows.push(a.d);
    if (shows.length) hits.push({ a, shows, show: shows.length === 1 ? shows[0] : qMerge(shows) });
  }
  const matched = new Set(), hidden = [], vis = new Set(baseRisks);
  const walk = (n, neg) => {
    if (n.k === 'not') return walk(n.a, !neg);
    if (n.k !== 'set') return n.c.forEach((c) => walk(c, neg));
    if (neg) return;
    if (n.filter) n.objs.forEach((o) => matched.add(o));
    const objs = [...n.objs];
    if (objs.length && vis.size < M.risks.length && objs.every((o) => onlyNotRelevant(o) && !(o.risks || [o]).some((r) => vis.has(r)))) hidden.push(n.obj ? objLabel(n.obj) : '@' + n.filter.name);
  };
  walk(core, false);
  return { hits, matched, hidden: uniq(hidden) };
}
