/* ---------------------------------------------------------------------------
 * 07c-search.js — search UI of the Connections view: the logical search field
 * (with ID autocompletion), the “Focused on” bar (clickable AND / OR / NOT),
 * the library of content filters and saved searches, the click-by-click content
 * filter builder (object → generic card → attribute → condition) and the
 * download / load of the library as a JSON file. Logic: 05q-query.js.
 * `api` (from VIEWS.connections): setFocus(expr, {cols, refocus}), redraw(), controls(), baseRisks().
 * ------------------------------------------------------------------------- */

ICONS.filter = ['M2.2 3h11.6L9.4 8.4v4.4l-2.8-1.4v-3z'];
ICONS.plus = ['M8 3.2v9.6M3.2 8h9.6'];
ICONS.bookmark = ['M4.2 2.4h7.6v11.2L8 10.9l-3.8 2.7z'];
ICONS.download = ['M8 2.4v8', 'M4.6 7.2 8 10.6l3.4-3.4', 'M3 13.6h10'];
ICONS.upload = ['M8 10.6v-8', 'M4.6 5.8 8 2.4l3.4 3.4', 'M3 13.6h10'];
ICONS.edit = ['M10.4 2.6 13.4 5.6 6 13H3v-3z', 'M8.9 4.1l3 3'];
ICONS.trash = ['M2.8 4.4h10.4', 'M6.4 4.4V2.8h3.2v1.6', 'M4.4 4.4l.7 9.2h5.8l.7-9.2'];
ICONS.not = ['M2.6 6.2h10.8v4.2'];
ICONS.logic = ['M5.4 3.6 2 8l3.4 4.4', 'M10.6 3.6 14 8l-3.4 4.4', 'M9 3.4 7 12.6'];

const Q_KW_TIP = { AND: 'both sides must hold', OR: 'either side', NOT: 'the opposite of what follows' };

