/* ---------------------------------------------------------------------------
 * 07z-edit.js — OPTIONAL editing of the workbook (only in write mode).
 * Flow of every save: high-level edit -> list of cell writes / appended rows ->
 * preview -> new .xlsx built by patching only those cells (all other parts of
 * the archive are copied byte-for-byte) -> re-read and compared cell by cell
 * with the old workbook (only the planned cells may differ) -> written ->
 * read back -> entry appended to the open change log -> tool reloads.
 * ------------------------------------------------------------------------- */
ICONS.plus = ['M8 3v10M3 8h10'];
const SML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function isMergeChild(sh, r, c) { return sh.merges.some((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2 && !(r === m.r1 && c === m.c1)); }
function rawCell(sh, r, c) { const v = sh.rows[r] && sh.rows[r][c]; return v == null ? '' : v; }
const cellRef = (r, c) => colName(c) + (r + 1);

/** Collects the cell writes of one save. */
class ChangeSet {
  constructor() { this.cells = new Map(); this.rows = []; this.focus = null; }
  get(sh, r, c) { const k = sh.name + '|' + r + '|' + c; return this.cells.has(k) ? this.cells.get(k).value : str(rawCell(sh, r, c)); }
  set(sh, r, c, value, computed) {
    if (c == null) return;
    if (isMergeChild(sh, r, c)) throw new Error('cell ' + cellRef(r, c) + ' in “' + sh.name + '” is part of a merged cell');
    const k = sh.name + '|' + r + '|' + c, prev = this.cells.get(k), old = prev ? prev.old : rawCell(sh, r, c);
    if (str(old) === str(value) && !(typeof value === 'number' && typeof old !== 'number')) { this.cells.delete(k); return; }
    this.cells.set(k, { sh, r, c, value, old, computed: !!computed });
  }
  addRow(sh, values) { // values: Map col -> value; computed columns marked with {computed: v}
    const last = Math.max(M.lastRow[Object.keys(M.sheetObj).find((k) => M.sheetObj[k] === sh)], ...this.rows.filter((x) => x.sh === sh).map((x) => x.r));
    const r = last + 1;
    if ((sh.rows[r] || []).some((v) => v != null && v !== '')) throw new Error('row ' + (r + 1) + ' of “' + sh.name + '” below the table is not empty — move that content first');
    this.rows.push({ sh, r, tpl: last, values });
    return r;
  }
  get size() { return this.cells.size + this.rows.length; }
}

/* ---------- spelling used in the workbook (new values are written like the existing ones) ---------- */
function spelling(list, item, rawOf) {
  const n = new Map();
  for (const r of M.risks) for (const [it, raw] of rawOf(r)) if (it === item && raw && item.match.test(looseKey(raw))) n.set(raw, (n.get(raw) || 0) + 1);
  let best = item.label, bc = 0; for (const [k, v] of n) if (v > bc) { bc = v; best = k; }
  return best;
}
const spellFreq = (it) => (it ? spelling(CFG.freq, it, (r) => [[r.freq, r.freqRaw], [r.freqAfter, r.freqAfterRaw]]) : '');
const spellEffect = (it) => (it ? spelling(CFG.effect, it, (r) => [[r.effect, r.effectRaw], [r.effectAfter, r.effectAfterRaw]]) : '');
const spellCat = (it) => (it ? spelling(CFG.categories, it, (r) => [[r.category, r.categoryRaw]]) : '');
function commonIntro() { const n = new Map(); for (const r of M.risks) if (r.intro) n.set(r.intro, (n.get(r.intro) || 0) + 1); let b = '', c = 0; for (const [k, v] of n) if (v > c) { c = v; b = k; } return b || 'Risk treatment options:'; }
const asmLine = (a) => a.id + ' ' + a.title;
const cvText = (keys) => CFG.coreValues.filter((v) => keys.includes(v.key)).map((v) => v.label).join(', ');

/* ---------- high-level edits ---------- */
function computedRiskCells(cs, sh, row, C, f, e, fa, ea, accepted) {
  const i = f && e ? f.value * e.value : '', ia = fa && ea ? fa.value * ea.value : '';
  cs.set(sh, row, C.index, i, true);
  cs.set(sh, row, C.indexAfter, ia, true);
  if (C.reduction != null) cs.set(sh, row, C.reduction, i !== '' && ia !== '' ? i - ia : '', true);
}
function editRisk(cs, r, v) {
  const sh = M.sheetObj.risk, C = M.cols.risk;
  cs.set(sh, r.row, C.description, v.description);
  cs.set(sh, r.row, C.component, v.component);
  cs.set(sh, r.row, C.core, cvText(v.core));
  cs.set(sh, r.row, C.assumptions, v.assumptions.map((id) => asmLine(M.by.assumption.get(id))).join('\n'));
  const f = CFG.freq.find((x) => x.key === v.freq), e = CFG.effect.find((x) => x.key === v.effect), fa = CFG.freq.find((x) => x.key === v.freqAfter), ea = CFG.effect.find((x) => x.key === v.effectAfter), cat = CFG.categories.find((x) => x.key === v.category);
  cs.set(sh, r.row, C.freq, spellFreq(f)); cs.set(sh, r.row, C.effect, spellEffect(e));
  cs.set(sh, r.row, C.freqAfter, spellFreq(fa)); cs.set(sh, r.row, C.effectAfter, spellEffect(ea));
  cs.set(sh, r.row, C.category, spellCat(cat));
  if (C.save != null) cs.set(sh, r.row, C.save, v.save);
  if (v.intro !== (r.intro || '')) {
    if (!v.intro && r.items.length) throw new Error('the introductory line cannot be empty while mitigation items follow it');
    const lines = cs.get(sh, r.row, C.treatment).split('\n'), first = lines.findIndex((l) => l.trim());
    if (r.intro && first >= 0) lines[first] = v.intro; else lines.unshift(v.intro);
    cs.set(sh, r.row, C.treatment, lines.join('\n').replace(/^\n+/, ''));
  }
  const changedAssess = ['freq', 'effect', 'freqAfter', 'effectAfter', 'category'].some((k) => (v[k] || '') !== (k === 'category' ? (r.category ? r.category.key : '') : (r[k] ? r[k].key : '')));
  if (changedAssess) computedRiskCells(cs, sh, r.row, C, f, e, fa, ea, cat && cat.key === 'acceptance');
}
function replaceInLine(cs, sh, row, col, lineNo, oldText, newText) {
  const lines = cs.get(sh, row, col).split('\n'), i = lineNo - 1;
  if (!lines[i] || !lines[i].includes(oldText)) throw new Error('line ' + lineNo + ' of ' + cellRef(row, col) + ' in “' + sh.name + '” no longer contains the expected text');
  lines[i] = lines[i].replace(oldText, () => newText);
  cs.set(sh, row, col, lines.join('\n'));
}
/** Renames a mitigation item everywhere the IDENTICAL text is written (risk analysis and group Content). */
function renameRmi(cs, m, text) {
  const old = m.text;
  for (const o of m.occ) if (o.text === old) replaceInLine(cs, M.sheetObj.risk, o.risk.row, M.cols.risk.treatment, o.line, old, text);
  for (const i of m.listed) if (i.text === old) replaceInLine(cs, M.sheetObj.group, i.group.row, M.cols.group.content, i.line, old, text);
  if (m.base) { const sh = M.sheetObj.rmi, c = M.cols.rmi.text, cur = cs.get(sh, m.row, c); if (!cur.includes(old)) throw new Error('the RMI row of ' + m.id + ' no longer contains the text'); cs.set(sh, m.row, c, cur.replace(old, () => text)); }
}
function editRmiFields(cs, m, v) { const sh = M.sheetObj.rmi, X = M.cols.rmi; cs.set(sh, m.row, X.ext, v.ext); cs.set(sh, m.row, X.comment, v.comment); cs.set(sh, m.row, X.responsible, v.responsible); }
function yesSpelling() { const n = new Map(); for (const m of M.rmis) if (m.base && /^(s[ií]|yes|y|ja)$/i.test(m.assignedRaw || '')) n.set(m.assignedRaw, (n.get(m.assignedRaw) || 0) + 1); let b = 'Si', c = 0; for (const [k, x] of n) if (x > c) { c = x; b = k; } return b; }
function addRmi(cs, risk, text, group, newId) {
  const sh = M.sheetObj.risk, C = M.cols.risk;
  let cur = cs.get(sh, risk.row, C.treatment);
  if (!cur.trim()) cur = commonIntro();
  cs.set(sh, risk.row, C.treatment, cur.replace(/\n+$/, '') + '\n- ' + text);
  if (!group.items.some((i) => i.text === text)) {
    const gs = M.sheetObj.group, g = cs.get(gs, group.row, M.cols.group.content);
    cs.set(gs, group.row, M.cols.group.content, (g.trim() ? g.replace(/\n+$/, '') + '\n' : '') + '- ' + text);
  }
  /* master list “Risk mitigations individual”: new item -> new row with its RMI ID; existing item -> add the group to “Groups” */
  if (!M.sheetObj.rmi) return;
  const rs = M.sheetObj.rmi, X = M.cols.rmi, base = M.rmis.find((m) => m.base && m.text === text);
  if (!base) {
    const vals = new Map([[X.id, newId], [X.text, text]]);
    if (X.groups != null) vals.set(X.groups, group.id);
    if (X.assigned != null) vals.set(X.assigned, yesSpelling());
    cs.addRow(rs, vals);
    return;
  }
  if (X.groups != null) {
    const cur = cs.get(rs, base.row, X.groups), stated = cur.split(/\s*[\n,;]\s*/).map((x) => x.trim()).filter(Boolean);
    if (!stated.includes(group.id)) cs.set(rs, base.row, X.groups, stated.length ? cur.replace(/\s+$/, '') + (cur.includes('\n') ? '\n' : ', ') + group.id : group.id);
  }
  if (X.assigned != null && !/^(s[ií]|yes|y|ja)$/i.test(cs.get(rs, base.row, X.assigned).trim())) cs.set(rs, base.row, X.assigned, yesSpelling());
}
function editThreat(cs, t, v) {
  const sh = M.sheetObj.risk, C = M.cols.risk, rows = uniq([t.row].concat(t.risks.map((r) => r.row)));
  for (const row of rows) for (const [col, val] of [[C.threat, v.name], [C.relevance, v.relevance]]) {
    if (col == null || isMergeChild(sh, row, col)) continue;
    if (row === t.row || str(rawCell(sh, row, col)) !== '') cs.set(sh, row, col, val);
  }
}
function editAssumption(cs, a, v) {
  const sh = M.sheetObj.assumption, C = M.cols.assumption;
  cs.set(sh, a.row, C.title, v.title); cs.set(sh, a.row, C.description, v.description); cs.set(sh, a.row, C.components, v.components);
  cs.set(sh, a.row, C.vAlpha, v.validityAlpha); cs.set(sh, a.row, C.vBeta, v.validityBeta); cs.set(sh, a.row, C.comment, v.comment);
  if (v.title !== a.title && a.title) for (const r of a.risks) {
    const rs = M.sheetObj.risk, col = M.cols.risk.assumptions, lines = cs.get(rs, r.row, col).split('\n');
    const next = lines.map((l) => (new RegExp('^\\s*' + a.id.replace('.', '\\.') + '(?!\\d)').test(l) && l.includes(a.title) ? l.replace(a.title, () => v.title) : l));
    cs.set(rs, r.row, col, next.join('\n'));
  }
}
function replaceToken(cell, old, neu) { if (cell.trim() === old) return neu; return cell.split(/(\s*[;,\n]\s*)/).map((p) => (p === old ? neu : p)).join(''); }
function renameComponent(cs, c, name) {
  for (const r of c.risks) cs.set(M.sheetObj.risk, r.row, M.cols.risk.component, replaceToken(cs.get(M.sheetObj.risk, r.row, M.cols.risk.component), c.name, name));
  for (const a of c.assumptions) cs.set(M.sheetObj.assumption, a.row, M.cols.assumption.components, replaceToken(cs.get(M.sheetObj.assumption, a.row, M.cols.assumption.components), c.name, name));
}
function editGroup(cs, g, v) { const sh = M.sheetObj.group, C = M.cols.group; cs.set(sh, g.row, C.name, v.name); cs.set(sh, g.row, C.treatment, v.treatment); }
function addRisk(cs, v) {
  const C = M.cols.risk, t = v.threat, vals = new Map();
  const f = CFG.freq.find((x) => x.key === v.freq), e = CFG.effect.find((x) => x.key === v.effect), fa = CFG.freq.find((x) => x.key === v.freqAfter), ea = CFG.effect.find((x) => x.key === v.effectAfter), cat = CFG.categories.find((x) => x.key === v.category);
  const i = f && e ? f.value * e.value : '', ia = fa && ea ? fa.value * ea.value : '';
  for (const [col, val] of [[C.threatId, t.id], [C.threat, t.name], [C.relevance, t.relevance], [C.riskId, v.riskId], [C.description, v.description], [C.component, v.component], [C.core, cvText(v.core)],
    [C.assumptions, v.assumptions.map((id) => asmLine(M.by.assumption.get(id))).join('\n')], [C.freq, spellFreq(f)], [C.effect, spellEffect(e)], [C.save, v.save], [C.category, spellCat(cat)],
    [C.treatment, ''], [C.freqAfter, spellFreq(fa)], [C.effectAfter, spellEffect(ea)]]) if (col != null) vals.set(col, val);
  for (const [col, val] of [[C.index, i], [C.indexAfter, ia], [C.reduction, i !== '' && ia !== '' ? i - ia : '']]) if (col != null) vals.set(col, { computed: val });
  cs.addRow(M.sheetObj.risk, vals);
}
function addAssumption(cs, v) {
  const C = M.cols.assumption, vals = new Map();
  for (const [col, val] of [[C.id, v.id], [C.title, v.title], [C.description, v.description], [C.components, v.components], [C.vAlpha, v.validityAlpha], [C.vBeta, v.validityBeta], [C.comment, v.comment]]) if (col != null) vals.set(col, val);
  cs.addRow(M.sheetObj.assumption, vals);
}
function addGroup(cs, v) {
  const C = M.cols.group, vals = new Map();
  for (const [col, val] of [[C.id, v.id], [C.treatment, v.treatment], [C.name, v.name], [C.content, '']]) if (col != null) vals.set(col, val);
  cs.addRow(M.sheetObj.group, vals);
}

/* ---------- XML patching ---------- */
function shiftFormula(f, dr) {
  return f.split('"').map((seg, i) => (i % 2 ? seg : seg.replace(/(^|[^A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, pre, cd, col, rd, row) => pre + cd + col + rd + (rd ? row : String(+row + dr))))).join('"');
}
function kidsOf(el, name) { return [...el.children].filter((x) => x.localName === name); }
function mk(doc, like, name) { return doc.createElementNS(like.namespaceURI || SML, (like.prefix ? like.prefix + ':' : '') + name); }
function rowEl(doc, r, create, tplRow) {
  const sd = doc.getElementsByTagNameNS('*', 'sheetData')[0];
  let before = null;
  for (const x of kidsOf(sd, 'row')) { const n = +x.getAttribute('r'); if (!n) throw new Error('rows without numbers are not supported'); if (n === r + 1) return x; if (n > r + 1) { before = x; break; } }
  if (!create) return null;
  const el = mk(doc, sd, 'row');
  if (tplRow) for (const a of tplRow.attributes) if (!['r', 'spans'].includes(a.name)) el.setAttribute(a.name, a.value);
  el.setAttribute('r', String(r + 1));
  sd.insertBefore(el, before);
  return el;
}
function cellEl(doc, row, r, c, create) {
  const ref = cellRef(r, c);
  let before = null;
  for (const x of kidsOf(row, 'c')) { const a = x.getAttribute('r'); if (!a) throw new Error('cells without references are not supported'); if (a === ref) return x; const p = parseRef(a); if (p.c > c) { before = x; break; } }
  if (!create) return null;
  const el = mk(doc, row, 'c'); el.setAttribute('r', ref); row.insertBefore(el, before); return el;
}
function writeCell(doc, el, value, formula) {
  const f = kidsOf(el, 'f')[0];
  if (f && formula === undefined) throw new Error('cell ' + el.getAttribute('r') + ' contains a formula — change it in Excel');
  for (const k of [...el.children]) if (k.localName !== 'f' || formula !== 'keep') el.removeChild(k);
  el.removeAttribute('t');
  if (typeof formula === 'string' && formula !== 'keep') { const fe = mk(doc, el, 'f'); fe.textContent = formula; el.appendChild(fe); }
  if (value === '' || value == null) return;
  if (typeof value === 'number') { const v = mk(doc, el, 'v'); v.textContent = String(value); el.appendChild(v); return; }
  el.setAttribute('t', 'inlineStr');
  const is = mk(doc, el, 'is'), t = mk(doc, el, 't');
  t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  t.textContent = String(value); is.appendChild(t); el.appendChild(is);
}
function formulaOf(doc, el, r) {
  const f = el && kidsOf(el, 'f')[0];
  if (!f) return null;
  if (f.getAttribute('t') === 'array' || f.getAttribute('t') === 'dataTable') return null;
  if (f.getAttribute('t') === 'shared') {
    const si = f.getAttribute('si');
    for (const x of doc.getElementsByTagNameNS('*', 'f')) if (x.getAttribute('t') === 'shared' && x.getAttribute('si') === si && x.getAttribute('ref') && x.textContent) {
      return { text: x.textContent, row: parseRef(x.parentNode.getAttribute('r')).r };
    }
    return null;
  }
  return f.textContent ? { text: f.textContent, row: r } : null;
}
function extendRanges(text, lastRow1, newLast1) {
  return text.split(/\s+/).map((rg) => { const m = /^(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)$/.exec(rg); return m && +m[4] === lastRow1 && +m[2] <= lastRow1 ? m[1] + m[2] + ':' + m[3] + newLast1 : rg; }).join(' ');
}
async function serialize(doc) { return new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + new XMLSerializer().serializeToString(doc).replace(/^\s*<\?xml[^>]*\?>\s*/, '')); }
async function deflate(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); }
async function rebuildZip(zip, changed) {
  const parts = [], central = [], enc = new TextEncoder();
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  let off = 0, n = 0;
  for (const e of zip.list()) {
    let method = e.method, crc = e.crc, size = e.size, data;
    if (changed.has(e.name)) { const raw = changed.get(e.name); data = await deflate(raw); method = 8; crc = crc32(raw); size = raw.length; } else data = zip.raw(e.name);
    if (data.length > 0xFFFFFFF0 || size > 0xFFFFFFF0) throw new Error('workbook too large to edit');
    const nm = enc.encode(e.name), flags = /[^\x00-\x7f]/.test(e.name) ? 0x0800 : 0;
    const head = [...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(size), ...u16(nm.length), ...u16(0)];
    parts.push(new Uint8Array([...u32(0x04034b50), ...head]), nm, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...head, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
    off += 30 + nm.length + data.length; n++;
  }
  const cd = central.reduce((a, b) => a + b.length, 0);
  return new Uint8Array(await new Blob([...parts, ...central, new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(n), ...u16(n), ...u32(cd), ...u32(off), ...u16(0)])]).arrayBuffer());
}
/** Builds the new workbook bytes for a change set and the list of planned cell values (for verification). */
async function buildEdited(cs) {
  const zip = M.wb.zip, docs = new Map(), planned = new Map();
  const doc = async (p) => { if (!docs.has(p)) docs.set(p, await zip.xml(p)); return docs.get(p); };
  let formulas = false;
  for (const ch of cs.cells.values()) {
    const d = await doc(ch.sh.path), row = rowEl(d, ch.r, true, null), el = cellEl(d, row, ch.r, ch.c, true);
    const hasF = !!kidsOf(el, 'f')[0];
    writeCell(d, el, ch.value, ch.computed ? (hasF ? 'keep' : null) : undefined);
    if (hasF) formulas = true;
    planned.set(ch.sh.name + '|' + ch.r + '|' + ch.c, ch.value);
  }
  const bySheet = groupBy(cs.rows, (x) => x.sh);
  for (const [sh, rows] of bySheet) {
    const d = await doc(sh.path), lastRow1 = rows[0].tpl + 1, newLast1 = rows[rows.length - 1].r + 1;
    for (const nr of rows) {
      const tpl = rowEl(d, nr.tpl, false), row = rowEl(d, nr.r, true, tpl);
      const cols = uniq([...(tpl ? kidsOf(tpl, 'c').map((x) => parseRef(x.getAttribute('r')).c) : []), ...nr.values.keys()]).sort((a, b) => a - b);
      for (const c of cols) {
        const t = tpl ? cellEl(d, tpl, nr.tpl, c, false) : null, el = cellEl(d, row, nr.r, c, true);
        if (t && t.getAttribute('s')) el.setAttribute('s', t.getAttribute('s'));
        let v = nr.values.has(c) ? nr.values.get(c) : '', fml = null;
        if (v && typeof v === 'object') { v = v.computed; const fo = formulaOf(d, t, nr.tpl); if (fo) { fml = shiftFormula(fo.text, nr.r - fo.row); formulas = true; } }
        writeCell(d, el, v, fml);
        planned.set(sh.name + '|' + nr.r + '|' + c, v);
      }
    }
    for (const el of d.getElementsByTagNameNS('*', '*')) {
      if (['conditionalFormatting', 'dataValidation'].includes(el.localName) && el.getAttribute('sqref')) el.setAttribute('sqref', extendRanges(el.getAttribute('sqref'), lastRow1, newLast1));
      if (el.localName === 'sqref' && el.textContent) el.textContent = extendRanges(el.textContent, lastRow1, newLast1);
      if (['autoFilter', 'dimension'].includes(el.localName) && el.getAttribute('ref')) el.setAttribute('ref', extendRanges(el.getAttribute('ref'), lastRow1, newLast1));
    }
    const relsPath = sh.path.replace(/([^/]+)$/, '_rels/$1.rels');
    if (zip.has(relsPath)) for (const r of kids(await zip.xml(relsPath), 'Relationship')) if (/\/table$/.test(r.getAttribute('Type') || '')) {
      const td = await doc(resolvePath(sh.path, r.getAttribute('Target')));
      for (const el of [td.documentElement, ...td.getElementsByTagNameNS('*', 'autoFilter')]) if (el.getAttribute('ref')) el.setAttribute('ref', extendRanges(el.getAttribute('ref'), lastRow1, newLast1));
    }
  }
  if (formulas) {
    const wbd = await doc(M.wb.wbPath);
    let calc = wbd.getElementsByTagNameNS('*', 'calcPr')[0];
    if (!calc) { calc = mk(wbd, wbd.documentElement, 'calcPr'); const after = ['definedNames', 'externalReferences', 'functionGroups', 'sheets'].map((n) => kidsOf(wbd.documentElement, n)[0]).find(Boolean); wbd.documentElement.insertBefore(calc, after ? after.nextSibling : null); }
    calc.setAttribute('fullCalcOnLoad', '1');
  }
  const changed = new Map();
  for (const [p, d] of docs) changed.set(p, await serialize(d));
  return { bytes: await rebuildZip(zip, changed), planned };
}
/** Re-reads the new workbook and compares every cell of every sheet: only planned cells may differ. */
async function verifyEdited(bytes, planned) {
  const nw = await readWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), problems = [];
  for (const os of M.wb.sheets) {
    const ns = nw.sheets.find((x) => x.name === os.name);
    if (!ns) { problems.push('sheet “' + os.name + '” missing'); continue; }
    const R = Math.max(os.rows.length, ns.rows.length);
    for (let r = 0; r < R; r++) {
      const C = Math.max((os.rows[r] || []).length, (ns.rows[r] || []).length);
      for (let c = 0; c < C; c++) {
        const k = os.name + '|' + r + '|' + c, want = planned.has(k) ? planned.get(k) : rawCell(os, r, c), got = rawCell(ns, r, c);
        if (str(want) !== str(got)) problems.push('“' + os.name + '” ' + cellRef(r, c) + ': expected “' + truncate(str(want), 40) + '”, found “' + truncate(str(got), 40) + '”');
      }
    }
    if (JSON.stringify(os.merges) !== JSON.stringify(ns.merges)) problems.push('merged cells of “' + os.name + '” changed');
  }
  if (problems.length) throw new Error('verification failed, nothing was saved: ' + problems.slice(0, 3).join('; '));
  return nw;
}
async function workbookHandle() {
  if (state.handle) return state.handle;
  if (write.dir) { try { const h2 = await write.dir.getFileHandle(M.file.name); if (await sha256(await (await h2.getFile()).arrayBuffer()) === state.hash) return h2; } catch (e) { /* not in the folder */ } }
  throw new Error('the tool cannot save to this file: open the workbook with “Open…” (or keep it in the repository folder) so the browser allows writing to it');
}
/** Preview -> write -> verify -> log -> reload. */
async function commit(cs, title) {
  if (!cs.size) { toast('Nothing changed.'); return false; }
  /* column header + what the row is (e.g. “Risk reduction value” of R.API.3), so every line of the preview is self-explanatory */
  const header = (sh, c) => { const rep = M.sheetReport.find((x) => x.name === sh.name); return rep && rep.headerRow ? str(rawCell(sh, rep.headerRow - 1, c)) : ''; };
  const owner = (sh, r) => { const o = [...M.risks, ...M.assumptions, ...M.groups, ...M.rmis.filter((x) => x.base)].find((x) => x.sheet === sh.name && x.row === r) || M.threats.find((t) => t.sheet === sh.name && t.row === r); return o ? o.id : ''; };
  const CALC = ' — calculated: risk index = frequency × effects, reduction = index before − index after';
  const rows = [...cs.cells.values()].map((ch) => [ch.sh.name, cellRef(ch.r, ch.c), str(ch.old), str(ch.value), header(ch.sh, ch.c) + (ch.computed ? CALC : ''), owner(ch.sh, ch.r)]);
  for (const nr of cs.rows) for (const [c, v] of nr.values) rows.push([nr.sh.name, cellRef(nr.r, c), '', str(v && typeof v === 'object' ? v.computed : v), header(nr.sh, c) + (v && typeof v === 'object' ? CALC : ''), 'new row']);
  const ok = await new Promise((res) => {
    let done = false; const finish = (v) => { if (!done) { done = true; res(v); } };
    openDialog('Save to Excel — ' + title, h('div',
      h('p', plural(rows.length, 'cell') + ' of “' + M.file.name + '” will be written. Nothing else in the workbook changes; the result is checked cell by cell before it is saved.'),
      h('div.preview', h('table.tbl', h('thead', h('tr', h('th', 'Object'), h('th', 'Field (column)'), h('th', 'Cell'), h('th', 'Current'), h('th', 'New'))), h('tbody', rows.map((x) => h('tr', h('td', x[5] || '—'), h('td', x[4] || '—'), h('td', { tip: x[0] }, x[1]), h('td.chg-from', x[2] || '—'), h('td.chg-to', x[3] || '—')))))),
      h('p.note', icon('info', 12), 'Cell styles are kept; partial (rich-text) formatting inside a rewritten cell is not. Close the workbook in Excel before saving.'),
      h('div.dialog-actions', h('button.btn', { type: 'button', onclick: () => { finish(false); document.querySelector('dialog[open]').close(); } }, 'Cancel'),
        h('button.btn.primary', { type: 'button', id: 'edit-confirm', onclick: () => { finish(true); document.querySelector('dialog[open]').close(); } }, icon('pen', 14), 'Write to Excel'))), true);
    document.querySelector('dialog[open]').addEventListener('close', () => finish(false));
  });
  if (!ok) return false;
  if (edit.busy) return false;
  edit.busy = true; document.body.classList.add('busy');
  try {
    const handle = await workbookHandle();
    const { bytes, planned } = await buildEdited(cs);
    const nw = await verifyEdited(bytes, planned);
    const before = snapshot(M), shaBefore = state.hash;
    const after = buildModel(nw, { name: M.file.name });
    await writeWorkbookFile(handle, bytes);
    const d = diffSnapshots(before, snapshot(after)), at = new Date().toISOString();
    let logFile = null, logErr = null;
    try { logFile = await appendSaveLog({ type: 'save', at, author: write.author, action: title, workbook: { name: M.file.name, sha256Before: shaBefore, sha256After: await sha256(bytes) }, cells: rows.map((x) => ({ sheet: x[0], cell: x[1], object: x[5], field: x[4].split(' — ')[0], calculated: / — calculated/.test(x[4]), old: x[2], new: x[3] })), summary: d.summary, changes: d.changes }); } catch (e) { logErr = e; }
    const focus = cs.focus;
    await loadFile(await handle.getFile(), handle);
    hist.loaded = false; loadHistory().catch(() => {});
    if (focus && M.by[focus.type] && M.by[focus.type].get(focus.id)) openObj(M.by[focus.type].get(focus.id));
    if (logErr) toast('Saved to “' + M.file.name + '”, but the change log could not be written: ' + (logErr.message || logErr), 'error');
    else toast('Saved to “' + M.file.name + '” (' + plural(rows.length, 'cell') + '). Logged in ' + logFile + '.');
    return true;
  } catch (e) { toast('Not saved: ' + (e && e.message ? e.message : e), 'error'); return false; } finally { edit.busy = false; document.body.classList.remove('busy'); }
}
const edit = { busy: false };

