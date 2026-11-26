/* ---------------------------------------------------------------------------
 * 07y-export.js — "Export to Excel" for every module. Builds a new .xlsx in
 * memory (no library) and hands it to the browser as a download. It never
 * touches the source workbook or the repository folder.
 * ------------------------------------------------------------------------- */
let flowLast = null; // set by the Connections view: what is currently shown
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
/** Minimal ZIP writer (stored entries). */
function zipFiles(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const [name, text] of files) {
    const n = enc.encode(name), d = enc.encode(text), crc = crc32(d);
    const head = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0)];
    parts.push(new Uint8Array([...u32(0x04034b50), ...head]), n, d);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...head, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), n);
    off += 30 + n.length + d.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  return new Blob([...parts, ...central, new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), ...u16(0)])],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xesc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LVL_STYLE = { low: 3, medium: 4, high: 5 };
/** sheets: [{ name, cols: [[header, width]], rows: [[value | {v, s}]] }] -> Blob (.xlsx) */
function buildXlsx(sheets) {
  const files = [];
  const names = sheets.map((s, i) => (s.name.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet' + (i + 1)));
  files.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>']);
  files.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
  files.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + names.map((n, i) => '<sheet name="' + xesc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>']);
  files.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
    + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>']);
  const fill = (rgb) => '<fill><patternFill patternType="solid"><fgColor rgb="FF' + rgb + '"/><bgColor indexed="64"/></patternFill></fill>';
  const xf = (font, fillId, wrap) => '<xf numFmtId="0" fontId="' + font + '" fillId="' + fillId + '" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top"' + (wrap ? ' wrapText="1"' : '') + '/></xf>';
  files.push(['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' + fill('DDE6F0') + fill('C6EFCE') + fill('FFEB9C') + fill('FFC7CE') + '</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="6">' + xf(0, 0, false) + xf(1, 2, true) + xf(0, 0, true) + xf(0, 3, true) + xf(0, 4, true) + xf(0, 5, true) + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']);
  sheets.forEach((s, i) => {
    const rows = [s.cols.map((c) => ({ v: c[0], s: 1 }))].concat(s.rows);
    const xml = rows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((cell, c) => {
      const o = cell != null && typeof cell === 'object' ? cell : { v: cell };
      const ref = colName(c) + (r + 1), st = ' s="' + (o.s != null ? o.s : 2) + '"';
      if (o.v == null || o.v === '') return o.s ? '<c r="' + ref + '"' + st + '/>' : '';
      if (typeof o.v === 'number' && Number.isFinite(o.v)) return '<c r="' + ref + '"' + st + '><v>' + o.v + '</v></c>';
      return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xesc(String(o.v).slice(0, 32000)) + '</t></is></c>';
    }).join('') + '</row>').join('');
    const last = colName(Math.max(0, s.cols.length - 1)) + rows.length;
    files.push(['xl/worksheets/sheet' + (i + 1) + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + (s.noFilter ? '' : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>')
      + '<cols>' + s.cols.map((c, k) => '<col min="' + (k + 1) + '" max="' + (k + 1) + '" width="' + (c[1] || 14) + '" customWidth="1"/>').join('') + '</cols>'
      + '<sheetData>' + xml + '</sheetData>' + (s.noFilter ? '' : '<autoFilter ref="A1:' + last + '"/>') + '</worksheet>']);
  });
  return zipFiles(files);
}

/* ---- cell helpers ---- */
const ids = (list) => list.map((o) => objLabel(o)).join('\n');
const lvl = (idx) => ({ v: idx == null ? 'Not rated' : LEVEL_LABEL[levelOf(idx)], s: LVL_STYLE[levelOf(idx)] || 2 });
const num0 = (v) => (v == null ? '' : v);
const issueCount = (o, c) => o.issues.filter((i) => i.cat === c).length || '';
const issueText = (o) => o.issues.map((i) => '[' + ISSUE_CATS[i.cat].label + '] ' + i.msg).join('\n');
const ISSUE_COLS = [['Format errors', 9], ['Consistency errors', 11], ['Warnings', 9], ['Findings', 70]];
const issueCells = (o) => [issueCount(o, 'format'), issueCount(o, 'consistency'), issueCount(o, 'warning'), issueText(o)];
const filterText = (f, hideNR) => [Object.keys(f || {}).filter((k) => f[k]).map((k) => k + ' = ' + f[k]).join(', '), hideNR ? 'hide not relevant = on' : ''].filter(Boolean).join(', ') || 'none';
const nrText = (r) => (r.notRelevant ? { v: 'not relevant', s: 4 } : 'relevant');

const EXPORTS = {
  risks: { label: 'Risks', run() {
    const rs = applyRiskFilter(M.risks, state.ui.risks.f).filter((r) => !state.ui.risks.hideNR || !r.notRelevant);
    return { filter: filterText(state.ui.risks.f, state.ui.risks.hideNR), sheets: [
      { name: 'Risks', cols: [['Risk ID', 12], ['Threat ID', 11], ['Threat', 30], ['Relevant', 10], ['Threat relevance', 30], ['Risk description', 50], ['Affected component', 18], ['Core values', 14], ['Related assumptions', 14], ['Frequency', 14], ['Effects', 16], ['Risk index', 9], ['Level', 10], ['Treatment category', 20], ['Mitigation items', 60], ['Mitigation groups', 14], ['Frequency after', 14], ['Effects after', 16], ['Risk index after', 9], ['Level after', 10], ['Risk reduction', 9]].concat(ISSUE_COLS),
        rows: rs.map((r) => [r.id, r.threat ? r.threat.id : '', r.threat ? r.threat.name : '', nrText(r), r.relevanceRaw || '', r.description, r.components.map((c) => c.name).join('\n'), r.coreValues.map((k) => CFG.coreValues.find((x) => x.key === k).label).join(', '), ids(r.assumptions), r.freqRaw, r.effectRaw, num0(r.index), lvl(r.index), r.categoryRaw,
          r.items.map((o) => o.rmi.id + '  ' + rmiText(o.rmi) + (o.groups.length ? '  → ' + o.groups.map((g) => g.id).join(', ') : '  → no group')).join('\n'), ids(r.groups), r.freqAfterRaw, r.effectAfterRaw, num0(r.residual), lvl(r.residual), r.index != null && r.residual != null ? r.index - r.residual : ''].concat(issueCells(r))) },
      { name: 'Risk-item links', cols: [['Risk ID', 12], ['Line in RMI ID cell', 8], ['RMI ID', 10], ['Mitigation item', 70], ['Mitigation group(s)', 16]],
        rows: rs.flatMap((r) => r.items.map((o) => [r.id, o.line, o.rmi.id, rmiText(o.rmi), o.groups.length ? ids(o.groups) : { v: 'none — not listed by any group', s: 5 }])) }] };
  } },
  matrix: { label: 'Risk matrix', run() {
    const rs = applyRiskFilter(M.risks, state.ui.matrix.f);
    const grid = (when) => ({ name: 'Matrix ' + when, noFilter: true, cols: [['Effects \\ Frequency', 30]].concat(CFG.freq.map((f) => [f.label + ' (' + f.value + ')', 30])),
      rows: CFG.effect.slice().reverse().map((e) => [{ v: e.label + ' (' + e.value + ')', s: 1 }].concat(CFG.freq.map((f) => { const l = rs.filter((r) => { const p = posOf(r, when); return p.f === f && p.e === e; }); return { v: 'Index ' + f.value * e.value + ' — ' + plural(l.length, 'risk') + (l.length ? '\n' + l.map((r) => r.id).join(', ') : ''), s: LVL_STYLE[levelOf(f.value * e.value)] }; }))) });
    return { filter: filterText(state.ui.matrix.f), sheets: [grid('before'), grid('after'),
      { name: 'Positions', cols: [['Risk ID', 12], ['Threat ID', 11], ['Component', 18], ['Frequency before', 14], ['Effects before', 16], ['Index before', 9], ['Level before', 10], ['Frequency after', 14], ['Effects after', 16], ['Index after', 9], ['Level after', 10], ['Moved', 8]],
        rows: rs.map((r) => { const a = posOf(r, 'before'), b = posOf(r, 'after'); return [r.id, r.threat ? r.threat.id : '', r.componentRaw, a.f ? a.f.label : '', a.e ? a.e.label : '', num0(r.index), lvl(r.index), b.f ? b.f.label : '', b.e ? b.e.label : '', num0(r.residual), lvl(r.residual), a.f === b.f && a.e === b.e ? 'no' : 'yes']; }) }] };
  } },
  threats: { label: 'Threats', run: () => ({ filter: filterText(null, state.ui.threats.hideNR), sheets: [{ name: 'Threats', cols: [['Threat ID', 11], ['Elementary threat', 10], ['Threat', 40], ['Only not-relevant risks', 10], ['BSI core values', 10], ['Risks', 7], ['Risk IDs', 14], ['Components', 20], ['Highest index before', 10], ['Highest index after', 10]].concat(ISSUE_COLS),
    rows: M.threats.filter((t) => !state.ui.threats.hideNR || !onlyNotRelevant(t)).map((t) => { const c = BSI_THREATS.find((x) => x.n === t.num); return [t.id, t.num != null ? 'G 0.' + t.num : '', t.name, onlyNotRelevant(t) ? 'yes' : '', c ? c.cia.join(', ') : '', t.risks.length, ids(t.risks), uniq(t.risks.flatMap((r) => r.components)).map((x) => x.name).join('\n'), num0(maxOf(t.risks, (r) => r.index)), num0(maxOf(t.risks, (r) => r.residual))].concat(issueCells(t)); }) }] }) },
  mitigations: { label: 'Mitigations', run: () => ({ filter: 'hide not relevant = ' + (state.ui.mit.hideNRg ? 'on' : 'off') + ' (groups), ' + (state.ui.mit.hideNRi ? 'on' : 'off') + ' (items); hide removed = ' + (state.ui.mit.hideRemoved ? 'on' : 'off'), sheets: [
    { name: 'Mitigation groups', cols: [['Group ID', 10], ['Security measure group', 30], ['Risk treatment', 22], ['Items', 7], ['Mitigation items', 70], ['Risks', 7], ['Risk IDs', 14], ['Components', 20], ['Highest index before', 10], ['Highest index after', 10]].concat(ISSUE_COLS),
      rows: M.groups.filter((g) => !state.ui.mit.hideNRg || !onlyNotRelevant(g)).map((g) => [g.id, g.name, g.treatment, g.rmis.length, g.rmis.map((m) => m.id + '  ' + rmiText(m)).join('\n'), g.risks.length, ids(g.risks), uniq(g.risks.flatMap((r) => r.components)).map((x) => x.name).join('\n'), num0(maxOf(g.risks, (r) => r.index)), num0(maxOf(g.risks, (r) => r.residual))].concat(issueCells(g))) },
    { name: 'Mitigation items', cols: [['RMI ID', 10], ['Mitigation item', 70], ['Removed', 9], ['In master list', 9], ['Groups', 12], ['In a group', 9], ['Extended Description', 40], ['Comment', 30], ['Responsible', 16], ['Risks', 7], ['Risk IDs', 14]].concat(ISSUE_COLS),
      rows: (state.ui.mit.hideRemoved ? M.rmis : M.allRmis).filter((m) => !state.ui.mit.hideNRi || !onlyNotRelevant(m)).map((m) => [m.id, rmiText(m), m.removed ? { v: 'yes', s: 4 } : '', m.base ? 'yes' : { v: 'NO', s: 5 }, ids(m.groups), m.groups.length ? 'yes' : { v: 'NO', s: 5 }, m.extDescription || '', m.comment || '', m.responsible || '', m.risks.length, ids(m.risks)].concat(issueCells(m))) },
    { name: 'Item-group links', cols: [['RMI ID', 10], ['Group ID', 10], ['Mitigation item', 70]],
      rows: M.groups.flatMap((g) => g.rmis.filter((m) => !state.ui.mit.hideNRi || !onlyNotRelevant(m)).map((m) => [m.id, g.id, rmiText(m)])) }] }) },
  assumptions: { label: 'Assumptions', run() {
    const q = state.ui.asm.q.toLowerCase();
    const as = M.assumptions.filter((a) => !q || (a.id + ' ' + a.title + ' ' + a.description + ' ' + a.componentsRaw + ' ' + a.comment).toLowerCase().includes(q));
    return { filter: q ? 'search = ' + q : 'none', sheets: [{ name: 'Assumptions', cols: [['Assumption ID', 11], ['Title', 36], ['Description', 50], ['Affected components', 20], ['Validity Alpha', 12], ['Validity Beta', 12], ['Comment', 30], ['Linked risks (derived)', 14], ['Highest index before', 10], ['Highest index after', 10]].concat(ISSUE_COLS),
      rows: as.map((a) => [a.id, a.title, a.description, a.componentsRaw, a.validityAlpha, a.validityBeta, a.comment, ids(a.risks), num0(maxOf(a.risks, (r) => r.index)), num0(maxOf(a.risks, (r) => r.residual))].concat(issueCells(a))) }] };
  } },
  components: { label: 'Components', run: () => ({ sheets: [{ name: 'Components', cols: [['Component', 22], ['Risks', 7], ['Risk IDs', 14], ['Threats', 14], ['Assumptions', 12], ['Mitigation groups', 12], ['Low before', 8], ['Medium before', 8], ['High before', 8], ['Low after', 8], ['Medium after', 8], ['High after', 8], ['Highest index before', 10], ['Highest index after', 10], ['Confidentiality', 8], ['Integrity', 8], ['Availability', 8]].concat(ISSUE_COLS),
    rows: M.components.map((c) => { const b = levelCounts(c.risks, (r) => r.index), a = levelCounts(c.risks, (r) => r.residual);
      return [c.name, c.risks.length, ids(c.risks), ids(uniq(c.risks.map((r) => r.threat).filter(Boolean))), ids(c.assumptions), ids(uniq(c.risks.flatMap((r) => r.groups))), b.low, b.medium, b.high, a.low, a.medium, a.high, num0(maxOf(c.risks, (r) => r.index)), num0(maxOf(c.risks, (r) => r.residual))].concat(CFG.coreValues.map((v) => c.risks.filter((r) => r.coreValues.includes(v.key)).length), issueCells(c)); }) }] }) },
  connections: { label: 'Connections', run() {
    const L = flowLast || { riskSet: M.risks, nodes: {}, cols: [] }, focus = exprToText(state.ui.flow.focus);
    /* the definitions of the library entries the search uses, so the export says what @name meant */
    const refs = uniq(exprAtoms(state.ui.flow.focus).filter((x) => x.n.k === 'ref').map((x) => x.n.name)).map(libGet).filter(Boolean).map((it) => '@' + it.name + ' = ' + (it.kind === 'filter' ? filterDesc(it) : it.expr));
    const dom = state.ui.flow.dom;
    return { filter: [dom ? 'dominance = ' + TYPES[dom].plural : '', focus ? 'search = ' + focus : '', refs.join('; '), state.ui.flow.hideNR ? 'hide not relevant = on' : ''].filter(Boolean).join(', ') || 'none', sheets: [
      { name: 'Paths', cols: [['Risk ID', 12], ['Threat', 12], ['Components', 18], ['Assumptions', 12], ['Mitigation items', 14], ['Mitigation groups', 12], ['Risk index after', 9]],
        rows: L.riskSet.map((r) => [r.id, r.threat ? r.threat.id : '', r.components.map((c) => c.name).join('\n'), ids(r.assumptions), ids(uniq(r.items.map((o) => o.rmi))), ids(r.groups), num0(r.residual)]) },
      { name: 'Objects shown', cols: [['Type', 16], ['ID', 14], ['Title', 70]], rows: L.cols.flatMap((t) => (L.nodes[t] || []).map((o) => [TYPES[t].label, objLabel(o), objTitle(o) || ''])) }] };
  } },
  history: { label: 'History', run() {
    const rows = [], push = (when, author, c) => {
      const base = [when, author, TYPES[c.type] ? TYPES[c.type].label : c.type, c.id, c.change];
      const fs = Object.keys(c.fields || {});
      if (!fs.length && !c.linesAdded && !c.linesRemoved) rows.push(base.concat(['', '', '']));
      for (const k of fs) rows.push(base.concat([k, valText(c.fields[k].from), valText(c.fields[k].to)]));
      for (const l of c.linesAdded || []) rows.push(base.concat(['linked RMI ID', '', l]));
      for (const l of c.linesRemoved || []) rows.push(base.concat(['linked RMI ID', l, '']));
    };
    if (hist.tab === 'compare' && hist.cmp) hist.cmp.d.changes.forEach((c) => push(hist.cmp.from + ' → ' + hist.cmp.to, '', c));
    else hist.logs.forEach((log) => log.changes.forEach((c) => push(log.createdAt, log.author || '', c)));
    return { filter: hist.tab === 'compare' && hist.cmp ? 'comparison ' + hist.cmp.from + ' → ' + hist.cmp.to : 'all change logs', sheets: [{ name: 'Changes', cols: [['When / versions', 26], ['Author', 16], ['Type', 14], ['ID', 12], ['Change', 10], ['Field', 18], ['Old value', 50], ['New value', 50]], rows }] };
  } },
  issues: { label: 'Errors and warnings', run() {
    const ui = state.ui.issues, q = ui.q.toLowerCase();
    const items = M.issues.filter((it) => (!ui.cats.size || ui.cats.has(it.cat)) && (!q || (it.title + ' ' + it.msg + ' ' + (it.excerpt || '') + ' ' + (it.cell || '') + ' ' + it.refs.map((o) => o.id).join(' ')).toLowerCase().includes(q)));
    return { filter: (ui.cats.size ? 'categories = ' + [...ui.cats].join(', ') : 'all categories') + (q ? '; search = ' + q : ''), sheets: [{ name: 'Findings', cols: [['#', 6], ['Category', 16], ['Check', 34], ['Message', 70], ['Sheet', 22], ['Cell', 8], ['Line', 6], ['Cell text', 50], ['Hint', 40], ['Objects', 16]],
      rows: items.map((it) => [it.n, { v: ISSUE_CATS[it.cat].label, s: it.cat === 'warning' ? 4 : 5 }, it.title, it.msg, it.sheet || '', it.cell || '', it.line || '', it.excerpt || '', it.hint || '', it.refs.map((o) => objLabel(o)).join('\n')]) }] };
  } },
};

function exportView(key) {
  const ex = EXPORTS[key];
  if (!ex || !M) return;
  try {
    const out = ex.run(), now = new Date();
    const about = { name: 'About', noFilter: true, cols: [['Item', 22], ['Value', 80]], rows: [['Module', ex.label], ['Source workbook', M.file.name], ['Workbook saved', fmtTime(new Date(M.file.lastModified))], ['Exported', fmtTime(now)], ['Filter / scope', out.filter || 'none'],
      ['Rows', out.sheets.map((s) => s.name + ': ' + s.rows.length).join(', ')], ['Note', 'Exported by Risk Register Explorer. This is a new file; the source workbook is not modified.']] };
    const blob = buildXlsx(out.sheets.concat(about));
    const name = 'RRE_' + slug(ex.label) + '_' + slug(M.file.name.replace(/\.(xlsx|xlsm)$/i, '')) + '_' + stamp(now) + '.xlsx';
    const url = URL.createObjectURL(blob), a = h('a', { href: url, download: name, hidden: true });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('Exported “' + name + '” (' + out.sheets.map((s) => plural(s.rows.length, 'row')).join(', ') + ').');
  } catch (e) { toast('Export failed: ' + (e && e.message ? e.message : e), 'error'); }
}
function exportButton(key) {
  return h('button.btn.ghost', { type: 'button', id: 'export-btn', tip: 'Download this module as a new Excel file (current filters apply). The source workbook is not modified.', onclick: () => exportView(key) }, icon('file', 14), 'Export to Excel');
}