/* ---- the logical search field ---------------------------------------------------------------------------- */
function flowSearchRow(ui, api) {
  const applied = exprToText(ui.focus);
  const inp = h('input', { type: 'text', id: 'flow-q', value: ui.draft != null ? ui.draft : applied, autocomplete: 'off', spellcheck: 'false',
    'aria-label': 'Logical search', 'aria-autocomplete': 'list', 'aria-controls': 'flow-q-sug',
    placeholder: 'Logical search — type an ID or a name, combine with AND, OR, NOT, ( ) and @filters' });
  const sug = h('div.qsug', { id: 'flow-q-sug', role: 'listbox', hidden: true });
  const status = h('div.qstatus', { id: 'flow-q-status' });
  const box = h('div.qbox', h('label.searchbox.qinput', icon('logic', 14), inp), sug, status);
  const applyBtn = h('button.btn.sm.primary', { type: 'button', id: 'flow-q-apply', tip: 'Apply the written search (Enter)', onclick: () => apply() }, 'Apply');
  let items = [], sel = 0, range = null;

  const active = () => box.classList.toggle('active', document.activeElement === inp || ui.draft != null);
  const insert = (txt) => {
    const s = inp.value, a = inp.selectionStart, b = inp.selectionEnd, before = s.slice(0, a), after = s.slice(b);
    if (/^[A-Z]+$/.test(txt)) txt = (before && !/[\s(]$/.test(before) ? ' ' : '') + txt + (/^\s/.test(after) ? '' : ' ');
    inp.value = before + txt + after;
    const c = before.length + txt.length;
    inp.focus(); inp.setSelectionRange(c, c); changed();
  };
  const palette = () => h('span.qops', ['AND', 'OR', 'NOT', '(', ')', '@'].map((x) => h('button', { type: 'button', tip: Q_KW_TIP[x] ? 'Insert ' + x + ' — ' + Q_KW_TIP[x] : x === '@' ? 'Insert a content filter or saved search' : 'Insert a bracket',
    onmousedown: (e) => e.preventDefault(), onclick: () => insert(x) }, x)));
  const validate = () => {
    const s = inp.value, r = qParse(s), dirty = s.trim() !== applied.trim();
    box.classList.toggle('err', !!r.err); inp.setAttribute('aria-invalid', String(!!r.err));
    applyBtn.disabled = !!r.err;
    applyBtn.classList.toggle('pulse', dirty && !r.err);
    if (r.err) {
      status.className = 'qstatus err';
      fill(status, icon('warning', 12), h('span.qmsg', r.err.msg), s.trim() ? h('code.qx', s.slice(0, r.err.s), h('mark', s.slice(r.err.s, r.err.e) || ' '), s.slice(r.err.e)) : null, palette());
    } else if (!r.ast) {
      status.className = 'qstatus';
      fill(status, h('span.qmsg', dirty ? 'Empty — Enter shows everything again.' : 'Type an ID or a name and pick a suggestion (↑ ↓ Enter), then AND, OR or NOT. Brackets group; @ inserts a content filter or saved search.'), palette());
    } else {
      const ev = evalFocus(r.ast, api.baseRisks()), nr = ev.hits.filter((x) => x.a.r).length, other = ev.hits.length - nr;
      status.className = 'qstatus ' + (ev.error ? 'err' : 'ok');
      fill(status, icon(ev.error ? 'warning' : 'check', 12), h('span.qmsg', ev.error ? ev.error : !ev.hits.length ? 'Nothing matches — an AND may be too strict' : plural(nr, 'risk') + (other ? ' + ' + plural(other, 'object') + ' without risks' : '') + ' match'),
        h('span.muted', 'reads as'), h('code.qreads', exprToText(r.ast)), dirty ? h('span.muted', '— Enter to apply') : null, palette());
    }
  };
  const closeSug = () => { sug.hidden = true; items = []; inp.setAttribute('aria-expanded', 'false'); };
  const renderSug = () => {
    if (!items.length) return closeSug();
    const k = range.k;
    const mark = (label) => { const i = k ? label.toLowerCase().indexOf(k) : -1; return i < 0 ? label : [label.slice(0, i), h('mark', label.slice(i, i + k.length)), label.slice(i + k.length)]; };
    fill(sug, items.map((it, i) => h('button.qsug-i' + (i === sel ? '.on' : '') + (it.o ? '.t-' + it.o.type : it.ref ? '.ref' + (it.ref.kind === 'filter' ? '.t-' + it.ref.type : '') : '.kw'), {
      type: 'button', role: 'option', tabindex: '-1', 'aria-selected': String(i === sel), data: { insert: it.insert },
      onmousedown: (e) => e.preventDefault(), onclick: () => accept(i),
    }, it.o ? icon(TYPES[it.o.type].icon, 13) : it.ref ? icon(it.ref.kind === 'filter' ? 'filter' : 'bookmark', 13) : icon('logic', 13),
      h('span.qsug-l', mark(it.label)), h('span.qsug-t', it.title ? truncate(it.title, 100) : ''),
      h('span.qsug-k', it.o ? TYPES[it.o.type].label + (onlyNotRelevant(it.o) ? ' · not relevant' : it.o.risks && !it.o.risks.length ? ' · no risks' : '') : it.ref ? (it.ref.kind === 'filter' ? 'Content filter' : 'Saved search') : 'Operator'))));
    sug.hidden = false; inp.setAttribute('aria-expanded', 'true');
    const on = sug.children[sel]; if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  };
  /* suggestions for the word at the caret: objects by ID / name (then by title), library entries after @, operators */
  const suggest = () => {
    const s = inp.value, caret = inp.selectionStart;
    if (caret !== inp.selectionEnd || document.activeElement !== inp) return closeSug();
    const toks = qTokens(s), ti = toks.findIndex((x) => x.t === 'atom' && x.s < caret && caret <= x.e);
    if (ti < 0) return closeSug();
    const t = toks[ti], prev = toks[ti - 1], opPos = !!prev && (prev.t === 'atom' || prev.t === ')');
    let start = t.s, text = s.slice(t.type ? t.vs : t.ref ? t.s + 1 : t.s, caret).replace(/^"/, '');
    if (!t.quoted && !t.type && !t.ref) { /* a name with spaces typed without quotes: “Edge Ga|” */
      const names = [...qNames().keys()].filter((x) => x.includes(' '));
      for (let j = ti - 1; j >= 0 && ti - j <= 4; j--) {
        const x = toks[j];
        if (x.t !== 'atom' || x.ref || x.quoted || x.type) break;
        const cand = s.slice(x.s, caret).toLowerCase();
        if (names.some((n) => n.startsWith(cand))) { start = x.s; text = s.slice(x.s, caret); }
      }
    }
    const k = text.toLowerCase().trim(), out = [];
    if (t.ref) {
      for (const it of searchLib.items) {
        const n = it.name.toLowerCase(), sc = !k || n.startsWith(k) ? 0 : n.includes(k) ? 1 : -1;
        if (sc >= 0) out.push({ sc, ref: it, insert: '@' + qWord(it.name), label: '@' + it.name, title: it.kind === 'filter' ? filterDesc(it) : it.expr });
      }
      if (!searchLib.items.length) out.push({ sc: 0, ref: { kind: 'filter' }, insert: '@', label: '@', title: 'The library is empty — create a content filter first (button “Content filter”)', none: true });
    } else {
      if (!k) return closeSug();
      for (const [lab, list] of qNames()) for (const o of list) {
        if (t.type && o.type !== t.type) continue;
        const ti2 = objTitle(o);
        let sc = lab.startsWith(k) ? 0 : lab.includes(k) ? 1 : -1;
        if (sc < 0 && k.length >= 3 && ti2 && ti2.toLowerCase().includes(k)) sc = 2;
        if (sc < 0) continue;
        out.push({ sc: sc + (opPos && start === t.s ? 3 : 0), o, insert: t.type ? t.type + ':' + qWord(objLabel(o)) : qObjText(o), label: objLabel(o), title: ti2 });
      }
      if (!t.quoted && !t.type) for (const kw of ['AND', 'OR', 'NOT']) {
        if (!kw.toLowerCase().startsWith(k) || (kw !== 'NOT') !== opPos) continue;
        out.push({ sc: -1, kw, insert: kw, label: kw, title: Q_KW_TIP[kw] });
      }
    }
    const order = (x) => (x.o ? FLOW_ORDER.indexOf(x.o.type) : -1);
    out.sort((a, b) => a.sc - b.sc || order(a) - order(b) || natCmp(a.label, b.label));
    items = out.slice(0, 12); sel = 0; range = { s: start, e: t.e, k };
    renderSug();
  };
  const accept = (i) => {
    const it = items[i];
    if (!it || it.none) return closeSug();
    const s = inp.value, after = s.slice(range.e), sep = /^[\s)]/.test(after) ? '' : ' ';
    inp.value = s.slice(0, range.s) + it.insert + sep + after;
    const c = range.s + it.insert.length + sep.length;
    inp.setSelectionRange(c, c);
    closeSug(); changed();
  };
  const later = debounce(validate, 90);
  const changed = () => { ui.draft = inp.value.trim() === applied.trim() ? null : inp.value; active(); later(); suggest(); };
  const apply = () => {
    const r = qParse(inp.value);
    if (r.err) { validate(); inp.focus(); inp.setSelectionRange(r.err.s, Math.max(r.err.s, r.err.e)); return; }
    closeSug();
    api.setFocus(r.ast, { cols: true, refocus: true });
  };
  inp.addEventListener('input', changed);
  inp.addEventListener('focus', () => { active(); validate(); });
  inp.addEventListener('blur', () => setTimeout(() => { closeSug(); active(); }, 150));
  inp.addEventListener('click', suggest);
  inp.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') suggest(); });
  inp.addEventListener('keydown', (e) => {
    const open = !sug.hidden && items.length > 0;
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; renderSug(); }
    else if (open && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      if (e.key === 'Enter' && inp.value.slice(range.s, range.e).toLowerCase() === items[sel].insert.toLowerCase()) apply(); // already complete (the search ignores case)
      else accept(sel);
    } else if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (open) closeSug(); else { inp.value = applied; ui.draft = null; active(); validate(); }
    }
  });
  if (ui.draft != null) { active(); validate(); }
  const nLib = searchLib.items.length;
  return h('div.ctl.qrow', box, applyBtn,
    h('button.icon-btn', { type: 'button', id: 'flow-q-help', tip: 'How the logical search works, with examples from this workbook', onclick: () => searchHelp(api) }, icon('info', 16)),
    h('span.qsep'),
    h('button.btn.sm', { type: 'button', id: 'flow-new-filter', tip: 'New content filter: find objects by what an attribute contains or does not contain (errors and warnings included) — by clicks', onclick: () => filterDialog(null, api) }, icon('plus', 13), 'Content filter'),
    h('button.btn.sm.lib-btn' + (ui.libOpen ? '.on' : ''), { type: 'button', id: 'flow-lib-btn', 'aria-expanded': String(!!ui.libOpen), tip: 'Content filters and saved searches: combine them with AND, OR and NOT',
      onclick: () => { ui.libOpen = !ui.libOpen; api.controls(); } }, icon('filter', 13), 'Filters & saved searches', h('span.count', nLib)));
}

