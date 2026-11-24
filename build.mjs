// Builds dist/risk-register-explorer.html: one self-contained file, no dependencies.
// Usage: node build.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const sha = (s) => 'sha256-' + createHash('sha256').update(s, 'utf8').digest('base64');

const jsFiles = readdirSync(join(root, 'src/js')).filter((f) => f.endsWith('.js')).sort();
// `node build.mjs --test` writes a second file with a small inspection hook for automated tests.
const test = process.argv.includes('--test');
const hook = test ? '\nwindow.__rre = { state: () => ({ M, state }), write, hist, safeWrite, EXPORTS, edit, snapshot, diffSnapshots };\n' : '';
const script = '\n(() => {\n"use strict";\n' + jsFiles.map((f) => read('src/js/' + f)).join('\n') + hook + '\n})();\n';
const style = '\n' + read('src/styles.css');
if (/<\/script/i.test(script) || /<\/style/i.test(style)) throw new Error('Source must not contain closing script/style tags.');

// App icon embedded as data: URIs (allowed by the CSP's img-src data:), so the single file stays self-contained.
const b64 = (p) => readFileSync(join(root, p)).toString('base64');
const html = read('src/index.template.html')
  .replace('{{ICON_SVG}}', 'data:image/svg+xml;base64,' + b64('assets/icon.svg'))
  .replace('{{ICON_PNG}}', 'data:image/png;base64,' + b64('assets/icon-32.png'))
  .replace('{{ICON_PNG256}}', 'data:image/png;base64,' + b64('assets/icon-256.png'))
  .replace('{{SCRIPT_HASH}}', sha(script))
  .replace('{{STYLE_HASH}}', sha(style))
  .replace('{{STYLE}}', () => style)
  .replace('{{SCRIPT}}', () => script);

mkdirSync(join(root, 'dist'), { recursive: true });
const out = test ? 'dist/risk-register-explorer.test.html' : 'dist/risk-register-explorer.html';
writeFileSync(join(root, out), html);
console.log(out, (html.length / 1024).toFixed(0) + ' KB', '(' + jsFiles.length + ' script files)');
