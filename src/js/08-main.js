/* ---------------------------------------------------------------------------
 * 08-main.js — application shell: welcome screen, opening the workbook
 * (read-only), navigation, global search, dialogs, theme.
 * ------------------------------------------------------------------------- */

const NAV = [
  { key: 'overview', label: 'Overview', icon: 'overview' },
  { key: 'matrix', label: 'Risk matrix', icon: 'matrix' },
  { key: 'risks', label: 'Risks', icon: 'risk', count: () => M.risks.length },
  { key: 'threats', label: 'Threats', icon: 'threat', count: () => M.threats.length },
  { key: 'mitigations', label: 'Mitigations', icon: 'rmi', count: () => M.rmis.length },
  { key: 'assumptions', label: 'Assumptions', icon: 'assumption', count: () => M.assumptions.length },
  { key: 'components', label: 'Components', icon: 'component', count: () => M.components.length },
  { key: 'connections', label: 'Connections', icon: 'flow' },
  { key: 'history', label: 'History', icon: 'history' },
  { key: 'issues', label: 'Errors & warnings', icon: 'issues', count: () => M.issues.length },
];

function logo(size) {
  const s = svg('svg', { viewBox: '0 0 24 24', width: size || 22, height: size || 22, class: 'logo', 'aria-hidden': 'true' });
  s.append(svg('rect', { x: 1.5, y: 1.5, width: 21, height: 21, rx: 6, class: 'logo-bg' }),
    svg('path', { d: 'M7 16.5 12 7.5l5 9', class: 'logo-l' }),
    svg('circle', { cx: 12, cy: 7.5, r: 2.1, class: 'logo-n n1' }), svg('circle', { cx: 7, cy: 16.5, r: 2.1, class: 'logo-n n2' }), svg('circle', { cx: 17, cy: 16.5, r: 2.1, class: 'logo-n n3' }));
  return s;
}

/* ---- theme ------------------------------------------------------------------------------- */
function applyTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('rre-theme', t); } catch (e) { /* storage unavailable */ } }
function initTheme() {
  let t = null;
  try { t = localStorage.getItem('rre-theme'); } catch (e) { /* ignore */ }
  if (t !== 'light' && t !== 'dark') t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
}
function themeButton() {
  const b = h('button.icon-btn', { type: 'button', tip: 'Switch light / dark theme', onclick: () => { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); fill(b, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 16)); } },
    icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 16));
  return b;
}

/* ---- dialogs & toasts ---------------------------------------------------------------------- */
/** wide: true = wide dialog, or a class name ('xwide'). Returns the dialog element. */
function openDialog(title, content, wide) {
  const d = h('dialog.dialog' + (wide ? (wide === true ? '.wide' : '.' + wide) : ''), h('header', h('h2', title), h('button.icon-btn', { type: 'button', tip: 'Close', onclick: () => d.close() }, icon('close', 15))), h('div.dialog-b', content));
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  document.body.append(d);
  d.showModal();
  return d;
}
function toast(msg, kind) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  const t = h('div.toast.' + (kind || 'info'), { role: 'alert' }, icon(kind === 'error' ? 'warning' : 'info', 15), h('span', msg), h('button.icon-btn.sm', { type: 'button', onclick: () => t.remove() }, icon('close', 12)));
  host.append(t);
  if (kind !== 'error') setTimeout(() => t.remove(), 4500);
}

