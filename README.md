# Risk Explorer (Risk Register Explorer)

A local, single-file web app for working with a cybersecurity risk analysis that is kept in an Excel workbook and follows
**BSI Standard 200-3** (elementary threats G 0.1–G 0.47, frequency × effects risk matrix, treatment options A–D).

The Excel workbook stays the database. The app opens it, turns rows and multi-line cells into connected objects (threats,
risks, mitigation items, mitigation groups, assumptions, components), checks the writing conventions and the consistency
between sheets, and shows everything in views that Excel cannot provide. Write mode is optional and off by default.

- **100 % local**: one HTML file, no server, no libraries, no fonts or scripts from the internet. The page's
  Content-Security-Policy makes the browser refuse every network request.
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
| Risik analysis Alpha | Threat ID, Threat, Threat relevance, Risk ID, Risk description, Affected component, Core values at risk, Related assumptions, Frequency of occurence, Effects without additional safeguards, Risk index, Description for SAVe database, Risk Treatment category, Risk treatment option, Frequency of occurence (after treatment), Effects after rollout of treatment, Risk index (after treatment), Risk reduction value |
| Risk Mitigation Groups | Risk Mitigation Group ID, Risk treatment, Security Measure Group, Content |
| Risk mitigations individual | RMI ID, Mitigation item, Groups, Assigned, Extended Description, Comment, Responsible |

“Assumed Risks Beta” and any other sheet are ignored. Columns can be inserted or moved; only the header text matters.

## What the app shows

Overview · Risk matrix (risks or threats per cell; before, after, side by side, movement) · Risks · Threats (coverage of
the 47 elementary threats) · Mitigations (items and groups) · Assumptions · Components (exposure map) · Connections
(linked columns with hover tracing and multi-object focus: click = AND, Ctrl+click = OR, double-click = details) ·
History (baselines and change logs) · Errors & warnings (format errors, consistency errors, warnings, each with sheet,
cell and line). Every module can be exported to a new Excel file.

## Write mode (optional)

Click **Read-only** in the top bar, enter your name and choose the repository folder that holds the workbook.

- **Edit / Add**: edit fields of risks, threats, mitigation items, groups, assumptions and components; add risks,
  assumptions, groups and mitigation items. Every save shows a cell-by-cell preview, is verified cell by cell before and
  after writing, and is refused if the file changed on disk. Close the workbook in Excel before saving (single user).
- **Create baseline**: copies the workbook to `baselines/` and starts a new JSON log in `change-logs/`; every later
  save is appended to that log. Existing baselines and logs are never modified.

## Development

```bash
node build.mjs
```

Builds `dist/risk-register-explorer.html` from `src/` (no dependencies). Tests:

```bash
node tests/run.cjs
```

Needs Node 18+, Playwright with Chromium, Python 3 with openpyxl (and LibreOffice only to regenerate fixtures with
`python3 tests/make_fixtures.py`). See `tests/TEST_PLAN.md`.

**Before changing code read [`CLAUDE.md`](CLAUDE.md) and the relevant sections of [`ARCHITECTURE.md`](ARCHITECTURE.md).**

## Privacy

Never commit real workbooks, baselines or change logs to this repository (`.gitignore` blocks `*.xlsx` except the
fictional sample and test fixtures). All sample and fixture data is invented.
