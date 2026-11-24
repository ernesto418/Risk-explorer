/* ---------------------------------------------------------------------------
 * 02-xlsx.js — minimal, dependency-free, READ-ONLY .xlsx / .xlsm reader.
 *
 * An .xlsx file is a ZIP archive of XML parts. This reader uses only browser
 * built-ins (DecompressionStream for inflate, DOMParser for XML). It extracts
 * cell values (cached formula results included) and merged ranges — nothing
 * else — and never writes anything.
 * ------------------------------------------------------------------------- */

class WorkbookError extends Error {}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new WorkbookError('This browser is too old to read .xlsx files locally (DecompressionStream is missing). Use a current Edge, Chrome or Firefox.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function openZip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  if (u8.length > 8 && u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0) {
    throw new WorkbookError('This file is not a plain .xlsx workbook. It is either a legacy .xls file or an encrypted workbook (password or sensitivity-label protection). Save an unprotected .xlsx copy and open that.');
  }
  if (u8.length < 22 || dv.getUint32(0, true) !== 0x04034b50) {
    throw new WorkbookError('This file is not an Excel .xlsx workbook (ZIP signature not found).');
  }
  let eocd = -1;
  for (let i = u8.length - 22, min = Math.max(0, u8.length - 22 - 65535); i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new WorkbookError('The workbook archive is damaged (end of ZIP directory not found).');
  let count = dv.getUint16(eocd + 10, true);
  let cdOff = dv.getUint32(eocd + 16, true);
  const u64 = (p) => dv.getUint32(p, true) + dv.getUint32(p + 4, true) * 4294967296;
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF) { // ZIP64
    const loc = eocd - 20;
    if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) throw new WorkbookError('Unsupported ZIP64 archive.');
    const z = u64(loc + 8);
    count = u64(z + 32);
    cdOff = u64(z + 48);
  }
  const utf8 = new TextDecoder('utf-8');
  const entries = new Map();
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    let compSize = dv.getUint32(p + 20, true);
    let size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let localOff = dv.getUint32(p + 42, true);
    const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));
    if (compSize === 0xFFFFFFFF || size === 0xFFFFFFFF || localOff === 0xFFFFFFFF) {
      let q = p + 46 + nameLen;
      const end = q + extraLen;
      while (q + 4 <= end) {
        const id = dv.getUint16(q, true), len = dv.getUint16(q + 2, true);
        if (id === 1) {
          let r = q + 4;
          if (size === 0xFFFFFFFF) { size = u64(r); r += 8; }
          if (compSize === 0xFFFFFFFF) { compSize = u64(r); r += 8; }
          if (localOff === 0xFFFFFFFF) { localOff = u64(r); }
        }
        q += 4 + len;
      }
    }
    entries.set(name, { method, compSize, size, localOff, crc: dv.getUint32(p + 16, true), flags: dv.getUint16(p + 8, true) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const lower = new Map([...entries.keys()].map((k) => [k.toLowerCase(), k]));
  return {
    /** All entries in archive order (used to rebuild the archive when editing). */
    list: () => [...entries].map(([name, e]) => ({ name, ...e })),
    /** Compressed bytes of an entry exactly as stored. */
    raw(name) { const e = entries.get(name); const nl = dv.getUint16(e.localOff + 26, true), xl = dv.getUint16(e.localOff + 28, true); const st = e.localOff + 30 + nl + xl; return u8.subarray(st, st + e.compSize); },
    has: (name) => entries.has(name) || lower.has(name.toLowerCase()),
    async bytes(name) {
      const e = entries.get(name) || entries.get(lower.get(name.toLowerCase()));
      if (!e) return null;
      const nameLen = dv.getUint16(e.localOff + 26, true);
      const extraLen = dv.getUint16(e.localOff + 28, true);
      const start = e.localOff + 30 + nameLen + extraLen;
      const data = u8.subarray(start, start + e.compSize);
      if (e.method === 0) return data;
      if (e.method === 8) return inflateRaw(data);
      throw new WorkbookError('Unsupported compression method in workbook archive (' + e.method + ').');
    },
    async xml(name) {
      const b = await this.bytes(name);
      if (!b) return null;
      const doc = new DOMParser().parseFromString(utf8.decode(b), 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new WorkbookError('Could not parse workbook part ' + name + '.');
      return doc;
    },
  };
}

function xlText(s) {
  if (s.indexOf('_x') >= 0) s = s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
  return s.indexOf('\r') >= 0 ? s.replace(/\r\n?/g, '\n') : s;
}
/** Text of a string item (<si> or <is>): plain <t> or concatenated rich-text runs; phonetic runs are skipped. */
function siText(node) {
  let out = '';
  for (const c of node.children) {
    if (c.localName === 't') out += c.textContent;
    else if (c.localName === 'r') { for (const t of c.children) if (t.localName === 't') out += t.textContent; }
  }
  return xlText(out);
}
function kids(node, name) { return node ? [...node.getElementsByTagNameNS('*', name)] : []; }
function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}
function parseRef(ref) {
  let c = 0, i = 0;
  for (; i < ref.length; i++) { const k = ref.charCodeAt(i); if (k >= 65 && k <= 90) c = c * 26 + (k - 64); else if (k >= 97 && k <= 122) c = c * 26 + (k - 96); else if (k !== 36) break; }
  const r = parseInt(ref.slice(i).replace('$', ''), 10);
  return { r: r - 1, c: c - 1 };
}

/**
 * Reads a workbook. Returns { sheets: [{ name, hidden, rows: any[][], merges, formulas, uncached, formulasWithoutValue }] }.
 * rows[r][c] holds strings, numbers, booleans or undefined (cached results for formula cells). Merged ranges are filled
 * with their top-left value. `formulas` = Set of "r:c" of every cell with a formula; `uncached` = [r, c] of formula
 * cells without a stored result.
 */
async function readWorkbook(buf) {
  const zip = openZip(buf);
  let wbPath = 'xl/workbook.xml';
  const rootRels = await zip.xml('_rels/.rels');
  if (rootRels) {
    const rel = kids(rootRels, 'Relationship').find((r) => /officeDocument$/.test(r.getAttribute('Type') || ''));
    if (rel) wbPath = resolvePath('', rel.getAttribute('Target'));
  }
  const wb = await zip.xml(wbPath);
  if (!wb) throw new WorkbookError('This archive does not contain an Excel workbook (xl/workbook.xml is missing). Only .xlsx / .xlsm files are supported.');
  const relsPath = wbPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = new Map();
  let sstPath = null;
  for (const r of kids(await zip.xml(relsPath), 'Relationship')) {
    const target = resolvePath(wbPath, r.getAttribute('Target'));
    rels.set(r.getAttribute('Id'), { target, type: r.getAttribute('Type') || '' });
    if (/sharedStrings$/.test(r.getAttribute('Type') || '')) sstPath = target;
  }
  const sst = [];
  if (sstPath && zip.has(sstPath)) for (const si of kids(await zip.xml(sstPath), 'si')) sst.push(siText(si));

  const sheets = [];
  for (const el of kids(wb, 'sheet')) {
    let rid = null;
    for (const a of el.attributes) if (a.localName === 'id' && a.name !== 'sheetId') rid = a.value;
    const rel = rels.get(rid);
    const sheet = { path: rel ? rel.target : null, name: el.getAttribute('name') || '', hidden: (el.getAttribute('state') || 'visible') !== 'visible', rows: [], merges: [], formulas: new Set(), uncached: [], formulasWithoutValue: 0 };
    sheets.push(sheet);
    if (!rel || !/worksheet$/.test(rel.type)) { sheet.kind = 'other'; continue; }
    const doc = await zip.xml(rel.target);
    if (!doc) continue;
    const rows = sheet.rows;
    let rIdx = -1;
    for (const rowEl of kids(doc, 'row')) {
      const rAttr = rowEl.getAttribute('r');
      rIdx = rAttr ? parseInt(rAttr, 10) - 1 : rIdx + 1;
      let cIdx = -1;
      for (const c of rowEl.children) {
        if (c.localName !== 'c') continue;
        const ref = c.getAttribute('r');
        if (ref) cIdx = parseRef(ref).c; else cIdx += 1;
        const t = c.getAttribute('t');
        let vEl = null, isEl = null, fEl = null;
        for (const k of c.children) { if (k.localName === 'v') vEl = k; else if (k.localName === 'is') isEl = k; else if (k.localName === 'f') fEl = k; }
        let val;
        if (fEl) sheet.formulas.add(rIdx + ':' + cIdx);
        if (t === 'inlineStr') val = isEl ? siText(isEl) : '';
        else if (!vEl || (fEl && vEl.textContent === '' && (!t || t === 'n'))) { // no result stored (an empty numeric <v/> as written by openpyxl)
          if (fEl) { sheet.formulasWithoutValue++; sheet.uncached.push([rIdx, cIdx]); }
          continue;
        }
        else {
          const raw = vEl.textContent;
          if (t === 's') val = sst[parseInt(raw, 10)] ?? '';
          else if (t === 'str' || t === 'e' || t === 'd') val = xlText(raw);
          else if (t === 'b') val = raw === '1';
          else { if (raw === '') continue; val = Number(raw); if (Number.isNaN(val)) val = raw; }
        }
        if (val === '' || val == null) continue;
        (rows[rIdx] || (rows[rIdx] = []))[cIdx] = val;
      }
    }
    for (const m of kids(doc, 'mergeCell')) {
      const [a, b] = (m.getAttribute('ref') || '').split(':');
      if (!a || !b) continue;
      const s = parseRef(a), e = parseRef(b);
      sheet.merges.push({ r1: s.r, c1: s.c, r2: e.r, c2: e.c });
      const v = rows[s.r] && rows[s.r][s.c];
      if (v == null) continue;
      for (let r = s.r; r <= e.r; r++) for (let c = s.c; c <= e.c; c++) { if (r === s.r && c === s.c) continue; (rows[r] || (rows[r] = []))[c] = v; }
    }
  }
  return { sheets, zip, wbPath };
}
