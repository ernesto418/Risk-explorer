/* ---------------------------------------------------------------------------
 * 07x-history.js — READ-ONLY view of the repository history: the change logs
 * written with each baseline, a free comparison of any two baselines (or a
 * baseline with the current workbook), and the change history of one object.
 * Nothing in this file writes to disk.
 * ------------------------------------------------------------------------- */
const hist = { dir: null, logs: [], baselines: [], loaded: false, tab: 'logs', from: '', to: '' };
const CURRENT = '(current workbook)';
ICONS.history = ['M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4z', 'M8 4.6V8l2.4 1.6'];
function histDir() { return write.dir || hist.dir; }
async function subDir(name) { try { return await histDir().getDirectoryHandle(name); } catch (e) { return null; } }
async function loadHistory() {
  const logs = [], b = await subDir(BASE_DIR), l = await subDir(LOG_DIR);
  hist.baselines = b ? await listFiles(b, /\.(xlsx|xlsm)$/i) : [];
  if (l) for (const n of await listFiles(l, /\.json$/i)) {
    try {
      const j = JSON.parse(await (await (await l.getFileHandle(n)).getFile()).text());
      if (j && Array.isArray(j.changes)) { j.file = n; logs.push(j); } // baseline header: changes since the previous baseline
      if (j && j.schema === 2 && Array.isArray(j.entries)) { // one log per baseline: every save made after it
        for (const e of j.entries) logs.push({ file: n, createdAt: e.at, author: e.author, changes: e.changes || [], summary: e.summary, baseline: { file: 'saved in the tool · ' + plural((e.cells || []).length, 'cell') + ' changed' }, previousBaseline: null, saved: true });
      }
    } catch (e) { /* not a change log */ }
  }
  hist.logs = logs.sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)));
  hist.loaded = true;
}
async function versionSnapshot(name) {
  if (name === CURRENT) return snapshot(M);
  const d = await subDir(BASE_DIR);
  return snapshot(buildModel(await readWorkbook(await (await (await d.getFileHandle(name)).getFile()).arrayBuffer()), { name }));
}
const valText = (v) => (v == null || v === '' ? '—' : String(v));
function summaryText(s) {
  return Object.keys(s || {}).map((t) => { const x = s[t]; return (x.added || x.removed || x.modified) ? (TYPES[t] ? TYPES[t].plural : t) + ': ' + x.added + ' added, ' + x.removed + ' removed, ' + x.modified + ' modified' : null; }).filter(Boolean).join(' · ') || 'no object changes';
}
/** One changed object: what was added / removed / modified (field: old → new, mitigation lines + / −). */
function changeRow(c) {
  const o = M && M.by[c.type] ? M.by[c.type].get(c.id) : null;
  const v = c.value || {};
  return h('div.chg',
    h('div.chg-head', o ? chip(o) : h('span.chip.plain', (TYPES[c.type] ? TYPES[c.type].label + ' ' : '') + c.id), h('span.tag.chg-' + c.change, c.change),
      c.change !== 'modified' ? h('span.muted.small', truncate(v.description || v.name || v.title || '', 140)) : null),
    Object.keys(c.fields || {}).length ? h('table.chg-t', h('tbody', Object.keys(c.fields).map((k) => h('tr', h('th', k), h('td.chg-from', valText(c.fields[k].from)), h('td', icon('arrow', 11)), h('td.chg-to', valText(c.fields[k].to)))))) : null,
    (c.linesAdded || []).map((ln) => h('div.chg-line.add', '+ ' + ln)), (c.linesRemoved || []).map((ln) => h('div.chg-line.del', '− ' + ln)));
}
/** Section for the side panel: every recorded change of this object, newest first. */
function historySection(o) {
  if (!hist.logs.length || !['risk', 'threat', 'assumption', 'group', 'rmi'].includes(o.type)) return null;
  const rows = [];
  for (const log of hist.logs) for (const c of log.changes) if (c.type === o.type && c.id === o.id) rows.push(h('div.chg-entry', h('div.muted.small', fmtTime(new Date(log.createdAt)) + ' · ' + (log.author || 'unknown') + ' · ' + (log.baseline ? log.baseline.file : '')), changeRow(c)));
  return section('Change history', rows.length ? rows.reverse() : h('div.muted.small', 'No change recorded in ' + plural(hist.logs.length, 'change log') + '.'), { count: rows.length, open: rows.length > 0 });
}
VIEWS.history = function () {
  const body = h('div.list'), controls = h('div.controls');
  let run = 0;
  const pick = async () => {
    try { hist.dir = await window.showDirectoryPicker({ mode: 'read' }); hist.loaded = false; draw(); }
    catch (e) { if (!e || e.name !== 'AbortError') toast('Folder could not be opened: ' + (e && e.message ? e.message : e), 'error'); }
  };
  const draw = async () => {
    const me = ++run;
    fill(controls); fill(body);
    if (!histDir()) {
      add(body, emptyState('Choose the repository folder to read its baselines and change logs', window.showDirectoryPicker ? 'Read access only — viewing the history never writes anything.' : 'This needs a browser with folder access (current Edge or Chrome).'),
        window.showDirectoryPicker ? h('button.btn.primary', { type: 'button', id: 'hist-pick', onclick: pick }, icon('folder', 14), 'Choose repository folder…') : null);
      return;
    }
    if (!hist.loaded) { add(body, h('div.muted', 'Reading history…')); await loadHistory(); if (me !== run) return; fill(body); }
    const names = hist.baselines.concat(CURRENT), opts = names.map((n) => ({ value: n, label: n }));
    if (!names.includes(hist.to)) hist.to = CURRENT;
    if (!names.includes(hist.from)) hist.from = hist.baselines[hist.baselines.length - 1] || CURRENT;
    add(controls, segmented([{ value: 'logs', label: 'Change logs', icon: 'history' }, { value: 'compare', label: 'Compare baselines', icon: 'matrix' }], hist.tab, (v) => { hist.tab = v; draw(); }, 'History view'),
      hist.tab === 'compare' ? [selectBox('From', opts, hist.from, (v) => { hist.from = v; draw(); }, true), selectBox('To', opts, hist.to, (v) => { hist.to = v; draw(); }, true)] : null,
      h('div.ctl.grow'), h('span.muted.small', 'Folder “' + histDir().name + '” · ' + plural(hist.baselines.length, 'baseline') + ' · ' + plural(hist.logs.length, 'change log')),
      h('button.btn.ghost.sm', { type: 'button', onclick: () => { hist.loaded = false; draw(); } }, icon('reload', 12), 'Refresh'));
    if (hist.tab === 'logs') {
      if (!hist.logs.length) { add(body, emptyState('No change logs yet', 'Create a baseline in write mode to start the history.')); return; }
      hist.logs.slice().reverse().forEach((log, i) => add(body, h('details.card.igroup.hlog', { open: i === 0 },
        h('summary', icon('chevron', 12), h('span.igroup-t.strong', fmtTime(new Date(log.createdAt))), h('span.tag', log.author || 'unknown'), h('span.count', log.changes.length),
          h('span.igroup-t', log.initial ? 'first baseline' : summaryText(log.summary)), h('span.igroup-s', (log.baseline ? log.baseline.file : '') + (log.previousBaseline ? '   ←   ' + log.previousBaseline.file : ''))),
        h('div.sec-b.issues', log.changes.length ? log.changes.map(changeRow) : h('div.muted.small', log.initial ? 'Initial baseline — nothing to compare with.' : 'No object-level changes.')))));
      return;
    }
    if (!hist.baselines.length) { add(body, emptyState('No baseline to compare yet')); return; }
    try {
      const d = diffSnapshots(await versionSnapshot(hist.from), await versionSnapshot(hist.to));
      hist.cmp = { from: hist.from, to: hist.to, d };
      if (me !== run) return;
      add(body, h('div.list-info', { id: 'cmp-info' }, plural(d.changes.length, 'changed object') + ' from “' + hist.from + '” to “' + hist.to + '” — ' + summaryText(d.summary)), d.changes.length ? d.changes.map(changeRow) : emptyState('No differences between the two versions'));
    } catch (e) { add(body, emptyState('The version could not be read', e && e.message)); }
  };
  draw();
  return h('div.view', viewHead('History', 'What changed between baselines. “Change logs” shows the log written with each baseline; “Compare baselines” compares any two baselines, or a baseline with the workbook as it is now. Open any object to see its own change history.'), controls, body);
};