/* ---- the “Focused on” bar: the search as chips; operators and NOT are clickable ---------------------------- */
function flowFocusBar(ui, api) {
  const root = ui.focus, few = exprAtoms(root).length < 3;
  const refChip = (n) => {
    const it = libGet(n.name);
    if (!it) return h('span.chip.ref.bad', { tip: 'Not in the library any more' }, icon('warning', 13), h('span.chip-id', '@' + n.name));
    const isF = it.kind === 'filter';
    return h('button.chip.ref' + (isF ? '.t-' + it.type : '.saved'), { type: 'button', tip: (isF ? 'Content filter — ' + filterDesc(it) + '\n' + plural(filterSet(it).size, 'match', 'matches') + ' in this workbook' : 'Saved search — ' + it.expr) + '\nClick to edit',
      onclick: (e) => { e.stopPropagation(); if (isF) filterDialog(it, api); else searchDialog(it, it.expr, api); } },
    icon(isF ? 'filter' : 'bookmark', 13), h('span.chip-id', '@' + it.name), few && isF ? h('span.chip-label', truncate(filterDesc(it), 52)) : null);
  };
  const atom = (n, path, notBtn) => h('span.focus-i' + (notBtn ? '.neg' : ''), notBtn,
    n.k === 'obj' ? chip(n.o, { label: few, max: 40 }) : refChip(n),
    notBtn ? null : h('button.icon-btn.sm.focus-neg', { type: 'button', tip: 'Negate (NOT): keep only the paths that are NOT linked to it', 'aria-label': 'Negate', onclick: () => api.setFocus(exprNegate(root, path)) }, icon('not', 12)),
    h('button.icon-btn.sm', { type: 'button', tip: 'Remove from the search', 'aria-label': 'Remove', onclick: () => api.setFocus(exprRemove(root, path)) }, icon('close', 11)));
  const opBtn = (n, path, i) => h('button.focus-op.op-' + n.k, { type: 'button', data: { op: n.k },
    tip: (n.k === 'and' ? 'AND — every shown path satisfies both sides.' : 'OR — a shown path satisfies at least one side.') + '\nClick to change it to ' + (n.k === 'and' ? 'OR' : 'AND') + '. AND binds before OR; brackets show the grouping.',
    onclick: () => api.setFocus(exprToggleOp(root, path, i)) }, n.k);
  const list = (n, path) => n.c.map((c, i) => [i ? opBtn(n, path, i) : null, render(c, path.concat(i), true)]);
  const render = (n, path, nested) => {
    if (n.k === 'obj' || n.k === 'ref') return atom(n, path, null);
    if (n.k === 'not') {
      const notBtn = h('button.focus-op.op-not', { type: 'button', data: { op: 'not' }, tip: 'NOT — keeps the paths that are NOT linked to this.\nClick to remove the NOT.', onclick: () => api.setFocus(exprSetAt(root, path, n.a)) }, 'not');
      return qIsList(n.a) ? h('span.focus-not', notBtn, h('span.focus-term.multi', list(n.a, path.concat('a')))) : atom(n.a, path.concat('a'), notBtn);
    }
    return nested ? h('span.focus-term.multi', list(n, path)) : list(n, path);
  };
  return h('div.ctl.focusbar', h('span.ctl-l', 'Focused on'), h('span.focus-expr', render(root, [], false)),
    h('span.focus-tools',
      h('button.btn.ghost.sm', { type: 'button', id: 'flow-save', tip: 'Save this search in the library, to reuse it as @name or to combine it with others', onclick: () => searchDialog(null, exprToText(root), api) }, icon('bookmark', 12), 'Save search'),
      h('button.btn.ghost.sm', { type: 'button', onclick: () => { ui.pending = []; api.setFocus(null); } }, icon('close', 12), 'Show everything')));
}

