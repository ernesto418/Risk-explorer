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

/** Parses one mitigation line ("- text [GROUP]") from a treatment cell or a group Content cell. */
function parseItemLine(raw, groupIdsLower) {
  let s = raw.trim();
  const out = { text: '', bullet: 'ok', bulletChar: '' };
  let m;
  if ((m = /^-\s+/.exec(s))) s = s.slice(m[0].length);
  else if (/^-(?=\S)/.test(s)) { out.bullet = 'nospace'; s = s.slice(1); }
  else if ((m = /^([\u2013\u2014\u2010\u2011\u2012\u2212\u2022\u00B7*\u25AA\u25E6\u25CB\u25CF\u25BA>\u2192])\s*/.exec(s))) { out.bullet = 'char'; out.bulletChar = m[1]; s = s.slice(m[0].length); }
  else out.bullet = 'none';

  /* A trailing group tag such as “[RMG01]” is not used by the tool: it is removed silently before comparing texts. */
  for (let guard = 0; guard < 4; guard++) {
    m = /\s*\[([^\[\]]{0,40})\]?\s*[.;,]?\s*$/.exec(s);
    if (!m || !/^[\w\s,;/|-]*$/.test(m[1]) || !/\[/.test(m[0])) break;
    s = s.slice(0, m.index);
  }
  out.text = s.trim();
  return out;
}
function bulletProblem(p) {
  if (p.bullet === 'none') return 'line does not start with “- ”';
  if (p.bullet === 'nospace') return 'missing space after the leading hyphen (“-text” instead of “- text”)';
  if (p.bullet === 'char') return 'line starts with “' + p.bulletChar + '” instead of “- ” (hyphen + space)';
  return null;
}

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
  if (!rmiSheet) addIssue('F_STRUCT', 'No “Risk mitigations individual” sheet found. Expected a sheet with the column headers “RMI ID” and “Mitigation item”. Mitigation items are shown as RMI-X.');
  if (!rmgSheet) addIssue('F_STRUCT', 'No mitigation group sheet found. Expected a sheet (e.g. “Risk Mitigation Groups”) with the column header “Risk Mitigation Group ID”.');
  for (const c of [riskSheet, asmSheet, rmgSheet, rmiSheet]) {
    if (c && c.s.formulasWithoutValue > 0) addIssue('W_UNCACHED', plural(c.s.formulasWithoutValue, 'formula cell') + ' in “' + c.s.name + '” have no stored result; values computed by formulas (e.g. Risk index) cannot be read and are recalculated by the tool where possible.', { sheet: c.s.name });
  }

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

  /* ---- 1. mitigation groups (IDs first, contents later) ------------------------ */
  let G = null;
  if (rmgSheet) {
    const sh = rmgSheet.s, name = sh.name;
    M.sheetNames.group = name;
    M.sheetObj = M.sheetObj || {}; M.sheetObj.group = sh;
    G = columns(rmgSheet, {
      id: [(n) => /^risk mitigation group id$/.test(n), 'Risk Mitigation Group ID', true],
      treatment: [(n) => /^risk treatment$/.test(n), 'Risk treatment', false],
      name: [(n) => /^security measure group$/.test(n), 'Security Measure Group', true],
      content: [(n) => /^content$/.test(n), 'Content', true],
    });
    const hr = rmgSheet.rmg.row; report(rmgSheet).headerRow = hr + 1;
    const cell = (r, c) => (c == null ? '' : str(sh.rows[r] && sh.rows[r][c]));
    for (let r = hr + 1; r < sh.rows.length; r++) {
      const id = cell(r, G.id), gname = cell(r, G.name), content = cell(r, G.content), treatment = cell(r, G.treatment);
      if (!id && !gname && !content) continue;
      const g = { type: 'group', id: id || '(row ' + (r + 1) + ')', name: gname, treatment, contentRaw: content, items: [], rmis: [], risks: [], issues: [], sheet: name, row: r };
      M.groups.push(g); report(rmgSheet).rows++;
      if (!id) addIssue('F_MISSING_ID', 'Group row without a Risk Mitigation Group ID.', { sheet: name, row: r, col: G.id, on: [g] });
      else if (!CFG.patterns.groupId.test(id)) addIssue('F_ID', 'Group ID “' + id + '” must be letters and digits only, without spaces.', { sheet: name, row: r, col: G.id, on: [g] });
      if (id && M.by.group.has(id)) addIssue('C_DUP_ID', 'Group ID “' + id + '” is used more than once (also in row ' + (M.by.group.get(id).row + 1) + ').', { sheet: name, row: r, col: G.id, on: [g, M.by.group.get(id)] });
      else if (id) M.by.group.set(id, g);
      if (!gname) addIssue('W_MISSING', 'Group “' + g.id + '” has no Security Measure Group name.', { sheet: name, row: r, col: G.name, on: [g] });
    }
  }
  const groupLower = new Map(M.groups.map((g) => [g.id.replace(/[^A-Za-z0-9]/g, '').toLowerCase(), g]));
  const groupIdsLower = new Set(groupLower.keys());

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

  /* ---- 3. risk analysis --------------------------------------------------------- */
  /* Mitigation items: the sheet “Risk mitigations individual” is the master list (RMI ID + text). Lines in the risk
     analysis and in group Contents are matched to it by IDENTICAL text; a text that is not there becomes an “RMI-X”. */
  const rmiByText = new Map(), baseRmis = [];
  let unknownN = 0;
  const newRmi = (text, extra) => { const m = { type: 'rmi', id: 'RMI-X', key: '', text, base: false, variants: new Map(), occ: [], listed: [], groups: [], risks: [], issues: [], ...extra }; M.rmis.push(m); return m; };
  function getRmi(text) {
    let m = rmiByText.get(text);
    if (!m) { m = newRmi(text, { key: 'RMI-X#' + (++unknownN) }); rmiByText.set(text, m); }
    return m;
  }
  let X = null;
  if (rmiSheet) {
    const sh = rmiSheet.s, name = sh.name;
    M.sheetNames.rmi = name; M.sheetObj = M.sheetObj || {}; M.sheetObj.rmi = sh;
    X = M.colsRmi = columns(rmiSheet, {
      id: [(n) => /^rmi id$/.test(n), 'RMI ID', true], text: [(n) => /^mitigation item$/.test(n), 'Mitigation item', true],
      groups: [(n) => /^groups?$/.test(n), 'Groups', false], assigned: [(n) => /^assigned$/.test(n), 'Assigned', false],
      ext: [(n) => /^extended description$/.test(n), 'Extended Description', false], comment: [(n) => /^comments?$/.test(n), 'Comment', false], responsible: [(n) => /^responsible$/.test(n), 'Responsible', false],
    });
    const hr = rmiSheet.rmi.row; report(rmiSheet).headerRow = hr + 1;
    const cell = (r, c) => (c == null ? '' : str(sh.rows[r] && sh.rows[r][c]));
    const byId = new Map();
    for (let r = hr + 1; r < sh.rows.length; r++) {
      const id = cell(r, X.id), raw = cell(r, X.text);
      if (!id && !raw) continue;
      report(rmiSheet).rows++;
      const text = raw ? parseItemLine(raw, new Set()).text : '';
      const m = newRmi(text, { id: id || '(row ' + (r + 1) + ')', key: id || '(row ' + (r + 1) + ')', base: true, sheet: name, row: r, groupsRaw: cell(r, X.groups), assignedRaw: cell(r, X.assigned),
        extDescription: cell(r, X.ext), comment: cell(r, X.comment), responsible: cell(r, X.responsible) });
      baseRmis.push(m);
      const loc = { sheet: name, row: r };
      if (!id) addIssue('F_MISSING_ID', 'Mitigation item without RMI ID.', { ...loc, col: X.id, on: [m] });
      else if (byId.has(id)) { addIssue('C_DUP_ID', 'RMI ID “' + id + '” is used more than once (also in row ' + (byId.get(id).row + 1) + ').', { ...loc, col: X.id, on: [m, byId.get(id)] }); m.key = id + '#row' + (r + 1); }
      else byId.set(id, m);
      if (!text) addIssue('W_MISSING', 'RMI ' + m.id + ' has no text in “Mitigation item”.', { ...loc, col: X.text, on: [m] });
      else if (rmiByText.has(text)) addIssue('C_DUP_ID', 'The text of RMI ' + m.id + ' is identical to RMI ' + rmiByText.get(text).id + ' (row ' + (rmiByText.get(text).row + 1) + ').', { ...loc, col: X.text, on: [m, rmiByText.get(text)] });
      else rmiByText.set(text, m);
    }
  }
  const baseLoose = new Map(baseRmis.filter((m) => m.text).map((m) => [looseKey(m.text), m]));
  const baseBg = baseRmis.filter((m) => m.text).map((m) => { const k = looseKey(m.text); return { m, k, bg: bigrams(k) }; });
  /** C_RMI_UNKNOWN for a line whose text is not in the master list, with the closest master item as hint. */
  function unknownRmi(rmi, text, where, loc, on) {
    if (rmi.base || !rmiSheet) return;
    const k = looseKey(text), near = baseLoose.get(k);
    let hint = null;
    if (near) hint = 'Near-identical to ' + near.id + ' (' + diffHint(text, near.text) + '): “' + truncate(near.text, 110) + '”';
    else { const bg = bigrams(k); let best = null, bs = 0; for (const c of baseBg) { const sc = dice(bg, c.bg, k.length, c.k.length); if (sc > bs) { bs = sc; best = c; } } if (best && bs >= 0.72) hint = 'Closest item (' + Math.round(bs * 100) + '% similar): ' + best.m.id + ' “' + truncate(best.m.text, 110) + '”'; }
    addIssue('C_RMI_UNKNOWN', where + ': this mitigation item is not in “' + M.sheetNames.rmi + '” (no row with identical text), so it has no RMI ID.', { ...loc, hint, on });
  }
  let R = null;
  const rawComponents = [];
  if (riskSheet) {
    const sh = riskSheet.s, name = sh.name;
    M.sheetNames.risk = name;
    M.sheetObj = M.sheetObj || {}; M.sheetObj.risk = sh;
    R = columns(riskSheet, {
      threatId: [(n) => /^threat id$/.test(n), 'Threat ID', true],
      threat: [(n) => /^threat$/.test(n), 'Threat', true],
      relevance: [(n) => /^threat relevance/.test(n), 'Threat relevance', false],
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
      treatment: [(n) => /^risk treatment options?/.test(n), 'Risk treatment option', true],
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

    function getThreat(tId, tName, rel, r) {
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
        if (rel && !t.relevance) t.relevance = rel;
        return t;
      }
      t = { type: 'threat', id: key, name: tName, title: mName ? mName[2].trim() : tName, num: mName ? +mName[1] : (mId && /^bsi$/i.test(mId[1]) ? +mId[2] : null), relevance: rel, risks: [], issues: [], sheet: name, row: r };
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
      const freqRaw = cell(r, R.freq), effectRaw = cell(r, R.effect), treatmentRaw = cell(r, R.treatment), categoryRaw = cell(r, R.category);
      const hasRisk = !!(rId || description || compRaw || freqRaw || effectRaw || treatmentRaw || categoryRaw);
      if (!tId && !tName && !hasRisk) continue;
      if (tId || tName) cur = getThreat(tId, tName, rel, r);
      if (!hasRisk) continue;
      report(riskSheet).rows++;
      const risk = {
        type: 'risk', id: rId || '(row ' + (r + 1) + ')', threat: cur, description, componentRaw: compRaw, components: [], coreRaw: cell(r, R.core), coreValues: [],
        assumptionsRaw: cell(r, R.assumptions), assumptionRefs: [], assumptions: [],
        freqRaw, effectRaw, freq: null, effect: null, index: null, indexCell: rawNum(r, R.index), indexCalc: null,
        save: cell(r, R.save), categoryRaw, category: null, treatmentRaw, intro: '', items: [],
        freqAfterRaw: cell(r, R.freqAfter), effectAfterRaw: cell(r, R.effectAfter), freqAfter: null, effectAfter: null,
        indexAfter: null, indexAfterCell: rawNum(r, R.indexAfter), indexAfterCalc: null, reduction: rawNum(r, R.reduction), reductionRaw: cell(r, R.reduction),
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

      /* treatment option cell -> individual mitigation items */
      const tl = treatmentRaw ? treatmentRaw.split('\n') : [];
      let first = true;
      const seen = new Map();
      tl.forEach((ln, li) => {
        if (!ln.trim()) return;
        const startsLikeItem = /^\s*[-\u2013\u2014\u2022*]\s*\S/.test(ln);
        if (first) {
          first = false;
          if (!startsLikeItem) { risk.intro = ln.trim(); return; }
          addIssue('F_INTRO', 'Risk ' + risk.id + ': the first line of “Risk treatment option” already looks like a mitigation item (the introductory line is missing).', { sheet: name, row: r, col: R.treatment, line: li + 1, on: [risk], excerpt: ln.trim() });
        }
        const p = parseItemLine(ln, groupIdsLower);
        const occ = { risk, rmi: null, line: li + 1, raw: ln.trim(), text: p.text, groups: [], issues: [] };
        const loc = { sheet: name, row: r, col: R.treatment, line: li + 1, excerpt: ln.trim() };
        if (!p.text) { addIssue('F_EMPTY_ITEM', 'Risk ' + risk.id + ', line ' + (li + 1) + ': mitigation line has no text.', { ...loc, on: [risk] }); return; }
        const rmi = getRmi(p.text);
        occ.rmi = rmi; rmi.occ.push(occ); risk.items.push(occ);
        unknownRmi(rmi, p.text, 'Risk ' + risk.id + ', line ' + (li + 1), { sheet: name, row: r, col: R.treatment, line: li + 1, excerpt: ln.trim() }, [risk, rmi, occ]);
        rmi.variants.set(p.text, (rmi.variants.get(p.text) || 0) + 1);
        const bp = bulletProblem(p);
        if (bp) addIssue('F_BULLET', 'Risk ' + risk.id + ', line ' + (li + 1) + ': ' + bp + '.', { ...loc, on: [risk, rmi, occ] });
        if (seen.has(rmi)) addIssue('W_DUP_LINE', 'Risk ' + risk.id + ': the same mitigation item appears on lines ' + seen.get(rmi) + ' and ' + (li + 1) + '.', { ...loc, on: [risk, rmi, occ] });
        else seen.set(rmi, li + 1);
      });
      if (!risk.items.length && risk.category && risk.category.key === 'mitigation') addIssue('W_NO_ITEMS', 'Risk ' + risk.id + ' is treated by “' + risk.category.label + '” but lists no mitigation items.', { sheet: name, row: r, col: R.treatment, on: [risk] });
    }

    /* risk reduction value: checked only if the column demonstrably holds "before − after" */
    const withRed = M.risks.filter((k) => k.reduction != null && k.index != null && k.indexAfter != null);
    const okRed = withRed.filter((k) => Math.abs(k.reduction - (k.index - k.indexAfter)) < 1e-9);
    if (withRed.length && okRed.length / withRed.length >= 0.6) {
      for (const k of withRed) if (!okRed.includes(k)) addIssue('C_REDUCTION', 'Risk ' + k.id + ': risk reduction value is ' + k.reduction + ', but ' + k.index + ' − ' + k.indexAfter + ' = ' + (k.index - k.indexAfter) + '.', { sheet: name, row: k.row, col: R.reduction, on: [k] });
    }
  }

  /* ---- 4. components (one object per distinct name) ---------------------------- */
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

  /* ---- 5. link risks <-> assumptions ---------------------------------------------- */
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

  /* ---- 6. group contents -> mitigation items ---------------------------------------- */
  const riskLines = M.risks.flatMap((r) => r.items).map((o) => { const k = looseKey(o.text); return { o, k, bg: bigrams(k) }; });
  for (const g of M.groups) {
    const lines = g.contentRaw ? g.contentRaw.split('\n') : [];
    const seen = new Map();
    lines.forEach((ln, li) => {
      if (!ln.trim()) return;
      const p = parseItemLine(ln, groupIdsLower);
      const loc = { sheet: g.sheet, row: g.row, col: G.content, line: li + 1, excerpt: ln.trim() };
      const item = { group: g, rmi: null, line: li + 1, raw: ln.trim(), text: p.text, issues: [], match: 'exact' };
      if (!p.text) { addIssue('F_EMPTY_ITEM', 'Group ' + g.id + ', line ' + (li + 1) + ': content line has no text.', { ...loc, on: [g] }); return; }
      const key = looseKey(p.text);
      const rmi = getRmi(p.text);
      item.rmi = rmi; g.items.push(item); rmi.listed.push(item);
      unknownRmi(rmi, p.text, 'Group ' + g.id + ', line ' + (li + 1), loc, [g, rmi, item]);
      const bp = bulletProblem(p);
      if (bp) addIssue('F_BULLET', 'Group ' + g.id + ', line ' + (li + 1) + ': ' + bp + '.', { ...loc, on: [g, rmi, item] });
      if (seen.has(rmi)) addIssue('W_DUP_LINE', 'Group ' + g.id + ': the same item appears on lines ' + seen.get(rmi) + ' and ' + (li + 1) + '.', { ...loc, on: [g, rmi, item] });
      else seen.set(rmi, li + 1);

      const nearLine = !rmi.occ.length && riskLines.find((x) => x.k === key);
      if (!rmi.occ.length && !nearLine) {
        item.match = 'none';
        let best = null, bs = 0;
        const bg = bigrams(key);
        for (const x of riskLines) { const s = dice(bg, x.bg, key.length, x.k.length); if (s > bs) { bs = s; best = x.o; } }
        const hint = best && bs >= 0.72 ? 'Closest line (' + Math.round(bs * 100) + '% similar) in ' + best.risk.id + ': “' + truncate(best.text, 110) + '”' : null;
        addIssue('C_NO_MATCH', 'Group ' + g.id + ', line ' + (li + 1) + ': no line with this text exists in any “Risk treatment option” cell.', { ...loc, hint, on: [g, rmi, item] });
      } else if (nearLine) {
        item.match = 'near';
        const o = nearLine.o;
        addIssue('C_NO_MATCH', 'Group ' + g.id + ', line ' + (li + 1) + ': no identical line in “Risk treatment option” — a near-identical one exists in ' + o.risk.id + ' (' + diffHint(p.text, o.text) + ').', { ...loc, hint: 'Risk analysis text: “' + truncate(o.text, 110) + '”', on: [g, rmi, item] });
      }
    });
    if (!g.items.length) addIssue('W_EMPTY_GROUP', 'Group ' + g.id + ' has no content lines.', { sheet: g.sheet, row: g.row, col: G.content, on: [g] });
  }

  /* ---- 7. link each mitigation line to the groups whose Content holds the IDENTICAL text ------------- */
  const contentByText = new Map(), contentLines = [];
  for (const g of M.groups) for (const i of g.items) {
    if (!contentByText.has(i.text)) contentByText.set(i.text, []);
    contentByText.get(i.text).push(g);
    const k = looseKey(i.text); contentLines.push({ i, k, bg: bigrams(k) });
  }
  for (const rmi of M.rmis) {
    for (const o of rmi.occ) {
      o.groups = uniq(contentByText.get(o.text) || []);
      if (o.groups.length) continue;
      const nl = looseKey(o.text), near = (contentLines.find((c) => c.k === nl) || {}).i;
      let hint = null;
      if (near) hint = 'A near-identical line exists in the Content of ' + near.group.id + ' (' + diffHint(o.text, near.text) + '): “' + truncate(near.text, 110) + '”';
      else {
        const k = looseKey(o.text), bg = bigrams(k);
        let best = null, bs = 0;
        for (const c of contentLines) { const sc = dice(bg, c.bg, k.length, c.k.length); if (sc > bs) { bs = sc; best = c; } }
        if (best && bs >= 0.72) hint = 'Closest Content line (' + Math.round(bs * 100) + '% similar) in ' + best.i.group.id + ': “' + truncate(best.i.text, 110) + '”';
      }
      addIssue('C_NOT_IN_GROUP', 'Risk ' + o.risk.id + ', line ' + o.line + ': no identical line exists in the Content of any Risk Mitigation Group.', { sheet: o.risk.sheet, row: o.risk.row, col: R.treatment, line: o.line, excerpt: o.raw, hint, on: [o.risk, rmi, o] });
    }
    rmi.groupsListed = uniq(rmi.listed.map((i) => i.group));
    rmi.groups = rmi.occ.length ? uniq(rmi.occ.flatMap((o) => o.groups)) : rmi.groupsListed;
    rmi.risks = uniq(rmi.occ.map((o) => o.risk));
    if (rmi.groups.length > 1) { const at = rmi.occ[0] ? { sheet: rmi.occ[0].risk.sheet, row: rmi.occ[0].risk.row, col: R.treatment, line: rmi.occ[0].line } : {}; addIssue('W_MULTI_GROUP', 'The item “' + truncate(rmi.text, 80) + '” is listed in ' + rmi.groups.length + ' groups: ' + rmi.groups.map((g) => g.id).join(', ') + '.', { ...at, on: [rmi] }); }
  }
  for (const m of M.rmis) M.by.rmi.set(m.key, m);
  /* “Groups” / “Assigned” of the master list must match the groups whose Content holds the item */
  const yesRx = /^(s[ií]|yes|y|ja|true|1|x)$/i, noRx = /^(no|n|nein|false|0)$/i;
  for (const m of baseRmis) {
    const actual = uniq(m.listed.map((i) => i.group.id)).sort(natCmp), loc = { sheet: m.sheet, row: m.row };
    if (!m.occ.length && !m.listed.length) addIssue('W_UNUSED_RMI', 'RMI ' + m.id + ' is used neither in the risk analysis nor in any group’s Content.', { ...loc, col: X.id, on: [m] });
    if (X.groups != null) {
      const stated = uniq(m.groupsRaw.split(/\s*[\n,;]\s*/).map((x) => x.trim()).filter(Boolean)).sort(natCmp);
      if (stated.join('|') !== actual.join('|')) addIssue('C_RMI_GROUPS', 'RMI ' + m.id + ': “Groups” says ' + (stated.length ? stated.join(', ') : '(empty)') + ', but the item is in the Content of ' + (actual.length ? actual.join(', ') : 'no group') + '.', { ...loc, col: X.groups, excerpt: m.groupsRaw || null, on: [m] });
    }
    if (X.assigned != null) {
      const a = m.assignedRaw.trim(), want = actual.length > 0;
      if (!a) addIssue('W_MISSING', 'RMI ' + m.id + ': “Assigned” is empty.', { ...loc, col: X.assigned, on: [m] });
      else if (!yesRx.test(a) && !noRx.test(a)) addIssue('F_VALUE', 'RMI ' + m.id + ': “Assigned” must be Si or No, found “' + a + '”.', { ...loc, col: X.assigned, on: [m] });
      else if (yesRx.test(a) !== want) addIssue('C_RMI_GROUPS', 'RMI ' + m.id + ': “Assigned” says ' + a + ', but the item is in the Content of ' + (want ? actual.join(', ') : 'no group') + '.', { ...loc, col: X.assigned, on: [m] });
    }
  }
  M.rmis.sort((a, b) => (a.base === b.base ? (a.base ? a.row - b.row : 0) : a.base ? -1 : 1));
  for (const g of M.groups) {
    g.rmis = uniq(g.items.map((i) => i.rmi));
    g.risks = uniq(g.rmis.flatMap((m) => m.occ.filter((o) => o.groups.includes(g)).map((o) => o.risk)));
    if (g.items.length && !g.risks.length && M.risks.length) addIssue('W_UNUSED_GROUP', 'Group ' + g.id + ': none of its Content lines appears with identical text in the risk analysis.', { sheet: g.sheet, row: g.row, col: G.id, on: [g] });
  }
  for (const risk of M.risks) risk.groups = uniq(risk.items.flatMap((o) => o.groups));

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
