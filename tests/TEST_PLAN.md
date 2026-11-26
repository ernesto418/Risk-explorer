# Test plan — Risk Register Explorer

Run everything: `node tests/run.cjs` (Node 18+, Playwright with Chromium). It rebuilds the tool, runs the tests below and
writes `tests/results/report.md` / `report.json`; exit code 1 on any failure. Fixtures are fictional (`tests/fixtures`,
regenerate with `python3 tests/make_fixtures.py`). Write-mode tests use a private in-browser folder, never a real one.

Priority 1 is **“nothing is modified by mistake”**: outside write mode nothing is written at all; in write mode the workbook
changes only in the cells of the confirmed edit (checked cell by cell before and after saving), existing baselines are never
changed or deleted, and a log only ever gets entries appended.

## Automated (in `run.cjs`)

| ID | Guards against | What is verified |
|----|----------------|------------------|
| S1 | data leaving the machine, injected code, deletions | no network, HTML-injection, delete or save-as API in any source file |
| S2 | writes from unexpected code | the only disk-write calls are inside `safeWrite()`; `readwrite` access is requested in one place |
| S3 | network access at run time | CSP `default-src 'none'`, `connect-src 'none'`, script/style pinned by hash, no external resources |
| S4 | writes in read-only mode | full tour of all views on the shipped file: 0 file writes/creates/deletes, 0 requests, 0 errors, only the theme in localStorage |
| S5 | cell content executed as code | `<img onerror>`, `<script>`, `<svg onload>`, `<iframe>` in cells are shown as text |
| S6 | unregistered third-party code | every file in `src/vendor/` is listed in its README with library, version, source, license and matching SHA-256 |
| W1 | accidental activation | write mode off by default; needs a name; enabling writes nothing |
| W2 | wrong files written | first baseline = exactly 1 `.xlsx` (byte-identical) + 1 JSON; workbook hash unchanged and never opened for writing |
| W3 | duplicate baselines | unchanged workbook → nothing written |
| W4 | history rewritten | second baseline: earlier baseline and log byte-identical; log lists exactly the edited objects, fields and lines |
| W5 | overwrite / path escape | `safeWrite` refuses other folders, `..`, the workbook name, non-generated names, existing files |
| W6 | writes after switching off | no write possible; History still readable with read access |
| W7 | hidden side effects | whole session: 4 writes (2 baselines + 2 logs), 0 deletions, folder content exactly as expected |
| H1 | wrong history shown | logs listed newest first with author, objects, old → new values, added/removed lines |
| H2 | wrong comparison | baseline A vs B = the logged changes; latest baseline vs current workbook = no change |
| H3 | missing object history | side panel of a changed risk shows its change entry |
| F1 | misread workbook | sheets found, “Assumed Risks Beta” ignored, object counts |
| F2 | silent checks | each seeded mistake is reported; top-bar counters equal the model |
| F3 | reader differences | Excel-style (rich text, CR escapes) and LibreOffice copies give the identical model |
| F4 | wrong matrix | chips in cells = risks of the model; risks/threats switch |
| F5 | wrong links | Connections hover and multi-focus (two clicks = A AND B) show only the risks linked in the risk analysis |
| F7 | wrong multi-select | Ctrl+click collects several objects; nothing applied until Ctrl is released; same type = OR (union of their risks) |
| F8 | wrong click action | fast and slow double-click (second click after the redraw, same spot) open the details and leave the focus unchanged |
| F9 | wrong item-group link | an item belongs exactly to the groups whose “RMI ID” cell lists it; an item used by risks but in no group is one consistency error (C_NOT_IN_GROUP); an item linked to no risk is a warning (W_UNUSED_RMI), also when a group lists it (badge on the group) |
| F10 | wrong RMI identity / text | links come only from the “RMI ID” columns (checked against an independent reading of the cells); texts only from “Risk mitigations individual”; one C_RMI_UNKNOWN per use of an unknown ID (with “this is the text of …” hint); hand-typed “Risk treatment option” / “Content” cells are W_NOT_FORMULA and do not change the links |
| F11 | silently mis-read RMI ID cells | other spelling, text after the ID, several IDs on one line (risk and group) are F_RMI_REF and read as the intended IDs; a duplicate ID is reported and kept once; formulas without results in unread columns do not raise W_UNCACHED |
| F12 | wrong relevance | “Threat relevance” is read per risk; not relevant iff the words “not relevant” appear (any case, any position); threats have no relevance; an empty cell and a look-alike text are warnings and count as relevant |
| F13 | hiding too much / too little | “Hide not relevant” on by default and independent in Risks, Threats, Groups, Items and Connections; exact counts on/off; unused items stay visible; BSI tile of a threat with only not-relevant risks is blank with the filter on and off |
| F14 | empty view / hidden numbers | Connections opened from a not-relevant risk switches only that filter off and highlights the button; group boxes show relevant (total) with the tooltip; not-relevant risks are listed last and marked |
| F16 | misread search | parser and printer: AND before OR, symbols `& \| !`, names with spaces (quoted or not), type prefix, double NOT; switching one operator regroups correctly; every error message (missing AND/OR, early end, brackets, unknown ID with “did you mean”, quote, unknown @name, empty brackets, removed item) with its position |
| F17 | wrong search result | `A OR B`, `(A OR B) AND NOT m`, two assumptions with AND, component AND NOT threat, single item, group AND threat, unused item, impossible AND: risks shown = an independent computation on the model; each column keeps only the objects the search names |
| F18 | focus bar does something else | clicking “and” switches it to “or” (and back), with three terms “(A and B) or C” shown with one bracket box; ¬ negates, “not” and × undo; shown risks follow |
| F19 | search box misplaced or autocompletion inserts wrong text | header order (Export, Hide not relevant, filter buttons, compact box); a search built by clicks is shown in the box, cut with “…” (full text in the tooltip); a click opens the large editor below the focus bar; suggestions for a partial ID, ↑ ↓ Enter / Tab insert the chosen ID or the quoted name with spaces; Enter applies, closes the editor and switches on the needed column; an unknown ID is marked and nothing is applied; unapplied text keeps the editor open, × / Esc / leaving without changes close it |
| F20 | content filters find the wrong objects | builder by clicks offers every object type and every attribute (errors and warnings included); preview counts = independent counts (contains any case, does not contain, is not empty on errors, check code in warnings, whole word vs substring); save and add; AND NOT from the library; saved search used inside another; a search cannot use itself; a filter in use cannot be deleted; renaming updates saved searches |
| F21 | library lost, leaked or poisoned | download = JSON file with exactly the library, no file-system write, nothing in localStorage; a new tab starts empty; loading restores filters and searches; a file of another format is refused; invalid entries (bad name, unknown attribute, empty search) are skipped |
| F22 | search lost or export unclear | reloading the workbook keeps the search and its result; the Connections export states the search and the definition of each @filter; Paths rows = risks shown |
| F23 | wrong point of view | Dominance off by default (no crowns); on: a crown above every active column, the leftmost selected, one at a time, a crown in the dominant column header; crown on items: `RMG01 AND RMG04` = no item (none is in both), crown on risks: the risks treated by both (R.UPD.1 among them), their items of the two groups and the two groups; crown on items, `RMG01`: its items, the group, their risks; crown on components, `RMG01`: only the risks on the paths; crown on components without search: only assumptions reached from a component through a visible risk; switching the dominant column off moves the crown to the leftmost active column; editor count and export follow the dominance; off = the results as before; AND of two objects of the dominant type never holds |
| F15 | removed items shown or linked | items with “Removed” = yes are absent from search, counts, risk panels and Connections, and appear only in the items tab with “Hide removed” off (and in its search); every reference to one is a C_RMI_REMOVED error and not linked; no other finding on removed items (same text as an active item, unused, no text); an invalid value is a format error and the item stays active |
| X1 | broken or partial export | every module downloads a valid .xlsx (opened with openpyxl), row counts equal the model (minus what “Hide not relevant” hides), About sheet present, no file-system write |
| E0 | deprecated editing reachable | in write mode no Edit / Add button exists (`edit.enabled` false). The E tests below then switch the deprecated code on in the test build only |
| E1 | editing changes more than asked | edit one risk field → exactly that cell differs (independent openpyxl diff of the whole workbook); save appended to the current log |
| E2 | text written in several places | rename a mitigation item → only its “Mitigation item” cell changes; risks and groups keep the link; fullCalcOnLoad is set (E1 checks it is not set when no formula is involved) |
| E3 | item without group / ID | adding an item is refused without a group, with an existing RMI ID or with the text of an existing item; the RMI ID is appended as a new line to the risk and the group cell, and a row (ID, text, shifted Groups/Assigned formulas) to “Risk mitigations individual”; adding an existing item already in the group changes only the risk cell |
| E4 | new row unlike the others | new risk and new group appended after the last row, same cell styles as the row above, risk index computed, “Risk treatment option” / “Content” array formula copied and shifted to the new row |
| E5 | stale copies of a name | renaming a component / assumption title updates every risk and assumption that uses it |
| E8 | relevance written in the wrong place | the threat form has no relevance field; editing a risk's relevance changes exactly its “Threat relevance” cell |
| E6 | overwriting someone else's version | if the workbook changed on disk since loading, nothing is saved; no file outside the workbook and the two folders |
| E7 | logs rewritten | a baseline saves the Excel version and starts a new log; earlier logs stay byte-identical |
| F6 | crash on bad input | non-ZIP, encrypted/legacy, unrelated workbook → clear message, tool stays usable |

## Still to automate

- Reader: ZIP64, stored entries, Strict OOXML, formulas without cached value, hidden/chart sheets, `~$` lock file.
- Model: one minimal positive/negative fixture per check code; all 16 frequency × effects products and band limits;
  “RMI ID” cells with dynamic-array formulas (`cm`) written by real Excel;
  accepted risks without “after” values; component splitting; duplicate IDs in change logs.
- Write mode: revoked folder permission, disk full, two baselines within the same second, very long/special author names,
  workbook replaced between reading and writing, corrupted or foreign JSON in `change-logs/`.
- History: removed/added objects, group content changes, >100 logs (performance), baselines deleted by hand.
- UI: keyboard-only use, Firefox (read-only), widths 1280–1920 px, visual regression light/dark, 500 risks performance.

## Manual acceptance with the real workbook (risk owner)

1. Note the SHA-256 of the workbook; work through all views and create two baselines; the hash must be unchanged.
2. Compare 10 random risks field by field with Excel and the matrix counts with an Excel pivot.
3. Review every finding (true/false positive); turn false positives into new anonymised fixtures.
4. Open each baseline in Excel: it must open normally and equal the workbook at that time.