/* ---- library panel ------------------------------------------------------------------------------------------ */
function flowLibrary(ui, api) {
  const filters = searchLib.items.filter((x) => x.kind === 'filter'), searches = searchLib.items.filter((x) => x.kind === 'search');
  const adders = (it) => [['and', 'AND', 'Add to the search with AND (both must hold)'], ['or', 'OR', 'Add to the search with OR (either may hold)'], ['andnot', 'AND NOT', 'Exclude: add to the search with AND NOT']]
    .map(([op, label, tip]) => h('button.btn.sm.lib-op.op-' + op, { type: 'button', tip, data: { op }, onclick: () => api.setFocus(exprAdd(ui.focus, QX.ref(it.name), op), { cols: true }) }, label));
  const tools = (it) => [h('button.icon-btn.sm', { type: 'button', tip: 'Edit', data: { act: 'edit' }, onclick: () => (it.kind === 'filter' ? filterDialog(it, api) : searchDialog(it, it.expr, api)) }, icon('edit', 13)),
    h('button.icon-btn.sm', { type: 'button', tip: 'Delete', data: { act: 'delete' }, onclick: () => libDelete(it, api) }, icon('trash', 13))];
  const fRow = (f) => {
    const n = filterSet(f).size, total = qPool(f.type).length;
    return h('div.lib-row.t-' + f.type, { data: { name: f.name } },
      h('span.lib-ico', { tip: TYPES[f.type].plural }, icon(TYPES[f.type].icon, 14)),
      h('button.lib-name', { type: 'button', tip: 'Add to the search (AND)', onclick: () => api.setFocus(exprAdd(ui.focus, QX.ref(f.name), 'and'), { cols: true }) }, '@' + f.name),
      h('span.lib-desc', { tip: filterDesc(f) }, filterDesc(f)),
      h('span.count', { tip: n + ' of ' + total + ' ' + TYPES[f.type].plural.toLowerCase() + ' match in this workbook' }, n),
      h('span.lib-act', adders(f), tools(f)));
  };
  const sRow = (s) => {
    const r = qParse(s.expr);
    let bad = r.err ? r.err.msg : null;
    if (!bad && r.ast) { try { qCore(r.ast, [s.name.toLowerCase()]); } catch (e) { if (!e.qeval) throw e; bad = e.message; } }
    return h('div.lib-row.saved', { data: { name: s.name } },
      h('span.lib-ico', icon('bookmark', 14)),
      h('button.lib-name', { type: 'button', tip: 'Show this search (it replaces the current one; you can then change it)', onclick: () => { if (bad) toast('@' + s.name + ': ' + bad, 'error'); else api.setFocus(r.ast, { cols: true }); } }, '@' + s.name),
      h('code.lib-desc', { tip: s.expr }, s.expr), bad ? h('span.tag.bad', { tip: bad }, 'cannot be used here') : null,
      h('span.lib-act', h('button.btn.sm', { type: 'button', data: { op: 'show' }, tip: 'Show this search (it replaces the current one; you can then change it)', onclick: () => { if (bad) toast('@' + s.name + ': ' + bad, 'error'); else api.setFocus(r.ast, { cols: true }); } }, 'Show'), adders(s), tools(s)));
  };
  const file = h('input', { type: 'file', id: 'lib-file', accept: '.json,application/json', hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) libLoad(f, api); } });
  return h('section.card.libp', { id: 'flow-lib' },
    h('header.libp-h', h('h3', icon('filter', 14), 'Filters & saved searches'),
      h('span.muted.small', 'Kept while this tab is open (also when you reload or open another workbook); nothing is stored in the browser. Download the library to keep or share it.'),
      h('span.libp-tools',
        searchLib.dirty && searchLib.items.length ? h('span.tag.pending', { tip: 'Filters or searches changed since the library was last downloaded or loaded. They are lost when this tab is closed.' }, 'not downloaded') : null,
        h('button.btn.sm', { type: 'button', tip: 'Save the library as a JSON file (a download, like the Excel export)', disabled: !searchLib.items.length, onclick: () => { libDownload(); api.controls(); } }, icon('download', 13), 'Download library'),
        h('button.btn.sm', { type: 'button', id: 'lib-load', tip: 'Read a library file downloaded before; entries with the same name are replaced', onclick: () => file.click() }, icon('upload', 13), 'Load library…'), file,
        h('button.icon-btn.sm', { type: 'button', tip: 'Close', onclick: () => { ui.libOpen = false; api.controls(); } }, icon('close', 12)))),
    h('div.lib-sec', h('div.lib-sec-h', icon('filter', 12), 'Content filters', h('span.count', filters.length), h('button.btn.ghost.sm', { type: 'button', onclick: () => filterDialog(null, api) }, icon('plus', 12), 'New content filter')),
      filters.length ? filters.map(fRow) : h('div.lib-empty', 'No content filters yet. A content filter finds objects by what one of their attributes contains — pick the object, click the attribute in its card, type the word. Errors and warnings are attributes too.')),
    h('div.lib-sec', h('div.lib-sec-h', icon('bookmark', 12), 'Saved searches', h('span.count', searches.length), ui.focus ? h('button.btn.ghost.sm', { type: 'button', onclick: () => searchDialog(null, exprToText(ui.focus), api) }, icon('bookmark', 12), 'Save current search') : null),
      searches.length ? searches.map(sRow) : h('div.lib-empty', 'No saved searches yet. Build a search — by clicks, by typing or with filters — and press “Save search” in the focus bar. Saved searches can be used inside other searches as @name.')));
}
function libPut(prev, item) {
  if (prev && searchLib.items.includes(prev)) {
    searchLib.items[searchLib.items.indexOf(prev)] = item;
    if (prev.name !== item.name) {
      for (const s of searchLib.items) if (s.kind === 'search') s.expr = qRenameRef(s.expr, prev.name, item.name);
      state.ui.flow.focus = exprRenameRef(state.ui.flow.focus, prev.name, item.name);
    }
  } else searchLib.items.push(item);
  searchLib.dirty = true;
}
function libDelete(it, api) {
  const users = libUsers(it.name).filter((x) => x !== it);
  if (users.length) { toast('@' + it.name + ' is used by ' + users.map((x) => '@' + x.name).join(', ') + '. Edit or delete ' + (users.length > 1 ? 'those searches' : 'that search') + ' first.', 'error'); return; }
  confirmDialog('Delete @' + it.name + '?', it.kind === 'filter' ? filterDesc(it) : it.expr, 'Delete', () => {
    searchLib.items = searchLib.items.filter((x) => x !== it); searchLib.dirty = true;
    const ui = state.ui.flow, f2 = exprDropRef(ui.focus, it.name), inFocus = exprToText(f2) !== exprToText(ui.focus);
    if (inFocus) api.setFocus(f2); else api.controls();
    toast('Deleted @' + it.name + (inFocus ? ' and removed it from the current search.' : '.'));
  });
}
function confirmDialog(title, text, okLabel, onOk) {
  const d = openDialog(title, h('div', h('p.text', text), h('div.dialog-actions',
    h('button.btn', { type: 'button', onclick: () => d.close() }, 'Cancel'),
    h('button.btn.primary', { type: 'button', id: 'confirm-ok', onclick: () => { d.close(); onOk(); } }, okLabel))));
}
const LIB_FORMAT = 'risk-register-explorer/search-library';
function libDownload() {
  const now = new Date(), data = { format: LIB_FORMAT, version: 1, saved: now.toISOString(), items: searchLib.items.map((x) => ({ ...x })) };
  const name = 'RRE_search-library_' + stamp(now) + '.json';
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' })), a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  searchLib.dirty = false;
  toast('Downloaded “' + name + '” (' + plural(data.items.length, 'entry', 'entries') + '). Load it again with “Load library…”.');
}
/** One entry of a library file, checked field by field; null when it is not valid. */
function libItemFrom(x) {
  if (!x || typeof x !== 'object') return null;
  const name = typeof x.name === 'string' ? x.name.trim() : '';
  if (!LIB_NAME.test(name)) return null;
  if (x.kind === 'filter') {
    if (!FILTER_FIELDS[x.type] || !fieldDef(x.type, x.field) || !FILTER_OPS.some((o) => o.key === x.op)) return null;
    const text = typeof x.text === 'string' ? x.text.trim().slice(0, 200) : '';
    if (qOpNeedsWord(x.op) && !text) return null;
    return { kind: 'filter', name, type: x.type, field: x.field, op: x.op, text: qOpNeedsWord(x.op) ? text : '', whole: qOpNeedsWord(x.op) && x.whole === true };
  }
  if (x.kind === 'search' && typeof x.expr === 'string' && x.expr.trim() && x.expr.length <= 4000) return { kind: 'search', name, expr: x.expr.trim() };
  return null;
}
async function libLoad(file, api) {
  try {
    if (file.size > 2e6) throw new Error('the file is larger than 2 MB');
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('it is not a JSON file'); }
    if (!data || data.format !== LIB_FORMAT || !Array.isArray(data.items)) throw new Error('it is not a search library of Risk Register Explorer');
    let added = 0, replaced = 0, skipped = 0;
    for (const x of data.items.slice(0, 2000)) {
      const it = libItemFrom(x);
      if (!it) { skipped++; continue; }
      const old = libGet(it.name);
      if (old) { searchLib.items[searchLib.items.indexOf(old)] = it; replaced++; } else { searchLib.items.push(it); added++; }
    }
    searchLib.dirty = false; state.ui.flow.libOpen = true; api.redraw();
    toast('Library “' + file.name + '” loaded: ' + added + ' added, ' + replaced + ' replaced' + (skipped ? ', ' + skipped + ' invalid entries skipped' : '') + '.');
  } catch (e) { toast('The library could not be loaded: ' + e.message + '.', 'error'); }
}