/* ---- opening the workbook (read-only) -------------------------------------------------------- */
async function loadFile(file, handle) {
  document.body.classList.add('busy');
  try {
    if (/^~\$/.test(file.name)) throw new WorkbookError('“' + file.name + '” is the temporary lock file Excel creates while a workbook is open. Choose the workbook itself (same name without “~$”).');
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) throw new WorkbookError('“' + file.name + '” is not an .xlsx or .xlsm workbook.');
    const buf = await file.arrayBuffer();
    const wb = await readWorkbook(buf);
    state.hash = await sha256(buf);
    const prevFocus = state.ui.flow.focus;
    M = buildModel(wb, { name: file.name, size: file.size, lastModified: file.lastModified, loadedAt: Date.now() });
    state.file = file; state.handle = handle || null; state.drawer = []; state.changed = false;
    state.ui.flow.focus = exprRemap(prevFocus); // the same objects (by type and ID) in the workbook just read; missing ones are dropped
    state.ui.flow.draft = null; state.ui.flow.pending = [];
    buildSearchIndex();
    renderApp();
    if (!M.sheetNames.risk) toast('The workbook was opened, but no risk analysis sheet was recognised. See “Errors & warnings”.', 'error');
  } catch (e) {
    toast(e instanceof WorkbookError ? e.message : 'The workbook could not be read: ' + (e && e.message ? e.message : e), 'error');
    if (!(e instanceof WorkbookError)) console.error(e);
  } finally { document.body.classList.remove('busy'); }
}
async function pickFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ multiple: false, types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xlsm'] } }] });
      await loadFile(await handle.getFile(), handle);
      return;
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  document.getElementById('file-input').click();
}
async function reloadFile() {
  try {
    if (state.handle) await loadFile(await state.handle.getFile(), state.handle);
    else if (state.file) { await state.file.slice(0, 1).arrayBuffer(); await loadFile(state.file, null); }
    toast('Workbook read again from disk.');
  } catch (e) { toast('The browser can no longer read the file (it changed or moved). Please choose it again.', 'error'); pickFile(); }
}
function initFileHandling() {
  const input = h('input', { type: 'file', id: 'file-input', accept: '.xlsx,.xlsm', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadFile(f, null); } });
  document.body.append(input);
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
    const item = e.dataTransfer.items && e.dataTransfer.items[0];
    const file = e.dataTransfer.files[0];
    let handle = null;
    if (item && item.getAsFileSystemHandle) { try { handle = await item.getAsFileSystemHandle(); if (handle && handle.kind !== 'file') handle = null; } catch (err) { handle = null; } }
    if (file) loadFile(file, handle);
  });
  /* notice when the workbook was saved again in Excel */
  setInterval(async () => {
    if (!state.handle || !M || state.changed || document.hidden) return;
    try { const f = await state.handle.getFile(); if (f.lastModified !== M.file.lastModified) { state.changed = true; const b = document.getElementById('reload-btn'); if (b) { b.classList.add('changed'); b.dataset.tip = 'The workbook was saved again since it was read — click to reload'; } } } catch (e) { /* file locked or permission gone */ }
  }, 4000);
}

/* ---- global search ---------------------------------------------------------------------------- */
let searchIndex = [];
function buildSearchIndex() {
  searchIndex = [];
  const add = (o, extra) => searchIndex.push({ o, text: (objLabel(o) + ' ' + objTitle(o) + ' ' + (extra || '')).toLowerCase() });
  M.risks.forEach((r) => add(r, r.componentRaw));
  M.threats.forEach((t) => add(t, t.name + ' ' + (t.num != null ? 'G 0.' + t.num : '')));
  M.groups.forEach((g) => add(g, g.treatment));
  M.assumptions.forEach((a) => add(a, a.description));
  M.components.forEach((c) => add(c));
  M.rmis.forEach((m) => add(m));
}
function searchWidget() {
  const results = h('div.search-res', { hidden: true });
  const run = (q) => {
    q = q.trim().toLowerCase();
    clear(results);
    if (q.length < 2) { results.hidden = true; return; }
    const terms = q.split(/\s+/);
    const hits = searchIndex.filter((x) => terms.every((t) => x.text.includes(t)));
    const byType = groupBy(hits, (x) => x.o.type);
    for (const t of ['risk', 'threat', 'group', 'rmi', 'assumption', 'component']) {
      const arr = byType.get(t);
      if (!arr) continue;
      results.append(h('div.search-h', TYPES[t].plural, h('span.count', arr.length)));
      arr.slice(0, 6).forEach((x) => results.append(h('button.search-i.t-' + t, { type: 'button', onclick: () => { results.hidden = true; openObj(x.o); } }, icon(TYPES[t].icon, 13), h('span.chip-id', objLabel(x.o)), h('span.search-t', truncate(objTitle(x.o), 90)))));
    }
    if (!hits.length) results.append(h('div.search-h', 'No matches'));
    results.hidden = false;
  };
  const inp = h('input', { type: 'search', id: 'global-search', placeholder: 'Search IDs and text…  ( / )', 'aria-label': 'Search all objects', autocomplete: 'off',
    oninput: debounce((e) => run(e.target.value), 120), onfocus: (e) => run(e.target.value),
    onkeydown: (e) => { if (e.key === 'Escape') { results.hidden = true; e.target.blur(); } if (e.key === 'Enter') { const first = results.querySelector('.search-i'); if (first) first.click(); } } });
  const box = h('div.search', h('label.searchbox', icon('search', 14), inp), results);
  document.addEventListener('mousedown', (e) => { if (!box.contains(e.target)) results.hidden = true; });
  return box;
}

