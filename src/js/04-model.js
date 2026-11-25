/* ---------------------------------------------------------------------------
 * 04-model.js — turns the raw sheets into connected objects and runs all
 * format / consistency checks. Excel keeps several things in one cell; here
 * every threat, risk, mitigation item (RMI), mitigation group, assumption and
 * component becomes its own object, linked to the others.
 * ------------------------------------------------------------------------- */

const normHeader = (v) => str(v).toLowerCase().replace(/\s+/g, ' ');

/** Finds the header row: first row (within the top 60) in which every `required` pattern matches a cell. */
function findHeader(sheet, required) {
  const rows = sheet.rows;
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const row = rows[r];
    if (!row) continue;
    const heads = [];
    row.forEach((v, c) => { const n = normHeader(v); if (n) heads.push({ c, n }); });
    if (required.every((rx) => heads.some((x) => rx.test(x.n)))) return { row: r, heads };
  }
  return null;
}
function parseEnum(raw, list) {
  const k = looseKey(raw);
  if (!k) return { item: null, exact: false };
  let item = list.find((x) => x.match.test(k));
  if (item) return { item, exact: true };
  let best = null, bd = 99;
  for (const x of list) { const d = levenshtein(k, x.label.toLowerCase()); if (d < bd) { bd = d; best = x; } }
  if (best && bd <= Math.max(2, Math.floor(best.label.length / 6))) return { item: best, exact: false };
  if (/^threat/.test(k) && list === CFG.effect) return { item: CFG.effect[3], exact: false };
  return { item: null, exact: false };
}

/** Loose form of an RMI ID, used only to recognise a mis-typed reference (case, spaces, dash variants). */
const looseId = (s) => s.toLowerCase().replace(/[\u2010-\u2015\u2212_]/g, '-').replace(/\s+/g, '');
/**
 * “Threat relevance” of a risk (one value per risk row; despite its name it says whether the RISK is relevant).
 * Not relevant = the words “not relevant” anywhere in the text (any case). Anything else counts as relevant; a text that
 * only resembles “not relevant” (“Not relevent”, “not-relevant”, “no relevant”…) is returned as `typo` and NOT hidden.
 */
function relevanceOf(raw) {
  if (!raw) return { notRelevant: false, typo: null };
  if (/\bnot\s+relevant\b/i.test(raw)) return { notRelevant: true, typo: null };
  const w = raw.toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ');
  for (let i = 0; i < w.length; i++) {
    if (/^no[nt]?rel/.test(w[i]) && levenshtein(w[i], 'notrelevant') <= 2) return { notRelevant: false, typo: w[i] };
    if (/^no[nt]?$/.test(w[i]) && w[i + 1] && /^rel/.test(w[i + 1]) && levenshtein(w[i + 1], 'relevant') <= 2) return { notRelevant: false, typo: w[i] + ' ' + w[i + 1] };
  }
  return { notRelevant: false, typo: null };
}
/** “Only not relevant”: a risk that is not relevant, or an object (threat, RMI, group, component…) whose risks all are. */
function onlyNotRelevant(o) { if (o.type === 'risk') return !!o.notRelevant; const rs = o.risks || []; return rs.length > 0 && rs.every((r) => r.notRelevant); }

/** “RMI-001”, or “RMI 17” for IDs that do not say RMI themselves. */
const rmiName = (m) => (/^rmi/i.test(m.id) ? m.id : 'RMI ' + m.id);

