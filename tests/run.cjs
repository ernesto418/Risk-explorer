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

  await test('S6', 'Vendored code: every file in src/vendor is registered with version, license and SHA-256', () => {
    const vdir = path.join(ROOT, 'src', 'vendor'); if (!fs.existsSync(vdir)) return 'no vendored code';
    const files = fs.readdirSync(vdir).filter((f) => /\.(js|css)$/.test(f)), reg = fs.readFileSync(path.join(vdir, 'README.md'), 'utf8');
    for (const f of files) {
      const row = reg.split('\n').find((l) => l.startsWith('| ' + f + ' |')); assert(row, f + ' is not listed in src/vendor/README.md');
      const cells = row.split('|').map((x) => x.trim()); assert(cells.slice(2, 6).every((x) => x && x !== '—'), f + ': library, version, source and license are required');
      eq(cells[6], sha(fs.readFileSync(path.join(vdir, f))), f + ' SHA-256 in the registry');
    }
    return files.length + ' vendored file(s)';
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
    eq(base.n, [19, 41, 42, 10, 10, 8], 'threats/risks/items (active)/groups/assumptions/components'); assert(base.sheets.includes('Assumed Risks Beta:ignored'), 'Beta sheet not ignored: ' + base.sheets);
  });
  await test('F2', 'Every seeded mistake of the sample is reported by its check', async () => {
    const want = ['C_ASSUMPTION_UNKNOWN', 'C_DUP_ID', 'C_INDEX', 'C_NOT_IN_GROUP', 'C_RMI_UNKNOWN', 'C_REDUCTION', 'C_THREAT_MISMATCH', 'F_ASSUMPTION_REF', 'F_RMI_REF', 'F_VALUE', 'W_AFTER_HIGHER', 'W_DUP_LINE', 'W_DUP_TEXT', 'W_MISSING', 'W_MULTI_GROUP', 'W_NOT_FORMULA', 'W_RELEVANCE', 'W_SIMILAR_NAME', 'W_UNUSED_ASSUMPTION', 'W_UNUSED_GROUP', 'W_UNUSED_RMI'];
    const miss = want.filter((c) => !base.codes.includes(c)); eq(miss, [], 'checks that did not fire');
    eq(base.codes.filter((c) => /^(F_BULLET|F_INTRO|F_EMPTY_ITEM|C_NO_MATCH|C_RMI_GROUPS|W_UNCACHED)$/.test(c)), [], 'text-based or obsolete checks that fired');
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
    const hov = await page.evaluate(() => { const { M } = window.__rre.state(); const exp = M.by.component.get('Edge Gateway').risks.filter((r) => !r.notRelevant).map((r) => r.id).sort(); /* “Hide not relevant” is on by default */ return { hl: [...document.querySelectorAll('.fnode.hl.t-risk .fnode-id')].map((x) => x.textContent).sort(), exp }; }); eq(hov.hl, hov.exp, 'highlighted risks');
    await page.click('.fnode.t-component:has-text("Edge Gateway")'); await page.waitForTimeout(500); await page.click('.fnode.t-threat >> nth=1'); await page.waitForTimeout(500);
    const foc = await page.evaluate(() => { const { M, state } = window.__rre.state(), f = state.ui.flow.focus, objs = window.__rre.Q.exprAtoms(f).map((x) => x.n.o); const exp = M.risks.filter((r) => !r.notRelevant && objs.every((o) => o.risks.includes(r))); /* two plain clicks = A AND B */ return { k: f.k, n: objs.length, shown: [...document.querySelectorAll('.fnode.t-risk .fnode-id')].map((x) => x.textContent).sort(), exp: exp.map((r) => r.id).sort() }; }); eq([foc.k, foc.n, foc.shown], ['and', 2, foc.exp], 'multi-focus risks');
  });
  await test('F7', 'Connections: Ctrl+click collects several threats, applied together on Ctrl release as OR', async () => {
    await page.click('.focusbar .btn:has-text("Show everything")'); await page.waitForTimeout(200);
    await page.keyboard.down('Control'); await page.click('.fnode.t-threat >> nth=0'); await page.click('.fnode.t-threat >> nth=1'); await page.waitForTimeout(150);
    const before = await page.evaluate(() => { const { state } = window.__rre.state(); return [state.ui.flow.focus, state.ui.flow.pending.length, !!document.getElementById('flow-pending')]; });
    eq(before, [null, 2, true], 'focus / pending / pending bar before Ctrl release');
    await page.keyboard.up('Control'); await page.waitForTimeout(250);
    const r = await page.evaluate(() => { const { M, state } = window.__rre.state(), f = state.ui.flow.focus, term = f && f.k === 'or' ? f.c.map((x) => x.o) : []; return { terms: f && f.k === 'or' ? 1 : 0, size: term.length, pending: state.ui.flow.pending.length,
      shown: [...document.querySelectorAll('.fnode.t-risk .fnode-id')].map((x) => x.textContent).sort(), exp: M.risks.filter((x) => term.includes(x.threat) && !x.notRelevant).map((x) => x.id).sort(), threats: document.querySelectorAll('.fnode.t-threat').length }; });
    eq([r.terms, r.size, r.pending, r.threats], [1, 2, 0, 2], 'terms / objects in term / pending / threats shown'); eq(r.shown, r.exp, 'risks = union of both threats'); assert(r.exp.length > 0, 'no risks');
    await page.click('.fnode.t-component >> nth=0').catch(() => {}); await page.waitForTimeout(500);
  });
  await test('F8', 'Connections: double-click opens the details without changing the focus', async () => {
    await page.click('.focusbar .btn:has-text("Show everything")').catch(() => {}); await page.waitForTimeout(200);
    const id = await page.locator('.fnode.t-threat >> nth=2 >> .fnode-id').textContent();
    await page.dblclick('.fnode.t-threat >> nth=2'); await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({ focus: window.__rre.Q.exprAtoms(window.__rre.state().state.ui.flow.focus).length, drawer: (document.querySelector('.drawer .dr-id') || {}).textContent }));
    eq([r.focus, r.drawer], [0, id], 'focus terms / opened object'); await page.keyboard.press('Escape');
    const bb = await page.locator('.fnode.t-threat >> nth=2').boundingBox(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    await page.mouse.click(cx, cy); await page.waitForTimeout(400); await page.mouse.click(cx, cy); await page.waitForTimeout(400);
    const slow = await page.evaluate(() => ({ focus: window.__rre.Q.exprAtoms(window.__rre.state().state.ui.flow.focus).length, drawer: (document.querySelector('.drawer .dr-id') || {}).textContent }));
    eq([slow.focus, slow.drawer], [0, id], 'slow double click: focus terms / opened object'); await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    await page.click('.fnode.t-threat >> nth=2'); await page.waitForTimeout(500);
    eq(await page.evaluate(() => [window.__rre.Q.exprAtoms(window.__rre.state().state.ui.flow.focus).length, !!document.querySelector('.drawer')]), [1, false], 'single click still focuses');
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
    /* every module's “Hide not relevant” is on by default: the exports leave out the same objects as the views */
    const exp = await page.evaluate(() => { const { M } = window.__rre.state(); const only = (o) => o.risks.length > 0 && o.risks.every((r) => r.notRelevant), rel = M.risks.filter((r) => !r.notRelevant);
      return { all: M.risks.length, risks: rel.length, threats: M.threats.filter((t) => !only(t)).length, groups: M.groups.filter((g) => !only(g)).length, rmis: M.rmis.filter((m) => !only(m)).length, assumptions: M.assumptions.length, components: M.components.length, issues: M.issues.length, links: rel.reduce((a, r) => a + r.items.length, 0) }; });
    eq([byKey.risks.Risks, byKey.risks['Risk-item links'], byKey.matrix.Positions, byKey.threats.Threats, byKey.mitigations['Mitigation groups'], byKey.mitigations['Mitigation items'], byKey.assumptions.Assumptions, byKey.components.Components, byKey.issues.Findings, byKey.connections.Paths],
      [exp.risks, exp.links, exp.all, exp.threats, exp.groups, exp.rmis, exp.assumptions, exp.components, exp.issues, exp.risks], 'rows per sheet');
    for (const k of keys) assert(byKey[k].About === 7, k + ': About sheet');
    eq(await page.evaluate(() => [window.__spy.writes.length, window.__spy.creates.length]), [0, 0], 'file-system writes during export'); eq(page.errors, [], 'script errors');
    return keys.length + ' modules exported';
  });
  await test('F10', 'Mitigation items: texts only from “Risk mitigations individual”, links only by RMI ID; unknown IDs reported once per use; text columns not read', async () => {
    const r = await page.evaluate(() => { const { M } = window.__rre.state(); const sheet = (n) => M.wb.sheets.find((x) => x.name === n);
      const msh = sheet('Risk mitigations individual'), master = new Map(msh.rows.slice(1).filter(Boolean).map((row) => [row[0], row[1]])), rc0 = msh.rows[0].indexOf('Removed');
      const removed = new Set(msh.rows.slice(1).filter((row) => row && /^yes$/i.test(String(row[rc0] == null ? '' : row[rc0]).trim())).map((row) => row[0]));
      const idCol = (sh) => { for (let i = 0; i < 10; i++) { const c = (sh.rows[i] || []).indexOf('RMI ID'); if (c >= 0) return c; } return -1; };
      const ra = sheet('Risik analysis Alpha'), rg = sheet('Risk Mitigation Groups'), rc = idCol(ra), gc = idCol(rg);
      /* independent reading of the RMI ID cells: lines that are exactly a master ID */
      const lines = (sh, c, row) => [...new Set(String(sh.rows[row][c] || '').split('\n').map((x) => x.trim()).filter((x) => master.has(x) && !removed.has(x)))];
      const exact = (items) => [...new Set(items.filter((o) => o.rmi.base && o.raw === o.rmi.id).map((o) => o.rmi.id))];
      const refs = M.risks.flatMap((k) => k.items).concat(M.groups.flatMap((g) => g.items));
      return { cols: rc >= 0 && gc >= 0, riskOk: M.risks.every((k) => JSON.stringify(exact(k.items)) === JSON.stringify(lines(ra, rc, k.row))), groupOk: M.groups.every((g) => JSON.stringify(exact(g.items)) === JSON.stringify(lines(rg, gc, g.row))),
        textOk: refs.filter((o) => o.rmi.base).every((o) => o.rmi.text === master.get(o.rmi.id) && o.text === o.rmi.text), unknown: refs.filter((o) => !o.rmi.base).length,
        nErr: M.issues.filter((i) => i.code === 'C_RMI_UNKNOWN').length, hint: M.issues.some((i) => i.code === 'C_RMI_UNKNOWN' && /^This is the text of RMI-\d+/.test(i.hint || '')),
        typed: M.issues.filter((i) => i.code === 'W_NOT_FORMULA').map((i) => i.refs[0].type).sort() }; });
    eq([r.cols, r.riskOk, r.groupOk, r.textOk, r.nErr], [true, true, true, true, r.unknown], 'RMI ID columns / risk links / group links / texts from the master list / one error per unknown ID');
    assert(r.unknown >= 3 && r.hint, 'sample should contain unknown IDs (incl. an item text instead of its ID)'); eq(r.typed, ['group', 'risk'], 'text cells typed instead of a formula');
  });
  await test('F9', 'Item → group only by the groups’ RMI ID column; used but in no group = consistency error; linked to no risk = warning (also when a group lists it)', async () => {
    const r = await page.evaluate(() => { const { M } = window.__rre.state();
      const wrong = M.rmis.filter((m) => JSON.stringify(m.groups.map((g) => g.id).sort()) !== JSON.stringify(M.groups.filter((g) => g.items.some((i) => i.rmi === m)).map((g) => g.id).sort())).length;
      const ni = M.issues.filter((i) => i.code === 'C_NOT_IN_GROUP'), un = M.issues.filter((i) => i.code === 'W_UNUSED_RMI');
      return { wrong, occWrong: M.risks.flatMap((k) => k.items).filter((o) => o.groups !== o.rmi.groups).length,
        ni: ni.map((i) => i.refs[0].id).sort(), expNi: M.rmis.filter((m) => m.base && m.risks.length && !m.groups.length).map((m) => m.id).sort(), niCats: [...new Set(ni.map((i) => i.cat))],
        un: un.map((i) => i.refs[0].id).sort(), expUn: M.rmis.filter((m) => m.base && !m.risks.length).map((m) => m.id).sort(), unCats: [...new Set(un.map((i) => i.cat))],
        unInGroup: un.filter((i) => i.refs.some((o) => o.type === 'group')).length, groupBadge: M.groups.some((g) => g.issues.some((i) => i.code === 'W_UNUSED_RMI')) }; });
    eq([r.wrong, r.occWrong, r.ni, r.niCats, r.un, r.unCats], [0, 0, r.expNi, ['consistency'], r.expUn, ['warning']], 'item-group links / C_NOT_IN_GROUP / W_UNUSED_RMI');
    assert(r.expNi.length > 0 && r.unInGroup > 0 && r.expUn.length > r.unInGroup && r.groupBadge, 'sample should contain: items in no group, unused items listed by a group and unused items in no group');
  });
  await test('F11', 'RMI ID cells: mis-typed references are format errors read as the intended ID; duplicates reported; formulas without results in unread columns ignored', async () => {
    const r = await page.evaluate(() => { const { M } = window.__rre.state(); const fmt = M.issues.filter((i) => i.code === 'F_RMI_REF'), rmiOf = (i) => i.refs.find((o) => o.type === 'rmi');
      return { kinds: [/not written exactly/, /only the RMI ID belongs/, /^Risk .*RMI IDs on one line/, /^Group .*RMI IDs on one line/].map((rx) => fmt.some((i) => rx.test(i.msg))),
        readAs: fmt.filter((i) => /read as/.test(i.msg)).every((i) => { const m = rmiOf(i); return m && m.base && i.msg.endsWith('(read as ' + m.id + ').'); }),
        split: fmt.filter((i) => /on one line/.test(i.msg)).every((i) => i.excerpt.split(/\s*[,;]\s*/).every((id) => i.refs[0].items.some((o) => o.rmi.id === id))),
        dup: M.issues.filter((i) => i.code === 'W_DUP_LINE').map((i) => i.refs[0].items.filter((o) => o.rmi === i.refs[1]).length),
        uncached: M.wb.sheets.reduce((a, x) => a + x.uncached.length, 0), uncachedIssue: M.issues.filter((i) => i.code === 'W_UNCACHED').length }; });
    eq([r.kinds, r.readAs, r.split, r.dup, r.uncachedIssue], [[true, true, true, true], true, true, [1], 0], 'kinds of format error / read as / IDs on one line all read / duplicate kept once / W_UNCACHED');
    assert(r.uncached > 0, 'the sample formulas should have no stored results');
  });
  await test('F12', '“Threat relevance” is an attribute of each risk: “not relevant” anywhere (any case) = not relevant; empty and look-alike texts are warnings and count as relevant', async () => {
    const r = await page.evaluate(() => { const { M } = window.__rre.state(); const sh = M.wb.sheets.find((x) => x.name === 'Risik analysis Alpha'), col = M.cols.risk.relevance, raw = (k) => String(sh.rows[k.row][col] == null ? '' : sh.rows[k.row][col]).trim();
      return { cls: M.risks.every((k) => k.notRelevant === /\bnot\s+relevant\b/i.test(raw(k)) && k.relevanceRaw === raw(k)), nr: M.risks.filter((k) => k.notRelevant).length, onThreat: M.threats.some((t) => 'relevance' in t),
        anyPos: M.risks.some((k) => k.notRelevant && !/^not/i.test(k.relevanceRaw)), missing: M.issues.filter((i) => i.code === 'W_MISSING' && /Threat relevance/.test(i.msg)).map((i) => i.refs[0].notRelevant),
        typo: M.issues.filter((i) => i.code === 'W_RELEVANCE').map((i) => i.refs[0].notRelevant) }; });
    eq([r.cls, r.onThreat, r.anyPos, r.missing, r.typo], [true, false, true, [false], [false]], 'classification / no threat relevance / any position / empty / look-alike'); assert(r.nr >= 3, 'sample should contain not-relevant risks');
  });
  await test('F13', '“Hide not relevant”: on by default and independent in Risks, Threats, Groups, Items and Connections; unused items stay; BSI tiles of only-not-relevant threats always blank', async () => {
    await load(page, FILE_T, fx('sample.xlsx'));
    const exp = await page.evaluate(() => { const { M } = window.__rre.state(); const only = (o) => o.risks.length > 0 && o.risks.every((r) => r.notRelevant);
      return { risks: M.risks.length, nr: M.risks.filter((r) => r.notRelevant).length, threats: M.threats.length, nrT: M.threats.filter((t) => t.risks.length && only(t)).map((t) => t.id),
        groups: M.groups.length, nrG: M.groups.filter(only).length, rmis: M.rmis.length, nrI: M.rmis.filter(only).length, unused: M.rmis.filter((m) => m.base && !m.risks.length).map((m) => m.id) }; });
    assert(exp.nr && exp.nrT.length && exp.nrG && exp.nrI && exp.unused.length, 'sample lacks not-relevant cases');
    const n = (sel) => page.locator(sel).count(), toggle = async () => { await page.click('#' + (await page.locator('.nr-toggle[id^="nr-"]').getAttribute('id'))); await page.waitForTimeout(150); };
    await nav(page, 'risks'); eq(await n('.view .obj.t-risk'), exp.risks - exp.nr, 'risks, filter on'); await toggle(); eq(await n('.view .obj.t-risk'), exp.risks, 'risks, filter off');
    await nav(page, 'threats'); eq(await n('.view .obj.t-threat'), exp.threats - exp.nrT.length, 'threats, filter still on (independent)');
    const tile = page.locator('.ttile:has-text("G 0.' + exp.nrT[0].split('.')[2] + ' ")').first(), tileInfo = async () => [await tile.getAttribute('class'), /Only not-relevant risks/.test(await tile.getAttribute('data-tip'))];
    eq(await tileInfo(), ['ttile listed', true], 'tile of an only-not-relevant threat'); await toggle(); eq(await n('.view .obj.t-threat'), exp.threats, 'threats, filter off'); eq(await tileInfo(), ['ttile listed', true], 'tile with the filter off');
    await nav(page, 'mitigations'); eq(await n('.view .obj.t-group'), exp.groups - exp.nrG, 'groups, filter on'); await toggle(); eq(await n('.view .obj.t-group'), exp.groups, 'groups, filter off');
    await page.click('.seg button:has-text("All items")'); await page.waitForTimeout(150); eq(await n('.view .obj.t-rmi'), exp.rmis - exp.nrI, 'items, filter on (own toggle)');
    const shown = await page.evaluate(() => [...document.querySelectorAll('.view .obj.t-rmi')].map((x) => x.textContent).join(' ')); assert(exp.unused.every((id) => shown.includes(id)), 'unused items hidden');
    await toggle(); eq(await n('.view .obj.t-rmi'), exp.rmis, 'items, filter off');
    await nav(page, 'connections'); await page.waitForTimeout(200);
    const th = async () => page.evaluate(() => [...document.querySelectorAll('.fnode.t-threat .fnode-id')].map((x) => x.textContent));
    eq(await n('.fnode.t-risk'), exp.risks - exp.nr, 'connections: risks, filter on'); assert(!(await th()).some((x) => exp.nrT.includes(x)) && (await th()).includes('T.BSI.43'), 'connections: threats');
    await toggle(); eq(await n('.fnode.t-risk'), exp.risks, 'connections: risks, filter off'); eq(page.errors, [], 'script errors');
  });
  await test('F14', 'Connections from a hidden object switches its filter off with a highlight; group boxes show relevant (total); not-relevant risks listed last and marked', async () => {
    await load(page, FILE_T, fx('sample.xlsx'));
    const rid = await page.evaluate(() => window.__rre.state().M.risks.find((r) => r.notRelevant).id);
    await page.fill('#global-search', rid); await page.click('.search-i:has-text("' + rid + '") >> nth=0'); await page.waitForSelector('.drawer .dr-id:has-text("' + rid + '")');
    assert((await page.textContent('.drawer')).includes('not relevant'), 'risk panel lacks the relevance'); await page.click('.dr-head .btn:has-text("Connections")'); await page.waitForTimeout(300);
    const r = await page.evaluate((id) => ({ off: window.__rre.state().state.ui.flow.hideNR, flash: !!document.querySelector('#nr-hideNR.flash:not(.on)'), shown: [...document.querySelectorAll('.fnode.t-risk .fnode-id')].map((x) => x.textContent).includes(id), other: window.__rre.state().state.ui.risks.hideNR }), rid);
    eq([r.off, r.flash, r.shown, r.other], [false, true, true, true], 'filter off / highlighted / risk shown / other views unchanged');
    const g = await page.evaluate(() => { const { M } = window.__rre.state(); const g = M.groups.find((x) => x.risks.some((k) => k.notRelevant) && x.risks.some((k) => !k.notRelevant)); return { id: g.id, rel: g.risks.filter((k) => !k.notRelevant).length, all: g.risks.length }; });
    await page.keyboard.press('Escape'); await page.fill('#global-search', g.id); await page.click('.search-i:has-text("' + g.id + '") >> nth=0'); await page.waitForSelector('.drawer .dr-id:has-text("' + g.id + '")');
    const box = page.locator('.drawer .stat:has-text("relevant risks addressed")');
    eq([(await box.locator('b').textContent()).replace(/\s+/g, ''), await box.getAttribute('data-tip')], [g.rel + '(' + g.all + ')', g.rel + ' relevant risk' + (g.rel === 1 ? '' : 's') + ' · ' + g.all + ' including not relevant (' + (g.all - g.rel) + ' not relevant)'], 'risks box');
    const rows = await page.evaluate(() => { const sec = [...document.querySelectorAll('.drawer section, .drawer details')].find((x) => /Risks addressed/.test(x.textContent.slice(0, 40)));
      const more = sec.querySelector('.more'); if (more) more.click(); return [...sec.querySelectorAll('.rrow')].map((x) => x.classList.contains('nr')); });
    eq(rows, rows.slice().sort((a, b) => a - b), 'not-relevant risks at the end'); assert(rows.includes(true), 'no not-relevant risk marked'); eq(page.errors, [], 'script errors');
  });
  await test('F15', 'Removed items (column “Removed”): hidden everywhere except the items tab (“Hide removed”, on by default); links to them are errors and ignored; no usage checks', async () => {
    await load(page, FILE_T, fx('sample.xlsx'));
    const r = await page.evaluate(() => { const { M } = window.__rre.state(); const sh = M.wb.sheets.find((x) => x.name === 'Risk mitigations individual'), c = sh.rows[0].indexOf('Removed');
      const exp = sh.rows.slice(1).filter((row) => row && row[0] && /^yes$/i.test(String(row[c] == null ? '' : row[c]).trim())).map((row) => row[0]).sort(), rem = M.allRmis.filter((m) => m.removed);
      return { ids: rem.map((m) => m.id).sort(), exp, inActive: M.rmis.some((m) => m.removed), linked: M.risks.some((k) => k.items.some((o) => o.rmi.removed)) || M.groups.some((g) => g.items.some((i) => i.rmi.removed)),
        errs: M.issues.filter((i) => i.code === 'C_RMI_REMOVED').length, refs: M.risks.concat(M.groups).reduce((a, o) => a + o.removedRefs.length, 0), own: rem.flatMap((m) => m.issues.map((i) => i.code)).filter((x) => x !== 'C_RMI_REMOVED'),
        invalid: M.issues.filter((i) => i.code === 'F_VALUE' && /“Removed”/.test(i.msg)).map((i) => i.refs[0].removed), dupText: rem.some((m) => m.text && M.rmis.some((x) => x.text === m.text)), active: M.rmis.length,
        holder: (M.risks.find((k) => k.removedRefs.length) || {}).id, linkedId: (rem.find((m) => m.issues.length) || {}).id }; });
    eq([r.ids, r.inActive, r.linked, r.errs, r.own, r.invalid, r.dupText], [r.exp, false, false, r.refs, [], [false], true], 'removed IDs / not among active items / not linked / one error per link / no other findings / invalid value / same text, no warning');
    assert(r.refs >= 2 && r.exp.length >= 2 && r.holder && r.linkedId, 'sample lacks removed items or links to them');
    await page.fill('#global-search', r.linkedId); await page.waitForTimeout(300); eq(await page.locator('.search-i:has-text("' + r.linkedId + '")').count(), 0, 'global search finds a removed item');
    await page.fill('#global-search', ''); eq(+(await page.locator('.nav-i:has-text("Mitigations") .count').textContent()), r.active, 'sidebar count');
    await page.fill('#global-search', r.holder); await page.click('.search-i:has-text("' + r.holder + '") >> nth=0'); await page.waitForSelector('.drawer .dr-id:has-text("' + r.holder + '")');
    assert(!(await page.locator('.drawer ul.items').textContent()).includes(r.linkedId), 'removed item listed in the risk panel'); await page.keyboard.press('Escape');
    await nav(page, 'connections'); await page.waitForTimeout(200); const fn = await page.evaluate(() => [...document.querySelectorAll('.fnode.t-rmi .fnode-id')].map((x) => x.textContent));
    assert(fn.length && !fn.some((x) => r.ids.includes(x)), 'removed item in Connections');
    await nav(page, 'mitigations'); await page.click('.seg button:has-text("All items")'); await page.waitForTimeout(200);
    const ids = () => page.evaluate(() => [...document.querySelectorAll('.view .obj.t-rmi .obj-head')].map((x) => x.textContent));
    const on = await ids(); assert(!on.some((t) => r.ids.some((id) => t.includes(id))), 'removed items shown with “Hide removed” on');
    await page.click('#rm-hideRemoved'); await page.waitForTimeout(200); eq((await ids()).length, on.length + r.ids.length, 'items with “Hide removed” off');
    await page.fill('.view .controls .searchbox input', r.linkedId); await page.waitForTimeout(400); eq((await ids()).filter((t) => t.includes(r.linkedId)).length, 1, 'items search finds the removed item');
    eq(page.errors, [], 'script errors');
  });
  /* ---------- search in Connections: logical search, focus bar, content filters, library ---------- */
  const ALL_COLS = ['component', 'assumption', 'threat', 'risk', 'rmi', 'group'];
  const qFocus = () => page.evaluate(() => window.__rre.Q.exprToText(window.__rre.state().state.ui.flow.focus));
  const qApply = async (text) => { await page.fill('#flow-q', text); await page.click('#flow-q-apply'); await page.waitForTimeout(250); };
  const qCol = (t) => page.evaluate((x) => [...document.querySelectorAll('.fnode.t-' + x + ' .fnode-id')].map((e) => e.textContent).sort(), t);
  const allCols = async () => { await page.evaluate((c) => { window.__rre.state().state.ui.flow.cols = c.slice(); }, ALL_COLS); await nav(page, 'overview'); await nav(page, 'connections'); await page.waitForTimeout(200); };
  await test('F16', 'Logical search: parser, precedence (AND before OR), printer, operator switch and error messages with position', async () => {
    await load(page, FILE_T, fx('sample.xlsx'));
    const r = await page.evaluate(() => {
      const { Q } = window.__rre, { M } = window.__rre.state();
      const T = (s) => { const x = Q.qParse(s); return x.err ? 'ERR ' + x.err.msg : Q.exprToText(x.ast); };
      const three = Q.qParse('T.BSI.15 AND T.BSI.43 AND RMI-008').ast, t1 = Q.exprToggleOp(three, [], 2), t2 = Q.exprToggleOp(t1, [], 1), t3 = Q.exprToggleOp(Q.qParse('T.BSI.15 OR T.BSI.43 OR RMI-008').ast, [], 2);
      const p = Q.qParse('T.BSI.15 AND XYZ').err;
      return { prec: T('T.BSI.15 or T.BSI.43 and not RMI-008'), sym: T('(t.bsi.15 | T.BSI.43) & !rmi-008'), round: T(T('T.BSI.15 or T.BSI.43 and not RMI-008')),
        name: T('Edge Gateway AND T.BSI.15'), quoted: T('"edge gateway"'), typed: T('rmi:RMI-008'), dneg: T('NOT NOT T.BSI.15'), empty: Q.qParse('   ').ast,
        toggles: [t1, t2, t3].map((x) => Q.exprToText(x)),
        errs: ['T.BSI.15 T.BSI.43', 'T.BSI.15 AND', '(T.BSI.15', 'T.BSI.15)', 'RMI-0O8', '"Edge', '@nope', 'group:RMI-008', '()', 'AND T.BSI.15', M.allRmis.find((m) => m.removed).id].map(T),
        pos: [p.s, p.e] }; });
    eq([r.prec, r.sym, r.round, r.name, r.quoted, r.typed, r.dneg, r.empty], ['T.BSI.15 OR (T.BSI.43 AND NOT RMI-008)', '(T.BSI.15 OR T.BSI.43) AND NOT RMI-008', 'T.BSI.15 OR (T.BSI.43 AND NOT RMI-008)',
      '"Edge Gateway" AND T.BSI.15', '"Edge Gateway"', 'RMI-008', 'T.BSI.15', null], 'parse → print');
    eq(r.toggles, ['(T.BSI.15 AND T.BSI.43) OR RMI-008', 'T.BSI.15 AND T.BSI.43 AND RMI-008', 'T.BSI.15 OR (T.BSI.43 AND RMI-008)'], 'switching one operator regroups with AND before OR');
    const want = [/^ERR Write AND or OR between “T\.BSI\.15” and “T\.BSI\.43”/, /^ERR The search ends too early/, /^ERR Missing “\)”/, /^ERR Unexpected “\)”/, /^ERR Unknown ID or name “RMI-0O8”\. Did you mean RMI-0\d8\?/,
      /^ERR Missing closing quote/, /^ERR There is no content filter or saved search called @nope/, /^ERR Unknown ID or name “RMI-008” among the mitigation groups/, /^ERR Empty brackets/, /^ERR Expected an ID, a name or @filter before “AND”/, /^ERR Unknown ID or name/];
    r.errs.forEach((e, i) => assert(want[i].test(e), 'error message ' + i + ': ' + e)); eq(r.pos, [13, 16], 'position of the unknown ID');
  });
  await test('F17', 'Logical search: AND / OR / NOT select exactly the risks linked to the objects; each column keeps only the objects the search names', async () => {
    await nav(page, 'connections'); await allCols();
    const P = await page.evaluate(() => {
      const { M } = window.__rre.state(), rel = M.risks.filter((r) => !r.notRelevant), ids = (l) => l.map((o) => o.id).sort();
      const th = M.threats.filter((t) => t.risks.some((r) => !r.notRelevant)).sort((a, b) => b.risks.length - a.risks.length), t1 = th[0], t2 = th[1];
      const m = t1.risks.filter((r) => !r.notRelevant).flatMap((r) => r.items.map((o) => o.rmi)).find((x) => x.risks.some((r) => r.threat !== t1) || true);
      const pair = rel.find((r) => r.assumptions.length >= 2), a1 = pair.assumptions[0], a2 = pair.assumptions[1], c1 = rel.find((r) => r.threat !== t1).components[0];
      const g = M.groups.find((x) => x.risks.some((r) => !r.notRelevant && r.threat === t1)), u = M.rmis.find((x) => x.base && !x.risks.length && x.groups.length);
      const uses = (r, o) => r.items.some((i) => i.rmi === o);
      return { t1: t1.id, t2: t2.id, m: m.id, a1: a1.id, a2: a2.id, c1: c1.name, g: g.id, u: u.id, uGroups: ids(u.groups), mGroups: ids(m.groups),
        e1: ids(rel.filter((r) => r.threat === t1 || r.threat === t2)), e2: ids(rel.filter((r) => (r.threat === t1 || r.threat === t2) && !uses(r, m))),
        e3: ids(rel.filter((r) => r.assumptions.includes(a1) && r.assumptions.includes(a2))), e3c: ids(rel.filter((r) => r.components.includes(c1) && r.threat !== t1)), e4: ids(rel.filter((r) => r.threat !== t1)), e5: ids(rel.filter((r) => uses(r, m))),
        e6: ids(rel.filter((r) => r.threat === t1 && r.groups.includes(g))), e6items: ids(uniqA(rel.filter((r) => r.threat === t1 && r.groups.includes(g)).flatMap((r) => r.items.map((o) => o.rmi)).filter((x) => x.groups.includes(g)))) };
      function uniqA(a) { return [...new Set(a)]; }
    });
    const q = (s) => s.replace(/\bc1\b/g, (x) => '"' + P[x] + '"').replace(/\b(t1|t2|a1|a2|m|g|u)\b/g, (x) => P[x]);
    await qApply(q('t1 OR t2')); eq([await qCol('risk'), await qCol('threat')], [P.e1, [P.t1, P.t2].sort()], 't1 OR t2: risks / threats');
    await qApply(q('(t1 OR t2) AND NOT m')); eq(await qCol('risk'), P.e2, '(t1 OR t2) AND NOT m: risks'); assert(!(await qCol('rmi')).includes(P.m), 'negated item shown');
    await qApply(q('a1 AND a2')); eq([await qCol('risk'), await qCol('assumption')], [P.e3, [P.a1, P.a2].sort()], 'a1 AND a2: risks relying on both / assumptions column = the two');
    await qApply(q('c1 AND NOT t1')); eq([await qCol('risk'), await qCol('component')], [P.e3c, [P.c1]], 'component AND NOT threat: risks / components column = the component');
    await qApply(q('NOT t1')); eq(await qCol('risk'), P.e4, 'NOT t1: risks'); assert(!(await qCol('threat')).includes(P.t1), 'negated threat shown');
    await qApply(q('m')); eq([await qCol('risk'), await qCol('rmi'), await qCol('group')], [P.e5, [P.m], P.mGroups], 'single item: its risks, itself, its groups');
    await qApply(q('g AND t1')); eq([await qCol('risk'), await qCol('rmi'), await qCol('group')], [P.e6, P.e6items, [P.g]], 'group AND threat: risks / only the items of the group / the group');
    await qApply(q('u')); eq([await qCol('risk'), await qCol('rmi'), await qCol('group')], [[], [P.u], P.uGroups], 'unused item: no risks, the item and its groups');
    await qApply(q('t1 AND t2')); assert(/No path satisfies the whole search/.test(await page.textContent('.flow-host')), 'empty AND without explanation');
    eq(page.errors, [], 'script errors');
  });
  await test('F18', 'Focus bar: a click on “and” / “or” switches that operator (brackets show the grouping), ¬ negates, “not” and × undo; the columns follow', async () => {
    const th = await page.evaluate(() => window.__rre.state().M.threats.filter((t) => t.risks.some((r) => !r.notRelevant)).sort((a, b) => b.risks.length - a.risks.length).slice(0, 3).map((t) => t.id));
    const risksOf = (ids, not) => page.evaluate(([a, n]) => window.__rre.state().M.risks.filter((r) => !r.notRelevant && (n ? !a.includes(r.threat && r.threat.id) : a.includes(r.threat && r.threat.id))).map((r) => r.id).sort(), [ids, !!not]);
    await qApply(th[0] + ' AND ' + th[1]); eq(await page.locator('.focusbar button.focus-op.op-and').count(), 1, 'one AND in the bar');
    await page.click('.focusbar button.focus-op.op-and'); await page.waitForTimeout(250);
    eq([await qFocus(), await qCol('risk')], [th[0] + ' OR ' + th[1], await risksOf([th[0], th[1]])], 'AND switched to OR');
    await page.click('.focusbar .focus-i:has(.chip-id:text-is("' + th[1] + '")) .focus-neg'); await page.waitForTimeout(250);
    const notT1 = await page.evaluate((a) => window.__rre.state().M.risks.filter((r) => !r.notRelevant && (r.threat && r.threat.id === a[0] || !(r.threat && r.threat.id === a[1]))).map((r) => r.id).sort(), th);
    eq([await qFocus(), await qCol('risk')], [th[0] + ' OR NOT ' + th[1], notT1], 'negated with ¬');
    await page.click('.focusbar button.focus-op.op-not'); await page.waitForTimeout(250); eq(await qFocus(), th[0] + ' OR ' + th[1], 'NOT removed by a click on “not”');
    await page.click('.focusbar .focus-i:has(.chip-id:text-is("' + th[1] + '")) .icon-btn:not(.focus-neg)'); await page.waitForTimeout(250); eq(await qFocus(), th[0], 'removed with ×');
    await qApply(th.join(' AND ')); await page.click('.focusbar button.focus-op.op-and >> nth=1'); await page.waitForTimeout(250);
    eq([await qFocus(), await page.locator('.focusbar .focus-term.multi').count(), await page.locator('.focusbar button.focus-op').allTextContents()], ['(' + th[0] + ' AND ' + th[1] + ') OR ' + th[2], 1, ['and', 'or']], 'second AND switched: (A and B) or C, shown with brackets');
    eq(await qCol('risk'), await risksOf([th[2]]), 'risks of (A and B) or C');
    await page.click('.focusbar button.focus-op.op-or'); await page.waitForTimeout(250); eq(await qFocus(), th.join(' AND '), 'and back');
    await page.click('.focusbar .btn:has-text("Show everything")'); await page.waitForTimeout(200); eq(await qFocus(), '', 'show everything');
    eq(page.errors, [], 'script errors');
  });
  await test('F19', 'Search field: ID and name autocompletion (keyboard), Enter applies, errors are marked and nothing is applied, missing columns are switched on', async () => {
    await page.evaluate(() => { window.__rre.state().state.ui.flow.cols = ['threat', 'risk', 'rmi', 'group']; }); await nav(page, 'overview'); await nav(page, 'connections');
    await page.click('#flow-q'); await page.keyboard.type('rmi-00'); await page.waitForTimeout(150);
    const sug = await page.locator('.qsug-i').allTextContents(); assert(sug.length >= 3 && sug.every((x) => /^RMI-00\d/.test(x)), 'suggestions for rmi-00: ' + sug.slice(0, 3));
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
    const second = await page.locator('#flow-q').inputValue(); assert(/^RMI-00\d $/.test(second) && second.trim() === sug[1].slice(0, 7), 'ArrowDown + Enter inserted ' + second);
    await page.keyboard.type('and Edge Ga'); await page.waitForTimeout(150); eq((await page.locator('.qsug-i').first().textContent()).slice(0, 12), 'Edge Gateway', 'name with a space suggested');
    await page.keyboard.press('Tab'); await page.waitForTimeout(100); eq(await page.locator('#flow-q').inputValue(), second.trim() + ' and "Edge Gateway" ', 'Tab inserted the quoted name');
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    eq([await qFocus(), (await page.evaluate(() => window.__rre.state().state.ui.flow.cols)).includes('component')], [second.trim() + ' AND "Edge Gateway"', true], 'applied; components column switched on');
    await page.fill('#flow-q', 'T.BSI.15 AND XYZ'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    eq([await qFocus(), await page.locator('.qstatus.err').count(), (await page.textContent('.qstatus.err code.qx mark'))], [second.trim() + ' AND "Edge Gateway"', 1, 'XYZ'], 'error shown and marked, focus unchanged');
    await page.keyboard.press('Escape'); await page.waitForTimeout(100); eq(await page.locator('#flow-q').inputValue(), second.trim() + ' AND "Edge Gateway"', 'Escape restores the applied search');
    await page.click('.focusbar .btn:has-text("Show everything")'); await page.waitForTimeout(150); eq(page.errors, [], 'script errors');
  });
  await test('F20', 'Content filters by clicks (object → generic card → attribute → condition), errors and warnings included; saved, combined with AND / OR / NOT, saved searches nested; renaming and deleting are safe', async () => {
    const exp = await page.evaluate(() => { const { M } = window.__rre.state(), ids = (l) => l.map((o) => o.id).sort(), rel = (l) => l.filter((r) => !r.notRelevant);
      const gw = M.risks.filter((r) => r.components.some((c) => /gateway/i.test(c.name))), bad = new Set(M.rmis.filter((m) => m.issues.some((i) => i.cat !== 'warning')));
      return { nFields: window.__rre.Q.fieldList('risk').length, gw: gw.length, gwRel: ids(rel(gw)), bad: bad.size, gwClean: ids(rel(gw).filter((r) => !r.items.some((o) => bad.has(o.rmi)))),
        miss: M.risks.filter((r) => r.issues.some((i) => i.code === 'W_MISSING')).length, noGw: M.risks.filter((r) => !/gateway/i.test(r.description)).length,
        keyWhole: M.rmis.filter((m) => /\bkey\b/i.test(m.text)).length, keySub: M.rmis.filter((m) => /key/i.test(m.text)).length, all: M.risks.length }; });
    const newFilter = async (type, field, op, word, whole) => {
      await page.click('#flow-new-filter'); await page.click('.fb-type[data-type="' + type + '"]'); await page.click('.gfield[data-field="' + field + '"]');
      if (op) await page.click('.fb-cond .seg button:text-is("' + op + '")'); if (word != null) await page.fill('#fb-word', word); if (whole) await page.check('#fb-whole'); await page.waitForTimeout(100);
      return [+(await page.textContent('#fb-count')), await page.inputValue('#fb-name')];
    };
    await page.click('#flow-new-filter'); eq(await page.locator('.fb-type').count(), 6, 'every object type offered'); await page.click('.fb-type[data-type="risk"]');
    eq(await page.locator('.gcard .gfield').count(), exp.nFields, 'generic card lists every attribute'); assert(await page.locator('.gfield[data-field="errors"]').count() && await page.locator('.gfield[data-field="warnings"]').count(), 'errors and warnings are attributes');
    await page.click('.dialog .icon-btn'); await page.waitForTimeout(100);
    const [n1, f1] = await newFilter('risk', 'components', null, 'GateWay'); eq(n1, exp.gw, 'preview: risks whose component contains “gateway”');
    await page.click('#fb-save-add'); await page.waitForTimeout(300); eq([await qFocus(), await qCol('risk')], ['@' + f1, exp.gwRel], 'saved and added: the search shows these risks');
    const [n2, f2] = await newFilter('rmi', 'errors', 'is not empty'); eq(n2, exp.bad, 'preview: items with errors'); await page.click('#fb-save'); await page.waitForTimeout(200);
    const [n3, f3] = await newFilter('risk', 'warnings', null, 'w_missing'); eq(n3, exp.miss, 'preview: warnings contain a check code'); await page.click('#fb-save'); await page.waitForTimeout(200);
    const [n4] = await newFilter('risk', 'description', 'does not contain', 'gateway'); eq(n4, exp.noGw, 'preview: does not contain'); await page.click('.dialog .icon-btn'); await page.waitForTimeout(100);
    const [n5] = await newFilter('rmi', 'text', null, 'key'); const [n6] = [+(await (async () => { await page.check('#fb-whole'); await page.waitForTimeout(80); return page.textContent('#fb-count'); })())];
    eq([n5, n6], [exp.keySub, exp.keyWhole], 'substring / whole word'); assert(exp.keySub > exp.keyWhole, 'sample should contain “key” inside a longer word'); await page.click('.dialog .icon-btn'); await page.waitForTimeout(100);
    if (!(await page.locator('#flow-lib').count())) await page.click('#flow-lib-btn');
    await page.click('.lib-row[data-name="' + f2 + '"] .lib-op.op-andnot'); await page.waitForTimeout(250);
    eq([await qFocus(), await qCol('risk')], ['@' + f1 + ' AND NOT @' + f2, exp.gwClean], 'AND NOT from the library');
    await page.click('#flow-save'); await page.fill('#sd-name', 'gw clean'); await page.click('#sd-save'); await page.waitForTimeout(200);
    eq(await page.evaluate(() => window.__rre.Q.searchLib.items.filter((x) => x.kind === 'search').map((x) => [x.name, x.expr])), [['gw clean', '@' + f1 + ' AND NOT @' + f2]], 'saved search');
    await qApply('NOT @"gw clean"'); eq((await qCol('risk')).length, (await page.evaluate(() => window.__rre.state().M.risks.filter((r) => !r.notRelevant).length)) - exp.gwClean.length, 'saved search used inside another search');
    await page.click('.lib-row[data-name="gw clean"] [data-act="edit"]'); await page.fill('#sd-expr', '@"gw clean" OR T.BSI.15'); await page.waitForTimeout(100);
    eq([/refers to itself/.test(await page.textContent('#sd-err')), await page.isDisabled('#sd-save')], [true, true], 'a search cannot use itself'); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    await page.click('.lib-row[data-name="' + f1 + '"] [data-act="delete"]'); await page.waitForTimeout(150);
    assert(/is used by @gw clean/.test(await page.textContent('.toast.error')), 'deleting a used filter is blocked'); await page.click('.toast.error .icon-btn');
    await page.click('.lib-row[data-name="' + f2 + '"] [data-act="edit"]'); await page.fill('#fb-name', 'broken-items'); await page.click('#fb-save'); await page.waitForTimeout(200);
    eq(await page.evaluate(() => window.__rre.Q.searchLib.items.find((x) => x.name === 'gw clean').expr), '@' + f1 + ' AND NOT @broken-items', 'rename updates the saved search');
    await page.click('.lib-row[data-name="' + f3 + '"] [data-act="delete"]'); await page.click('#confirm-ok'); await page.waitForTimeout(150);
    eq(await page.evaluate(() => window.__rre.Q.searchLib.items.map((x) => x.name)), [f1, 'broken-items', 'gw clean'], 'library after rename and delete');
    eq(page.errors, [], 'script errors');
  });
  await test('F21', 'Library: downloaded as a JSON file (no file-system API, nothing in localStorage); loading it restores filters and searches; invalid files are refused', async () => {
    const dir = path.join(__dirname, 'results', 'library'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#flow-lib .btn:has-text("Download library")')]);
    const file = path.join(dir, dl.suggestedFilename()); await dl.saveAs(file); assert(/^RRE_search-library_\d{4}-\d{2}-\d{2}_\d{6}\.json$/.test(dl.suggestedFilename()), 'file name ' + dl.suggestedFilename());
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')), mem = await page.evaluate(() => window.__rre.Q.searchLib.items);
    eq([saved.format, saved.items], ['risk-register-explorer/search-library', mem], 'file content = library');
    eq(await page.evaluate(() => [window.__spy.writes.length, window.__spy.creates.length, Object.keys(localStorage).filter((k) => k !== 'rre-theme')]), [0, 0, []], 'no file-system write, nothing stored in the browser');
    await page.goto(FILE_T); await page.setInputFiles('#file-input', fx('sample.xlsx')); await page.waitForSelector('.topbar'); await nav(page, 'connections');
    eq(await page.evaluate(() => window.__rre.Q.searchLib.items.length), 0, 'new tab: empty library');
    await page.click('#flow-lib-btn'); await page.setInputFiles('#lib-file', file); await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__rre.Q.searchLib.items), mem, 'library loaded'); assert(/2 added|3 added/.test(await page.textContent('.toast')), 'load message');
    await qApply('@"gw clean"'); assert((await qCol('risk')).length > 0, 'loaded saved search works');
    const bad = path.join(dir, 'not-a-library.json'); fs.writeFileSync(bad, JSON.stringify({ format: 'something else', items: [] }));
    await page.setInputFiles('#lib-file', bad); await page.waitForTimeout(250); assert(/could not be loaded: it is not a search library/.test(await page.textContent('.toast.error')), 'invalid file refused');
    const mixed = path.join(dir, 'mixed.json'); fs.writeFileSync(mixed, JSON.stringify({ format: 'risk-register-explorer/search-library', items: [{ kind: 'filter', name: 'ok-one', type: 'risk', field: 'id', op: 'contains', text: 'R.' }, { kind: 'filter', name: '<img src=x>', type: 'risk', field: 'id', op: 'contains', text: 'x' }, { kind: 'filter', name: 'bad-field', type: 'risk', field: 'nope', op: 'contains', text: 'x' }, { kind: 'search', name: 'empty', expr: '' }] }));
    await page.setInputFiles('#lib-file', mixed); await page.waitForTimeout(250); assert(/1 added, 0 replaced, 3 invalid entries skipped/.test(await page.locator('.toast').last().textContent()), 'invalid entries skipped');
    eq(page.errors, [], 'script errors');
  });
  await test('F22', 'Reloading the workbook keeps the search (objects by ID); the Connections export states the search and what each @filter means', async () => {
    await qApply('@risk-components-gateway AND NOT T.BSI.15'); const before = await qFocus(), risks = await qCol('risk');
    await page.setInputFiles('#file-input', fx('sample.xlsx')); await page.waitForTimeout(600); await nav(page, 'connections');
    eq([await qFocus(), await qCol('risk')], [before, risks], 'search and result after reloading the workbook');
    const dir = path.join(__dirname, 'results', 'library'); const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#export-btn')]); const file = path.join(dir, 'connections.xlsx'); await dl.saveAs(file);
    const about = JSON.parse(execFileSync('python3', ['-c', 'import sys,json\nfrom openpyxl import load_workbook\nwb=load_workbook(sys.argv[1])\nprint(json.dumps({"about":{str(r[0].value):str(r[1].value) for r in wb["About"].iter_rows()},"paths":wb["Paths"].max_row-1}))', file]).toString());
    const scope = about.about['Filter / scope'];
    assert(scope.includes('search = ' + before) && scope.toLowerCase().includes('@risk-components-gateway = risks · affected component contains “gateway”'), 'About: ' + scope); eq(about.paths, risks.length, 'Paths rows = risks shown');
    eq(page.errors, [], 'script errors');
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
    const txt = await page.locator('.hlog').first().textContent(); for (const s of ['Test Author', 'R.API.1', 'R.GW.2', 'frequently', 'rarely', '+ RMI-019 — Create encrypted database backups', '− RMI-031']) assert(txt.includes(s), 'newest log lacks “' + s + '”');
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
  const calcOnLoad = (f) => execFileSync('python3', ['-c', 'import sys,zipfile\nprint(\'fullCalcOnLoad="1"\' in zipfile.ZipFile(sys.argv[1]).read("xl/workbook.xml").decode())', f]).toString().trim() === 'True';
  const openObjBy = async (q) => { await page.keyboard.press('Escape'); await page.fill('#global-search', q); await page.click('.search-i:has-text("' + q + '") >> nth=0'); await page.waitForSelector('.drawer .dr-id:has-text("' + q + '")'); };
  const save = async () => { await page.click('#form-save'); await page.waitForSelector('#edit-confirm', { timeout: 5000 }); await page.click('#edit-confirm'); await page.waitForSelector('.toast', { timeout: 8000 }); await page.waitForTimeout(400); const t = await page.locator('.toast').last().textContent(); await page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.remove())); return t; };
  const modelOf = () => page.evaluate(() => { const { M } = window.__rre.state(); return M; }).catch(() => null);
  await test('E0', 'Editing is deprecated: in write mode no Edit / Add button is shown (the E tests switch the old code on in the test build only)', async () => {
    await page.click('#write-btn'); await page.fill('#write-name', 'Editor'); await page.click('#write-enable'); await page.waitForTimeout(300);
    await nav(page, 'risks'); const add = await page.locator('#add-btn').count(); await openObjBy('R.DB.2'); const btns = await page.locator('#edit-btn, #add-rmi-btn').count(); await page.keyboard.press('Escape');
    eq([await page.evaluate(() => [window.__rre.write.on, window.__rre.edit.enabled]), add, btns], [[true, false], 0, 0], 'write mode + editing flag / Add button / Edit buttons');
    await page.evaluate(() => { window.__rre.edit.enabled = true; }); // DEPRECATED editing code: still tested until it is rebuilt
  });
  await test('E1', 'Edit a risk field: exactly that cell changes (checked independently with openpyxl); save appended to the open log', async () => {
    prevFile = await snapWb();
    await openObjBy('R.DB.2'); await page.click('#edit-btn'); await page.fill('#f-description', 'Edited description of R.DB.2'); await page.click('#form-save'); await page.waitForSelector('#edit-confirm');
    const pv = await page.locator('.preview tbody tr').first().textContent(); assert(pv.includes('R.DB.2') && pv.includes('Risk description'), 'preview row lacks object/field: ' + pv);
    await page.click('.dialog-actions .btn:has-text("Cancel")'); await page.waitForTimeout(200); await page.click('#edit-btn'); await page.fill('#f-description', 'Edited description of R.DB.2'); const msg = await save();
    assert(/^Saved/.test(msg), msg); const cur = await snapWb(), d = pyDiff(prevFile, cur); prevFile = cur;
    eq(d.diff.map((x) => [x[0], x[3]]), [['Risik analysis Alpha', 'Edited description of R.DB.2']], 'changed cells'); eq(calcOnLoad(cur), false, 'recalculation requested without formulas involved');
    const logs = Object.keys(await T('tree')).filter((k) => k.startsWith('change-logs/')).sort(), last = JSON.parse(await T('read', logs[logs.length - 1]));
    eq([last.schema, last.closed, last.entries.length, last.entries[0].author, last.entries[0].changes.map((c) => c.id)], [2, null, 1, 'Editor', ['R.DB.2']], 'open log');
  });
  await test('E2', 'Rename a mitigation item: only its cell in “Risk mitigations individual” changes; links stay; Excel recalculates the text formulas on opening', async () => {
    const pick = await page.evaluate(() => { const { M } = window.__rre.state(); const m = M.rmis.filter((x) => x.base && x.occ.length >= 2 && x.listed.length).sort((a, b) => b.occ.length - a.occ.length)[0];
      return { id: m.id, old: m.text, risks: m.risks.map((x) => x.id), groups: m.groups.map((g) => g.id) }; });
    await openObjBy(pick.id); await page.click('#edit-btn'); await page.fill('#f-text', pick.old + ' (renamed)'); const m2 = await save(); assert(/^Saved/.test(m2), m2);
    const cur = await snapWb(), d = pyDiff(prevFile, cur); prevFile = cur;
    eq(d.diff.map((x) => [x[0], x[2], x[3]]), [['Risk mitigations individual', pick.old, pick.old + ' (renamed)']], 'changed cells'); eq(calcOnLoad(cur), true, 'fullCalcOnLoad set');
    const r = await page.evaluate((id) => { const { M } = window.__rre.state(); const m = M.by.rmi.get(id); return [m.text, m.risks.map((x) => x.id), m.groups.map((g) => g.id)]; }, pick.id);
    eq(r, [pick.old + ' (renamed)', pick.risks, pick.groups], 'renamed item: new text, same risks and groups');
  });
  await test('E3', 'Add a mitigation item: a group is mandatory; its RMI ID is appended to the risk and the group; a new item gets a master-list row (ID, text, formulas)', async () => {
    const taken = await page.evaluate(() => window.__rre.state().M.by.rmi.get('RMI-019').text);
    await openObjBy('R.DB.2'); await page.click('#add-rmi-btn'); await page.fill('#f-text', 'Encrypt database volumes at rest'); await page.click('#form-save');
    assert(/required/.test(await page.textContent('.form-err')), 'saved without a group'); await page.selectOption('#f-group', 'RMG05'); await page.fill('#f-rmiId', 'RMI-001'); await page.click('#form-save');
    assert(/already exists/.test(await page.textContent('.form-err')), 'accepted an existing RMI ID'); await page.fill('#f-rmiId', 'RMI-900'); await page.fill('#f-text', taken); await page.click('#form-save');
    assert(/already exists as RMI-019/.test(await page.textContent('.form-err')), 'accepted the text of an existing item');
    await page.fill('#f-text', 'Encrypt database volumes at rest'); await page.click('#form-save'); await page.click('#edit-confirm'); await page.waitForSelector('.toast'); await page.waitForTimeout(400);
    let cur = await snapWb(), d = pyDiff(prevFile, cur); prevFile = cur; const two = d.diff.filter((x) => x[0] !== 'Risk mitigations individual'), ind = d.diff.filter((x) => x[0] === 'Risk mitigations individual');
    eq(two.map((x) => x[0]).sort(), ['Risik analysis Alpha', 'Risk Mitigation Groups'], 'changed cells'); assert(two.every((x) => String(x[3]) === String(x[2]) + '\nRMI-900'), 'RMI ID not appended as a new line: ' + JSON.stringify(two));
    const nr = ind.length ? ind[0][1].replace(/[A-Z]+/, '') : '?';
    eq(ind.slice(0, 2).map((x) => x[3]), ['RMI-900', 'Encrypt database volumes at rest'], 'new row in Risk mitigations individual');
    assert(ind.length === 4 && String(ind[2][3]).startsWith('=') && String(ind[2][3]).includes('A' + nr) && String(ind[3][3]).includes('C' + nr), 'Groups / Assigned formulas not copied to row ' + nr + ': ' + JSON.stringify(ind.slice(2)));
    let r = await page.evaluate(() => { const { M } = window.__rre.state(); const m = M.by.rmi.get('RMI-900'); return [m.text, m.risks.map((x) => x.id), m.groups.map((g) => g.id), m.issues.length]; });
    eq(r, ['Encrypt database volumes at rest', ['R.DB.2'], ['RMG05'], 0], 'text / risk / group / issues of the new item');
    /* existing item whose group already lists it: only the risk's RMI ID cell changes */
    await page.click('#add-rmi-btn'); await page.selectOption('#f-existing', 'RMI-019'); await page.selectOption('#f-group', 'RMG05'); await page.click('#form-save'); await page.click('#edit-confirm'); await page.waitForSelector('.toast'); await page.waitForTimeout(400);
    cur = await snapWb(); d = pyDiff(prevFile, cur); prevFile = cur;
    eq(d.diff.map((x) => [x[0], String(x[3]).split('\n').slice(-1)[0]]), [['Risik analysis Alpha', 'RMI-019']], 'existing item: changed cells');
    r = await page.evaluate(() => window.__rre.state().M.by.risk.get('R.DB.2').items.map((o) => o.rmi.id).slice(-2)); eq(r, ['RMI-900', 'RMI-019'], 'items of R.DB.2');
  });
  await test('E4', 'Add a risk and a group: appended after the last row, formatted like the row above, index computed, text-column formula copied', async () => {
    await page.keyboard.press('Escape'); await nav(page, 'risks'); await page.click('#add-btn');
    await page.selectOption('#f-threat', 't:T.BSI.25'); await page.fill('#f-riskId', 'R.DB.9'); await page.fill('#f-description', 'Storage controller failure'); await page.fill('#f-component', 'Telemetry Database');
    await page.check('#f-core input[value="A"]'); await page.selectOption('#f-freq', 'medium'); await page.selectOption('#f-effect', 'considerable'); await page.selectOption('#f-category', 'mitigation'); await page.selectOption('#f-freqAfter', 'rarely'); await page.selectOption('#f-effectAfter', 'considerable');
    assert(/^Saved/.test(await save()), 'not saved');
    const cur = await snapWb(), d = pyDiff(prevFile, cur); prevFile = cur; const rows = [...new Set(d.diff.map((x) => x[1].replace(/[A-Z]+/, '')))];
    const exp = await page.evaluate(() => { const { M } = window.__rre.state(); const r = M.by.risk.get('R.DB.9'); return { row: r.row + 1, last: Math.max(...M.risks.filter((x) => x !== r).map((x) => x.row)) + 1, idx: [r.index, r.residual], thr: r.threat.id }; });
    eq([rows, exp.row, exp.idx, exp.thr], [[String(exp.last + 1)], exp.last + 1, [15, 10], 'T.BSI.25'], 'new row / computed indices / threat');
    assert(Object.values(d.styles).length > 5 && Object.values(d.styles).every(Boolean), 'new cells not formatted like the row above');
    assert(d.diff.some((x) => /^P\d+$/.test(x[1]) && /^=_xlfn\.TEXTJOIN/.test(String(x[3])) && String(x[3]).includes('O' + exp.row)), '“Risk treatment option” formula not copied to the new row');
    /* a new group: appended after the last group, its Content gets the formula of the row above */
    await page.keyboard.press('Escape'); await nav(page, 'mitigations'); await page.click('#add-btn'); await page.fill('#f-id', 'RMG11'); await page.fill('#f-name', 'Supplier management'); assert(/^Saved/.test(await save()), 'group not saved');
    const cur2 = await snapWb(), d2 = pyDiff(prevFile, cur2); prevFile = cur2;
    const k = d2.diff.find((x) => /^K\d+$/.test(x[1])), gr = d2.diff.find((x) => x[3] === 'RMG11');
    assert(gr && k && k[1].slice(1) === gr[1].slice(1) && /^=_xlfn\.TEXTJOIN/.test(String(k[3])) && String(k[3]).includes('J' + gr[1].slice(1)), 'Content formula not copied to the new group row: ' + JSON.stringify(d2.diff));
  });
  await test('E5', 'Rename a component and an assumption title: propagated to every risk and assumption that uses them', async () => {
    await page.keyboard.press('Escape'); await nav(page, 'components'); await page.click('.comp-card:has-text("Update Server")'); await page.waitForSelector('.drawer'); await page.click('#edit-btn'); await page.fill('#f-name', 'Update Service'); assert(/^Saved/.test(await save()), 'component not saved');
    let r = await page.evaluate(() => { const { M } = window.__rre.state(); return [!!M.by.component.get('Update Server'), M.by.component.get('Update Service').risks.length, M.by.component.get('Update Service').assumptions.length]; }); eq([r[0], r[1] > 2, r[2] > 0], [false, true, true], 'component renamed everywhere');
    await page.keyboard.press('Escape'); await nav(page, 'assumptions'); await page.click('.obj-head:has-text("A.4") .icon-btn'); await page.waitForSelector('.drawer'); await page.click('#edit-btn'); await page.fill('#f-title', 'Devices have a hardware root of trust (secure element)'); assert(/^Saved/.test(await save()), 'assumption not saved');
    r = await page.evaluate(() => { const { M } = window.__rre.state(); return M.issues.filter((i) => i.code === 'W_ASSUMPTION_TITLE' && i.refs.some((o) => o.id === 'A.4')).length; }); eq(r, 0, 'risks citing A.4 with the old title');
    prevFile = await snapWb();
  });
  await test('E8', 'Relevance is edited per risk: only that risk’s “Threat relevance” cell changes; the threat form has no relevance field', async () => {
    await openObjBy('T.BSI.43'); await page.click('#edit-btn'); await page.waitForSelector('dialog[open] #f-name'); eq(await page.locator('dialog[open] #f-relevance').count(), 0, 'relevance field in the threat form'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const before = await snapWb(); await openObjBy('R.DB.2'); await page.click('#edit-btn'); await page.fill('#f-relevance', 'Not relevant: decommissioned'); const msg = await save(); assert(/^Saved/.test(msg), msg);
    const cur = await snapWb(), d = pyDiff(before, cur); prevFile = cur;
    eq(d.diff.map((x) => [x[0], x[3]]), [['Risik analysis Alpha', 'Not relevant: decommissioned']], 'changed cells'); eq(d.diff[0][1].replace(/\d+/, ''), 'D', 'column “Threat relevance”');
    eq(await page.evaluate(() => window.__rre.state().M.by.risk.get('R.DB.2').notRelevant), true, 'R.DB.2 now not relevant');
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
    eq(cur.entries.length, 9, 'saves in the current log');
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