/* ---- informational dialogs ---------------------------------------------------------------------- */
function showWorkbookInfo() {
  const f = M.file;
  openDialog('Workbook', h('div',
    h('div.fields', field('File', f.name), field('Saved', fmtTime(new Date(f.lastModified))), field('Read by this tool', fmtTime(new Date(f.loadedAt))), field('Size', Math.round(f.size / 1024) + ' KB')),
    h('table.tbl', h('thead', h('tr', h('th', 'Sheet'), h('th', 'Used as'), h('th', 'Header row'), h('th', 'Rows read'))),
      h('tbody', M.sheetReport.map((s) => h('tr' + (s.role ? '' : '.muted'), h('td', s.name), h('td', s.role || 'ignored'), h('td', s.headerRow || '—'), h('td', s.role ? String(s.rows) : '—'))))),
    h('p.note', icon('lock', 12), 'The file is opened read-only and parsed in this browser tab. Nothing is written back, uploaded or stored.')));
}
function showMethod() {
  const scale = (list, title) => h('table.tbl', h('thead', h('tr', h('th', title), h('th', 'Value'), h('th', 'Meaning (BSI Standard 200-3)'))), h('tbody', list.map((x) => h('tr', h('td', h('b', x.label)), h('td', String(x.value)), h('td', x.desc)))));
  openDialog('Method & conventions', h('div.method',
    h('p', 'The risk analysis follows BSI Standard 200-3: threats from the elementary threat catalogue (G 0.1 – G 0.47) are assessed per affected component by frequency of occurrence and effects, first without and then with the planned treatment.'),
    h('h3', 'Risk index = frequency value × effects value'),
    scale(CFG.freq, 'Frequency of occurrence'), scale(CFG.effect, 'Effects'),
    h('h3', 'Risk-index bands'),
    h('div.legend', CFG.bands.map((b) => h('span.legend-i', h('i.sw.lvl-' + b.key), h('b', b.label), ' ' + b.range))),
    h('h3', 'Risk treatment options'),
    h('table.tbl', h('tbody', CFG.categories.map((c) => h('tr', h('td', h('b', c.label)), h('td', c.desc))))),
    h('h3', 'How cells are interpreted'),
    h('ul',
      h('li', 'Mitigation items (RMI) and their texts live only in the sheet “Risk mitigations individual” (RMI ID + Mitigation item). Its “Groups” and “Assigned” columns are generated by formulas and are not read.'),
      h('li', '“Removed” in “Risk mitigations individual”: empty or “no” = active, “yes” = removed (any case); any other value is a format error and the item stays active. Removed items are hidden everywhere (search, counts, panels, Connections, exports) except Mitigations → All items with “Hide removed” off; they get no “not used” / “no group” findings, and a risk or group that still lists one is a consistency error (the link is ignored).'),
      h('li', '“RMI ID” of a risk: the RMI IDs of its mitigation items, one per line. An ID that is not in “Risk mitigations individual” is a consistency error.'),
      h('li', '“RMI ID” of a Risk Mitigation Group: the RMI IDs of the items in the group, one per line. An item belongs to every group that lists its ID; an item used by a risk must belong to at least one group, otherwise it is a consistency error. An item that no risk uses is a warning.'),
      h('li', '“Risk treatment option” (risk analysis) and “Content” (groups) are formulas that show the texts of the RMI IDs. They are not read; the tool only warns when such a cell is not a formula.'),
      h('li', '“Threat relevance”: one value per risk row; despite its name it says whether the RISK is relevant. A risk is not relevant when the text contains the words “not relevant” (any case, anywhere); any other text counts as relevant. An empty cell or a text that only resembles “not relevant” is a warning. “Hide not relevant” (on by default in Risks, Threats, Mitigations and Connections, each on its own) hides not-relevant risks and the threats, groups and items whose risks are all not relevant.'),
      h('li', '“Related assumptions”: assumption IDs written as A.<number>. The links of an assumption to risks are derived from this column.'),
      h('li', 'Accepted risks without an after-treatment assessment keep their initial position and index in all “after treatment” views.')),
    h('h3', 'Checks performed'),
    h('table.tbl', h('tbody', Object.keys(ISSUE_TYPES).map((k) => h('tr', h('td', h('span.ibadge.cat-' + ISSUE_TYPES[k][0], icon(ISSUE_CATS[ISSUE_TYPES[k][0]].icon, 12))), h('td', h('b', ISSUE_TYPES[k][1])), h('td', ISSUE_TYPES[k][2])))))), true);
}

