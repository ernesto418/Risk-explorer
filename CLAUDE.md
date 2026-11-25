# CLAUDE.md — instructions for coding agents

Risk Explorer is a single-file, offline web app (plain JavaScript, no dependencies) that reads — and in optional write
mode edits — a BSI 200-3 cybersecurity risk analysis kept in an Excel workbook.

## Start here
1. Read the **Index** and **§0 Routing table** of [`ARCHITECTURE.md`](ARCHITECTURE.md).
2. Read only the sections the routing table lists for your task (always §1 and §15).
3. Use the recipes in §18 for common changes.

## Hard rules (do not break)
- **No network, no libraries, no CDN, no web fonts.** Everything stays inline in one HTML file; the CSP must stay
  `default-src 'none'` with hash-pinned script/style (ARCHITECTURE §3, §14).
- **Nothing is modified by mistake.** Disk writes only through `safeWrite` / `safeAppendLog` / `writeWorkbookFile`
  (which call `rawWrite`) in `src/js/07w-write.js`. Never add another write path, delete API or overwrite of existing
  baselines/logs. Workbook edits must go through the `ChangeSet` pipeline in `07z-edit.js` (preview → verify → write).
- **Render workbook text only as text** (`h()` / `textContent`), never `innerHTML`.
- **UI, code and docs in English.** The project owner writes in Spanish — answer them in Spanish.
- **Never commit real workbooks, baselines or change logs**; fixtures and the sample are fictional.
- **Workbook editing is DEPRECATED and disabled in the UI** (`edit.enabled = false` in `src/js/07z-edit.js`, owner
  decision 2026-11). Keep the code (it will be rebuilt), do not extend it or re-enable it without the owner; the E tests
  switch it on only in the test build (`window.__rre.edit.enabled = true`).
- If a requested change has a technical or logical ambiguity (especially anything that writes to the workbook), stop
  and ask the owner before implementing.

## Commands
```bash
node build.mjs
node tests/run.cjs
python3 tests/make_fixtures.py
```
Build → `dist/risk-register-explorer.html`. Tests need Playwright + Chromium and Python openpyxl (fixtures also need
LibreOffice). File load order = alphabetical file names in `src/js/` (ARCHITECTURE §3).

## Definition of done
- `node tests/run.cjs` green; new rules/editable fields have a test (`tests/TEST_PLAN.md` updated).
- `dist/risk-register-explorer.html` rebuilt and committed.
- `README.md` and `ARCHITECTURE.md` updated where behaviour or structure changed (add a decision to §16 if you made one).
