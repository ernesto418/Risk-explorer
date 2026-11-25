# Third-party code (vendored)

Libraries and other external code are allowed **only if they are stored here and inlined into the built HTML**, so the
downloaded `dist/risk-register-explorer.html` keeps working 100 % offline.

Rules:
- Put the **browser build** of the library here as a file (`*.js` UMD/IIFE build that defines a global, `*.css`).
  `node build.mjs` inlines every `src/vendor/*.js` / `*.css` (alphabetical order) **before** the app code.
- Never load anything at runtime from a URL (no CDN `<script src>`, no `import()` of URLs, no fetch of fonts/data).
  The CSP (`default-src 'none'`, `connect-src 'none'`) blocks it anyway, and test S3 fails on external references.
- Pin an exact version and record it in the table below with source, license and SHA-256 of the file.
- Use only licenses that allow redistribution inside the HTML (MIT, BSD, Apache-2.0, ISC…); keep the license header
  in the file.
- A library must not write to disk or bypass the guarded write functions (ARCHITECTURE §10); it must not render
  workbook text as HTML (§14).
- Prefer small, dependency-free libraries; check the size impact on the single file.

| File | Library | Version | Source | License | SHA-256 |
|---|---|---|---|---|---|
| — | (none yet) | | | | |