/* ---- shell ----------------------------------------------------------------------------------------- */
function welcome() {
  return h('div.welcome',
    h('div.welcome-top', h('span.spacer'), themeButton()),
    h('div.welcome-card',
      h('div.welcome-brand', logo(44), h('div', h('h1', 'Risk Register Explorer'), h('p', 'A read-only view of your BSI 200-3 risk analysis workbook'))),
      h('button.drop', { type: 'button', onclick: pickFile },
        h('span.drop-ico', icon('folder', 26)), h('b', 'Choose the workbook…'), h('span', 'or drop the .xlsx file anywhere on this page')),
      h('ul.promises',
        h('li', icon('offline', 16), h('div', h('b', '100% local'), h('span', 'No server, no downloads, no fonts or scripts from the internet. Network access is blocked by the page’s own security policy.'))),
        h('li', icon('eye', 16), h('div', h('b', 'Read-only by default'), h('span', 'The workbook is only read and never modified. Nothing is saved unless you turn on the optional write mode, which only adds baseline copies and change logs to a folder you choose.'))),
        h('li', icon('lock', 16), h('div', h('b', 'Stays in memory'), h('span', 'The data lives in this browser tab only and is gone when you close it.')))),
      h('details.expect', h('summary', icon('chevron', 12), 'Expected workbook layout'),
        h('ul',
          h('li', h('b', 'Architecture Assumptions'), ' — Assumption ID, Title, Description, Affected components, Linked risks, Validity for Alpha Release, Validity for Beta Release, Comment'),
          h('li', h('b', 'Risk analysis Alpha'), ' — Threat ID, Threat, Threat relevance, Risk ID, Risk description, Affected component, Core values at risk, Related assumptions, Frequency of occurence, Effects without additional safeguards, Risk index, Description for SAVe database, Risk Treatment category, RMI ID, Risk treatment option (formula), Frequency of occurence (after treatment), Effects after rollout of treatment, Risk index (after treatment), Risk reduction value'),
          h('li', h('b', 'Risk Mitigation Groups'), ' — Risk Mitigation Group ID, Risk treatment, Security Measure Group, RMI ID, Content (formula)'),
          h('li', h('b', 'Risk mitigations individual'), ' — RMI ID, Mitigation item, Groups (formula), Assigned (formula), Extended Description, Comment, Responsible, Removed')),
        h('p.muted.small', 'Header rows are located automatically by their column names, so the tables may start in any row or column. Other sheets are ignored.'))));
}
function issueCounters() {
  return h('div.counters', Object.keys(ISSUE_CATS).map((c) => h('button.counter.cat-' + c + (M.stats.cats[c] ? '' : '.zero'), {
    type: 'button', tip: M.stats.cats[c] + ' ' + ISSUE_CATS[c].plural.toLowerCase() + ' — open the list', onclick: () => { state.ui.issues.cats = new Set([c]); go('issues', true); },
  }, icon(ISSUE_CATS[c].icon, 14), h('b', M.stats.cats[c]))));
}
function renderApp() {
  const app = document.getElementById('app');
  clear(app);
  if (!M) { app.append(welcome()); return; }
  app.append(
    h('header.topbar',
      h('button.brand', { type: 'button', onclick: () => go('overview'), tip: 'Overview' }, logo(22), h('span', 'Risk Register Explorer')),
      h('button.filechip', { type: 'button', onclick: showWorkbookInfo, tip: 'Workbook details: sheets used, time read' }, icon('file', 14), h('span.fname', M.file.name), h('span.muted', 'saved ' + fmtTime(new Date(M.file.lastModified)))),
      h('button.btn.ghost', { type: 'button', id: 'reload-btn', onclick: reloadFile, tip: 'Read the workbook again from disk' }, icon('reload', 14), 'Reload'),
      h('button.btn.ghost', { type: 'button', onclick: pickFile, tip: 'Open another workbook' }, icon('folder', 14), 'Open…'),
      writeButton(),
      searchWidget(), h('span.spacer'),
      issueCounters(),
      h('button.icon-btn', { type: 'button', tip: 'Method, scales and conventions', onclick: showMethod }, icon('info', 16)),
      themeButton()),
    h('div.layout',
      h('nav.sidebar', { 'aria-label': 'Views' }, NAV.map((n) => h('a.nav-i', { href: '#/' + n.key, data: { view: n.key } }, icon(n.icon, 16), h('span', n.label), n.count ? h('span.count', n.count()) : null)),
        h('div.sidebar-foot', icon('offline', 12), write.on ? 'Local · write mode on' : 'Local · read-only')),
      h('main', { id: 'main', tabindex: '-1' })),
    h('div', { id: 'drawer' }));
  showView();
}
function showView() {
  if (!M) return;
  const key = (location.hash.replace(/^#\/?/, '') || 'overview').split('?')[0];
  state.view = VIEWS[key] ? key : 'overview';
  const main = document.getElementById('main');
  fill(main, VIEWS[state.view]());
  const head = main.querySelector('.view-head');
  if (head && (EXPORTS[state.view] || ADDERS[state.view])) add(head.querySelector('.view-head-r') || head.appendChild(h('div.view-head-r')), addButton(state.view), EXPORTS[state.view] ? exportButton(state.view) : null);
  main.scrollTop = 0;
  document.querySelectorAll('.nav-i').forEach((a) => a.classList.toggle('on', a.dataset.view === state.view));
  document.title = NAV.find((n) => n.key === state.view).label + ' · Risk Register Explorer';
}
function go(view, force) {
  if (location.hash !== '#/' + view) location.hash = '#/' + view;
  else showView();
}

window.addEventListener('hashchange', showView);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.drawer.length && !document.querySelector('dialog[open]')) closeDrawer();
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { const s = document.getElementById('global-search'); if (s) { e.preventDefault(); s.focus(); } }
});
initTheme();
initTooltip();
initFileHandling();
renderApp();
