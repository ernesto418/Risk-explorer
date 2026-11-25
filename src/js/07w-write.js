/* ---------------------------------------------------------------------------
 * 07w-write.js — OPTIONAL write mode (off by default).
 * The only things ever written are, inside a repository folder the user picks:
 *   baselines/    exact copies of the workbook (.xlsx) at a point in time
 *   change-logs/  one JSON per baseline: who, when, and what changed since
 *                 the previous baseline (object-level diff)
 * The workbook itself is never modified.
 * ------------------------------------------------------------------------- */
const write = { on: false, author: '', dir: null, busy: false };
const BASE_DIR = 'baselines', LOG_DIR = 'change-logs';
ICONS.pen = ['M3 13l.6-3.1L10.9 2.6l2.5 2.5L6.1 12.4z', 'M9.4 4.1l2.5 2.5'];

/** Plain, comparable picture of a model: one record per object, keyed by ID. */
function snapshot(m) {
  const obj = (list, fn) => { const o = {}; for (const x of list) o[x.id] = fn(x); return o; };
  /* the RMI IDs as written in the cell, including those of removed items (which are not linked) */
  const ids = (o) => o.items.concat(o.removedRefs || []).sort((a, b) => a.line - b.line).map((x) => x.rmi.id);
  return {
    risk: obj(m.risks, (r) => ({ threat: r.threat ? r.threat.id : '', description: r.description, component: r.componentRaw, coreValues: r.coreValues.join(', '),
      assumptions: r.assumptionRefs.map((a) => a.id).join(', '), frequency: r.freqRaw, effects: r.effectRaw, riskIndex: r.index, treatmentCategory: r.categoryRaw,
      frequencyAfter: r.freqAfterRaw, effectsAfter: r.effectAfterRaw, riskIndexAfter: r.indexAfter, reduction: r.reduction, saveDescription: r.save, relevance: r.relevanceRaw, rmis: ids(r) })),
    threat: obj(m.threats, (t) => ({ name: t.name })),
    assumption: obj(m.assumptions, (a) => ({ title: a.title, description: a.description, components: a.componentsRaw, validityAlpha: a.validityAlpha, validityBeta: a.validityBeta, comment: a.comment })),
    rmi: obj((m.allRmis || m.rmis).filter((x) => x.base && !/#row/.test(x.key)), (x) => ({ text: x.text, extendedDescription: x.extDescription, comment: x.comment, responsible: x.responsible, removed: x.removedRaw || '' })),
    group: obj(m.groups, (g) => ({ name: g.name, treatment: g.treatment, rmis: ids(g) })),
  };
}
/** Object-level diff of two snapshots (a may be null for the first baseline). */
function diffSnapshots(a, b) {
  const changes = [], summary = {};
  for (const type of Object.keys(b)) {
    const A = a ? a[type] : null, B = b[type], s = summary[type] = { total: Object.keys(B).length, added: 0, removed: 0, modified: 0 };
    if (!A) continue;
    for (const id of Object.keys(B)) {
      if (!(id in A)) { s.added++; changes.push({ type, id, change: 'added', value: B[id] }); continue; }
      const fields = {}; let linesAdded, linesRemoved;
      for (const k of Object.keys(B[id])) {
        const x = A[id][k], y = B[id][k];
        if (Array.isArray(y)) { const xa = Array.isArray(x) ? x : [], la = y.filter((l) => !xa.includes(l)), lr = xa.filter((l) => !y.includes(l)); if (la.length) linesAdded = la; if (lr.length) linesRemoved = lr; }
        else if ((x == null ? '' : x) !== (y == null ? '' : y)) fields[k] = { from: x == null ? null : x, to: y == null ? null : y };
      }
      if (Object.keys(fields).length || linesAdded || linesRemoved) { s.modified++; changes.push({ type, id, change: 'modified', fields, linesAdded, linesRemoved }); }
    }
    for (const id of Object.keys(A)) if (!(id in B)) { s.removed++; changes.push({ type, id, change: 'removed', value: A[id] }); }
  }
  return { summary, changes };
}
async function sha256(buf) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function listFiles(dir, rx) { const out = []; for await (const [name, hnd] of dir.entries()) if (hnd.kind === 'file' && rx.test(name)) out.push(name); return out.sort(); }
/** The ONLY function that writes to disk. Guards against modifying anything by mistake: write mode must be on,
    the target is one of two fixed sub-folders, the file name must be a freshly generated one, it can never be the
    workbook, an existing file is never overwritten, and the written bytes are read back and verified. */
const SAFE_NAME = { [BASE_DIR]: /^\d{4}-\d{2}-\d{2}_\d{6}_[\w.-]{1,80}\.(xlsx|xlsm)$/, [LOG_DIR]: /^\d{4}-\d{2}-\d{2}_\d{6}_[\w.-]{1,60}\.json$/ };
async function safeWrite(kind, name, data) {
  if (!write.on || !write.dir) throw new Error('refused: write mode is off');
  if (!SAFE_NAME[kind] || !SAFE_NAME[kind].test(name) || name.includes('..')) throw new Error('refused: unexpected target ' + kind + '/' + name);
  if (state.file && name === state.file.name) throw new Error('refused: target has the name of the workbook');
  const dir = await write.dir.getDirectoryHandle(kind, { create: true });
  let exists = true;
  try { await dir.getFileHandle(name); } catch (e) { exists = false; }
  if (exists) throw new Error('refused: ' + kind + '/' + name + ' already exists — existing files are never overwritten');
  const fh = await dir.getFileHandle(name, { create: true });
  await rawWrite(fh, data);
}
/** Low-level write + read-back check. Every disk write of the tool goes through here (called only by the guarded
    functions safeWrite, safeAppendLog and writeWorkbookFile). */
async function rawWrite(fh, data) {
  const w = await fh.createWritable({ keepExistingData: false }); await w.write(data); await w.close();
  const src = typeof data === 'string' ? new TextEncoder().encode(data).buffer : data;
  if (await sha256(await (await fh.getFile()).arrayBuffer()) !== await sha256(src)) throw new Error('verification failed for ' + fh.name);
}
/** Appends entries to the CURRENT change log (the newest one, started by the last baseline). Refuses unless the file is
    exactly as read and the new content only adds entries — nothing already logged can change. */
async function safeAppendLog(name, oldText, newObj) {
  if (!write.on || !write.dir) throw new Error('refused: write mode is off');
  if (!SAFE_NAME[LOG_DIR].test(name)) throw new Error('refused: unexpected log name ' + name);
  const fh = await (await write.dir.getDirectoryHandle(LOG_DIR)).getFileHandle(name);
  const now = await (await fh.getFile()).text();
  if (now !== oldText) throw new Error('refused: ' + LOG_DIR + '/' + name + ' changed since it was read');
  const old = JSON.parse(oldText);
  if (old.schema !== 2) throw new Error('refused: ' + name + ' is not a change log of this tool');
  if (JSON.stringify(newObj.entries.slice(0, old.entries.length)) !== JSON.stringify(old.entries)) throw new Error('refused: existing log entries would change');
  for (const k of Object.keys(old)) if (k !== 'entries' && JSON.stringify(old[k]) !== JSON.stringify(newObj[k])) throw new Error('refused: log header would change');
  await rawWrite(fh, JSON.stringify(newObj, null, 2));
}
/** The only way the WORKBOOK can be written: edit mode on, the handle the workbook was opened from, the file on disk
    still byte-identical to what was loaded, new bytes already verified by the caller. */
async function writeWorkbookFile(handle, bytes) {
  if (!write.on || !write.dir) throw new Error('refused: write mode is off');
  if (!handle || handle.kind !== 'file' || handle.name !== M.file.name) throw new Error('refused: not the opened workbook');
  if (handle.requestPermission && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('permission to save the workbook was not granted');
  const disk = await (await handle.getFile()).arrayBuffer();
  if (await sha256(disk) !== state.hash) throw new Error('refused: the workbook on disk changed since it was loaded — reload it first');
  try { await rawWrite(handle, bytes); }
  catch (e) {
    try { if (await sha256(await (await handle.getFile()).arrayBuffer()) !== state.hash) await rawWrite(handle, disk); } catch (e2) { /* restore failed */ }
    throw new Error((e && e.message ? e.message : e) + ' — if the workbook is open in Excel, close it and try again');
  }
}
async function openLog() {
  let ldir = null;
  try { ldir = await write.dir.getDirectoryHandle(LOG_DIR); } catch (e) { return null; }
  const n = (await listFiles(ldir, /\.json$/i)).pop(); // the newest log is the current one
  if (!n) return null;
  try { const text = await (await (await ldir.getFileHandle(n)).getFile()).text(), j = JSON.parse(text); if (j.schema === 2 && Array.isArray(j.entries)) return { name: n, text, j }; } catch (e) { /* not a log */ }
  return null;
}
/** Every save from the tool is appended to the current log (started by the last baseline, or here if there is none). */
async function appendSaveLog(entry) {
  const cur = await openLog();
  if (cur) { await safeAppendLog(cur.name, cur.text, { ...cur.j, entries: cur.j.entries.concat(entry) }); return LOG_DIR + '/' + cur.name; }
  let bdir = null; try { bdir = await write.dir.getDirectoryHandle(BASE_DIR); } catch (e) { /* none */ }
  const prev = bdir ? (await listFiles(bdir, /\.(xlsx|xlsm)$/i)).pop() : null;
  const name = stamp(new Date()) + '_' + slug(write.author) + '.json';
  await safeWrite(LOG_DIR, name, JSON.stringify({ tool: 'Risk Register Explorer', schema: 2, opened: entry.at, openedBy: write.author, workbook: M.file.name, previousBaseline: prev ? BASE_DIR + '/' + prev : null, entries: [entry] }, null, 2));
  return LOG_DIR + '/' + name;
}
function stamp(d) { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
const slug = (s) => s.trim().replace(/[^\w.-]+/g, '_').slice(0, 40) || 'unknown';

/** Copies the workbook into baselines/ and writes the change log against the previous baseline. */
async function createBaseline() {
  if (!write.on || write.busy || !M) return null;
  write.busy = true;
  try {
    const file = state.handle ? await state.handle.getFile() : state.file;
    const buf = await file.arrayBuffer(), hash = await sha256(buf);
    const model = buildModel(await readWorkbook(buf), { name: file.name, size: file.size, lastModified: file.lastModified, loadedAt: Date.now() });
    let bdir = null;
    try { bdir = await write.dir.getDirectoryHandle(BASE_DIR); } catch (e) { /* no baseline yet */ }
    const prevName = bdir ? (await listFiles(bdir, /\.(xlsx|xlsm)$/i)).pop() || null : null;
    let prev = null;
    if (prevName) {
      const pb = await (await (await bdir.getFileHandle(prevName)).getFile()).arrayBuffer(), ph = await sha256(pb);
      if (ph === hash) { toast('No baseline created: the workbook is identical to the latest baseline (' + prevName + ').'); return null; }
      prev = { file: BASE_DIR + '/' + prevName, sha256: ph, snap: snapshot(buildModel(await readWorkbook(pb), { name: prevName })) };
    }
    const now = new Date(), st = stamp(now), ext = (/\.(xlsx|xlsm)$/i.exec(file.name) || ['.xlsx'])[0].toLowerCase();
    const baseName = st + '_' + slug(file.name.replace(/\.(xlsx|xlsm)$/i, '')) + ext, logName = st + '_' + slug(write.author) + '.json';
    await safeWrite(BASE_DIR, baseName, buf); // byte-identical copy, stays a normal Excel file
    const d = diffSnapshots(prev ? prev.snap : null, snapshot(model));
    const log = {
      tool: 'Risk Register Explorer', schema: 2, author: write.author, createdAt: now.toISOString(),
      workbook: { name: file.name, savedAt: new Date(file.lastModified).toISOString(), sha256: hash },
      baseline: { file: BASE_DIR + '/' + baseName, sha256: hash },
      previousBaseline: prev ? { file: prev.file, sha256: prev.sha256 } : null,
      initial: !prev, findings: model.stats.cats, summary: d.summary, changes: d.changes,
      entries: [], // every save from the tool until the next baseline is appended here
    };
    await safeWrite(LOG_DIR, logName, JSON.stringify(log, null, 2)); // a new log file per baseline; earlier logs are never touched
    hist.loaded = false; loadHistory().catch(() => {});
    toast('Baseline saved: ' + BASE_DIR + '/' + baseName + ' · change log: ' + LOG_DIR + '/' + logName + (prev ? ' (' + plural(d.changes.length, 'changed object') + ')' : ' (first baseline)') + '.');
    return log;
  } catch (e) { toast('Baseline could not be written: ' + (e && e.message ? e.message : e), 'error'); return null; } finally { write.busy = false; }
}

function writeButton() {
  return h('button.btn' + (write.on ? '.write-on' : '.ghost'), { type: 'button', id: 'write-btn', onclick: writeDialog,
    tip: write.on ? 'Write mode is ON for ' + write.author + ' — baselines and change logs' : 'Read-only. Click to turn on write mode (baselines and change logs).' },
    icon(write.on ? 'pen' : 'lock', 14), write.on ? 'Write: ' + truncate(write.author, 18) : 'Read-only');
}
function writeDialog() {
  const closeDlg = () => { const d = document.querySelector('dialog[open]'); if (d) d.close(); };
  if (!window.showDirectoryPicker) { toast('Write mode needs a browser with folder access (current Edge or Chrome).', 'error'); return; }
  if (!write.on) {
    const name = h('input', { type: 'text', id: 'write-name', placeholder: 'Your name', value: write.author, maxlength: '80', autocomplete: 'off' });
    const enable = async () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      try {
        const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        write.author = n; write.dir = dir; write.on = true; hist.loaded = false; loadHistory().catch(() => {});
        closeDlg(); renderApp();
        toast('Write mode on for ' + n + '. Folder: ' + dir.name + '. The workbook itself is never modified.');
      } catch (e) { if (!e || e.name !== 'AbortError') toast('Folder access was not granted: ' + (e && e.message ? e.message : e), 'error'); }
    };
    openDialog('Turn on write mode', h('div',
      h('p', 'Write mode lets the tool save two things into the repository folder that holds the workbook: baseline copies of the workbook in “' + BASE_DIR + '/” (Excel format) and a JSON change log per baseline in “' + LOG_DIR + '/”. The workbook itself is never modified.'),
      h('label.fieldbox', 'Your name — recorded as author in every change log', name),
      h('div.dialog-actions', h('button.btn', { type: 'button', onclick: closeDlg }, 'Cancel'), h('button.btn.primary', { type: 'button', id: 'write-enable', onclick: enable }, icon('folder', 14), 'Choose repository folder…'))));
    return;
  }
  const list = h('div.muted.small', 'Reading baselines…');
  (async () => {
    try {
      let bd = null; try { bd = await write.dir.getDirectoryHandle(BASE_DIR); } catch (e) { /* none yet */ }
      const names = bd ? await listFiles(bd, /\.(xlsx|xlsm)$/i) : [];
      fill(list, names.length ? h('ul.variants', names.slice(-8).reverse().map((n) => h('li', h('code.excerpt', BASE_DIR + '/' + n)))) : 'No baseline yet.');
    } catch (e) { fill(list, 'Baselines could not be listed.'); }
  })();
  openDialog('Write mode', h('div',
    h('div.fields', field('Author', write.author), field('Repository folder', write.dir.name), field('Workbook', M ? M.file.name : null)),
    h('h3', 'Latest baselines'), list,
    h('p.note', icon('info', 12), 'A baseline is an exact copy of the workbook as saved on disk. Its change log lists every risk, threat, assumption and group that was added, removed or modified since the previous baseline.'),
    h('div.dialog-actions',
      h('button.btn', { type: 'button', id: 'write-off', onclick: () => { write.on = false; write.dir = null; hist.loaded = false; closeDlg(); renderApp(); toast('Write mode off. The tool is read-only again.'); } }, icon('lock', 14), 'Turn off write mode'),
      h('button.btn.primary', { type: 'button', id: 'write-baseline', onclick: async () => { closeDlg(); await createBaseline(); } }, icon('pen', 14), 'Create baseline now'))));
}