/* ---------- forms ---------- */
function formDialog(title, fields, onSubmit) {
  const els = {}, err = h('div.form-err', { role: 'alert' });
  const body = h('div.form', fields.map((f) => {
    let el;
    if (f.type === 'select') { el = h('select', { id: 'f-' + f.key }); for (const o of f.options) { const op = h('option', { value: o.value }, o.label); if (o.value === f.value) op.selected = true; el.append(op); } }
    else if (f.type === 'checks') { el = h('div.checks', { id: 'f-' + f.key }, f.options.map((o) => h('label', h('input', { type: 'checkbox', value: o.value, checked: f.value.includes(o.value) }), ' ' + o.label))); }
    else if (f.type === 'textarea') el = h('textarea', { id: 'f-' + f.key, rows: f.rows || 3 }, f.value || '');
    else { el = h('input', { type: 'text', id: 'f-' + f.key, value: f.value || '', list: f.list ? 'dl-' + f.key : null, autocomplete: 'off' }); }
    els[f.key] = el;
    return h('label.fieldbox', h('span', f.label + (f.required ? ' *' : '')), el, f.list ? h('datalist', { id: 'dl-' + f.key }, f.list.map((x) => h('option', { value: x }))) : null, f.help ? h('small.muted', f.help) : null);
  }));
  const read = () => { const v = {}; for (const f of fields) { const el = els[f.key]; v[f.key] = f.type === 'checks' ? [...el.querySelectorAll('input:checked')].map((x) => x.value) : el.value.replace(/\r/g, '').trim(); } return v; };
  const submit = async () => {
    const v = read();
    for (const f of fields) if (f.required && (!v[f.key] || (Array.isArray(v[f.key]) && !v[f.key].length))) { err.textContent = '“' + f.label + '” is required.'; return; }
    try { const cs = await onSubmit(v); if (!cs) return; document.querySelector('dialog[open]').close(); await commit(cs, title); }
    catch (e) { err.textContent = e && e.message ? e.message : String(e); }
  };
  openDialog(title, h('div', body, err, h('div.dialog-actions', h('button.btn', { type: 'button', onclick: () => document.querySelector('dialog[open]').close() }, 'Cancel'), h('button.btn.primary', { type: 'button', id: 'form-save', onclick: submit }, 'Review changes…'))), true);
}
const opt = (list, labelFn, empty) => (empty ? [{ value: '', label: empty }] : []).concat(list.map((x) => ({ value: x.key, label: labelFn ? labelFn(x) : x.label })));
const singleLine = (s, what) => { if (/\n/.test(s)) throw new Error(what + ' must be a single line'); if (/\[[^\]]*\]?\s*$/.test(s)) throw new Error(what + ' must not end with a [bracketed] text'); return s.replace(/^-\s*/, ''); };
function riskFields(r) {
  const t = r || {};
  return [
    { key: 'description', label: 'Risk description', type: 'textarea', value: t.description || '', required: true },
    { key: 'component', label: 'Affected component', value: t.componentRaw || '', list: M.components.map((c) => c.name), required: true, help: 'Pick an existing component or type a new name.' },
    { key: 'core', label: 'Core values at risk', type: 'checks', options: CFG.coreValues.map((c) => ({ value: c.key, label: c.label })), value: t.coreValues || [], required: true },
    { key: 'assumptions', label: 'Related assumptions', type: 'checks', options: M.assumptions.map((a) => ({ value: a.id, label: a.id + ' ' + truncate(a.title, 70) })), value: t.assumptions ? t.assumptions.map((a) => a.id) : [] },
    { key: 'freq', label: 'Frequency of occurrence', type: 'select', options: opt(CFG.freq), value: t.freq ? t.freq.key : '', required: true },
    { key: 'effect', label: 'Effects without additional safeguards', type: 'select', options: opt(CFG.effect), value: t.effect ? t.effect.key : '', required: true },
    { key: 'category', label: 'Risk treatment category', type: 'select', options: opt(CFG.categories), value: t.category ? t.category.key : '', required: true },
    { key: 'freqAfter', label: 'Frequency after treatment', type: 'select', options: opt(CFG.freq, null, '—'), value: t.freqAfter ? t.freqAfter.key : '' },
    { key: 'effectAfter', label: 'Effects after treatment', type: 'select', options: opt(CFG.effect, null, '—'), value: t.effectAfter ? t.effectAfter.key : '' },
  ].concat(M.cols.risk.save != null ? [{ key: 'save', label: 'Description for SAVe database', type: 'textarea', value: t.save || '' }] : []);
}
const checkComponent = (s) => { if (/[;,\n]/.test(s)) throw new Error('a component name must not contain “;”, “,” or line breaks'); return s; };
function nextPadded(list) { const m = list.map((x) => /^(\D*)(\d+)$/.exec(x)).filter(Boolean); if (!m.length) return ''; const p = m[0][1], w = m[0][2].length, n = Math.max(...m.filter((x) => x[1] === p).map((x) => +x[2])) + 1; return p + String(n).padStart(w, '0'); }
function nextId(prefix, list) { let n = 0; for (const x of list) { const m = new RegExp('^' + prefix.replace(/\./g, '\\.') + '(\\d+)$').exec(x); if (m) n = Math.max(n, +m[1]); } return prefix + (n + 1); }

