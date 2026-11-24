#!/usr/bin/env node
/* Applies and validates the automated tests of Risk Register Explorer.
   Usage:  node tests/run.cjs        (Node 18+, Playwright with Chromium: npm i -D playwright)
   Output: PASS/FAIL per test, tests/results/report.json and report.md, exit code 1 if anything fails.
   The tests only use the fictional fixtures in tests/fixtures and a private in-browser folder (OPFS):
   no real workbook or repository folder is ever touched. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), fx = (n) => path.join(__dirname, 'fixtures', n);
const DIST = path.join(ROOT, 'dist', 'risk-register-explorer.html'), TEST = path.join(ROOT, 'dist', 'risk-register-explorer.test.html');
const results = [];
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), m + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
async function test(id, name, fn) {
  const t0 = Date.now(); let ok = true, note = '';
  try { note = (await fn()) || ''; } catch (e) { ok = false; note = String((e && e.message) || e).split('\n')[0]; }
  results.push({ id, name, ok, note, ms: Date.now() - t0 });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + id.padEnd(4) + name + (ok ? '' : '\n        -> ' + note));
}
/* Runs inside every page before the app: records every file-system write, CSP violation, and offers a private test folder. */
const INIT = () => {
  window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  const spy = window.__spy = { writes: [], creates: [], removes: [], paused: false };
  if (typeof FileSystemFileHandle !== 'undefined') {
    const P = FileSystemFileHandle.prototype, D = FileSystemDirectoryHandle.prototype, cw = P.createWritable, gf = D.getFileHandle, re = D.removeEntry;
    P.createWritable = function (...a) { if (!spy.paused) spy.writes.push(this.name); return cw.apply(this, a); };
    D.getFileHandle = function (n, o) { if (!spy.paused && o && o.create) spy.creates.push(n); return gf.call(this, n, o); };
    D.removeEntry = function (...a) { if (!spy.paused) spy.removes.push(String(a[0])); return re.apply(this, a); };
  }
  const root = () => navigator.storage.getDirectory();
  window.__t = {
    async clear() { spy.paused = true; const r = await root(); const names = []; for await (const [n] of r.entries()) names.push(n); for (const n of names) await r.removeEntry(n, { recursive: true }); spy.paused = false; },
    async put(name, b64) { spy.paused = true; const fh = await (await root()).getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); await w.close(); spy.paused = false; },
    async tree() { const out = {}; const walk = async (dir, pre) => { for await (const [n, hd] of dir.entries()) { if (hd.kind === 'directory') await walk(hd, pre + n + '/'); else { const d = await crypto.subtle.digest('SHA-256', await (await hd.getFile()).arrayBuffer()); out[pre + n] = [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join(''); } } }; await walk(await root(), ''); return out; },
    async get(p) { const parts = p.split('/'); let d = await root(); for (const s of parts.slice(0, -1)) d = await d.getDirectoryHandle(s); const b = new Uint8Array(await (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).arrayBuffer()); let x = ''; for (const c of b) x += String.fromCharCode(c); return btoa(x); },
    async read(p) { const parts = p.split('/'); let d = await root(); for (const s of parts.slice(0, -1)) d = await d.getDirectoryHandle(s); return (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).text(); },
  };
  window.showOpenFilePicker = async () => [await (await root()).getFileHandle('workbook.xlsx')];
  window.showDirectoryPicker = async () => root();
};
const VIEWS = ['overview', 'matrix', 'risks', 'threats', 'mitigations', 'assumptions', 'components', 'connections', 'history', 'issues'];
const nav = async (page, v) => { await page.evaluate((x) => { location.hash = '#/' + x; }, v); await page.waitForTimeout(150); };
const load = async (page, url, file) => { await page.goto(url); await page.setInputFiles('#file-input', file); await page.waitForSelector('.topbar', { timeout: 8000 }); };