/* ---- content filter builder: object → generic card → attribute → condition ------------------------------------ */
function qSnippet(o, fd, rx) {
  if (rx) {
    for (const v of fieldValues(o, fd)) {
      const m = rx.exec(v);
      if (!m) continue;
      const a = Math.max(0, m.index - 40), b = Math.min(v.length, m.index + m[0].length + 70);
      return [a ? '…' : '', v.slice(a, m.index), h('mark', m[0]), v.slice(m.index + m[0].length, b), b < v.length ? '…' : ''];
    }
  }
  return truncate(objTitle(o) || fieldValues(o, fd)[0] || '', 120);
}
function filterDialog(prev, api) {
  const st = prev ? { type: prev.type, field: prev.field, op: prev.op, text: prev.text || '', whole: !!prev.whole } : { type: null, field: null, op: 'contains', text: '', whole: false };
  let name = prev ? prev.name : '', named = !!prev;
  const types = h('div.fb-types', { role: 'group', 'aria-label': 'Object type' }), card = h('div.fb-card'), cond = h('div.fb-cond'), prevBox = h('div.fb-prev', { 'aria-live': 'polite' });
  const word = h('input', { type: 'text', id: 'fb-word', placeholder: 'word or phrase…', value: st.text, spellcheck: 'false', autocomplete: 'off',
    oninput: (e) => { st.text = e.target.value; preview(); }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(false); } } });
  const whole = h('input', { type: 'checkbox', id: 'fb-whole', checked: st.whole, onchange: (e) => { st.whole = e.target.checked; preview(); } });
  const nameInp = h('input', { type: 'text', id: 'fb-name', maxlength: '60', spellcheck: 'false', autocomplete: 'off', value: name, oninput: (e) => { name = e.target.value; named = true; check(); } });
  const nameErr = h('div.form-err', { id: 'fb-err' });
  const saveBtn = h('button.btn.primary', { type: 'button', id: 'fb-save', onclick: () => save(false) }, prev ? 'Save changes' : 'Save filter');
  const saveAdd = prev ? null : h('button.btn', { type: 'button', id: 'fb-save-add', tip: 'Save the filter and add it to the current search with AND', onclick: () => save(true) }, icon('plus', 13), 'Save and add to search');
  const steps = [1, 2, 3].map((n) => h('div.fb-step', h('span.fb-n', String(n)), ['Object — what do you want to find?', 'Attribute — click it in the card', 'Condition'][n - 1]));
  const ready = () => !!(st.type && st.field && (!qOpNeedsWord(st.op) || st.text.trim()));
  const cur = () => ({ type: st.type, field: st.field, op: st.op, text: qOpNeedsWord(st.op) ? st.text.trim() : '', whole: qOpNeedsWord(st.op) && st.whole });
  const autoName = () => {
    if (!st.type) return '';
    const fd = st.field && fieldDef(st.type, st.field);
    const w = qOpNeedsWord(st.op) ? (st.op === 'not' ? 'without-' : '') + st.text.trim() : st.op === 'empty' ? 'empty' : 'filled';
    const base = [st.type, fd && !fd.any ? st.field : '', w].filter(Boolean).join('-').replace(/[^A-Za-z0-9 _.-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 52) || st.type;
    let n = base, i = 2;
    while (libGet(n) && libGet(n) !== prev) n = base + '-' + i++;
    return n;
  };
  const check = () => {
    const nm = name.trim(), other = nm && libGet(nm);
    const err = !ready() ? '' : !nm ? 'Give the filter a name.' : !LIB_NAME.test(nm) ? 'Use letters, digits, spaces, “-”, “_” or “.”, starting with a letter or digit (at most 60 characters).'
      : other && other !== prev ? 'There is already a ' + (other.kind === 'filter' ? 'content filter' : 'saved search') + ' called @' + other.name + '.' : '';
    fill(nameErr, err);
    saveBtn.disabled = !ready() || !!err; if (saveAdd) saveAdd.disabled = saveBtn.disabled;
  };
  const preview = () => {
    if (!named) { name = autoName(); nameInp.value = name; }
    if (st.field) {
      if (!ready()) fill(prevBox, h('span.muted.small', 'Type the word or phrase the attribute must ' + (st.op === 'not' ? 'not ' : '') + 'contain (any case).'));
      else {
        const f = cur(), pool = qPool(st.type), list = pool.filter(filterMatcher(f)), fd = fieldDef(st.type, st.field), rx = f.op === 'contains' ? qWordRx(f) : null;
        fill(prevBox, h('div.fb-count', h('b', { id: 'fb-count' }, String(list.length)), ' of ' + pool.length + ' ' + TYPES[st.type].plural.toLowerCase() + ' match'),
          list.length ? h('ul.fb-list', list.slice(0, 8).map((o) => h('li', h('span.fb-id.t-' + o.type, icon(TYPES[o.type].icon, 12), objLabel(o)), h('span.fb-snip', qSnippet(o, fd, rx)))),
            list.length > 8 ? h('li.muted', '… and ' + (list.length - 8) + ' more') : null) : h('div.muted.small', 'Nothing matches in this workbook — the filter can still be saved.'));
      }
    }
    check();
  };
  const drawTypes = () => fill(types, FLOW_ORDER.map((t) => h('button.fb-type.t-' + t + (st.type === t ? '.on' : ''), {
    type: 'button', data: { type: t }, 'aria-pressed': String(st.type === t),
    onclick: () => { if (st.type === t) return; st.type = t; if (st.field && !fieldDef(t, st.field)) st.field = null; drawAll(); },
  }, icon(TYPES[t].icon, 18), h('b', TYPES[t].plural), h('span', plural(qPool(t).length, 'object')))));
  const drawCard = () => {
    if (!st.type) return fill(card, h('div.fb-hint', icon('info', 14), 'Click an object type above: its card opens here with every attribute you can search in — errors and warnings included.'));
    const t = TYPES[st.type], pool = qPool(st.type);
    fill(card, h('article.card.gcard.t-' + st.type,
      h('header.gcard-h', h('span.obj-ico', icon(t.icon, 16)), h('div', h('b', t.label), h('span.muted.small', 'Generic card of every ' + t.label.toLowerCase() + ' · click the attribute to search in'))),
      h('div.gcard-b', { role: 'listbox', 'aria-label': 'Attributes of a ' + t.label.toLowerCase() }, fieldList(st.type).map((fd) => {
        const vals = pool.map((o) => fieldValues(o, fd)), n = vals.filter((v) => v.length).length, ex = (vals.find((v) => v.length) || [])[0];
        return h('button.gfield' + (st.field === fd.key ? '.on' : '') + (fd.cat ? '.gissue.cat-' + fd.cat : '') + (fd.any ? '.any' : ''), {
          type: 'button', role: 'option', data: { field: fd.key }, 'aria-selected': String(st.field === fd.key),
          tip: (fd.from ? fd.from + '\n' : '') + n + ' of ' + pool.length + ' have a value' + (ex && !fd.any ? '\ne.g. ' + truncate(ex, 160) : ''),
          onclick: () => { st.field = fd.key; drawAll(); if (qOpNeedsWord(st.op)) setTimeout(() => { word.focus(); word.select(); }, 0); },
        }, h('span.gfield-l', fd.cat ? h('span.ibadge.cat-' + fd.cat, icon(ISSUE_CATS[fd.cat].icon, 11)) : fd.any ? icon('search', 13) : null, fd.label),
          h('span.gfield-v', fd.any ? 'all text of the ' + t.label.toLowerCase() : ex ? truncate(ex, 90) : '—'), h('span.gfield-n', { tip: n + ' of ' + pool.length + ' have a value' }, String(n)));
      }))));
  };
  const drawCond = () => {
    if (!st.field) { fill(cond, h('div.fb-hint', st.type ? 'Click an attribute in the card.' : 'Choose the object first.')); return; }
    const fd = fieldDef(st.type, st.field);
    fill(cond, h('div.fb-what', 'Find ', h('b', TYPES[st.type].plural.toLowerCase()), ' whose ', h('b', fd.label.toLowerCase())),
      segmented(FILTER_OPS.map((o) => ({ value: o.key, label: o.label })), st.op, (v) => { st.op = v; drawCond(); preview(); if (qOpNeedsWord(v)) word.focus(); }, 'Condition'),
      qOpNeedsWord(st.op) ? h('div.fb-word', word, h('label.fb-whole', { tip: 'Only as a whole word: “api” does not match “rapid”' }, whole, 'Whole word')) : null, prevBox);
  };
  const drawAll = () => {
    drawTypes(); drawCard(); drawCond(); preview();
    steps[0].classList.toggle('done', !!st.type); steps[1].classList.toggle('off', !st.type); steps[1].classList.toggle('done', !!st.field); steps[2].classList.toggle('off', !st.field);
  };
  const save = (andAdd) => {
    check();
    if (saveBtn.disabled) return;
    const item = { kind: 'filter', name: name.trim(), ...cur() };
    libPut(prev, item);
    d.close();
    if (andAdd) api.setFocus(exprAdd(state.ui.flow.focus, QX.ref(item.name), 'and'), { cols: true }); else api.redraw();
    toast('Content filter @' + item.name + ' saved: ' + filterDesc(item) + ' — ' + plural(filterSet(item).size, 'match', 'matches') + '.');
  };
  const body = h('div.fb',
    h('p.muted.small', 'A content filter finds objects by what one attribute contains or does not contain. Use it in the search as @name and combine it with objects, other filters and saved searches.'),
    steps[0], types,
    h('div.fb-main', h('div.fb-col', steps[1], card), h('div.fb-col', steps[2], cond)),
    h('div.fb-footer', h('div.fb-foot', h('label.fieldbox', h('span', 'Name — written @name in the search'), nameInp), h('div.dialog-actions', h('button.btn', { type: 'button', onclick: () => d.close() }, 'Cancel'), saveAdd, saveBtn)), nameErr));
  const d = openDialog(prev ? 'Edit content filter @' + prev.name : 'New content filter', body, 'xwide');
  drawAll();
}