const EDITORS = {
  risk: (r) => formDialog('Edit risk ' + r.id, riskFields(r).concat([{ key: 'intro', label: 'Introductory line of “Risk treatment option”', value: r.intro || '', help: r.intro ? null : 'This risk has no introductory line; leave empty to keep it that way.' }]), (v) => {
    const cs = new ChangeSet(); cs.focus = r; v.component = checkComponent(v.component); editRisk(cs, r, v); return cs; }),
  threat: (t) => formDialog('Edit threat ' + t.id, [{ key: 'name', label: 'Threat', value: t.name, required: true, help: 'Written in every row of ' + t.id + '.' }].concat(M.cols.risk.relevance != null ? [{ key: 'relevance', label: 'Threat relevance', type: 'textarea', value: t.relevance || '' }] : []), (v) => {
    const m = /^G 0\.(\d+) \S/.exec(v.name); if (!m) throw new Error('the threat must be written as “G 0.<number> <name>”');
    if (/^T\.BSI\.\d+$/.test(t.id) && +m[1] !== +t.id.split('.')[2]) throw new Error('the number must stay ' + t.id.split('.')[2] + ' (Threat ID ' + t.id + ')');
    const cs = new ChangeSet(); cs.focus = t; editThreat(cs, t, v); return cs; }),
  rmi: (m) => formDialog('Edit mitigation item ' + m.id, rmiExtraFields(m, [{ key: 'text', label: 'Text', type: 'textarea', rows: 2, value: m.text, required: true,
    help: 'Replaced in every line with exactly this text: ' + plural(m.occ.filter((o) => o.text === m.text).length, 'line') + ' in the risk analysis, ' + plural(m.listed.filter((i) => i.text === m.text).length, 'line') + ' in group Content.' }]), (v) => {
    const cs = new ChangeSet(); cs.focus = m; if (v.text !== m.text) renameRmi(cs, m, singleLine(v.text, 'The text')); if (m.base) editRmiFields(cs, m, v); return cs; }),
  group: (g) => formDialog('Edit group ' + g.id, [{ key: 'name', label: 'Security Measure Group', value: g.name, required: true }, { key: 'treatment', label: 'Risk treatment', value: g.treatment, list: uniq(M.groups.map((x) => x.treatment).filter(Boolean)) }], (v) => {
    const cs = new ChangeSet(); cs.focus = g; editGroup(cs, g, v); return cs; }),
  assumption: (a) => formDialog('Edit assumption ' + a.id, asmFields(a), (v) => { const cs = new ChangeSet(); cs.focus = a; editAssumption(cs, a, v); return cs; }),
  component: (c) => formDialog('Rename component', [{ key: 'name', label: 'Component name', value: c.name, required: true, help: 'Renamed in ' + plural(c.risks.length, 'risk') + ' and ' + plural(c.assumptions.length, 'assumption') + '.' }], (v) => {
    const cs = new ChangeSet(); renameComponent(cs, c, checkComponent(v.name)); cs.focus = { type: 'component', id: v.name }; return cs; }),
};
function asmFields(a) {
  const t = a || {}, vals = uniq(M.assumptions.flatMap((x) => [x.validityAlpha, x.validityBeta]).filter(Boolean));
  return (a ? [] : [{ key: 'id', label: 'Assumption ID', value: nextId('A.', M.assumptions.map((x) => x.id)), required: true }]).concat([
    { key: 'title', label: 'Title', value: t.title || '', required: true, help: a ? 'Also updated where risks cite “' + a.id + ' ' + truncate(a.title, 40) + '”.' : null },
    { key: 'description', label: 'Description', type: 'textarea', value: t.description || '' },
    { key: 'components', label: 'Affected components', value: t.componentsRaw || '', list: M.components.map((c) => c.name) },
    { key: 'validityAlpha', label: 'Validity for Alpha Release', value: t.validityAlpha || '', list: vals },
    { key: 'validityBeta', label: 'Validity for Beta Release', value: t.validityBeta || '', list: vals },
    { key: 'comment', label: 'Comment', type: 'textarea', value: t.comment || '' }]);
}
function rmiExtraFields(m, fields) {
  fields[0].help += m.base ? ' Also changed in “' + M.sheetNames.rmi + '” (' + m.id + ').' : ' This item is not in “' + (M.sheetNames.rmi || 'Risk mitigations individual') + '”.';
  if (!m.base) return fields;
  const X = M.cols.rmi;
  return fields.concat([['ext', 'Extended Description', 'extDescription'], ['comment', 'Comment', 'comment'], ['responsible', 'Responsible', 'responsible']].filter((x) => X[x[0]] != null)
    .map(([key, label, prop]) => ({ key, label, type: key === 'responsible' ? null : 'textarea', value: m[prop] || '', list: key === 'responsible' ? uniq(M.rmis.map((x) => x.responsible).filter(Boolean)) : null })));
}
function addRmiDialog(r) {
  const others = M.rmis.filter((m) => m.base && m.text && !r.items.some((o) => o.rmi === m));
  formDialog('Add mitigation item to ' + r.id, [
    { key: 'existing', label: 'Existing mitigation item', type: 'select', options: [{ value: '', label: '— new item (type the text below) —' }].concat(others.map((m) => ({ value: m.key, label: m.id + ' ' + truncate(m.text, 80) }))), value: '' },
    { key: 'text', label: 'New item text', type: 'textarea', rows: 2, value: '' },
  ].concat(M.sheetObj.rmi ? [{ key: 'rmiId', label: 'RMI ID of the new item', value: nextPadded(M.rmis.filter((m) => m.base).map((m) => m.id)), help: 'Only for a new item: it is added as a new row to “' + M.sheetNames.rmi + '”.' }] : []).concat([
    { key: 'group', label: 'Risk Mitigation Group', type: 'select', options: [{ value: '', label: '— choose —' }].concat(M.groups.map((g) => ({ value: g.id, label: g.id + ' ' + g.name }))), value: '', required: true, help: 'Required: the item is added to this group’s Content (unless it is already there).' },
  ]), (v) => {
    const m = v.existing ? M.by.rmi.get(v.existing) : null, text = m ? m.text : singleLine(v.text, 'The text');
    if (!text) throw new Error('choose an existing item or type the text of a new one');
    if (r.items.some((o) => o.text === text)) throw new Error(r.id + ' already lists this item');
    const g = M.by.group.get(v.group); if (!g) throw new Error('choose a Risk Mitigation Group');
    let newId = null;
    if (!m && M.sheetObj.rmi && !M.rmis.some((x) => x.base && x.text === text)) {
      newId = v.rmiId; if (!newId) throw new Error('a new item needs an RMI ID');
      if (/\s/.test(newId) || newId === 'RMI-X') throw new Error('the RMI ID must not contain spaces and must not be RMI-X');
      if (M.rmis.some((x) => x.base && x.id.toLowerCase() === newId.toLowerCase())) throw new Error('RMI ID ' + newId + ' already exists');
    }
    const cs = new ChangeSet(); cs.focus = r; addRmi(cs, r, text, g, newId); return cs;
  });
}
function addRiskDialog() {
  const threats = M.threats.map((t) => ({ value: 't:' + t.id, label: t.id + ' — ' + truncate(t.name, 60) }))
    .concat(BSI_THREATS.filter((c) => !M.threats.some((t) => t.num === c.n)).map((c) => ({ value: 'b:' + c.n, label: 'T.BSI.' + c.n + ' — G 0.' + c.n + ' ' + c.name + ' (new)' })));
  formDialog('Add risk', [{ key: 'threat', label: 'Threat', type: 'select', options: [{ value: '', label: '— choose —' }].concat(threats), value: '', required: true },
    { key: 'riskId', label: 'Risk ID', value: '', required: true, help: 'Pattern <letters>.<letters>.<number>, e.g. ' + (M.risks[0] ? nextId(M.risks[0].id.replace(/\d+$/, ''), M.risks.map((x) => x.id)) : 'R.XX.1') + '.' }].concat(riskFields(null)), (v) => {
    if (!CFG.patterns.riskId.test(v.riskId)) throw new Error('the Risk ID must look like <letters>.<letters>.<number>');
    if (M.by.risk.has(v.riskId)) throw new Error('Risk ID ' + v.riskId + ' already exists');
    let t;
    if (v.threat.startsWith('t:')) t = M.by.threat.get(v.threat.slice(2));
    else { const c = BSI_THREATS.find((x) => x.n === +v.threat.slice(2)); t = { id: 'T.BSI.' + c.n, name: 'G 0.' + c.n + ' ' + c.name, relevance: '' }; }
    v.threat = t; v.component = checkComponent(v.component);
    const cs = new ChangeSet(); cs.focus = { type: 'risk', id: v.riskId }; addRisk(cs, v); return cs;
  });
}
function addAssumptionDialog() {
  formDialog('Add assumption', asmFields(null), (v) => {
    if (!CFG.patterns.assumptionId.test(v.id)) throw new Error('the Assumption ID must look like A.<number>');
    if (M.by.assumption.has(v.id)) throw new Error(v.id + ' already exists');
    const cs = new ChangeSet(); cs.focus = { type: 'assumption', id: v.id }; addAssumption(cs, v); return cs;
  });
}
function addGroupDialog() {
  formDialog('Add mitigation group', [{ key: 'id', label: 'Risk Mitigation Group ID', value: nextPadded(M.groups.map((g) => g.id)) || 'RMG01', required: true },
    { key: 'name', label: 'Security Measure Group', value: '', required: true }, { key: 'treatment', label: 'Risk treatment', value: '', list: uniq(M.groups.map((x) => x.treatment).filter(Boolean)) }], (v) => {
    if (!CFG.patterns.groupId.test(v.id)) throw new Error('the group ID must be letters and digits only');
    if ([...M.by.group.keys()].some((k) => k.toLowerCase() === v.id.toLowerCase())) throw new Error(v.id + ' already exists');
    const cs = new ChangeSet(); cs.focus = { type: 'group', id: v.id }; addGroup(cs, v); return cs;
  });
}
const canEdit = () => write.on && !!M && !!M.sheetObj && !!M.sheetObj.risk;
function editButtons(o) {
  if (!canEdit() || !EDITORS[o.type]) return null;
  return [h('button.btn.ghost.sm', { type: 'button', id: 'edit-btn', tip: 'Edit in the workbook', onclick: () => EDITORS[o.type](o) }, icon('pen', 13), 'Edit'),
    o.type === 'risk' ? h('button.btn.ghost.sm', { type: 'button', id: 'add-rmi-btn', tip: 'Add a mitigation item (must belong to a group)', onclick: () => addRmiDialog(o) }, icon('plus', 13), 'Add item') : null];
}
const ADDERS = { risks: ['Add risk', addRiskDialog, 'risk'], assumptions: ['Add assumption', addAssumptionDialog, 'assumption'], mitigations: ['Add group', addGroupDialog, 'group'] };
function addButton(view) {
  const a = ADDERS[view];
  if (!a || !canEdit() || !M.sheetObj[a[2]]) return null;
  return h('button.btn.ghost', { type: 'button', id: 'add-btn', onclick: a[1] }, icon('plus', 14), a[0]);
}
