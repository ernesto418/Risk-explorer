# Architecture — Risk Explorer

How the code is built and why. Read the **index**, then use the **routing table** to read only the sections your
change needs. Sections are self-contained; cross-references are given as `§n`.

## Index

| § | Section | Read it when you… |
|---|---|---|
| 0 | [Routing table](#0-routing-table) | start any task |
| 1 | [Goals and hard constraints](#1-goals-and-hard-constraints) | always (short) |
| 2 | [Repository layout](#2-repository-layout) | look for a file |
| 3 | [Build and runtime](#3-build-and-runtime) | add a file, touch the build, CSP, the test hook |
| 4 | [Workbook format and domain rules](#4-workbook-format-and-domain-rules) | touch anything that reads or writes workbook content |
| 5 | [XLSX reader](#5-xlsx-reader-02-xlsxjs) | have a file that does not open or reads wrong |
| 6 | [Domain model and checks](#6-domain-model-and-checks-04-modeljs) | change how objects are built, linked or checked |
| 7 | [Configuration](#7-configuration-03-configjs) | change scales, thresholds, allowed values, issue texts |
| 8 | [UI architecture](#8-ui-architecture-01-05-08) | change shared UI pieces, routing, state, side panel |
| 9 | [Views](#9-views-06-07-07x) | change a specific screen |
| 10 | [Write mode, baselines and change logs](#10-write-mode-baselines-and-change-logs-07w-writejs) | touch anything that writes to disk |
| 11 | [Editing the workbook](#11-editing-the-workbook-07z-editjs) | add/change an editable field or an “Add …” action |
| 12 | [History](#12-history-07x-historyjs) | change how logs/baselines are shown or compared |
| 13 | [Export to Excel](#13-export-to-excel-07y-exportjs) | change exported sheets/columns |
| 14 | [Security and privacy](#14-security-and-privacy) | add any I/O, HTML rendering, storage |
| 15 | [Testing](#15-testing) | always before finishing |
| 16 | [Decision log](#16-decision-log) | wonder “why is it done like this?” |
| 17 | [Known limitations and open points](#17-known-limitations-and-open-points) | plan a larger change |
| 18 | [Recipes](#18-recipes) | do a common change step by step |

## 0. Routing table

| Task | Read |
|---|---|
| New/changed format or consistency check | §4, §6, §7, §15, recipe 18.1 |
| New column in a sheet (read) | §4, §6, recipe 18.2 |
| New editable field / new “Add …” action | §4, §10, §11, §15, recipe 18.3 |
| New view or change a view | §8, §9, recipe 18.4 |
| Matrix, colors, thresholds, scale values | §7, §9 |
| Connections view (focus, hover, clicks) | §9.8 |
| Connections search (logical search, content filters, library) | §9.8, §9.11, §14, recipe 18.6 |
| Baselines, logs, History | §10, §12 |
| Export | §13 |
| Workbook does not open / wrong values | §5, §4 |
| Anything touching disk, network or HTML injection | §14 first, then §10 |
| Build, CSP, icon, single-file output | §3 |
| Use a third-party library / external code | §1, §3, §14, recipe 18.5 |

## 1. Goals and hard constraints

- **Local only.** No network at runtime, no CDN, no web fonts loaded from URLs. Enforced by the CSP (§3) and tests
  S1/S3. **Third-party libraries and external code are allowed** if they are vendored in `src/vendor/` and inlined into
  the built HTML, so it keeps working 100 % offline (recipe 18.5). The current code uses none (see D2).
- **Single HTML file** for users (`dist/risk-register-explorer.html`); sources stay modular in `src/`.
- **Excel stays the database.** The app interprets it; it does not replace it.
- **Nothing is modified by mistake.** Read-only by default; every disk write goes through one guarded function family
  (§10); workbook edits are verified cell by cell (§11).
- **English UI.** (The project owner communicates in Spanish; code, UI and docs are English.)
- **Single user** on the workbook (no concurrent Excel co-authoring while the app writes).
- Target browsers: current Edge/Chrome (write mode needs the File System Access API); Firefox read-only.

## 2. Repository layout

```
build.mjs                  concatenates src/ into dist/ (no dependencies)
src/index.template.html    page skeleton + CSP with hash placeholders
src/styles.css             all styles (light/dark via CSS variables)
src/vendor/                optional third-party code (*.js / *.css), inlined before the app; registry in its README.md
src/js/01-util.js          DOM builder h(), icons, string/number helpers, fuzzy matching
src/js/02-xlsx.js          minimal read-only XLSX/ZIP reader
src/js/03-config.js        scales, bands, categories, BSI threat catalogue, issue catalogue
src/js/04-model.js         buildModel(): sheets -> linked objects + all checks
src/js/05-ui-core.js       shared UI: chips, pills, badges, object cards, detail renderers, side panel, filters
src/js/05q-query.js        search language of Connections: expression trees, parser/printer, content filters, library, evaluation
src/js/06-views-a.js       views: overview, risk matrix, risks, threats
src/js/07-views-b.js       views: mitigations, assumptions, components, connections, issues
src/js/07c-search.js       search UI of Connections: search field + autocomplete, focus bar, library panel, filter builder
src/js/07w-write.js        write mode: guarded disk writes, baselines, change logs, snapshot/diff
src/js/07x-history.js      History view and per-object change history
src/js/07y-export.js       Export to Excel (own XLSX writer)
src/js/07z-edit.js         editing the workbook (change sets, XML patching, verification, forms)
src/js/08-main.js          app shell: file opening, navigation, search, dialogs, theme, start-up
assets/                    icon (svg/png/ico); embedded into the HTML by build.mjs
sample/make_sample.py      generates the fictional sample workbook (with deliberate mistakes)
tests/                     run.cjs (Playwright suite), TEST_PLAN.md, xlsx_diff.py, make_fixtures.py, fixtures/
dist/                      built single file (committed for users)
```

## 3. Build and runtime

- `node build.mjs` reads every `src/js/*.js` **in alphabetical order**, concatenates them into one
  `(() => { "use strict"; … })()` and inlines it with `styles.css` into `index.template.html`.
  Consequences: all files share one scope (top-level `const`/`function` are visible to later files); **the file name
  decides load order** (`05-ui-core` < `05q-query` < `06`, `07-views-b` < `07c-search` < `07w` < `07x` < `07y` < `07z` < `08`). Top-level code that runs immediately
  may only use what earlier files defined; functions may reference later files because they run after start-up.
- Before the app, `build.mjs` inlines **`src/vendor/*.js`** (alphabetical, classic-script scope, each ends with `;`;
  `</script` is escaped) and **`src/vendor/*.css`**. Vendor scripts run first and expose their API on `globalThis`;
  the app (inside its IIFE) uses them as globals.
- The CSP in the template is filled with the **SHA-256 of the exact script and style**:
  `default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…'; img-src data:; connect-src 'none'; …`.
  Never add `unsafe-inline`, external URLs or `<link href>` other than `data:` (test S3).
- The icon is embedded as `data:` URIs (`assets/icon.svg`, `icon-32.png`, `icon-256.png`).
- `node build.mjs --test` writes `dist/risk-register-explorer.test.html` that additionally exposes
  `window.__rre = { state(), write, hist, safeWrite, snapshot, diffSnapshots, EXPORTS, edit, Q }` (`Q` = parser, printer,
  evaluation and library of the search, §9.11). It is used only by
  tests, deleted after the run, and git-ignored. The shipped file has no hook.
- Start-up (`08-main.js`, last lines): `initTheme()`, `initTooltip()`, `initFileHandling()`, `renderApp()`.

## 4. Workbook format and domain rules

Sheets are recognised by **header names** (`findHeader`, first 60 rows), not by position or sheet name (the name only
breaks ties). Column lookup uses case-insensitive, whitespace-normalised header text; several headers match by prefix
(`Frequency…`/`Effects…`/`Risk index…`, with or without `after`). See §17 for the risk of look-alike headers.

| Sheet (role) | Key rules |
|---|---|
| **Risk analysis** (“Risik analysis Alpha”) | One row per risk. Threat ID `T.BSI.<n>` and Threat `G 0.<n> <name>` may be **merged** across the risk rows of a threat (the reader fills merged cells). Risk ID `<letters>.<letters>.<n>`. **Threat relevance**: one value **per risk** (not per threat): not relevant = the words “not relevant” anywhere, any case (`relevanceOf`). Core values: comma list of Confidentiality/Integrity/Availability. Related assumptions: lines starting with `A.<n>`. Frequency/Effects: fixed lists (§7). **RMI ID**: the RMI IDs of the risk’s mitigation items, one per line. **Risk treatment option**: a formula that shows the texts of those IDs — **not read**, only checked to be a formula. |
| **Architecture Assumptions** | One row per assumption, ID `A.<n>`. “Linked risks” is usually empty: links are **derived** from the risks’ “Related assumptions”. |
| **Risk Mitigation Groups** | One row per group (RMG). **RMI ID**: the RMI IDs of the items in the group, one per line. **Content**: a formula that shows their texts — **not read**, only checked to be a formula. |
| **Risk mitigations individual** | **Master list of mitigation items (RMI)** and the **only place that holds their text**: RMI ID + Mitigation item; Extended Description, Comment, Responsible. “Groups” and “Assigned” are formulas generated from the group sheet — **not read and not checked**. **Removed**: empty / no = active, yes = removed (any case), other = `F_VALUE` and active. |

Core domain rules (implemented in §6):
- **Risk index = frequency value × effects value** (rarely 2, medium 3, frequently 6, very frequently 7;
  negligible 1, limited 3, considerable 5, threatening the existence 7). Bands: ≤10 low, 11–20 medium, >20 high.
- **Accepted risks** without an after-treatment assessment keep their initial position/index in “after” views
  (`risk.assumedAfter`, `risk.residual`).
- **Mitigation items are identified by RMI ID.** Risks and groups refer to master-list items through their “RMI ID”
  cells; the text always comes from the master list. An ID that is not in the master list is `C_RMI_UNKNOWN` (once per
  use). A line that is not exactly one ID (several IDs on one line, other spelling, text after the ID) is `F_RMI_REF`
  and is read as the intended ID where it can be recognised.
- **Item → group link = the group’s “RMI ID” cell lists the item’s ID.** An item used by a risk but listed by no group
  is `C_NOT_IN_GROUP` (error); an item linked to no risk is `W_UNUSED_RMI` (warning), also when a group lists it.
- **Components** come from “Affected component” (split on `;`/line breaks; on commas only if every part is a known
  single name).

## 5. XLSX reader (`02-xlsx.js`)

- Own ZIP reader (central directory, ZIP64, stored/deflate via the browser’s `DecompressionStream`) and XML via
  `DOMParser`. Reads shared strings, inline strings, rich-text runs (phonetic runs skipped), `_xHHHH_` escapes,
  CR/LF → `\n`, booleans, cached formula results, merged ranges (filled with the top-left value).
- Returns `{ sheets: [{ name, path, hidden, rows[r][c], merges, formulas, uncached, formulasWithoutValue }], zip, wbPath }`.
  `rows` holds the stored (cached) result of formula cells; `formulas` is the Set of `"r:c"` of every formula cell
  (used by `W_NOT_FORMULA`); `uncached` lists formula cells without a stored result (no `<v>`, or an empty numeric
  `<v/>` as written by openpyxl). `W_UNCACHED` counts only those in columns the model reads.
  `zip.list()` / `zip.raw()` expose entries and compressed bytes so §11 can rebuild the archive byte-for-byte.
- Detects OLE files (legacy `.xls`, password/label-encrypted) and non-ZIP input with explicit messages.
- **Why own reader:** written when libraries were not allowed; the subset needed is small and it gives byte-level
  control needed by the editor (§11). Replacing it with a vendored library is possible but must keep `zip.list()` /
  `zip.raw()` and the verification of §11.

## 6. Domain model and checks (`04-model.js`)

`buildModel(wb, fileInfo)` → `M` with:
`assumptions, threats, risks, rmis, groups, components, issues`, maps `M.by.<type>` (keyed by ID; RMIs by `m.key`),
`sheetReport`, `sheetNames`, `sheetObj` (raw sheets by role), `cols` (column index per field and role),
`lastRow` (per role, for appending), `wb`, `stats`.

Order inside `buildModel` (matters for cross-references):
1. locate sheets and columns; 2. groups (IDs and raw “RMI ID” only); 3. assumptions; 4. RMI master list (by ID, text
duplicates `W_DUP_TEXT`), then risks (threats are created on the fly per Threat ID; each ID of the risk’s “RMI ID” cell
becomes an occurrence `occ` linked to an RMI via `readRmiRefs`); 5. components; 6. risks ↔ assumptions; 7. group “RMI
ID” cells → items (`readRmiRefs`); 8. item ↔ group/risk links by ID, item checks (`C_NOT_IN_GROUP`, `W_UNUSED_RMI`,
`W_MULTI_GROUP`, only for master-list items), derived `g.rmis`, `g.risks`, `risk.groups`; `W_UNCACHED`.
Removed items (`m.removed`): `M.rmis` holds the **active** items only, `M.allRmis` also the removed ones (used only by
the Mitigations items tab, its export and `snapshot`; `M.by.rmi` holds all so findings can open them). A reference to a
removed item is not linked: it goes to `owner.removedRefs` and raises `C_RMI_REMOVED`; removed items get no usage or text
checks (`C_DUP_ID` still applies).
`readRmiRefs` is the single reader of “RMI ID” cells (tolerant parsing, `F_RMI_REF`, `C_RMI_UNKNOWN`, `W_DUP_LINE`);
`checkFormula` emits `W_NOT_FORMULA` when “Risk treatment option” / “Content” is not a formula.

Object shapes (main fields): every object has `type, id, issues[]`, and `sheet,row` when it maps to a row.
- `risk`: `threat, description, components[], coreValues[], assumptions[], freq/effect/freqAfter/effectAfter` (config
  items), `…Raw` strings (incl. `rmiRaw`, `relevanceRaw`), `notRelevant`, `index, indexAfter, residual, assumedAfter, category, items[occ], groups[]`.
- `occ` (one ID in a risk’s “RMI ID” cell): `risk, rmi, line, raw, text (= rmi.text), groups (= rmi.groups)`;
  group `item` (one ID in a group’s “RMI ID” cell): `group, rmi, line, raw, text`.
- `rmi`: `id`, `key` (unique; `?<id>` for unknown IDs), `base` (row in the master list; false = referenced ID that is not
  there, no text), `text, occ[], listed[], groups[], risks[]`, master fields `extDescription, comment, responsible`.
  UI shows the text through `rmiText(m)`.
- `threat`: `id, name, title, num, risks[]` (no relevance: it belongs to the risks); `group`: `id, name, treatment, rmiRaw, items[], rmis[], risks[]`;
  `assumption`: `id, title, …, risks[], components[]`; `component`: `name, risks[], assumptions[]`.

`onlyNotRelevant(o)`: a not-relevant risk, or an object whose risks are all not relevant (false without risks). It is
the single rule behind every “Hide not relevant” filter, the blank BSI tiles and the automatic switch-off (§9).

**Issue system.** `addIssue(code, msg, {sheet,row,col,line,excerpt,hint,on:[objects]})`. The code’s category
(`format` / `consistency` / `warning`), title and explanation live in `ISSUE_TYPES` (§7). `on` attaches the issue to
objects; the UI shows per-object badges and the Errors view groups them. Every issue must point to a sheet/cell/line
so it can be fixed in Excel.

**Why:** one pass builds a fully linked in-memory graph so every view is a cheap read; Excel’s “one cell, many
items” is normalised into objects (decision D3).

## 7. Configuration (`03-config.js`)

`CFG.freq`, `CFG.effect` (keys, labels, values, regex for accepted spellings incl. the workbook typo “threatining”),
`CFG.bands` (thresholds), `CFG.categories` (A–D treatment options), `CFG.coreValues`, `CFG.patterns` (ID formats),
`BSI_THREATS` (47 elementary threats with C/I/A from BSI 200-3 Table 1), `ISSUE_CATS`, `ISSUE_TYPES`.
Change values here, never hard-code them in views. Issue codes are referenced by tests (F2), keep them stable.

## 8. UI architecture (01, 05, 08)

- **No framework.** `h('tag.class', {props}, …children)` builds DOM; children are always text nodes
  (`textContent`), never HTML strings (§14). `svg()` for SVG, `icon(name)` from the `ICONS` path table.
  Use `add()/fill()` helpers (they flatten arrays and skip null) instead of `el.append()` with arrays.
- **State**: global `M` (model) and `state` (`file, handle, hash, view, drawer stack, expanded cards, ui.<view>
  filters`). Views keep their filter state in `state.ui.<view>` so it survives navigation. The Connections search is
  `state.ui.flow.focus` (an expression tree or null, §9.11); the library of content filters and saved searches is the
  global `searchLib` (in memory only).
- **Routing**: `location.hash` `#/<view>` → `showView()` renders `VIEWS[key]()` into `<main>`, then appends the
  view’s **Add** button (§11) and **Export** button (§13) to the view header.
- **Side panel** (`openObj(o)`, `renderDrawer`): stack with back button; content from `DETAIL[type]`; plus Edit
  buttons (§11) and Change history (§12). `objCard` = expandable card used by list views.
- Tooltips: any element with `data-tip` (`tip:` prop). Theme: `data-theme` on `<html>`; colours as CSS variables in
  `styles.css` (palette validated for colour-vision deficiency; status colours always with icon + label).

## 9. Views (06, 07, 07x)

Each `VIEWS.<key>` returns a fresh element; heavy views redraw only their body on filter changes.
1. **overview** – KPIs, profile bars, count matrices, top residual risks, treatment/core-value bars, quality tiles.
2. **matrix** – 4×4 grid; cells list risks or threats; before / after / side by side / movement (SVG arrows).
3. **risks** – filterable, groupable list of risk cards. 4. **threats** – 47-tile BSI coverage + threat cards.
5. **mitigations** – groups (reach bars, cards) and all items. 6. **assumptions**. 7. **components** – heat map.
8. **connections** – columns of object types, links derived through risks, SVG curves.
   Focus = the **search**, an expression tree (`state.ui.flow.focus`, §9.11). A plain click adds the object with AND;
   a Ctrl/Cmd+click batch (applied on key release) adds one OR term per object type. The search can also be typed
   (search field with autocompletion) and combined with content filters and saved searches (§9.11). Every change goes
   through `setFocus(expr, {cols, refocus})` inside the view. Hover highlights only objects linked through the
   hovered object’s own risks (as far as the search shows them for each risk). Single click is delayed 280 ms; a double
   click (also a slow one on the same spot within 650 ms) opens details and never changes the focus (`clickTimer`,
   `lastClick`, `flowUndo`).
9. **history** (§12). 10. **issues** – findings grouped by check / object / sheet & row.
11. **Search in Connections** (`05q-query.js` logic, `07c-search.js` UI).
   - *Expression tree* (immutable): `{k:'obj', o}` | `{k:'ref', name}` (library entry, written `@name`) | `{k:'not', a}` |
     `{k:'and'|'or', c:[…]}`; `exprSimplify` flattens same-operator children, drops single-child nodes and double NOT.
   - *Language* (`qParse` / `exprToText`): IDs or component names (quoted when they have spaces; an unquoted run of
     words that is a known name is accepted), `AND`/`&`, `OR`/`|`, `NOT`/`!`, brackets, `@name`, `type:ID` only when two
     types share an ID. **AND binds before OR.** Errors carry the position (`{msg, s, e}`) and a “did you mean”.
   - *Semantics* (`evalFocus`): the view is built from **anchors** = every visible risk with the objects it links, plus
     objects no visible risk links (unused items with their groups, empty groups, components/assumptions without
     visible risks) — without a search the anchors are exactly what the view showed before. Every term asks whether an
     anchor is linked to the object (a content filter: to any object it finds); AND / OR / NOT combine the answers per
     anchor, so `A AND B` (same type) = risks linked to both. For display the search is put in disjunctive normal form
     (`qDnf`, at most 512 conjunctions, otherwise no column restriction): for every satisfied conjunction each column
     keeps only the objects the conjunction names positively (`qRestrict`; groups narrow the items to those in the
     groups, the groups column follows the items shown). Edges are drawn per conjunction, weight = number of risks.
   - *Focus bar* (`flowFocusBar`): the tree as chips; every “and” / “or” is a button that flips **that** operator and
     regroups the node with AND before OR (`exprToggleOp`: “A and B and C” → “(A and B) or C”); nested nodes are drawn
     as bracketed boxes; ¬ negates a chip, the red “not” removes the negation, × removes the chip.
   - *Search field* (`flowSearchRow`): always in sync with the focus (`ui.draft` holds unapplied text); live validation
     (“reads as …”, number of matching risks); suggestions for the word at the caret (objects by ID/name, then by title;
     `@` lists the library; AND/OR/NOT where they fit); ↑ ↓ Enter/Tab; Enter applies; applying switches on the columns of
     the types the search asks for (`exprTypes`).
   - *Content filters* (`FILTER_FIELDS`, `filterMatcher`, `filterSet`): one condition on one attribute of one object
     type — contains / does not contain a word or phrase (case-insensitive, optional whole word) / is empty / is not empty.
     Every type has “Any attribute” (own attributes, not links) and **Errors** / **Warnings** (title, message, cell text and
     check code of its findings). Built by clicks in `filterDialog`: object type tiles → generic card of the type (every
     attribute with an example value and how many objects have one) → condition with a live preview (count + snippets).
   - *Library* (`searchLib.items`: filters and saved searches, unique names, `@name`): in memory while the tab is open
     (kept when a workbook is reloaded or another one is opened); **Download library** = JSON file via a `blob:` download,
     **Load library…** = a file input, every entry validated (`libItemFrom`), same name = replaced. Renaming a filter
     rewrites `@old` in saved searches and in the focus (`qRenameRef`); a filter used by a saved search cannot be
     deleted; a saved search cannot refer to itself (checked when saving and when evaluating).
   - After reading a workbook again the focus is remapped by type and ID (`exprRemap`); missing objects are dropped.

**Hide removed** (`removedToggle`, `state.ui.mit.hideRemoved`, on by default) exists only in the Mitigations items tab:
it is the only place where removed items can appear (with its own search). Everywhere else they are absent because
views read `M.rmis`.

**Hide not relevant** (`nrToggle` in a `.nr-slot`, always the last control of the view, aligned right; state
`state.ui.<view>.hideNR…`, on at start, kept while the tab is open): one
independent toggle in Risks (`risks.hideNR`), Threats (`threats.hideNR`, list only), Mitigations (`mit.hideNRg` groups
tab, `mit.hideNRi` items tab) and Connections (`flow.hideNR`: hides not-relevant risks and threats with only such risks;
every other column keeps its objects). Hidden = `onlyNotRelevant`; objects without risks are never hidden. The drawer’s
“Connections” button switches `flow.hideNR` off for such an object and sets `hideNRFlash` (one CSS highlight). A focus
that contains hidden objects shows an explanation with “Show not relevant” instead of an empty view. BSI tiles of
threats with only not-relevant risks are always “listed” (blank). Risk lists (`riskList`, RMI “Used in risks”) put
not-relevant risks last, marked (`nrTag`, `.rrow.nr`); group stat boxes show relevant values with the total in brackets
(`relevanceStats`).

## 10. Write mode, baselines and change logs (`07w-write.js`)

Write mode (`write = { on, author, dir }`) is enabled with a name and a folder picked with `showDirectoryPicker`.

**All disk writes go through `rawWrite()`, and only three guarded functions may call it** (enforced by test S2):
- `safeWrite(kind, name, data)` — new file in `baselines/` or `change-logs/` only; name must match a generated
  pattern; never the workbook name; **refuses existing files**; read-back hash check.
- `safeAppendLog(name, oldText, newObj)` — rewrites the current log only if the file is unchanged since read and the
  new content only **appends entries** (header and earlier entries must be identical).
- `writeWorkbookFile(handle, bytes)` — the workbook, only the opened handle, only if the file on disk still has the
  hash loaded (`state.hash`); restores the original bytes if the write fails.

**Baselines and logs.** *Create baseline* copies the workbook byte-for-byte to
`baselines/<YYYY-MM-DD_HHMMSS>_<workbook>.xlsx` (skipped if identical to the latest one) and **starts a new log**
`change-logs/<stamp>_<author>.json` (schema 2): header with author, time, hashes, previous baseline and the object-level
diff since it, plus `entries: []`. Every save from the editor appends `{type:'save', at, author, action, workbook
{sha256Before, sha256After}, cells[{sheet, cell, object, field, calculated, old, new}], summary, changes}` to the newest
log. A baseline never modifies an earlier log.
`snapshot(M)` / `diffSnapshots(a,b)` produce the object-level diff (risks, threats, assumptions, groups, master RMIs).
Risks and groups record their linked RMI IDs (`rmis`); added/removed IDs are logged as `linesAdded` / `linesRemoved`
and History shows them with the item’s current text.

## 11. Editing the workbook (`07z-edit.js`) — DEPRECATED

**Disabled in the UI** (owner decision 2026-11): `edit.enabled = false`, so `canEdit()` is false and no Edit / Add button
appears. The code below is kept until editing is rebuilt; the E tests switch it on in the test build only. Do not extend it.

Pipeline of every save:
1. **High-level edit → `ChangeSet`** (`editRisk`, `renameRmi`, `addRmi`, `editThreat`, `editAssumption`,
   `renameComponent`, `editGroup`, `addRisk`, `addAssumption`, `addGroup`). A change set holds cell writes
   (`set(sh,r,c,value,computed)`) and appended rows (`addRow`). Unchanged values are dropped. Merged-child cells and
   formula cells (unless “computed”) are refused.
2. **Preview** (`commit`): object, column header, cell, old → new, “calculated” marker. User confirms.
3. **Build** (`buildEdited`): parse only the touched sheet XMLs, patch cells (inline strings; style `s` kept), append
   rows copying the template row’s attributes and cell styles, shift template formulas for computed columns, extend
   conditional-formatting / data-validation / autofilter / table ranges that ended at the last row, set
   `fullCalcOnLoad` when formulas are involved. `rebuildZip` copies every untouched entry’s **compressed bytes as
   is**; only patched parts are re-deflated.
4. **Verify** (`verifyEdited`): re-read the new bytes and compare **every cell of every sheet** with the old workbook;
   only planned cells may differ; merges must be equal. Otherwise nothing is written.
5. **Write** (`writeWorkbookFile`, §10), **log** (`appendSaveLog`), **reload** the workbook and reopen the object.

Propagation rules (decided with the owner): the text of a mitigation item is written **only** in its master-list row
(risks and groups show it through their formulas; the save sets `cs.recalc` so `fullCalcOnLoad` makes Excel recalculate
on opening); assumption titles in “Related assumptions”; component names in risks and assumptions; threat names in every
row of the Threat ID (the threat form no longer has “Threat relevance”: it is edited per risk in the risk form). New values use the **spelling already used in the workbook** (`spelling()`); new rows go **after
the last row** of the table. Adding an item to a risk appends its RMI ID as a new line to the risk’s “RMI ID” cell and,
unless already there, to the chosen group’s (a group is required); a new item requires a new RMI ID and a text not used
by another item and gets a master-list row (ID + text). Text columns that are formulas (“Risk treatment option”,
“Content”, “Groups”, “Assigned”, Risk index…) are written as `{computed}` values in new rows: the formula of the row
above is copied and shifted (plain, shared and single-cell array formulas; the `cm` attribute of dynamic arrays is
kept).

UI entry points: `editButtons(o)` in the side panel, `ADDERS` per view (`addButton`). Forms: `formDialog(title,
fields, onSubmit)` where `onSubmit` returns a `ChangeSet` or throws a user-readable error.

## 12. History (`07x-history.js`)

Reads `baselines/` and `change-logs/` (read access is enough; a folder can be picked without write mode).
Log files are flattened into `hist.logs` entries (baseline headers and every save). Tabs: *Change logs* and
*Compare baselines* (any two baselines or baseline vs current workbook, computed live with `diffSnapshots`).
`historySection(o)` adds an object’s change history to its side panel. Old schema-1 logs remain readable.

## 13. Export to Excel (`07y-export.js`)

`EXPORTS[view] = { label, run() → { filter, sheets: [{ name, cols: [[header, width]], rows }] } }`. `buildXlsx` writes
a minimal valid XLSX (inline strings, styles for header and Low/Medium/High fills, frozen header, autofilter) and
`zipFiles` stores it (CRC-32, no compression). Downloaded via a `blob:` link with `download` — no file-system API, so
it cannot touch the workbook or the repository folder. Every export adds an “About” sheet (source, time, filter).
Exports respect the current filters/focus of the view, including its “Hide not relevant” toggle (stated in “About”).
The Connections export states the search as text and the definition of every `@name` it uses.

## 14. Security and privacy

- No network: CSP + no fetch/XHR/WebSocket in our sources (test S1). Vendored code is not scanned by S1 but cannot reach
  the network because of the CSP; review it before adding (recipe 18.5). No `innerHTML`, `eval`, `new Function` (S1); cell text
  is rendered as text (test S5 with injection fixture).
- Disk writes only via §10 guards; no delete API anywhere (`removeEntry` forbidden by S1).
- `localStorage` holds only the theme preference. The search library (§9.11) lives in memory; it leaves the tab only as a
  download chosen by the user (`blob:` link, like the export) and comes back only through a file input; loaded entries
  are validated field by field and every text is rendered with `h()` (tests F20–F21).
- Real workbooks, baselines and logs must never be committed (`.gitignore`); all fixtures are fictional.

## 15. Testing

`node tests/run.cjs` rebuilds both outputs, runs every test in Chromium and writes `tests/results/report.md/json`.
Groups: **S** static/security guarantees, **F** functional reading/checks/views, **X** export, **W** write mode &
baselines, **H** history, **E** editing (each edit is diffed independently with `tests/xlsx_diff.py` / openpyxl).
Write tests use the browser’s private file system (OPFS) and shimmed pickers — never real folders.
`tests/TEST_PLAN.md` lists every test and what is still to automate. Fixtures: `python3 tests/make_fixtures.py`
(regenerates sample, LibreOffice copy, Excel-style rich-text copy, injection and broken files).
**Every change must keep the suite green; add a test for every new rule or editable field.**

## 16. Decision log

| # | Decision | Why |
|---|---|---|
| D1 | One self-contained HTML, CSP `default-src 'none'`; libraries only inlined from `src/vendor/` | Sensitive data; must run offline on locked-down machines; nothing can leak or be fetched. Libraries allowed since Nov 2026 (owner decision) under the vendoring rules. |
| D2 | Own XLSX reader and writer | Written when no dependencies were allowed; needed subset is small; byte-level control needed for safe editing. |
| D3 | Normalise Excel into linked objects (RMI per line, components, derived links) | Excel keeps several items per cell and no relations; views and checks need a graph. |
| D4 | Columns found by header text | Owner inserts/moves columns; positions are unstable. |
| D5 | *(superseded by D15)* Identity of mitigation items = identical text; unknown = RMI-X | Was needed while items had no ID in the treatment/Content cells. |
| D6 | *(superseded by D15)* Group tags `[ID]` ignored; links by identical Content text | Tags duplicated information and drifted. |
| D7 | Issues always carry sheet/cell/line, three categories with distinct icons | The fix happens in Excel; users must find the cell. |
| D8 | Read-only by default; write mode needs a name; three guarded write functions | “Nothing modified by mistake” is the top priority; author recorded in logs. |
| D9 | Edits patch only the target cells, copy all other archive parts byte-for-byte, verify every cell | Avoids reformatting/losing Excel features; makes unintended changes detectable before writing. |
| D10 | Baseline = byte copy + new log; saves append to the newest log; logs never rewritten otherwise | Owner requirement: one log per baseline period; audit trail must be append-only. |
| D11 | New rows appended after the table, formatted like the row above | Inserting rows would shift merges, formulas, CF ranges — higher risk (owner chose “end of table”). |
| D12 | Single user, refuse save if file changed on disk | Excel co-authoring cannot be joined from a local file; avoids overwriting others’ work. |
| D13 | Connections: AND between clicks, OR within a Ctrl batch, double click = details | Owner requirements for exploring paths. |
| D14 | Export via download, not file-system API | Keeps export unable to touch workbook or repository. |
| D15 | Mitigation items identified by **RMI ID**: text only in “Risk mitigations individual”; risks and groups link through their “RMI ID” column (one ID per line); “Risk treatment option”, “Content”, “Groups”, “Assigned” are formulas and are not read; only the new format is supported | Owner “formalised” the workbook. One source of truth for the text; IDs are stable keys, so renaming an item touches one cell. |
| D16 | No introductory line for treatments; “Groups”/“Assigned” not checked; item linked to no risk (also if only a group lists it) = warning; item used by risks but in no group = error; unknown IDs reported only as `C_RMI_UNKNOWN`; tolerant reading of mis-typed “RMI ID” lines (`F_RMI_REF`) | Owner decisions (2026-11). Avoids double findings for one cause while keeping links usable. |
| D17 | Text formula columns only checked to *be* formulas (`W_NOT_FORMULA`), their cached result is not compared with the IDs | The tool cannot evaluate Excel formulas; comparing the result would depend on the exact formula output. |
| D18 | “Threat relevance” is a risk attribute; not relevant = the words “not relevant” anywhere; “Hide not relevant” per view, on by default; threats/groups/items hidden only when all their risks are not relevant; unused objects never hidden; empty or look-alike values = warning, counted as relevant | Owner decisions (2026-11). Never hide something on a guess; never hide a gap of the analysis. |
| D19 | “Removed” column: removed items hidden everywhere except the items tab (“Hide removed”, on by default); links to them are errors and ignored; no usage/text checks for them; invalid values = format error, treated as active | Owner decisions (2026-11). One switch (`M.rmis` = active) so no view can forget to hide them. |
| D20 | Workbook editing deprecated: UI disabled, code kept, still covered by the E tests via the test hook | Owner: editing will be rebuilt later; keeping the tested code avoids losing the safe-write pipeline. |
| D21 | Connections search = expression tree over objects and `@` library entries; each term is a question about an anchor (risk-level: “linked to X?”); columns restricted per DNF conjunction to the objects named positively; AND binds before OR; clicking one operator flips only it and regroups | Owner request (2026-11): switch and/or in the focus bar, write own logical expressions with ID autocompletion. Risk-level terms keep the click behaviour (`A AND B` = risks linked to both, also for two objects of one type) and make NOT intuitive (“risks without this item”). |
| D22 | Content filter = one condition (contains / does not contain / is empty / is not empty) on one attribute of one object type, errors and warnings included; filters and saved searches combine through the same logic language | Owner request (2026-11), built by clicks (object → generic card → attribute). One condition per filter keeps each filter readable; combinations are expressed — and saved — as searches. |
| D23 | Library of filters and searches kept in memory; kept between sessions only as a downloaded JSON file loaded again by the user; nothing in `localStorage` | “Stays in memory” promise and §14: filter words can contain workbook content; `file://` pages share one storage origin. Can be changed by the owner (then update §14 and test S4). |

## 17. Known limitations and open points

- No delete of objects (risk, item, group, assumption) from the app.
- Rewritten cells lose partial rich-text formatting (cell style kept).
- New rows copy formulas only for Risk index / index after / reduction and the text formula columns (“Risk treatment
  option”, “Content”, “Groups”, “Assigned”); multi-cell array formulas are not copied.
- Workbooks in the old text-based format (no “RMI ID” columns) are not supported: they show `F_STRUCT` and no item
  links, so comparing an old baseline with a new one shows every link as changed once.
- Look-alike headers (a new column starting with “Frequency”, “Effects”, “Risk index”, “Comment”…) placed left of the
  original can be picked instead; header detection takes the first match.
- Write mode and History folder access need Chromium (File System Access API).
- Search: a saved search refers to objects by ID, so in another workbook it may not resolve (shown as “cannot be used
  here”); a search with more than 512 conjunctions in normal form is still evaluated exactly but its columns are not
  restricted; duplicate IDs (C_DUP_ID) are written in a search as their first object; the library is lost when the tab
  is closed unless it was downloaded.
- Not tested against real Microsoft Excel files in CI (LibreOffice/openpyxl only); Excel-written fixture is simulated.

## 18. Recipes

**18.1 Add a check.** Add the code to `ISSUE_TYPES` (§7, category/title/explanation) → emit it in `buildModel` with
`addIssue(code, msg, {sheet,row,col,line,on:[objects]})` at the right step (§6 order) → add the seeded mistake to
`sample/make_sample.py`, regenerate fixtures (`python3 tests/make_fixtures.py`) → add the code to the F2 list or a
dedicated test → update `tests/TEST_PLAN.md`.

**18.2 Read a new column.** Add it to the `columns(…)` spec of its sheet in `buildModel` (header regex, label,
required?) → store it on the object → show it in `DETAIL[type]` (05) and, if useful, in `EXPORTS` (13) and in
`snapshot()` (10) so History tracks it.

**18.3 Make a field editable / add an action.** Write an edit function that only calls `cs.set` / `cs.addRow`
(never touches XML) → add the field to the form in `EDITORS` / `*Fields()` with validation that throws readable
errors → if the text is duplicated elsewhere, propagate to every identical occurrence (§11) → add an **E** test that
diffs the workbook with `xlsx_diff.py` and asserts exactly the expected cells changed.

**18.4 Add a view.** `VIEWS.<key> = function () { … return h('div.view', viewHead(…), …) }` in a views file →
add it to `NAV` in `08-main.js` → optional `EXPORTS.<key>` and `ADDERS.<key>` → add it to the `VIEWS` list in
`tests/run.cjs` (S4 tour) and a functional test.

**18.5 Use a third-party library.** Check the license allows redistribution (MIT/BSD/Apache-2.0/ISC…) → download the
**browser build** (UMD/IIFE that defines a global; no build step, no runtime imports) of an **exact version** → save it
as `src/vendor/<name>-<version>.js` (and `.css`) with its license header → add a row (file, library, version, source,
license, SHA-256) to `src/vendor/README.md` (test S6 fails otherwise) → use the global from app code → make sure it
does not fetch anything, write to disk or inject workbook text as HTML → `node build.mjs && node tests/run.cjs` and
check the size of `dist/`. Add a decision to §16 if it replaces own code.

**18.6 Make an attribute searchable by content filters / extend the search.** Add `{ key, label, from, get(o) }` to
`FILTER_FIELDS[type]` in `05q-query.js` (`get` returns a text or a list of texts; `rel: true` for values derived from
links, which “Any attribute” leaves out) — the generic card, preview, matching and library validation pick it up. A new
operator of the language goes into `qTokens` / `qParse` / `exprToText` and needs an F16 case; a new filter condition into
`FILTER_OPS` / `filterMatcher` and an F20 case. Never render a value with anything but `h()`.

**After any change:** `node build.mjs && node tests/run.cjs`, keep `README.md`, this document and
`tests/TEST_PLAN.md` in sync.