/* ---- save / edit a search ---------------------------------------------------------------------------------- */
function searchDialog(prev, text, api) {
  let name = prev ? prev.name : '';
  const nameInp = h('input', { type: 'text', id: 'sd-name', maxlength: '60', spellcheck: 'false', autocomplete: 'off', value: name, oninput: (e) => { name = e.target.value; check(); } });
  const expr = h('textarea', { id: 'sd-expr', rows: '3', spellcheck: 'false', oninput: () => check() }, text || '');
  const err = h('div.form-err', { id: 'sd-err' }), info = h('div.qstatus.ok');
  const ok = h('button.btn.primary', { type: 'button', id: 'sd-save', onclick: () => save() }, prev ? 'Save changes' : 'Save search');
  let ast = null;
  const check = () => {
    const nm = name.trim(), other = nm && libGet(nm), r = qParse(expr.value);
    let e = !nm ? 'Give the search a name.' : !LIB_NAME.test(nm) ? 'Use letters, digits, spaces, “-”, “_” or “.”, starting with a letter or digit (at most 60 characters).'
      : other && other !== prev ? 'There is already a ' + (other.kind === 'filter' ? 'content filter' : 'saved search') + ' called @' + other.name + '.' : '';
    ast = r.ast || null;
    if (!e && r.err) e = r.err.msg;
    if (!e && !ast) e = 'The search is empty.';
    if (!e) { try { qCore(ast, [nm.toLowerCase()]); } catch (x) { if (!x.qeval) throw x; e = x.message; } }
    fill(err, e);
    fill(info, ast && !r.err ? [icon('check', 12), h('span.muted', 'reads as'), h('code.qreads', exprToText(ast))] : null);
    ok.disabled = !!e;
  };
  const save = () => {
    check();
    if (ok.disabled) return;
    const item = { kind: 'search', name: name.trim(), expr: exprToText(ast) };
    libPut(prev, item);
    d.close(); api.redraw();
    toast('Search @' + item.name + ' saved. Find it under “Filters & saved searches”, or use it in a search as @' + qWord(item.name) + '.');
  };
  const d = openDialog(prev ? 'Edit saved search @' + prev.name : 'Save search', h('div',
    h('p.muted.small', 'A saved search can be shown again later or used inside other searches as @name. It keeps the IDs and filters, so it also works after the workbook is reloaded.'),
    h('label.fieldbox', h('span', 'Name'), nameInp), h('label.fieldbox.sd-expr', h('span', 'Search'), expr), info, err,
    h('div.dialog-actions', h('button.btn', { type: 'button', onclick: () => d.close() }, 'Cancel'), ok)));
  check();
  setTimeout(() => nameInp.focus(), 0);
}