function buildModel(wb, fileInfo) {
  const M = {
    file: fileInfo, sheetReport: [], sheetNames: {},
    assumptions: [], threats: [], risks: [], rmis: [], groups: [], components: [], issues: [],
    by: { assumption: new Map(), threat: new Map(), risk: new Map(), rmi: new Map(), group: new Map(), component: new Map() },
  };
  let seq = 0;
  function addIssue(code, msg, o) {
    o = o || {};
    const def = ISSUE_TYPES[code];
    const it = {
      n: ++seq, code, cat: def[0], title: def[1], msg, sheet: o.sheet || null, row: o.row == null ? null : o.row, col: o.col == null ? null : o.col,
      line: o.line || null, excerpt: o.excerpt || null, hint: o.hint || null, refs: [],
    };
    it.cell = it.row != null ? (it.col != null ? colName(it.col) + (it.row + 1) : 'row ' + (it.row + 1)) : null;
    for (const obj of (o.on || [])) { if (obj && !obj.issues.includes(it)) { obj.issues.push(it); if (obj.type) it.refs.push(obj); } }
    M.issues.push(it);
    return it;
  }

  /* ---- locate the three sheets ------------------------------------------------ */
  const cand = wb.sheets.map((s) => ({
    s,
    risk: findHeader(s, [/^threat id$/, /^risk id$/]),
    asm: findHeader(s, [/^assumption id$/, /^title$/]),
    rmg: findHeader(s, [/^risk mitigation group id$/]),
    rmi: findHeader(s, [/^rmi id$/, /^mitigation item$/]),
  }));
  const pickBest = (list, score) => list.map((x) => ({ x, sc: score(x.s.name.toLowerCase()) })).sort((a, b) => b.sc - a.sc)[0]?.x || null;
  const riskSheet = pickBest(cand.filter((x) => x.risk), (n) => (/analys/.test(n) ? 4 : 0) + (/alpha/.test(n) ? 2 : 0) - (/assumed|beta/.test(n) ? 3 : 0));
  const asmSheet = pickBest(cand.filter((x) => x.asm && x !== riskSheet), (n) => (/assumption/.test(n) ? 4 : 0) + (/architect/.test(n) ? 2 : 0));
  const rmgSheet = pickBest(cand.filter((x) => x.rmg && x !== riskSheet && x !== asmSheet), (n) => (/mitigation/.test(n) ? 4 : 0) + (/group/.test(n) ? 2 : 0));
  const rmiSheet = pickBest(cand.filter((x) => x.rmi && x !== riskSheet && x !== asmSheet && x !== rmgSheet), (n) => (/individual/.test(n) ? 4 : 0) + (/mitigation/.test(n) ? 2 : 0));
  for (const c of cand) {
    const role = c === riskSheet ? 'Risk analysis' : c === asmSheet ? 'Architecture assumptions' : c === rmgSheet ? 'Risk mitigation groups' : c === rmiSheet ? 'Risk mitigations individual' : null;
    M.sheetReport.push({ name: c.s.name, role, rows: 0, headerRow: null });
  }
  const report = (c) => M.sheetReport[cand.indexOf(c)];
  if (!riskSheet) addIssue('F_STRUCT', 'No risk analysis sheet found. Expected a sheet (e.g. “Risk analysis Alpha”) with the column headers “Threat ID” and “Risk ID”.');
  if (!asmSheet) addIssue('F_STRUCT', 'No assumptions sheet found. Expected a sheet (e.g. “Architecture Assumptions”) with the column headers “Assumption ID” and “Title”.');
  if (!rmiSheet) addIssue('F_STRUCT', 'No “Risk mitigations individual” sheet found. Expected a sheet with the column headers “RMI ID” and “Mitigation item”. Mitigation items have no text and every RMI ID is unknown.');
  if (!rmgSheet) addIssue('F_STRUCT', 'No mitigation group sheet found. Expected a sheet (e.g. “Risk Mitigation Groups”) with the column header “Risk Mitigation Group ID”.');

  function columns(c, spec) {
    const cols = {};
    for (const key in spec) {
      const [test, label, required] = spec[key];
      const hit = c[c === riskSheet ? 'risk' : c === asmSheet ? 'asm' : c === rmiSheet ? 'rmi' : 'rmg'].heads.find((x) => test(x.n));
      cols[key] = hit ? hit.c : null;
      if (!hit && required) addIssue('F_STRUCT', 'Column “' + label + '” not found in sheet “' + c.s.name + '”.', { sheet: c.s.name });
    }
    return cols;
  }

  /* ---- 1. mitigation groups (IDs first, their RMI IDs are resolved after the master list) ---- */
  let G = null;
  if (rmgSheet) {
    const sh = rmgSheet.s, name = sh.name;
    M.sheetNames.group = name;
    M.sheetObj = M.sheetObj || {}; M.sheetObj.group = sh;
    G = columns(rmgSheet, {
      id: [(n) => /^risk mitigation group id$/.test(n), 'Risk Mitigation Group ID', true],
      treatment: [(n) => /^risk treatment$/.test(n), 'Risk treatment', false],
      name: [(n) => /^security measure group$/.test(n), 'Security Measure Group', true],
      rmiIds: [(n) => /^rmi ids?$/.test(n), 'RMI ID', true],
      content: [(n) => /^content$/.test(n), 'Content', false], // formula showing the texts of the RMI IDs: not read, only checked to be a formula
    });
    const hr = rmgSheet.rmg.row; report(rmgSheet).headerRow = hr + 1;
    const cell = (r, c) => (c == null ? '' : str(sh.rows[r] && sh.rows[r][c]));
    for (let r = hr + 1; r < sh.rows.length; r++) {
      const id = cell(r, G.id), gname = cell(r, G.name), rmiRaw = cell(r, G.rmiIds), treatment = cell(r, G.treatment);
      if (!id && !gname && !rmiRaw) continue;
      const g = { type: 'group', id: id || '(row ' + (r + 1) + ')', name: gname, treatment, rmiRaw, items: [], rmis: [], risks: [], issues: [], sheet: name, row: r };
      M.groups.push(g); report(rmgSheet).rows++;
      if (!id) addIssue('F_MISSING_ID', 'Group row without a Risk Mitigation Group ID.', { sheet: name, row: r, col: G.id, on: [g] });
      else if (!CFG.patterns.groupId.test(id)) addIssue('F_ID', 'Group ID “' + id + '” must be letters and digits only, without spaces.', { sheet: name, row: r, col: G.id, on: [g] });
      if (id && M.by.group.has(id)) addIssue('C_DUP_ID', 'Group ID “' + id + '” is used more than once (also in row ' + (M.by.group.get(id).row + 1) + ').', { sheet: name, row: r, col: G.id, on: [g, M.by.group.get(id)] });
      else if (id) M.by.group.set(id, g);
      if (!gname) addIssue('W_MISSING', 'Group “' + g.id + '” has no Security Measure Group name.', { sheet: name, row: r, col: G.name, on: [g] });
    }
  }

  /* ---- 2. assumptions --------------------------------------------------------- */
  if (asmSheet) {
    const sh = asmSheet.s, name = sh.name;
    M.sheetNames.assumption = name;
    M.sheetObj = M.sheetObj || {}; M.sheetObj.assumption = sh;
    const A = M.colsAsm = columns(asmSheet, {
      id: [(n) => /^assumption id$/.test(n), 'Assumption ID', true],
      title: [(n) => /^title$/.test(n), 'Title', true],
      description: [(n) => /^description$/.test(n), 'Description', false],
      components: [(n) => /^affected components?$/.test(n), 'Affected components', false],
      linked: [(n) => /^linked risks?$/.test(n), 'Linked risks', false],
      vAlpha: [(n) => /^validity.*alpha/.test(n), 'Validity for Alpha Release', false],
      vBeta: [(n) => /^validity.*beta/.test(n), 'Validity for Beta Release', false],
      comment: [(n) => /^comments?$/.test(n), 'Comment', false],
    });
    const hr = asmSheet.asm.row; report(asmSheet).headerRow = hr + 1;
    const cell = (r, c) => (c == null ? '' : str(sh.rows[r] && sh.rows[r][c]));
    for (let r = hr + 1; r < sh.rows.length; r++) {
      const id = cell(r, A.id), title = cell(r, A.title), description = cell(r, A.description);
      if (!id && !title && !description) continue;
      const a = {
        type: 'assumption', id: id || '(row ' + (r + 1) + ')', title, description, componentsRaw: cell(r, A.components), linkedRaw: cell(r, A.linked),
        validityAlpha: cell(r, A.vAlpha), validityBeta: cell(r, A.vBeta), comment: cell(r, A.comment),
        risks: [], components: [], issues: [], sheet: name, row: r, cols: A,
      };
      M.assumptions.push(a); report(asmSheet).rows++;
      if (!id) addIssue('F_MISSING_ID', 'Assumption row without an Assumption ID.', { sheet: name, row: r, col: A.id, on: [a] });
      else if (!CFG.patterns.assumptionId.test(id)) addIssue('F_ID', 'Assumption ID “' + id + '” does not match the pattern A.<number> (no spaces).', { sheet: name, row: r, col: A.id, on: [a] });
      if (id && M.by.assumption.has(id)) addIssue('C_DUP_ID', 'Assumption ID “' + id + '” is used more than once (also in row ' + (M.by.assumption.get(id).row + 1) + ').', { sheet: name, row: r, col: A.id, on: [a, M.by.assumption.get(id)] });
      else if (id) M.by.assumption.set(id, a);
      if (!title) addIssue('W_MISSING', 'Assumption “' + a.id + '” has no title.', { sheet: name, row: r, col: A.title, on: [a] });
    }
  }

  /* ---- 3. mitigation items: the master list “Risk mitigations individual” --------------------------- */
  /* It is the only place that holds the text of an item. Risks and groups refer to items by RMI ID (column “RMI ID”,
     one ID per line); their text columns (“Risk treatment option”, “Content”) are formulas and are not read. */
  const rmiById = new Map(), rmiLoose = new Map(), rmiByText = new Map(), unknownById = new Map(), baseRmis = [];
  const newRmi = (extra) => { const m = { type: 'rmi', id: '', key: '', text: '', base: false, occ: [], listed: [], groups: [], risks: [], issues: [], ...extra }; M.rmis.push(m); return m; };
  let X = null;
  if (rmiSheet) {
    const sh = rmiSheet.s, name = sh.name;
    M.sheetNames.rmi = name; M.sheetObj = M.sheetObj || {}; M.sheetObj.rmi = sh;
    X = M.colsRmi = columns(rmiSheet, {
      id: [(n) => /^rmi id$/.test(n), 'RMI ID', true], text: [(n) => /^mitigation item$/.test(n), 'Mitigation item', true],
      /* “Groups” / “Assigned” are generated by formulas in the workbook: not read; located only so new rows get their formulas */
      groups: [(n) => /^groups?$/.test(n), 'Groups', false], assigned: [(n) => /^assigned$/.test(n), 'Assigned', false],
      ext: [(n) => /^extended description$/.test(n), 'Extended Description', false], comment: [(n) => /^comments?$/.test(n), 'Comment', false], responsible: [(n) => /^responsible$/.test(n), 'Responsible', false],
      removed: [(n) => /^removed$/.test(n), 'Removed', false], // yes = item removed (hidden everywhere, links to it are errors); empty / no = active
    });
    const hr = rmiSheet.rmi.row; report(rmiSheet).headerRow = hr + 1;
    const cell = (r, c) => (c == null ? '' : str(sh.rows[r] && sh.rows[r][c]));
    for (let r = hr + 1; r < sh.rows.length; r++) {
      const id = cell(r, X.id), text = cell(r, X.text);
      if (!id && !text) continue;
      report(rmiSheet).rows++;
      const removedRaw = cell(r, X.removed);
      const m = newRmi({ id: id || '(row ' + (r + 1) + ')', key: id || '(row ' + (r + 1) + ')', text, base: true, sheet: name, row: r,
        extDescription: cell(r, X.ext), comment: cell(r, X.comment), responsible: cell(r, X.responsible), removedRaw, removed: /^yes$/i.test(removedRaw) });
      baseRmis.push(m);
      const loc = { sheet: name, row: r };
      if (removedRaw && !/^(yes|no)$/i.test(removedRaw)) addIssue('F_VALUE', rmiName(m) + ': “Removed” must be empty, yes or no; found “' + removedRaw + '”. The item is treated as not removed.', { ...loc, col: X.removed, on: [m] });
      if (!id) addIssue('F_MISSING_ID', 'Mitigation item without RMI ID.', { ...loc, col: X.id, on: [m] });
      else if (/\s/.test(id)) addIssue('F_ID', 'RMI ID “' + id + '” contains spaces or line breaks.', { ...loc, col: X.id, on: [m] });
      if (id && rmiById.has(id)) { addIssue('C_DUP_ID', 'RMI ID “' + id + '” is used more than once (also in row ' + (rmiById.get(id).row + 1) + ').', { ...loc, col: X.id, on: [m, rmiById.get(id)] }); m.key = id + '#row' + (r + 1); }
      else if (id) { rmiById.set(id, m); if (!rmiLoose.has(looseId(id))) rmiLoose.set(looseId(id), m); }
      if (m.removed) continue; // a removed item: no text checks (a replacement often keeps its text); its ID stays unique (above)
      if (!text) addIssue('W_MISSING', rmiName(m) + ' has no text in “Mitigation item”.', { ...loc, col: X.text, on: [m] });
      else if (rmiByText.has(text)) addIssue('W_DUP_TEXT', rmiName(m) + ' has the same text as ' + rmiName(rmiByText.get(text)) + ' (row ' + (rmiByText.get(text).row + 1) + ').', { ...loc, col: X.text, on: [m, rmiByText.get(text)] });
      else rmiByText.set(text, m);
    }
  }
  /** Placeholder for an RMI ID that is not in the master list (one object per distinct ID, no text). */
  const unknownRmi = (id) => { let m = unknownById.get(id); if (!m) { m = newRmi({ id, key: '?' + id }); unknownById.set(id, m); } return m; };
  const resolveRmi = (tok) => { const m = rmiById.get(tok); if (m) return { m, exact: true }; const l = rmiLoose.get(looseId(tok)); return l ? { m: l, exact: false } : null; };
  /**
   * Reads one “RMI ID” cell (risk or group): one RMI ID per line. Tolerant: IDs separated by commas, semicolons or
   * spaces, a different spelling (case, spaces, dashes) or text after the ID are read as the intended ID and reported
   * as format errors. `mkItem(rmi, line, raw)` creates the link object; duplicates are reported and skipped.
   */
  function readRmiRefs(raw, owner, who, loc0, mkItem) {
    const seen = new Map(), out = [], rmiSheetName = M.sheetNames.rmi || 'Risk mitigations individual';
    owner.removedRefs = []; // references to removed items: reported, kept only for the snapshot, never linked
    (raw ? raw.split('\n') : []).forEach((ln, li) => {
      const s = ln.trim();
      if (!s) return;
      const loc = { ...loc0, line: li + 1, excerpt: s }, at = who + ', line ' + (li + 1);
      /* several IDs on one line: split on , or ; when every part looks like an ID, on spaces only when every word is a known ID */
      let toks = [s];
      const parts = s.split(/\s*[,;]\s*/).filter(Boolean), words = s.split(/\s+/);
      if (parts.length > 1 && parts.every((x) => !/\s/.test(x) || resolveRmi(x))) toks = parts;
      else if (words.length > 1 && words.every((x) => resolveRmi(x))) toks = words;
      if (toks.length > 1) addIssue('F_RMI_REF', at + ': ' + toks.length + ' RMI IDs on one line. Write one RMI ID per line.', { ...loc, on: [owner] });
      for (const tok of toks) {
        let res = resolveRmi(tok), extra = null;
        if (!res) { const fw = /^(\S+?)[:.–—-]*\s+(\S.*)$/.exec(tok); if (fw && resolveRmi(fw[1])) { res = resolveRmi(fw[1]); extra = fw[2]; } }
        const rmi = res ? res.m : unknownRmi(tok);
        if (seen.has(rmi)) { addIssue('W_DUP_LINE', who + ': ' + rmiName(rmi) + ' is listed twice (lines ' + seen.get(rmi) + ' and ' + (li + 1) + ').', { ...loc, on: [owner, rmi] }); continue; }
        seen.set(rmi, li + 1);
        if (rmi.removed) {
          owner.removedRefs.push({ rmi, line: li + 1, raw: s });
          addIssue('C_RMI_REMOVED', at + ': ' + rmiName(rmi) + ' is marked as removed in “' + rmiSheetName + '” (column “Removed”), but this cell still lists it. The link is ignored.', { ...loc, on: [owner, rmi] });
          continue;
        }
        const item = mkItem(rmi, li + 1, s);
        out.push(item);
        const on = [owner, rmi, item];
        if (!res) {
          const byText = rmiByText.get(tok);
          let near = null, nd = 3;
          if (!byText) for (const [k, mm] of rmiById) { if (mm.removed) continue; const d = levenshtein(looseId(k), looseId(tok)); if (d < nd) { nd = d; near = k; } }
          const hint = byText ? 'This is the text of ' + byText.id + ' — write its RMI ID instead.' : near ? 'Did you mean ' + near + ' (“' + truncate(rmiById.get(near).text, 90) + '”)?' : null;
          addIssue('C_RMI_UNKNOWN', at + ': RMI ID “' + truncate(tok, 60) + '” does not exist in “' + rmiSheetName + '”.', { ...loc, hint, on });
        } else if (extra != null) addIssue('F_RMI_REF', at + ': only the RMI ID belongs in this cell, but “' + truncate(extra, 60) + '” follows ' + rmi.id + ' (read as ' + rmi.id + ').', { ...loc, on });
        else if (!res.exact) addIssue('F_RMI_REF', at + ': “' + tok + '” is not written exactly like the RMI ID ' + rmi.id + ' (read as ' + rmi.id + ').', { ...loc, on });
      }
    });
    return out;
  }
  /** Warns when a text column that should be a formula (it shows the texts of the RMI IDs) holds typed text instead. */
  function checkFormula(sh, r, col, rmiRaw, who, label, obj) {
    if (col == null || sh.formulas.has(r + ':' + col)) return;
    if (!str(sh.rows[r] && sh.rows[r][col]) && !rmiRaw) return;
    addIssue('W_NOT_FORMULA', who + ': “' + label + '” is not a formula (typed text?), so Excel may show other mitigation items than the “RMI ID” cell. The tool reads only the RMI IDs.', { sheet: sh.name, row: r, col, on: [obj] });
  }

  /* ---- 4. risk analysis ----------------------------------------------------------- */
  let R = null;
  const rawComponents = [];
  if (riskSheet) {
    const sh = riskSheet.s, name = sh.name;
    M.sheetNames.risk = name;
    M.sheetObj = M.sheetObj || {}; M.sheetObj.risk = sh;
    R = columns(riskSheet, {
      threatId: [(n) => /^threat id$/.test(n), 'Threat ID', true],
      threat: [(n) => /^threat$/.test(n), 'Threat', true],
      relevance: [(n) => /^threat relevance/.test(n), 'Threat relevance', false], // per RISK: is this risk relevant
      riskId: [(n) => /^risk id$/.test(n), 'Risk ID', true],
      description: [(n) => /^risk description/.test(n), 'Risk description', true],
      component: [(n) => /^affected components?$/.test(n), 'Affected component', true],
      core: [(n) => /^core values/.test(n), 'Core values at risk', true],
      assumptions: [(n) => /^related assumptions?/.test(n), 'Related assumptions', true],
      freq: [(n) => /^frequency/.test(n) && !/after/.test(n), 'Frequency of occurence', true],
      effect: [(n) => /^effects?\b/.test(n) && !/after/.test(n), 'Effects without additional safeguards', true],
      index: [(n) => /^risk index/.test(n) && !/after/.test(n), 'Risk index', true],
      save: [(n) => /^description for save/.test(n), 'Description for SAVe database', false],
      category: [(n) => /^risk treatment category/.test(n), 'Risk Treatment category', true],
      rmiIds: [(n) => /^rmi ids?$/.test(n), 'RMI ID', true],
      treatment: [(n) => /^risk treatment options?/.test(n), 'Risk treatment option', false], // formula showing the RMI texts: not read, only checked to be a formula
      freqAfter: [(n) => /^frequency.*after/.test(n), 'Frequency of occurence (after treatment)', true],
      effectAfter: [(n) => /^effects?.*after/.test(n), 'Effects after rollout of treatment', true],
      indexAfter: [(n) => /^risk index.*after/.test(n), 'Risk index (after treatment)', true],
      reduction: [(n) => /^risk reduction/.test(n), 'Risk reduction value', false],
    });
    const hr = riskSheet.risk.row; report(riskSheet).headerRow = hr + 1;
    const cell = (r, c) => (c == null ? '' : str(sh.rows[r] && sh.rows[r][c]));
    const rawNum = (r, c) => (c == null ? null : num(sh.rows[r] && sh.rows[r][c]));
    let cur = null;
    const seenCombo = new Set();

    function getThreat(tId, tName, r) {
      const mName = /^G\s*0\s*\.\s*(\d{1,3})\b[\s:.\u2013-]*(.*)$/i.exec(tName);
      const mId = /^T\.([A-Za-z]+)\.(\d+)$/.exec(tId);
      const key = tId || (mName ? 'G 0.' + mName[1] : tName);
      let t = M.by.threat.get(key);
      const combo = tId + '|' + tName, firstTime = !seenCombo.has(combo);
      seenCombo.add(combo);
      const mismatch = mId && mName && /^bsi$/i.test(mId[1]) && +mId[2] !== +mName[1];
      if (t) {
        if (firstTime && mismatch) addIssue('C_THREAT_MISMATCH', 'Threat ID ' + tId + ' refers to number ' + mId[2] + ', but the threat name in this row starts with G 0.' + mName[1] + '. The row is filed under ' + t.id + '.', { sheet: name, row: r, col: R.threat, on: [t] });
        else if (firstTime && tName && t.name && looseKey(tName) !== looseKey(t.name)) addIssue('W_THREAT_NAME_VARIES', 'Threat ' + t.id + ' is named “' + tName + '” here but “' + t.name + '” in row ' + (t.row + 1) + '.', { sheet: name, row: r, col: R.threat, on: [t] });
        return t;
      }
      t = { type: 'threat', id: key, name: tName, title: mName ? mName[2].trim() : tName, num: mName ? +mName[1] : (mId && /^bsi$/i.test(mId[1]) ? +mId[2] : null), risks: [], issues: [], sheet: name, row: r };
      M.threats.push(t); M.by.threat.set(key, t);
      if (!tId) addIssue('F_MISSING_ID', 'Threat “' + truncate(tName, 60) + '” has no Threat ID.', { sheet: name, row: r, col: R.threatId, on: [t] });
      else if (!CFG.patterns.threatId.test(tId)) addIssue('F_ID', 'Threat ID “' + tId + '” does not match the pattern T.BSI.<number>.', { sheet: name, row: r, col: R.threatId, on: [t] });
      if (!tName) addIssue('W_MISSING', 'Threat ' + t.id + ' has no threat name.', { sheet: name, row: r, col: R.threat, on: [t] });
      else if (!mName) addIssue('F_THREAT_NAME', 'Threat name “' + truncate(tName, 60) + '” does not start with the elementary threat number (“G 0.<number> …”).', { sheet: name, row: r, col: R.threat, on: [t] });
      else if (!/^G 0\.\d+ \S/.test(tName)) addIssue('F_THREAT_NAME', 'Threat name “' + truncate(tName, 60) + '” is not written as “G 0.<number> <name>” (check spaces).', { sheet: name, row: r, col: R.threat, on: [t] });
      if (mismatch) addIssue('C_THREAT_MISMATCH', 'Threat ID ' + tId + ' refers to number ' + mId[2] + ', but the threat name starts with G 0.' + mName[1] + '.', { sheet: name, row: r, col: R.threat, on: [t] });
      if (t.num != null && (!mId || /^bsi$/i.test(mId[1])) && (t.num < 1 || t.num > 47)) addIssue('W_THREAT_RANGE', 'Threat ' + t.id + ': G 0.' + t.num + ' is not one of the 47 BSI elementary threats.', { sheet: name, row: r, col: R.threatId, on: [t] });
      return t;
    }

    for (let r = hr + 1; r < sh.rows.length; r++) {
      const tId = cell(r, R.threatId), tName = cell(r, R.threat), rel = cell(r, R.relevance);
      const rId = cell(r, R.riskId), description = cell(r, R.description), compRaw = cell(r, R.component);
      const freqRaw = cell(r, R.freq), effectRaw = cell(r, R.effect), rmiRaw = cell(r, R.rmiIds), categoryRaw = cell(r, R.category);
      const hasRisk = !!(rId || description || compRaw || freqRaw || effectRaw || rmiRaw || categoryRaw);
      if (!tId && !tName && !hasRisk) continue;
      if (tId || tName) cur = getThreat(tId, tName, r);
      if (!hasRisk) continue;
      report(riskSheet).rows++;
      const risk = {
        type: 'risk', id: rId || '(row ' + (r + 1) + ')', threat: cur, description, componentRaw: compRaw, components: [], coreRaw: cell(r, R.core), coreValues: [],
        assumptionsRaw: cell(r, R.assumptions), assumptionRefs: [], assumptions: [],
        freqRaw, effectRaw, freq: null, effect: null, index: null, indexCell: rawNum(r, R.index), indexCalc: null,
        save: cell(r, R.save), categoryRaw, category: null, rmiRaw, items: [],
        freqAfterRaw: cell(r, R.freqAfter), effectAfterRaw: cell(r, R.effectAfter), freqAfter: null, effectAfter: null,
        indexAfter: null, indexAfterCell: rawNum(r, R.indexAfter), indexAfterCalc: null, reduction: rawNum(r, R.reduction), reductionRaw: cell(r, R.reduction),
        relevanceRaw: rel, notRelevant: false,
        groups: [], issues: [], sheet: name, row: r,
      };
      M.risks.push(risk);
      if (cur) cur.risks.push(risk);
      else addIssue('F_MISSING_ID', 'Risk ' + risk.id + ' is not preceded by any threat (Threat ID and Threat are empty).', { sheet: name, row: r, col: R.threatId, on: [risk] });

      if (!rId) addIssue('F_MISSING_ID', 'Risk row without a Risk ID.', { sheet: name, row: r, col: R.riskId, on: [risk] });
      else if (!CFG.patterns.riskId.test(rId)) addIssue('F_ID', 'Risk ID “' + rId + '” does not match the pattern <letters>.<letters>.<number>.', { sheet: name, row: r, col: R.riskId, on: [risk] });
      if (rId && M.by.risk.has(rId)) addIssue('C_DUP_ID', 'Risk ID “' + rId + '” is used more than once (also in row ' + (M.by.risk.get(rId).row + 1) + ').', { sheet: name, row: r, col: R.riskId, on: [risk, M.by.risk.get(rId)] });
      else if (rId) M.by.risk.set(rId, risk);
      if (!description) addIssue('W_MISSING', 'Risk ' + risk.id + ' has no description.', { sheet: name, row: r, col: R.description, on: [risk] });
      if (R.relevance != null) {
        const rv = relevanceOf(rel);
        risk.notRelevant = rv.notRelevant;
        if (!rel) addIssue('W_MISSING', 'Risk ' + risk.id + ' has no “Threat relevance”; it counts as relevant.', { sheet: name, row: r, col: R.relevance, on: [risk] });
        else if (rv.typo) addIssue('W_RELEVANCE', 'Risk ' + risk.id + ': “Threat relevance” contains “' + rv.typo + '”, which looks like “not relevant” but is not written so. The risk counts as relevant and is not hidden.', { sheet: name, row: r, col: R.relevance, excerpt: rel, on: [risk] });
      }
      if (!compRaw) addIssue('W_MISSING', 'Risk ' + risk.id + ' has no affected component.', { sheet: name, row: r, col: R.component, on: [risk] });
      else rawComponents.push({ raw: compRaw, risk });

      /* core values */
      if (!risk.coreRaw) addIssue('W_MISSING', 'Risk ' + risk.id + ' has no core values at risk.', { sheet: name, row: r, col: R.core, on: [risk] });
      else {
        for (const part of risk.coreRaw.split(/[,;/\n]+|\s+and\s+/i).map((s) => s.trim()).filter(Boolean)) {
          const k = looseKey(part);
          let cv = CFG.coreValues.find((x) => x.match.test(k));
          if (!cv) {
            cv = CFG.coreValues.find((x) => x.key.toLowerCase() === k || levenshtein(k, x.label.toLowerCase()) <= 2);
            addIssue('F_VALUE', 'Core value “' + part + '” is not one of Confidentiality, Integrity, Availability' + (cv ? ' (read as ' + cv.label + ')' : '') + '.', { sheet: name, row: r, col: R.core, on: [risk], excerpt: risk.coreRaw });
          }
          if (cv && !risk.coreValues.includes(cv.key)) risk.coreValues.push(cv.key);
        }
        risk.coreValues.sort((a, b) => 'CIA'.indexOf(a) - 'CIA'.indexOf(b));
      }

      /* related assumptions */
      const lines = risk.assumptionsRaw ? risk.assumptionsRaw.split('\n') : [];
      lines.forEach((ln, li) => {
        if (!ln.trim()) return;
        const hits = [...ln.matchAll(/(?<![A-Za-z0-9.])A\.(\d+)(?!\d)/g)];
        if (!hits.length) {
          const lo = /(?<![A-Za-z])A[\s._-]*(\d+)\b/.exec(ln);
          if (lo) {
            addIssue('F_ASSUMPTION_REF', 'Assumption reference “' + lo[0] + '” is not written as A.' + lo[1] + '.', { sheet: name, row: r, col: R.assumptions, line: li + 1, on: [risk], excerpt: ln.trim() });
            risk.assumptionRefs.push({ id: 'A.' + lo[1], title: ln.slice(lo.index + lo[0].length).replace(/^[\s:\u2013\u2014-]+/, '').trim(), line: li + 1 });
          } else addIssue('F_ASSUMPTION_REF', 'No assumption ID (A.<number>) found in this line.', { sheet: name, row: r, col: R.assumptions, line: li + 1, on: [risk], excerpt: ln.trim() });
          return;
        }
        hits.forEach((mm, i) => {
          const end = i + 1 < hits.length ? hits[i + 1].index : ln.length;
          const title = ln.slice(mm.index + mm[0].length, end).replace(/^[\s:\u2013\u2014-]+/, '').replace(/[\s,;]+$/, '');
          risk.assumptionRefs.push({ id: 'A.' + mm[1], title, line: li + 1 });
        });
      });

      /* assessment before / after treatment */
      const enumField = (raw, list, label, col, missingOk) => {
        if (!raw) { if (!missingOk) addIssue('W_MISSING', 'Risk ' + risk.id + ': “' + label + '” is empty.', { sheet: name, row: r, col, on: [risk] }); return null; }
        const res = parseEnum(raw, list);
        if (!res.exact) addIssue('F_VALUE', 'Risk ' + risk.id + ': “' + raw + '” is not an allowed value for “' + label + '”' + (res.item ? ' (read as “' + res.item.label + '”)' : '') + '. Allowed: ' + list.map((x) => x.label).join(', ') + '.', { sheet: name, row: r, col, on: [risk] });
        return res.item;
      };
      risk.category = enumField(categoryRaw, CFG.categories, 'Risk Treatment category', R.category, false);
      const accepted = risk.category && risk.category.key === 'acceptance';
      risk.freq = enumField(freqRaw, CFG.freq, 'Frequency of occurence', R.freq, false);
      risk.effect = enumField(effectRaw, CFG.effect, 'Effects without additional safeguards', R.effect, false);
      risk.freqAfter = enumField(risk.freqAfterRaw, CFG.freq, 'Frequency of occurence (after treatment)', R.freqAfter, accepted);
      risk.effectAfter = enumField(risk.effectAfterRaw, CFG.effect, 'Effects after rollout of treatment', R.effectAfter, accepted);
      const idx = (f, e, cellVal, label, col) => {
        const calc = f && e ? f.value * e.value : null;
        if (cellVal != null && calc != null && Math.abs(cellVal - calc) > 1e-9) {
          addIssue('C_INDEX', 'Risk ' + risk.id + ': ' + label + ' is ' + cellVal + ' in the workbook, but ' + f.label + ' (' + f.value + ') × ' + e.label + ' (' + e.value + ') = ' + calc + '.', { sheet: name, row: r, col, on: [risk] });
        }
        return { calc, value: cellVal != null ? cellVal : calc };
      };
      let x = idx(risk.freq, risk.effect, risk.indexCell, 'Risk index', R.index);
      risk.indexCalc = x.calc; risk.index = x.value;
      x = idx(risk.freqAfter, risk.effectAfter, risk.indexAfterCell, 'Risk index (after treatment)', R.indexAfter);
      risk.indexAfterCalc = x.calc; risk.indexAfter = x.value;
      /* Accepted risks without an after-treatment assessment keep their initial position. */
      risk.assumedAfter = accepted && risk.indexAfter == null && !risk.freqAfter && !risk.effectAfter;
      risk.posAfter = risk.assumedAfter ? { f: risk.freq, e: risk.effect } : { f: risk.freqAfter, e: risk.effectAfter };
      risk.residual = risk.assumedAfter ? risk.index : risk.indexAfter;
      if (risk.index != null && risk.indexAfter != null && risk.indexAfter > risk.index) addIssue('W_AFTER_HIGHER', 'Risk ' + risk.id + ': risk index rises from ' + risk.index + ' to ' + risk.indexAfter + ' after treatment.', { sheet: name, row: r, col: R.indexAfter, on: [risk] });

      /* “RMI ID” cell -> links to the mitigation items of the master list */
      risk.items = readRmiRefs(rmiRaw, risk, 'Risk ' + risk.id, { sheet: name, row: r, col: R.rmiIds }, (rmi, line, raw) => {
        const occ = { risk, rmi, line, raw, text: rmi.text, groups: [], issues: [] };
        rmi.occ.push(occ);
        return occ;
      });
      checkFormula(sh, r, R.treatment, rmiRaw, 'Risk ' + risk.id, 'Risk treatment option', risk);
      if (!risk.items.length && !risk.removedRefs.length && risk.category && risk.category.key === 'mitigation') addIssue('W_NO_ITEMS', 'Risk ' + risk.id + ' is treated by “' + risk.category.label + '” but its “RMI ID” cell lists no mitigation item.', { sheet: name, row: r, col: R.rmiIds, on: [risk] });
    }

    /* risk reduction value: checked only if the column demonstrably holds "before − after" */
    const withRed = M.risks.filter((k) => k.reduction != null && k.index != null && k.indexAfter != null);
    const okRed = withRed.filter((k) => Math.abs(k.reduction - (k.index - k.indexAfter)) < 1e-9);
    if (withRed.length && okRed.length / withRed.length >= 0.6) {
      for (const k of withRed) if (!okRed.includes(k)) addIssue('C_REDUCTION', 'Risk ' + k.id + ': risk reduction value is ' + k.reduction + ', but ' + k.index + ' − ' + k.indexAfter + ' = ' + (k.index - k.indexAfter) + '.', { sheet: name, row: k.row, col: R.reduction, on: [k] });
    }
  }

  /* ---- 5. components (one object per distinct name) ---------------------------- */
  const atomic = new Set(rawComponents.filter((x) => !/[,;\n]/.test(x.raw)).map((x) => x.raw));
  const splitComponents = (raw) => {
    const parts = raw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const sub = p.split(',').map((s) => s.trim()).filter(Boolean);
      if (sub.length > 1 && sub.every((s) => atomic.has(s))) out.push(...sub); else out.push(p);
    }
    return uniq(out);
  };
  const getComponent = (nm) => {
    let c = M.by.component.get(nm);
    if (!c) { c = { type: 'component', id: nm, name: nm, risks: [], assumptions: [], issues: [] }; M.by.component.set(nm, c); M.components.push(c); }
    return c;
  };
  for (const { raw, risk } of rawComponents) for (const nm of splitComponents(raw)) { const c = getComponent(nm); risk.components.push(c); c.risks.push(risk); }
  const riskComponentNames = M.components.map((c) => c.name);
  for (const a of M.assumptions) {
    if (!a.componentsRaw) continue;
    for (const p of a.componentsRaw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean)) {
      const sub = p.split(',').map((s) => s.trim()).filter(Boolean);
      const names = M.by.component.has(p) ? [p] : (sub.length > 1 ? sub : [p]);
      for (const nm of names) {
        const known = M.by.component.get(nm) || M.components.find((c) => c.name.toLowerCase() === nm.toLowerCase());
        if (known) { if (!a.components.includes(known)) { a.components.push(known); known.assumptions.push(a); } }
        else a.components.push({ type: 'text', name: nm });
      }
    }
  }
  /* look-alike component names */
  const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (let i = 0; i < M.components.length; i++) for (let j = i + 1; j < M.components.length; j++) {
    const a = M.components[i], b = M.components[j], sa = squash(a.name), sb = squash(b.name);
    if (sa === sb || (Math.min(sa.length, sb.length) >= 6 && levenshtein(sa, sb) <= 2)) {
      const [rare, common] = a.risks.length <= b.risks.length ? [a, b] : [b, a];
      addIssue('W_SIMILAR_NAME', 'Component “' + rare.name + '” (' + plural(rare.risks.length, 'risk') + ') looks like “' + common.name + '” (' + plural(common.risks.length, 'risk') + ') — possibly the same component.', { sheet: M.sheetNames.risk, row: rare.risks[0] && rare.risks[0].row, col: R && R.component, on: [rare, common, ...rare.risks.slice(0, 3)] });
    }
  }

  /* ---- 6. link risks <-> assumptions ---------------------------------------------- */
  for (const risk of M.risks) {
    for (const ref of risk.assumptionRefs) {
      const a = M.by.assumption.get(ref.id);
      const loc = { sheet: risk.sheet, row: risk.row, col: R.assumptions, line: ref.line };
      if (!a) { addIssue('C_ASSUMPTION_UNKNOWN', 'Risk ' + risk.id + ' refers to assumption ' + ref.id + ', which does not exist in the assumptions sheet.', { ...loc, on: [risk] }); continue; }
      if (!risk.assumptions.includes(a)) { risk.assumptions.push(a); a.risks.push(risk); }
      if (ref.title && a.title && looseKey(ref.title) !== looseKey(a.title)) addIssue('W_ASSUMPTION_TITLE', 'Risk ' + risk.id + ' cites ' + a.id + ' as “' + truncate(ref.title, 70) + '”, but its title is “' + truncate(a.title, 70) + '”.', { ...loc, on: [risk, a] });
    }
  }
  for (const a of M.assumptions) {
    if (a.linkedRaw) {
      const stated = uniq((a.linkedRaw.match(/[A-Za-z]+\.[A-Za-z]+\.\d+/g) || []));
      const derived = new Set(a.risks.map((k) => k.id));
      const loc = { sheet: a.sheet, row: a.row, col: a.cols.linked };
      for (const id of stated) if (!derived.has(id)) addIssue('C_LINKED_RISKS', a.id + ' lists ' + id + ' under “Linked risks”, but ' + (M.by.risk.has(id) ? 'that risk does not name ' + a.id + ' under “Related assumptions”.' : 'no such risk exists in the risk analysis.'), { ...loc, on: [a, M.by.risk.get(id)] });
      for (const k of a.risks) if (!stated.includes(k.id)) addIssue('C_LINKED_RISKS', 'Risk ' + k.id + ' names ' + a.id + ' under “Related assumptions”, but ' + a.id + ' does not list it under “Linked risks”.', { ...loc, on: [a, k] });
    }
    if (!a.risks.length && M.risks.length) addIssue('W_UNUSED_ASSUMPTION', 'Assumption ' + a.id + ' is not referenced by any risk.', { sheet: a.sheet, row: a.row, col: a.cols.id, on: [a] });
  }

  /* ---- 7. group “RMI ID” cells -> mitigation items ------------------------------------ */
  for (const g of M.groups) {
    g.items = readRmiRefs(g.rmiRaw, g, 'Group ' + g.id, { sheet: g.sheet, row: g.row, col: G.rmiIds }, (rmi, line, raw) => {
      const item = { group: g, rmi, line, raw, text: rmi.text, issues: [] };
      rmi.listed.push(item);
      return item;
    });
    checkFormula(M.sheetObj.group, g.row, G.content, g.rmiRaw, 'Group ' + g.id, 'Content', g);
    if (!g.items.length && !g.removedRefs.length) addIssue('W_EMPTY_GROUP', 'Group ' + g.id + ' lists no RMI ID.', { sheet: g.sheet, row: g.row, col: G.rmiIds, on: [g] });
  }

  /* ---- 8. links by RMI ID: item -> groups (the groups that list its ID), item -> risks, and their checks ---- */
  const idList = (list) => list.slice(0, 6).map((o) => o.id).join(', ') + (list.length > 6 ? ', …' : '');
  for (const m of M.rmis) {
    m.groups = uniq(m.listed.map((i) => i.group));
    m.risks = uniq(m.occ.map((o) => o.risk));
    for (const o of m.occ) o.groups = m.groups;
    if (!m.base || m.removed) continue; // unknown IDs: C_RMI_UNKNOWN per use; removed items: no usage checks (links to them: C_RMI_REMOVED)
    const at = { sheet: m.sheet, row: m.row, col: X.id }; // item-level findings point to the item's row in the master list
    if (m.risks.length && !m.groups.length) addIssue('C_NOT_IN_GROUP', rmiName(m) + ' is used by ' + plural(m.risks.length, 'risk') + ' (' + idList(m.risks) + '), but no Risk Mitigation Group lists it in its “RMI ID” cell.', { ...at, on: [m, ...m.risks, ...m.occ] });
    if (!m.risks.length) addIssue('W_UNUSED_RMI', rmiName(m) + ' is not linked to any risk' + (m.groups.length ? ': group ' + idList(m.groups) + ' lists it, but no risk lists it in its “RMI ID” cell.' : ' and is not listed by any group.'), { ...at, on: [m, ...m.groups, ...m.listed] });
    if (m.groups.length > 1) addIssue('W_MULTI_GROUP', rmiName(m) + ' is listed by ' + m.groups.length + ' groups: ' + m.groups.map((g) => g.id).join(', ') + '.', { ...at, on: [m] });
  }
  for (const m of M.rmis) M.by.rmi.set(m.key, m);
  M.rmis.sort((a, b) => (a.base === b.base ? (a.base ? a.row - b.row : natCmp(a.id, b.id)) : a.base ? -1 : 1));
  /* removed items are hidden everywhere: M.rmis = active items only; M.allRmis (incl. removed) only for the items tab,
     the snapshot and links from findings (M.by.rmi holds all). */
  M.allRmis = M.rmis; M.rmis = M.allRmis.filter((m) => !m.removed);
  for (const g of M.groups) {
    g.rmis = uniq(g.items.map((i) => i.rmi));
    g.risks = uniq(g.rmis.flatMap((m) => m.risks));
    if (g.items.length && !g.risks.length && M.risks.length) addIssue('W_UNUSED_GROUP', 'Group ' + g.id + ': none of the RMIs it lists is linked to a risk.', { sheet: g.sheet, row: g.row, col: G.id, on: [g] });
  }
  for (const risk of M.risks) risk.groups = uniq(risk.items.flatMap((o) => o.groups));

  /* formulas without a stored result matter only in the columns the tool reads (the text columns are not read) */
  const readCols = [[riskSheet, R, ['treatment']], [asmSheet, M.colsAsm, []], [rmgSheet, G, ['content']], [rmiSheet, X, ['groups', 'assigned']]];
  for (const [c, cols, skip] of readCols) {
    if (!c || !cols) continue;
    const used = new Set(Object.keys(cols).filter((k) => !skip.includes(k) && cols[k] != null).map((k) => cols[k])), hr = report(c).headerRow - 1;
    const n = c.s.uncached.filter(([r, col]) => r > hr && used.has(col)).length;
    if (n) addIssue('W_UNCACHED', plural(n, 'formula cell') + ' in columns of “' + c.s.name + '” that the tool reads have no stored result; values computed by formulas (e.g. Risk index) cannot be read and are recalculated by the tool where possible.', { sheet: c.s.name });
  }

  M.components.sort((a, b) => natCmp(a.name, b.name));
  M.wb = wb; M.cols = { risk: R, group: G, assumption: M.colsAsm || null, rmi: X };
  M.lastRow = { risk: Math.max(-1, ...M.risks.map((r) => r.row), ...M.threats.map((t) => t.row)), assumption: Math.max(-1, ...M.assumptions.map((a) => a.row)), group: Math.max(-1, ...M.groups.map((g) => g.row)), rmi: Math.max(rmiSheet ? rmiSheet.rmi.row : -1, ...baseRmis.map((m) => m.row)) };
  M.stats = {
    occ: sum(M.risks, (k) => k.items.length),
    occAssigned: sum(M.risks, (k) => k.items.filter((o) => o.groups.length).length),
    cats: { format: 0, consistency: 0, warning: 0 },
  };
  for (const it of M.issues) M.stats.cats[it.cat]++;
  return M;
}
