# Risk Explorer (Risk Register Explorer)

A local, single-file web app for working with a cybersecurity risk analysis that is kept in an Excel workbook and follows
**BSI Standard 200-3** (elementary threats G 0.1–G 0.47, frequency × effects risk matrix, treatment options A–D).

The Excel workbook stays the database. The app opens it, turns rows and multi-line cells into connected objects (threats,
risks, mitigation items, mitigation groups, assumptions, components), checks the writing conventions and the consistency
between sheets, and shows everything in views that Excel cannot provide. Write mode is optional and off by default.

- **100 % local**: one HTML file, no server, nothing loaded from the internet at runtime. Third-party libraries are
  allowed, but only inlined into that HTML at build time (`src/vendor/`). The page's Content-Security-Policy makes the
  browser refuse every network request.
- **Read-only by default**: nothing is written unless write mode is switched on and the change is confirmed.
- **English UI**.

## Quick start

1. Open `dist/risk-register-explorer.html` in a current Edge or Chrome (Firefox works read-only).
2. Click **Choose the workbook…** (or drop the `.xlsx` on the page).
3. Try it first with `sample/sample-risk-workbook.xlsx`, a fictional workbook with deliberate mistakes.

The app icon is embedded in the HTML (browser tab). For a desktop shortcut use `assets/icon.ico`.

## Expected workbook

| Sheet | Columns (found by header name, any position) |
|---|---|
| Architecture Assumptions | Assumption ID, Title, Description, Affected components, Linked risks, Validity for Alpha Release, Validity for Beta Release, Comment |
| Risik analysis Alpha | Threat ID, Threat, Threat relevance, Risk ID, Risk description, Affected component, Core values at risk, Related assumptions, Frequency of occurence, Effects without additional safeguards, Risk index, Description for SAVe database, Risk Treatment category, **RMI ID**, Risk treatment option *(formula)*, Frequency of occurence (after treatment), Effects after rollout of treatment, Risk index (after treatment), Risk reduction value |
| Risk Mitigation Groups | Risk Mitigation Group ID, Risk treatment, Security Measure Group, **RMI ID**, Content *(formula)* |
| Risk mitigations individual | RMI ID, Mitigation item, Groups *(formula)*, Assigned *(formula)*, Extended Description, Comment, Responsible, Removed |

“Assumed Risks Beta” and any other sheet are ignored. Columns can be inserted or moved; only the header text matters.

**Mitigation items (RMI)** are identified by their RMI ID. Their text lives only in “Risk mitigations individual”. A
risk and a group list the IDs of their items in their **RMI ID** column, one ID per line; that is how items are linked
to risks and to groups. “Risk treatment option”, “Content”, “Groups” and “Assigned” are formulas in the workbook and are
not read (the app only warns when a “Risk treatment option” or “Content” cell is not a formula). Workbooks in the older
text-based layout (no “RMI ID” columns) are not supported.

**Removed** (in “Risk mitigations individual”): empty or “no” = active, “yes” = removed (any case); any other value is
a format error and the item stays active. Removed items are hidden everywhere in the app (search, counts, panels,
Connections, exports) except **Mitigations → All items**, where **Hide removed** (on by default) can show them. They raise
no “not used” / “no group” findings; a risk or group that still lists a removed item is a consistency error and that
link is ignored.

**Threat relevance** is read per risk row: despite its name it says whether the **risk** is relevant. A risk is *not
relevant* when the text contains the words “not relevant” (any case, anywhere in the text); an empty cell or a text that
only resembles them (“Not relevent”) is a warning and counts as relevant. **Hide not relevant** is on by default, and
separately for each of Risks, Threats, Mitigations (groups tab and items tab) and Connections. It hides not-relevant
risks, and threats, groups and items whose risks are all not relevant. Items and groups without any risk stay visible.
Opening Connections from the panel of such an object switches its filter off (the button flashes). In the BSI coverage
grid, threats with only not-relevant risks are always shown blank. Not-relevant risks are listed last and marked
everywhere else.

## What the app shows