(async () => {
  execFileSync('node', ['build.mjs'], { cwd: ROOT }); execFileSync('node', ['build.mjs', '--test'], { cwd: ROOT });
  const src = fs.readdirSync(path.join(ROOT, 'src/js')).filter((f) => f.endsWith('.js')).map((f) => ({ f, s: fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8') }));

  /* ---------- static guarantees ---------- */
  await test('S1', 'Source: no network, HTML-injection, delete or save-as APIs anywhere', () => {
    const bad = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|new Function|document\.write|removeEntry|showSaveFilePicker|\.move\s*\(/;
    for (const { f, s } of src) { const m = bad.exec(s); assert(!m, f + ' contains forbidden API “' + (m && m[0]) + '”'); }
  });
  await test('S2', 'Source: disk writes exist only inside safeWrite() in 07w-write.js', () => {
    for (const { f, s } of src) {
      const n = (s.match(/createWritable/g) || []).length, c = (s.match(/getFileHandle\([^)]*create:\s*true/g) || []).length, rw = (s.match(/readwrite/g) || []).length;
      if (f === '07w-write.js') { eq([n, c, rw], [1, 1, 2], 'write API occurrences in ' + f); const rw2 = s.slice(s.indexOf('async function rawWrite'), s.indexOf('async function safeAppendLog')); assert(rw2.includes('createWritable'), 'createWritable is not inside rawWrite');
        const callers = s.split(/\n(?=(?:async )?function )/).filter((c) => /await rawWrite\(/.test(c)).map((c) => /function (\w+)/.exec(c)[1]).sort(); eq(callers, ['safeAppendLog', 'safeWrite', 'writeWorkbookFile'], 'functions that call rawWrite'); }
      else { eq([n, c, rw], [0, 0, 0], 'write API occurrences in ' + f); assert(!/rawWrite\(/.test(s), f + ' calls rawWrite'); assert(f === '07z-edit.js' || !/writeWorkbookFile\(/.test(s), f + ' writes the workbook'); }
    }
  });
  await test('S3', 'Build: Content-Security-Policy blocks all network access and pins script and style by hash', () => {
    const html = fs.readFileSync(DIST, 'utf8'), csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
    for (const d of ["default-src 'none'", "connect-src 'none'", "object-src 'none'", "form-action 'none'"]) assert(csp.includes(d), 'CSP lacks ' + d);
    const h64 = (s) => "'sha256-" + crypto.createHash('sha256').update(s, 'utf8').digest('base64') + "'";
    assert(csp.includes(h64(/<script>([\s\S]*)<\/script>/.exec(html)[1])), 'script hash not in CSP'); assert(csp.includes(h64(/<style>([\s\S]*?)<\/style>/.exec(html)[1])), 'style hash not in CSP');
    assert(!/unsafe-inline|unsafe-eval|https?:/.test(csp), 'CSP allows inline/eval/remote sources'); assert(!/<script[^>]+src=|<link[^>]+href="(?!data:)/.test(html), 'external resource referenced');
  });

  const browser = await chromium.launch();
  const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(TEST)); });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const URL_T = 'http://127.0.0.1:' + server.address().port + '/', FILE_D = 'file://' + DIST, FILE_T = 'file://' + TEST;
  const newPage = async () => { const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); await ctx.addInitScript(INIT); const page = await ctx.newPage(); page.errors = []; page.reqs = []; page.on('pageerror', (e) => page.errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); }); page.on('request', (r) => page.reqs.push(r.url())); return page; };

  /* ---------- read-only behaviour of the shipped file ---------- */
  let page = await newPage();
  await test('S4', 'Read-only session (shipped file): no disk write, no network request, no script error', async () => {
    await load(page, FILE_D, fx('sample.xlsx'));
    for (const v of VIEWS) { await nav(page, v); const c = page.locator('.obj-head').first(); if (await c.count()) { await c.click(); const k = page.locator('.obj-body .chip').first(); if (await k.count()) { await k.click(); await page.keyboard.press('Escape'); } } }
    const st = await page.evaluate(() => ({ spy: window.__spy, csp: window.__csp, ls: Object.keys(localStorage) }));
    eq([st.spy.writes, st.spy.creates, st.spy.removes], [[], [], []], 'file-system writes in read-only mode'); eq(st.csp, [], 'CSP violations');
    assert(st.ls.every((k) => k === 'rre-theme'), 'unexpected localStorage keys ' + st.ls); eq(page.reqs.filter((u) => !u.startsWith('file://')), [], 'non-local requests'); eq(page.errors, [], 'script errors');
  });
  await test('S5', 'Markup inside cells is displayed as text and never executed', async () => {
    await load(page, FILE_D, fx('xss.xlsx'));
    for (const v of VIEWS) await nav(page, v);
    await nav(page, 'risks'); await page.locator('.obj-head').first().click();
    const r = await page.evaluate(() => ({ x: window.__xss, n: document.querySelectorAll('#app img, #app script, #app iframe, #app svg[onload], #app [onmouseover], #app [onerror]').length, shown: document.body.textContent.includes('<img src=x onerror') }));
    eq([r.x === undefined, r.n, r.shown], [true, 0, true], 'injection check'); eq(page.errors, [], 'script errors');
  });
  await page.context().close();

  /* ---------- functional checks (test build exposes the model) ---------- */
  page = await newPage();
  const model = () => page.evaluate(() => { const { M } = window.__rre.state(); return { n: [M.threats.length, M.risks.length, M.rmis.length, M.groups.length, M.assumptions.length, M.components.length], codes: [...new Set(M.issues.map((i) => i.code))].sort(), cats: M.stats.cats, snap: JSON.stringify(window.__rre.snapshot(M)), sheets: M.sheetReport.map((s) => s.name + ':' + (s.role || 'ignored')) }; });
  let base = null;
  await test('F1', 'Sample workbook: sheets recognised, Beta sheet ignored, object counts as expected', async () => {
    await load(page, FILE_T, fx('sample.xlsx')); base = await model();
    eq(base.n, [19, 41, 40, 9, 10, 8], 'threats/risks/items/groups/assumptions/components'); assert(base.sheets.includes('Assumed Risks Beta:ignored'), 'Beta sheet not ignored: ' + base.sheets);
  });
  await test('F2', 'Every seeded mistake of the sample is reported by its check', async () => {
    const want = ['C_ASSUMPTION_UNKNOWN', 'C_DUP_ID', 'C_INDEX', 'C_NOT_IN_GROUP', 'C_RMI_GROUPS', 'C_RMI_UNKNOWN', 'C_NO_MATCH', 'C_REDUCTION', 'C_THREAT_MISMATCH', 'F_ASSUMPTION_REF', 'F_BULLET', 'F_INTRO', 'F_VALUE', 'W_AFTER_HIGHER', 'W_DUP_LINE', 'W_MISSING', 'W_MULTI_GROUP', 'W_SIMILAR_NAME', 'W_UNUSED_ASSUMPTION', 'W_UNUSED_GROUP', 'W_UNUSED_RMI'];
    const miss = want.filter((c) => !base.codes.includes(c)); eq(miss, [], 'checks that did not fire');
    const ui = await page.evaluate(() => [...document.querySelectorAll('.counter b')].map((b) => +b.textContent)); eq(ui, [base.cats.format, base.cats.consistency, base.cats.warning], 'top-bar counters vs model');
  });
  await test('F3', 'Reader: Excel-style (rich text, CR escapes) and LibreOffice copies give the identical model', async () => {
    for (const f of ['libreoffice-copy.xlsx', 'excel-style.xlsx']) { await load(page, FILE_T, fx(f)); const m = await model(); assert(m.snap === base.snap, f + ' differs from sample.xlsx'); eq(m.cats, base.cats, f + ' findings'); }
  });
  await test('F4', 'Risk matrix: chips in the cells equal the risks of the model, risks/threats switch works', async () => {
    await load(page, FILE_T, fx('sample.xlsx')); await nav(page, 'matrix');
    const r = await page.evaluate(() => { const { M } = window.__rre.state(); return { chips: document.querySelectorAll('.mx .mchip:not(.more)').length, placed: M.risks.filter((x) => x.freq && x.effect).length }; }); eq(r.chips, r.placed, 'risk chips');
    await page.click('.seg button:has-text("Threats")'); assert(await page.locator('.mx .mchip.th').count() > 0, 'no threat chips');
  });
  await test('F5', 'Connections: hover and multi-focus follow only the links of the risk analysis', async () => {
    await nav(page, 'connections'); await page.click('.seg.multi button:has-text("Components")'); await page.waitForTimeout(200);
    await page.hover('.fnode.t-component:has-text("Edge Gateway")'); await page.waitForTimeout(150);
    const hov = await page.evaluate(() => { const { M } = window.__rre.state(); const exp = M.by.component.get('Edge Gateway').risks.map((r) => r.id).sort(); return { hl: [...document.querySelectorAll('.fnode.hl.t-risk .fnode-id')].map((x) => x.textContent).sort(), exp }; }); eq(hov.hl, hov.exp, 'highlighted risks');
    await page.click('.fnode.t-component:has-text("Edge Gateway")'); await page.waitForTimeout(500); await page.click('.fnode.t-threat >> nth=1'); await page.waitForTimeout(500);
    const foc = await page.evaluate(() => { const { M, state } = window.__rre.state(); let exp = M.risks; for (const term of state.ui.flow.focus) exp = exp.filter((r) => term.some((o) => o.risks.includes(r))); return { n: state.ui.flow.focus.flat().length, shown: [...document.querySelectorAll('.fnode.t-risk .fnode-id')].map((x) => x.textContent).sort(), exp: exp.map((r) => r.id).sort() }; }); eq([foc.n, foc.shown], [2, foc.exp], 'multi-focus risks');
  });
  await test('F7', 'Connections: Ctrl+click collects several threats, applied together on Ctrl release as OR', async () => {
    await page.click('.focusbar .btn:has-text("Show everything")'); await page.waitForTimeout(200);
    await page.keyboard.down('Control'); await page.click('.fnode.t-threat >> nth=0'); await page.click('.fnode.t-threat >> nth=1'); await page.waitForTimeout(150);
    const before = await page.evaluate(() => { const { state } = window.__rre.state(); return [state.ui.flow.focus.length, state.ui.flow.pending.length, !!document.getElementById('flow-pending')]; });
    eq(before, [0, 2, true], 'focus terms / pending / pending bar before Ctrl release');
    await page.keyboard.up('Control'); await page.waitForTimeout(250);
    const r = await page.evaluate(() => { const { M, state } = window.__rre.state(); const term = state.ui.flow.focus[0] || []; return { terms: state.ui.flow.focus.length, size: term.length, pending: state.ui.flow.pending.length,
      shown: [...document.querySelectorAll('.fnode.t-risk .fnode-id')].map((x) => x.textContent).sort(), exp: M.risks.filter((x) => term.includes(x.threat)).map((x) => x.id).sort(), threats: document.querySelectorAll('.fnode.t-threat').length }; });
    eq([r.terms, r.size, r.pending, r.threats], [1, 2, 0, 2], 'terms / objects in term / pending / threats shown'); eq(r.shown, r.exp, 'risks = union of both threats'); assert(r.exp.length > 0, 'no risks');
    await page.click('.fnode.t-component >> nth=0').catch(() => {}); await page.waitForTimeout(500);
  });
  await test('F8', 'Connections: double-click opens the details without changing the focus', async () => {
    await page.click('.focusbar .btn:has-text("Show everything")').catch(() => {}); await page.waitForTimeout(200);
    const id = await page.locator('.fnode.t-threat >> nth=2 >> .fnode-id').textContent();
    await page.dblclick('.fnode.t-threat >> nth=2'); await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({ focus: window.__rre.state().state.ui.flow.focus.length, drawer: (document.querySelector('.drawer .dr-id') || {}).textContent }));
    eq([r.focus, r.drawer], [0, id], 'focus terms / opened object'); await page.keyboard.press('Escape');
    const bb = await page.locator('.fnode.t-threat >> nth=2').boundingBox(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    await page.mouse.click(cx, cy); await page.waitForTimeout(400); await page.mouse.click(cx, cy); await page.waitForTimeout(400);
    const slow = await page.evaluate(() => ({ focus: window.__rre.state().state.ui.flow.focus.length, drawer: (document.querySelector('.drawer .dr-id') || {}).textContent }));
    eq([slow.focus, slow.drawer], [0, id], 'slow double click: focus terms / opened object'); await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    await page.click('.fnode.t-threat >> nth=2'); await page.waitForTimeout(500);
    eq(await page.evaluate(() => [window.__rre.state().state.ui.flow.focus.length, !!document.querySelector('.drawer')]), [1, false], 'single click still focuses');
  });
  await test('X1', 'Export to Excel: every module downloads a valid .xlsx; no disk write through the file-system API', async () => {
    await load(page, FILE_T, fx('sample.xlsx'));
    const dir = path.join(__dirname, 'results', 'exports'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const keys = await page.evaluate(() => Object.keys(window.__rre.EXPORTS)); const got = {};
    for (const k of keys) {
      await nav(page, k); await page.waitForTimeout(200);
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#export-btn')]);
      const file = path.join(dir, dl.suggestedFilename()); await dl.saveAs(file);
      assert(/^RRE_.+_\d{4}-\d{2}-\d{2}_\d{6}\.xlsx$/.test(dl.suggestedFilename()), 'file name ' + dl.suggestedFilename()); got[k] = file;
    }
    const check = execFileSync('python3', ['-c', 'import sys,json\nfrom openpyxl import load_workbook\nout={}\nfor p in sys.argv[1:]:\n  wb=load_workbook(p)\n  out[p]={ws.title:ws.max_row-1 for ws in wb.worksheets}\nprint(json.dumps(out))', ...Object.values(got)]).toString();
    const rows = JSON.parse(check), byKey = {}; for (const k of keys) byKey[k] = rows[got[k]];
    const exp = await page.evaluate(() => { const { M } = window.__rre.state(); return { risks: M.risks.length, threats: M.threats.length, groups: M.groups.length, rmis: M.rmis.length, assumptions: M.assumptions.length, components: M.components.length, issues: M.issues.length, links: M.stats.occ }; });
    eq([byKey.risks.Risks, byKey.risks['Risk-item links'], byKey.matrix.Positions, byKey.threats.Threats, byKey.mitigations['Mitigation groups'], byKey.mitigations['Mitigation items'], byKey.assumptions.Assumptions, byKey.components.Components, byKey.issues.Findings, byKey.connections.Paths],
      [exp.risks, exp.links, exp.risks, exp.threats, exp.groups, exp.rmis, exp.assumptions, exp.components, exp.issues, exp.risks], 'rows per sheet');
    for (const k of keys) assert(byKey[k].About === 7, k + ': About sheet');
    eq(await page.evaluate(() => [window.__spy.writes.length, window.__spy.creates.length]), [0, 0], 'file-system writes during export'); eq(page.errors, [], 'script errors');
    return keys.length + ' modules exported';
  });
  await test('F10', 'RMI IDs come from “Risk mitigations individual”; texts not there are RMI-X with one error per line; Groups/Assigned checked', async () => {
    const r = await page.evaluate(() => { const { M } = window.__rre.state(); const sh = M.wb.sheets.find((x) => x.name === 'Risk mitigations individual');
      const master = new Map(sh.rows.slice(1).filter(Boolean).map((row) => [row[1], row[0]]));
      const lines = M.risks.flatMap((r) => r.items).concat(M.groups.flatMap((g) => g.items)), unknown = lines.filter((o) => !master.has(o.text));
      return { idsOk: lines.filter((o) => master.has(o.text)).every((o) => o.rmi.id === master.get(o.text) && o.rmi.base), xOk: unknown.every((o) => o.rmi.id === 'RMI-X' && !o.rmi.base),
        nErr: M.issues.filter((i) => i.code === 'C_RMI_UNKNOWN').length, nUnknown: unknown.length, groupsErr: M.issues.filter((i) => i.code === 'C_RMI_GROUPS').map((i) => i.refs[0].id).sort(), unused: M.issues.filter((i) => i.code === 'W_UNUSED_RMI').map((i) => i.refs[0].id) }; });
    eq([r.idsOk, r.xOk, r.nErr], [true, true, r.nUnknown], 'IDs from the sheet / RMI-X / one error per unknown line'); assert(r.nUnknown > 0, 'sample should contain unknown lines');
    assert(r.groupsErr.length >= 2 && r.unused.length === 1, 'Groups/Assigned errors ' + r.groupsErr + ' / unused ' + r.unused);
  });
  await test('F9', 'Items are linked to groups only by identical Content text; every item without one is a consistency error; [ID] tags are ignored', async () => {
    const r = await page.evaluate(() => { const { M } = window.__rre.state(); const content = new Set(M.groups.flatMap((g) => g.items.map((i) => i.text)));
      const occ = M.risks.flatMap((r) => r.items), miss = occ.filter((o) => !content.has(o.text)), errs = M.issues.filter((i) => i.code === 'C_NOT_IN_GROUP');
      const wrong = occ.filter((o) => o.groups.some((g) => !g.items.some((i) => i.text === o.text))).length;
      return { n: errs.length, cats: [...new Set(errs.map((i) => i.cat))], miss: miss.length, wrong, tagged: occ.filter((o) => /\[\w+\]?\s*$/.test(o.text)).length, tagCodes: M.issues.filter((i) => /TAG|UNASSIGNED/.test(i.code)).length }; });
    eq([r.cats, r.n, r.wrong, r.tagged, r.tagCodes], [['consistency'], r.miss, 0, 0, 0], 'error category / one error per unmatched line / wrong links / tags left in text / tag checks'); assert(r.n > 0, 'sample should contain unmatched lines');
  });
  await test('F6', 'Invalid files give a clear message and leave the tool usable', async () => {
    for (const [f, rx] of [['not-a-workbook.xlsx', /not an Excel/], ['encrypted.xlsx', /encrypted|legacy/], ['other-workbook.xlsx', /no risk analysis sheet/]]) { await page.goto(FILE_T); await page.setInputFiles('#file-input', fx(f)); await page.waitForSelector('.toast.error', { timeout: 5000 }); assert(rx.test(await page.locator('.toast.error').first().textContent()), 'message for ' + f); }
    await load(page, FILE_T, fx('sample.xlsx')); eq(page.errors, [], 'script errors');
  });
  await page.context().close();

  /* ---------- write mode, baselines, change logs, history (private test folder) ---------- */
  page = await newPage();
  const T = (fn, ...a) => page.evaluate(([f, args]) => window.__t[f](...args), [fn, a]);
  const b64 = (n) => fs.readFileSync(fx(n)).toString('base64'), h0 = sha(fs.readFileSync(fx('sample.xlsx'))), h1 = sha(fs.readFileSync(fx('modified.xlsx')));
  const waitTree = async (n) => { for (let i = 0; i < 40; i++) { const t = await T('tree'); if (Object.keys(t).length === n) return t; await page.waitForTimeout(200); } return T('tree'); };
  const baseline = async () => { await page.click('#write-btn'); await page.click('#write-baseline'); };
  const spy = () => page.evaluate(() => window.__spy);
  let t1 = null, t2 = null, names = {};
  await test('W1', 'Write mode is off by default and cannot be enabled without a name', async () => {
    await page.goto(URL_T); await T('clear'); await T('put', 'workbook.xlsx', b64('sample.xlsx'));
    await page.click('.drop'); await page.waitForSelector('.topbar');
    assert(!(await page.evaluate(() => window.__rre.write.on)), 'write mode on at start'); assert((await page.textContent('#write-btn')).includes('Read-only'), 'button label');
    await page.click('#write-btn'); await page.click('#write-enable'); assert(!(await page.evaluate(() => window.__rre.write.on)), 'enabled without a name');
    await page.fill('#write-name', 'Test Author'); await page.click('#write-enable'); await page.waitForTimeout(300);
    assert(await page.evaluate(() => window.__rre.write.on), 'write mode not enabled'); eq(Object.keys(await T('tree')), ['workbook.xlsx'], 'files after enabling (nothing written yet)');
  });
  await test('W2', 'First baseline: exactly one .xlsx copy and one JSON log are created; the workbook is untouched', async () => {
    await baseline(); t1 = await waitTree(3); const keys = Object.keys(t1).sort();
    names.b1 = keys.find((k) => k.startsWith('baselines/')); names.l1 = keys.find((k) => k.startsWith('change-logs/')); assert(names.b1 && names.l1 && keys.length === 3, 'files: ' + keys);
    eq(t1['workbook.xlsx'], h0, 'workbook hash'); eq(t1[names.b1], h0, 'baseline is a byte-identical copy');
    const s = await spy(); eq(s.writes.length, 2, 'number of files written'); assert(!s.writes.includes('workbook.xlsx') && !s.creates.includes('workbook.xlsx'), 'workbook was opened for writing'); eq(s.removes, [], 'deletions');
    const log = JSON.parse(await T('read', names.l1)); eq([log.author, log.initial, log.changes.length, log.baseline.sha256], ['Test Author', true, 0, h0], 'log content');
  });
  await test('W3', 'Baseline of an unchanged workbook writes nothing', async () => { await baseline(); await page.waitForTimeout(1500); eq(await T('tree'), t1, 'folder content'); });
  await test('W4', 'Second baseline: log lists exactly the edited objects; earlier baseline and log stay byte-identical', async () => {
    await T('put', 'workbook.xlsx', b64('modified.xlsx')); await page.click('#reload-btn'); await page.waitForTimeout(700); await baseline(); t2 = await waitTree(5); const keys = Object.keys(t2);
    names.b2 = keys.filter((k) => k.startsWith('baselines/')).sort()[1]; names.l2 = keys.filter((k) => k.startsWith('change-logs/')).sort()[1]; assert(names.b2 && names.l2 && keys.length === 5, 'files: ' + keys);
    eq([t2[names.b1], t2[names.l1]], [t1[names.b1], t1[names.l1]], 'earlier files'); eq([t2['workbook.xlsx'], t2[names.b2]], [h1, h1], 'workbook and new baseline');
    const log = JSON.parse(await T('read', names.l2)); eq(log.changes.map((c) => c.type + ' ' + c.id + ' ' + c.change).sort(), ['risk R.API.1 modified', 'risk R.GW.2 modified'], 'changed objects');
    const c = log.changes.find((x) => x.id === 'R.API.1'); eq([c.fields.frequency, c.linesAdded.length, c.linesRemoved.length], [{ from: 'frequently', to: 'rarely' }, 1, 1], 'R.API.1 change'); eq(log.previousBaseline.file, names.b1, 'previous baseline');
  });
  await test('W5', 'safeWrite refuses: other folders, path tricks, the workbook name, and overwriting existing files', async () => {
    const tries = [['baselines', '../evil.xlsx'], ['baselines', 'workbook.xlsx'], ['elsewhere', '2026-01-01_000000_x.json'], ['change-logs', 'notes.json'], ['baselines', names.b1.split('/')[1]], ['change-logs', names.l1.split('/')[1]]];
    const r = await page.evaluate(async (list) => { const out = []; for (const [k, n] of list) { try { await window.__rre.safeWrite(k, n, 'overwritten'); out.push('WRITTEN ' + k + '/' + n); } catch (e) { out.push('refused'); } } return out; }, tries);
    eq(r, tries.map(() => 'refused'), 'guard results'); eq(await T('tree'), t2, 'folder content after refused writes');
  });
  await test('H1', 'History: change logs are listed newest first with the changes of each object', async () => {
    await nav(page, 'history'); await page.waitForSelector('.hlog'); eq(await page.locator('.hlog').count(), 2, 'number of logs');
    const txt = await page.locator('.hlog').first().textContent(); for (const s of ['Test Author', 'R.API.1', 'R.GW.2', 'frequently', 'rarely', 'A brand new mitigation line']) assert(txt.includes(s), 'newest log lacks “' + s + '”');
  });
  await test('H2', 'History: comparing two baselines shows the same changes; latest baseline vs current workbook shows none', async () => {
    await page.click('.seg button:has-text("Compare baselines")'); await page.waitForSelector('#cmp-info'); assert((await page.textContent('#cmp-info')).startsWith('0 changed objects'), 'latest baseline vs current workbook');
    await page.locator('.controls select').nth(0).selectOption(names.b1.split('/')[1]); await page.waitForTimeout(300); await page.locator('.controls select').nth(1).selectOption(names.b2.split('/')[1]);
    await page.waitForFunction(() => document.querySelectorAll('.view .chg').length === 2, null, { timeout: 5000 }); assert((await page.textContent('.view')).includes('rarely'), 'field change not shown');
  });
  await test('H3', 'History of one object is shown in its side panel', async () => {
    await page.fill('#global-search', 'R.API.1'); await page.click('.search-i >> nth=0'); await page.waitForSelector('.drawer');
    const d = await page.textContent('.drawer'); assert(d.includes('Change history') && d.includes('Test Author'), 'no change history in panel'); eq(await page.locator('.drawer .chg-entry').count(), 1, 'entries'); await page.keyboard.press('Escape');
  });
  await test('W6', 'Turning write mode off: no further write is possible; history stays readable (read access only)', async () => {
    await page.click('#write-btn'); await page.click('#write-off'); assert(!(await page.evaluate(() => window.__rre.write.on)), 'still on'); assert((await page.textContent('#write-btn')).includes('Read-only'), 'button label');
    const r = await page.evaluate(async () => { try { await window.__rre.safeWrite('baselines', '2030-01-01_000000_x.xlsx', 'x'); return 'WRITTEN'; } catch (e) { return 'refused'; } }); eq(r, 'refused', 'write while off');
    await nav(page, 'history'); await page.click('#hist-pick'); await page.click('.seg button:has-text("Change logs")'); await page.waitForSelector('.hlog'); eq(await page.locator('.hlog').count(), 2, 'logs in read-only history');
  });
  await test('W7', 'Whole session: 4 files written in total (2 baselines + 2 logs), nothing deleted, workbook never written', async () => {
    const s = await spy(); eq([s.writes.length, s.creates.length, s.removes.length], [4, 4, 0], 'writes/creates/deletes'); assert(!s.writes.includes('workbook.xlsx'), 'workbook written');
    eq(await T('tree'), t2, 'final folder content'); eq(page.errors, [], 'script errors'); eq(page.reqs.filter((u) => !u.startsWith(URL_T)), [], 'requests outside the local test page');
  });
  /* ---------- editing the workbook (write mode) ---------- */
  const edDir = path.join(__dirname, 'results', 'edit'); fs.rmSync(edDir, { recursive: true, force: true }); fs.mkdirSync(edDir, { recursive: true });
  let step = 0, prevFile = null;
  const snapWb = async () => { const f = path.join(edDir, (++step) + '.xlsx'); fs.writeFileSync(f, Buffer.from(await T('get', 'workbook.xlsx'), 'base64')); return f; };
  const pyDiff = (a, b) => JSON.parse(execFileSync('python3', [path.join(__dirname, 'xlsx_diff.py'), a, b]).toString());
  const openObjBy = async (q) => { await page.keyboard.press('Escape'); await page.fill('#global-search', q); await page.click('.search-i >> nth=0'); await page.waitForSelector('.drawer'); };
  const save = async () => { await page.click('#form-save'); await page.waitForSelector('#edit-confirm', { timeout: 5000 }); await page.click('#edit-confirm'); await page.waitForSelector('.toast', { timeout: 8000 }); await page.waitForTimeout(400); const t = await page.locator('.toast').last().textContent(); await page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove())); return t; };
  const modelOf = () => page.evaluate(() => { const { M } = window.__rre.state(); return M; }).catch(() => null);
  await test('E1', 'Edit a risk field: exactly that cell changes (checked independently with openpyxl); save appended to the open log', async () => {
    await page.click('#write-btn'); await page.fill('#write-name', 'Editor'); await page.click('#write-enable'); await page.waitForTimeout(300);
    prevFile = await snapWb();
    await openObjBy('R.DB.2'); await page.click('#edit-btn'); await page.fill('#f-description', 'Edited description of R.DB.2'); await page.click('#form-save'); await page.waitForSelector('#edit-confirm');
    const pv = await page.locator('.preview tbody tr').first().textContent(); assert(pv.includes('R.DB.2') && pv.includes('Risk description'), 'preview row lacks object/field: ' + pv);
    await page.click('.dialog-actions .btn:has-text("Cancel")'); await page.waitForTimeout(200); await page.click('#edit-btn'); await page.fill('#f-description', 'Edited description of R.DB.2'); const msg = await save();
    assert(/^Saved/.test(msg), msg); const cur = await snapWb(), d = pyDiff(prevFile, cur); prevFile = cur;
    eq(d.diff.map((x) => [x[0], x[3]]), [['Risik analysis Alpha', 'Edited description of R.DB.2']], 'changed cells');
    const logs = Object.keys(await T('tree')).filter((k) => k.startsWith('change-logs/')).sort(), last = JSON.parse(await T('read', logs[logs.length - 1]));
    eq([last.schema, last.closed, last.entries.length, last.entries[0].author, last.entries[0].changes.map((c) => c.id)], [2, null, 1, 'Editor', ['R.DB.2']], 'open log');
  });
  await test('E2', 'Rename a mitigation item: every identical line (risk analysis + group Content) changes, nothing else', async () => {
    const pick = await page.evaluate(() => { const { M } = window.__rre.state(); const m = M.rmis.filter((x) => x.base && x.occ.length >= 2 && x.listed.length).sort((a, b) => b.occ.length - a.occ.length)[0];
      return { id: m.id, old: m.text, cells: new Set(m.occ.map((o) => 'r' + o.risk.row).concat(m.listed.map((i) => 'g' + i.group.row))).size + 1, occ: m.occ.length }; });
    await openObjBy(pick.id); await page.click('#edit-btn'); await page.fill('#f-text', pick.old + ' (renamed)'); const m2 = await save(); assert(/^Saved/.test(m2), m2);
    const cur = await snapWb(), d = pyDiff(prevFile, cur); prevFile = cur;
    eq(d.diff.length, pick.cells, 'number of changed cells'); assert(d.diff.every((x) => String(x[3]).includes(pick.old + ' (renamed)') && String(x[3]).replace(pick.old + ' (renamed)', pick.old) === String(x[2])), 'a changed cell differs in more than the item text');
    const r = await page.evaluate((t) => { const { M } = window.__rre.state(); const m = M.rmis.find((x) => x.text === t); return m ? [m.id, m.occ.length, m.groups.length > 0] : null; }, pick.old + ' (renamed)'); eq(r, [pick.id, pick.occ, true], 'renamed item: same RMI ID / uses / still linked to its group');
  });
  await test('E3', 'Add a mitigation item: a group is mandatory; the line is added to the risk and to the group Content', async () => {
    await openObjBy('R.DB.2'); await page.click('#add-rmi-btn'); await page.fill('#f-text', 'Encrypt database volumes at rest'); await page.click('#form-save');
    assert(/required/.test(await page.textContent('.form-err')), 'saved without a group'); await page.selectOption('#f-group', 'RMG05'); await page.fill('#f-rmiId', 'RMI-001'); await page.click('#form-save');
    assert(/already exists/.test(await page.textContent('.form-err')), 'accepted an existing RMI ID'); await page.fill('#f-rmiId', 'RMI-900'); await page.click('#form-save'); await page.click('#edit-confirm'); await page.waitForSelector('.toast'); await page.waitForTimeout(400);
    const cur = await snapWb(), d = pyDiff(prevFile, cur); prevFile = cur; const two = d.diff.filter((x) => x[0] !== 'Risk mitigations individual'), ind = d.diff.filter((x) => x[0] === 'Risk mitigations individual');
    eq(two.map((x) => x[0]).sort(), ['Risik analysis Alpha', 'Risk Mitigation Groups'], 'changed cells'); eq(ind.map((x) => x[3]), ['RMI-900', 'Encrypt database volumes at rest', 'RMG05', 'Si'], 'new row in Risk mitigations individual');
    assert(two.every((x) => String(x[3]).endsWith('\n- Encrypt database volumes at rest') && String(x[3]).startsWith(String(x[2]))), 'line not appended at the end');
    const r = await page.evaluate(() => { const { M } = window.__rre.state(); const m = M.rmis.find((x) => x.text === 'Encrypt database volumes at rest'); return [m.id, m.risks.map((x) => x.id), m.groups.map((g) => g.id), m.issues.length]; });
    eq(r, ['RMI-900', ['R.DB.2'], ['RMG05'], 0], 'ID / risk / group / issues of the new item');
  });
  await test('E4', 'Add a risk: appended after the last row, formatted like the row above, index computed', async () => {
    await page.keyboard.press('Escape'); await nav(page, 'risks'); await page.click('#add-btn');
    await page.selectOption('#f-threat', 't:T.BSI.25'); await page.fill('#f-riskId', 'R.DB.9'); await page.fill('#f-description', 'Storage controller failure'); await page.fill('#f-component', 'Telemetry Database');
    await page.check('#f-core input[value="A"]'); await page.selectOption('#f-freq', 'medium'); await page.selectOption('#f-effect', 'considerable'); await page.selectOption('#f-category', 'mitigation'); await page.selectOption('#f-freqAfter', 'rarely'); await page.selectOption('#f-effectAfter', 'considerable');
    assert(/^Saved/.test(await save()), 'not saved');
    const cur = await snapWb(), d = pyDiff(prevFile, cur); prevFile = cur; const rows = [...new Set(d.diff.map((x) => x[1].replace(/[A-Z]+/, '')))];
    const exp = await page.evaluate(() => { const { M } = window.__rre.state(); const r = M.by.risk.get('R.DB.9'); return { row: r.row + 1, last: Math.max(...M.risks.filter((x) => x !== r).map((x) => x.row)) + 1, idx: [r.index, r.residual], thr: r.threat.id }; });
    eq([rows, exp.row, exp.idx, exp.thr], [[String(exp.last + 1)], exp.last + 1, [15, 10], 'T.BSI.25'], 'new row / computed indices / threat');
    assert(Object.values(d.styles).length > 5 && Object.values(d.styles).every(Boolean), 'new cells not formatted like the row above');
  });
  await test('E5', 'Rename a component and an assumption title: propagated to every risk and assumption that uses them', async () => {
    await page.keyboard.press('Escape'); await nav(page, 'components'); await page.click('.comp-card:has-text("Update Server")'); await page.waitForSelector('.drawer'); await page.click('#edit-btn'); await page.fill('#f-name', 'Update Service'); assert(/^Saved/.test(await save()), 'component not saved');
    let r = await page.evaluate(() => { const { M } = window.__rre.state(); return [!!M.by.component.get('Update Server'), M.by.component.get('Update Service').risks.length, M.by.component.get('Update Service').assumptions.length]; }); eq([r[0], r[1] > 2, r[2] > 0], [false, true, true], 'component renamed everywhere');
    await page.keyboard.press('Escape'); await nav(page, 'assumptions'); await page.click('.obj-head:has-text("A.4") .icon-btn'); await page.waitForSelector('.drawer'); await page.click('#edit-btn'); await page.fill('#f-title', 'Devices have a hardware root of trust (secure element)'); assert(/^Saved/.test(await save()), 'assumption not saved');
    r = await page.evaluate(() => { const { M } = window.__rre.state(); return M.issues.filter((i) => i.code === 'W_ASSUMPTION_TITLE' && i.refs.some((o) => o.id === 'A.4')).length; }); eq(r, 0, 'risks citing A.4 with the old title');
    prevFile = await snapWb();
  });
  await test('E6', 'Safety: no save when the workbook changed on disk; nothing written outside the workbook and the two folders', async () => {
    const before = await T('tree'); await T('put', 'workbook.xlsx', b64('modified.xlsx')); const changed = (await T('tree'))['workbook.xlsx'];
    await openObjBy('R.API.1'); await page.click('#edit-btn'); await page.fill('#f-description', 'must not be saved'); const msg = await save();
    assert(/Not saved/.test(msg) && /changed since it was loaded/.test(msg), 'message: ' + msg); eq((await T('tree'))['workbook.xlsx'], changed, 'workbook after refused save');
    const extra = Object.keys(before).filter((k) => !(k === 'workbook.xlsx' || /^(baselines|change-logs)\//.test(k))); eq(extra, [], 'files outside the allowed places');
    const s = await spy(); eq(s.removes, [], 'deletions');
  });
  await test('E7', 'Baseline saves the Excel version and starts a new log; earlier logs are not modified', async () => {
    const t0 = await T('tree'), logs0 = Object.keys(t0).filter((k) => k.startsWith('change-logs/')).sort(), cur = JSON.parse(await T('read', logs0[logs0.length - 1]));
    eq(cur.entries.length, 6, 'saves in the current log');
    await T('put', 'workbook.xlsx', fs.readFileSync(prevFile).toString('base64')); // back to the edited version (E6 replaced it)
    await page.keyboard.press('Escape'); await page.click('#reload-btn'); await page.waitForTimeout(700); await page.click('#write-btn'); await page.click('#write-baseline'); await page.waitForTimeout(1500);
    const t1 = await T('tree'), logs1 = Object.keys(t1).filter((k) => k.startsWith('change-logs/')).sort(), neu = JSON.parse(await T('read', logs1[logs1.length - 1]));
    eq([logs1.length - logs0.length, Object.keys(t1).filter((k) => k.startsWith('baselines/')).length - Object.keys(t0).filter((k) => k.startsWith('baselines/')).length], [1, 1], 'new log / new baseline');
    for (const k of logs0) eq(t1[k], t0[k], 'earlier log ' + k);
    eq([neu.schema, neu.entries.length, neu.baseline.file.startsWith('baselines/')], [2, 0, true], 'new log');
    await nav(page, 'history'); await page.click('.seg button:has-text("Change logs")'); await page.waitForSelector('.hlog'); assert(await page.locator('.hlog').count() >= 9, 'history entries'); eq(page.errors, [], 'script errors');
  });
  await browser.close(); server.close(); fs.rmSync(TEST, { force: true });

  const failed = results.filter((r) => !r.ok);
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', 'report.json'), JSON.stringify({ date: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  fs.writeFileSync(path.join(__dirname, 'results', 'report.md'), '# Test report\n\n' + new Date().toISOString() + ' — ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed\n\n| ID | Test | Result | Note |\n|---|---|---|---|\n' + results.map((r) => '| ' + r.id + ' | ' + r.name + ' | ' + (r.ok ? 'PASS' : '**FAIL**') + ' | ' + r.note.replace(/\|/g, '/') + ' |').join('\n') + '\n');
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed — report: tests/results/report.md');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