/* ---- help ---------------------------------------------------------------------------------------------------- */
function searchHelpExamples() {
  const out = [], th = M.threats.filter((t) => t.risks.some((r) => !r.notRelevant)).sort((a, b) => b.risks.length - a.risks.length);
  if (th.length >= 2) out.push({ text: qObjText(th[0]) + ' OR ' + qObjText(th[1]), note: 'the risks of either threat' });
  const r = th[0] && th[0].risks.find((x) => x.items.length && !x.notRelevant);
  if (r) out.push({ text: qObjText(th[0]) + ' AND NOT ' + qObjText(r.items[0].rmi), note: 'risks of the threat that do not use this mitigation item' });
  const comps = M.components.filter((c) => c.risks.length).sort((a, b) => b.risks.length - a.risks.length), g = M.groups.slice().sort((a, b) => b.risks.length - a.risks.length)[0];
  if (comps.length >= 2 && g) out.push({ text: '(' + qObjText(comps[0]) + ' OR ' + qObjText(comps[1]) + ') AND NOT ' + qObjText(g), note: 'risks of either component that no item of the group treats' });
  const f = searchLib.items.find((x) => x.kind === 'filter');
  if (f && th[0]) out.push({ text: '@' + qWord(f.name) + ' AND ' + qObjText(th[0]), note: 'a content filter combined with a threat' });
  return out;
}
function searchHelp(api) {
  const row = (code, text) => h('tr', h('td', h('code.qx', code)), h('td', text));
  const d = openDialog('Logical search', h('div.method.qhelp',
    h('p', 'Every term asks a question about the paths of the risk analysis — a risk with its threat, components, assumptions, mitigation items and groups: is the path linked to this object? AND, OR and NOT combine the answers. The columns then show the objects the search names (for example only the mitigation items you asked for) and everything else those risks link.'),
    h('table.tbl', h('tbody',
      row('T.BSI.15   RMI-008   "Edge Gateway"', 'An object: its ID, or the name of a component (quotes when the name has spaces). Suggestions appear while you type: ↑ ↓ and Enter or Tab pick one.'),
      row('A AND B', 'Paths linked to both (also written &).'), row('A OR B', 'Paths linked to at least one (also written |).'), row('NOT A', 'Paths not linked to A (also written !).'),
      row('( … )', 'Grouping. Without brackets AND binds before OR: A OR B AND C = A OR (B AND C).'),
      row('@name', 'A content filter or a saved search of the library (@"name with spaces"). Filters and searches can be combined like objects.'),
      row('group:X', 'Type prefix (component, assumption, threat, risk, rmi, group) — only needed when two object types use the same ID.'))),
    h('h3', 'Examples from this workbook'),
    h('div.qex', searchHelpExamples().map((x) => h('div.qex-i', h('code.qx', x.text), h('span.muted.small', x.note),
      h('button.btn.sm', { type: 'button', onclick: () => { d.close(); const r = qParse(x.text); if (r.ast) api.setFocus(r.ast, { cols: true }); } }, 'Try it')))),
    h('h3', 'With the mouse'),
    h('ul', h('li', 'Click an object in a column: it is added with AND. Ctrl+click several and release Ctrl: they are added together (same type = OR).'),
      h('li', 'In the “Focused on” bar click an “and” or “or” to switch it; ¬ next to an object negates it (a red “not” appears — click it to undo); × removes it. Brackets show how the search is grouped.'),
      h('li', '“Content filter” builds a filter by clicks: object → attribute in its card → contains / does not contain / is empty / is not empty. “Filters & saved searches” adds one to the search with AND, OR or AND NOT.'),
      h('li', '“Save search” keeps the current search in the library; download the library to keep it after the tab is closed.'))), true);
}