Overview · Risk matrix (risks or threats per cell; before, after, side by side, movement) · Risks · Threats (coverage of
the 47 elementary threats) · Mitigations (items and groups) · Assumptions · Components (exposure map) · Connections
(linked columns with hover tracing and a search: click = AND, Ctrl+click = OR, double-click = details, logical
search and content filters — see below) · History (baselines and change logs) · Errors & warnings (format errors,
consistency errors, warnings, each with sheet, cell and line). Every module can be exported to a new Excel file.

## Searching in Connections

- **By clicks.** Click an object to add it to the search (AND); Ctrl+click several and release Ctrl to add them
  together (same type = OR). In the **Focused on** bar every “and” / “or” can be clicked to switch it (AND binds before
  OR, brackets show the grouping), ¬ negates an object (click the red “not” to undo) and × removes it.
- **Logical search.** The compact box at the top right (under *Content filter* and *Filters & saved searches*) always
  shows the current search as text — also when it was built by clicks — and ends in “…” when it does not fit. Click it
  and a large editor opens below the *Focused on* bar: type your own expression, e.g.
  `(T.BSI.15 OR T.BSI.43) AND NOT RMI-008` or `"Edge Gateway" AND NOT @no-owner` — IDs or component names, `AND` `OR`
  `NOT` `( )`, `@name` for library entries. Suggestions complete IDs and names while typing (↑ ↓, Enter or Tab); the
  line below says how the search reads and how many risks match, or what is wrong and where. Enter applies it and
  closes the editor; Esc closes it without applying. The ⓘ button explains the syntax with examples from
  the opened workbook.
- **Content filters.** *Content filter* opens a builder that works by clicks: choose the object type, click the
  attribute in its generic card (every attribute, plus **Errors** and **Warnings**), choose contains / does not contain /
  is empty / is not empty and type the word. A live preview shows what matches. Saved filters are used as `@name`.
- **Combine and save.** *Filters & saved searches* lists the filters; AND / OR / AND NOT add one to the search, so
  content filters, objects and logic combine freely. *Save search* keeps the current search, which can be shown again or
  used inside other searches as `@name`.
- **Meaning.** Every term asks whether a path of the risk analysis (a risk with its threat, components, assumptions,
  mitigation items and groups) is linked to the object: `A AND B` = risks linked to both, `NOT A` = risks not linked to
  A. The columns then show only the objects the search names, plus everything else those risks link.
- **Where they are kept.** Filters and saved searches stay while the tab is open (also when you reload or open another
  workbook). Nothing is stored in the browser: **Download library** saves them as a JSON file and **Load library…**
  reads it back — also to share them with colleagues. The Connections export states the search and what each `@name`
  means.

## Write mode (optional)

Click **Read-only** in the top bar, enter your name and choose the repository folder that holds the workbook.

- **Editing the workbook is currently disabled (deprecated)**: the Edit / Add buttons are not shown. The code is kept
  and will be rebuilt later; until then the workbook is only changed in Excel. (When it was enabled, it edited fields of
  risks, threats, items, groups, assumptions and components, and added risks, assumptions, groups and items, with a
  cell-by-cell preview and verification.) Every save shows a cell-by-cell preview, is verified cell by cell before and
  after writing, and is refused if the file changed on disk. Close the workbook in Excel before saving (single user).
- **Create baseline**: copies the workbook to `baselines/` and starts a new JSON log in `change-logs/`; every later
  save is appended to that log. Existing baselines and logs are never modified.

## Development

```bash
node build.mjs
```

Builds `dist/risk-register-explorer.html` from `src/`. External libraries or code may be used if they are stored in
`src/vendor/` (browser build, pinned version, license and hash recorded in `src/vendor/README.md`); the build inlines
them, so the downloaded HTML still works 100 % offline. Never reference a CDN or any URL at runtime. Tests:

```bash
node tests/run.cjs
```

Needs Node 18+, Playwright with Chromium, Python 3 with openpyxl (and LibreOffice only to regenerate fixtures with
`python3 tests/make_fixtures.py`). See `tests/TEST_PLAN.md`.

**Before changing code read [`CLAUDE.md`](CLAUDE.md) and the relevant sections of [`ARCHITECTURE.md`](ARCHITECTURE.md).**

## Privacy

Never commit real workbooks, baselines or change logs to this repository (`.gitignore` blocks `*.xlsx` except the
fictional sample and test fixtures). All sample and fixture data is invented.
