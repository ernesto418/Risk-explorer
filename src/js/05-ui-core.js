/* ---------------------------------------------------------------------------
 * 05-ui-core.js — shared UI building blocks: chips, pills, issue badges,
 * expandable object cards, the detail renderers and the side panel (drawer).
 * ------------------------------------------------------------------------- */

const TYPES = {
  component: { label: 'Component', plural: 'Components', icon: 'component' },
  assumption: { label: 'Assumption', plural: 'Assumptions', icon: 'assumption' },
  threat: { label: 'Threat', plural: 'Threats', icon: 'threat' },
  risk: { label: 'Risk', plural: 'Risks', icon: 'risk' },
  rmi: { label: 'Mitigation item', plural: 'Mitigation items', icon: 'rmi' },
  group: { label: 'Mitigation group', plural: 'Mitigation groups', icon: 'group' },
};

let M = null; // current model
const state = {
  file: null, handle: null, view: 'overview', drawer: [], expanded: new Set(),
  ui: {
    matrix: { show: 'risks', when: 'before', f: {} },
    risks: { f: {}, group: 'threat', sort: 'index' },
    mit: { tab: 'groups', q: '', only: 'all' },
    asm: { q: '' },
    comp: { when: 'before' },
    flow: { cols: ['threat', 'risk', 'rmi', 'group'], focus: [], pending: [] },
    issues: { cats: new Set(), q: '', by: 'type' },
  },
};

function objTitle(o) {
  switch (o.type) {
    case 'threat': return o.title || o.name;
    case 'risk': return o.description;
    case 'rmi': return o.text;
    case 'group': return o.name;
    case 'assumption': return o.title;
    default: return '';
  }
}
function objLabel(o) { return o.type === 'component' ? o.name : o.id; }

/* ---- small visual atoms --------------------------------------------------------- */
function chip(o, opts) {
  opts = opts || {};
  if (o.type === 'text') return h('span.chip.plain', o.name);
  const t = TYPES[o.type], title = objTitle(o);
  return h('button.chip.t-' + o.type, {
    type: 'button', tip: opts.tip || (t.label + ' ' + objLabel(o) + (title ? '\n' + truncate(title, 240) : '')),
    onclick: (e) => { e.stopPropagation(); openObj(o); },
  }, icon(t.icon, 13), h('span.chip-id', objLabel(o)), opts.label && title ? h('span.chip-label', truncate(title, opts.max || 56)) : null, opts.extra || null);
}
function pill(idx, tip) {
  const lv = levelOf(idx);
  return h('span.pill.lvl-' + lv, { tip: tip || (idx == null ? 'No risk index' : 'Risk index ' + str(idx) + ' — ' + LEVEL_LABEL[lv]) }, idx == null ? '–' : str(idx));
}
function pillPair(r) {
  return h('span.pill-pair', pill(r.index, 'Before treatment: ' + (r.index == null ? 'no risk index' : str(r.index) + ' (' + LEVEL_LABEL[levelOf(r.index)] + ')')),
    icon('arrow', 11), h('span' + (r.assumedAfter ? '.assumed' : ''), pill(r.residual, 'After treatment: ' + (r.residual == null ? 'not assessed' : str(r.residual) + ' (' + LEVEL_LABEL[levelOf(r.residual)] + ')') + (r.assumedAfter ? '\nAccepted risk without separate after-treatment assessment — initial value kept.' : ''))));
}
function ciaBadges(values, full) {
  return h('span.cia', CFG.coreValues.map((cv) => h('span.cia-b' + (values.includes(cv.key) ? '.on' : ''), { tip: cv.label + (values.includes(cv.key) ? ' at risk' : ' not listed') }, full && values.includes(cv.key) ? cv.label : cv.key)));
}
function catTag(r) {
  if (!r.category) return r.categoryRaw ? h('span.tag.bad', { tip: 'Not an allowed treatment category' }, r.categoryRaw) : h('span.tag.pending', 'no treatment category');
  return h('span.tag.cat', { tip: r.category.label + '\n' + r.category.desc }, r.category.short);
}
function issueBadges(issues, onclick) {
  if (!issues || !issues.length) return null;
  const by = { format: [], consistency: [], warning: [] };
  for (const it of issues) by[it.cat].push(it);
  return h('span.ibadges', Object.keys(by).filter((c) => by[c].length).map((c) => {
    const list = by[c];
    const tip = (list.length === 1 ? ISSUE_CATS[c].label : list.length + ' ' + ISSUE_CATS[c].plural.toLowerCase()) + '\n' + list.slice(0, 4).map((it) => '• ' + it.title).join('\n') + (list.length > 4 ? '\n…' : '');
    return h(onclick ? 'button.ibadge.cat-' + c : 'span.ibadge.cat-' + c, { type: onclick ? 'button' : null, tip, onclick: onclick ? (e) => { e.stopPropagation(); onclick(c); } : null },
      icon(ISSUE_CATS[c].icon, 12), list.length > 1 ? h('span.ibadge-n', list.length) : null);
  }));
}
function dash() { return h('span.muted', '—'); }
/** Tiny corner marker for compact chips: red = errors, amber = warnings only. */
function issueDot(issues) {
  if (!issues || !issues.length) return null;
  return h('i.idot' + (issues.some((i) => i.cat !== 'warning') ? '.err' : '.warn'));
}
function issueSummary(issues) {
  if (!issues || !issues.length) return '';
  const n = { format: 0, consistency: 0, warning: 0 };
  for (const i of issues) n[i.cat]++;
  return '\n' + Object.keys(n).filter((c) => n[c]).map((c) => n[c] + ' ' + (n[c] === 1 ? ISSUE_CATS[c].label : ISSUE_CATS[c].plural).toLowerCase()).join(', ');
}
function levelBar(counts, opts) {
  /* thin (8px) or tall (28px) segmented bar of low / medium / high / not rated */
  opts = opts || {};
  const total = counts.low + counts.medium + counts.high + counts.none;
  const bar = h('div.lbar' + (opts.tall ? '.tall' : ''), { role: 'img', 'aria-label': ['low', 'medium', 'high', 'none'].map((k) => LEVEL_LABEL[k] + ' ' + counts[k]).join(', ') });
  for (const k of ['low', 'medium', 'high', 'none']) {
    if (!counts[k]) continue;
    const pct = Math.round((counts[k] / total) * 100);
    bar.append(h((opts.onclick ? 'button' : 'span') + '.lbar-seg.lvl-' + k, {
      type: opts.onclick ? 'button' : null, style: { flexGrow: String(counts[k]) }, tip: LEVEL_LABEL[k] + ': ' + plural(counts[k], 'risk') + ' (' + pct + '%)',
      onclick: opts.onclick ? () => opts.onclick(k) : null,
    }, opts.tall && pct >= 7 ? String(counts[k]) : null));
  }
  if (!total) bar.append(h('span.lbar-seg.lvl-none', { style: { flexGrow: '1' } }));
  return bar;
}
function levelCounts(risks, fn) { const o = { low: 0, medium: 0, high: 0, none: 0 }; for (const r of risks) o[levelOf(fn(r))]++; return o; }
function levelLegend() {
  return h('div.legend', CFG.bands.map((b) => h('span.legend-i', h('i.sw.lvl-' + b.key), b.label + ' ' + b.range)), h('span.legend-i', h('i.sw.lvl-none'), 'Not rated'));
}
function segmented(options, value, onChange, label) {
  return h('div.seg', { role: 'group', 'aria-label': label }, options.map((o) => h('button' + (o.value === value ? '.on' : ''), {
    type: 'button', tip: o.tip, 'aria-pressed': String(o.value === value), onclick: () => { if (o.value !== value) onChange(o.value); },
  }, o.icon ? icon(o.icon, 13) : null, o.label)));
}
function selectBox(label, options, value, onChange, plain) {
  const sel = h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) });
  for (const o of options) { const op = h('option', { value: o.value }, o.label); if (o.value === (value || '')) op.selected = true; sel.append(op); }
  return h('label.sel' + (value && !plain ? '.active' : ''), h('span', label), sel);
}
function searchBox(placeholder, value, onInput) {
  const inp = h('input', { type: 'search', placeholder, value: value || '', 'aria-label': placeholder, oninput: debounce((e) => onInput(e.target.value), 140) });
  return h('label.searchbox', icon('search', 14), inp);
}
function emptyState(text, sub) { return h('div.empty', h('div.empty-t', text), sub ? h('div.empty-s', sub) : null); }
function section(title, content, opts) {
  opts = opts || {};
  return h('details.sec', { open: opts.open !== false }, h('summary', icon('chevron', 12), h('span.sec-t', title), opts.count != null ? h('span.count', opts.count) : null, opts.note ? h('span.sec-note', opts.note) : null), h('div.sec-b', content));
}
function field(label, value) { return h('div.field', h('div.field-l', label), h('div.field-v', value == null || value === '' || (Array.isArray(value) && !value.length) ? dash() : value)); }
function sourceLine(o) { return o.sheet ? h('div.source', icon('file', 12), 'Workbook: “' + o.sheet + '”, row ' + (o.row + 1)) : null; }
function validityBadge(v) {
  if (!v) return dash();
  const yes = /^(yes|y|valid|true|x|ok|✓|applicable)\b/i.test(v), no = /^(no|n|invalid|not valid|false|not applicable|n\/a)\b/i.test(v);
  return h('span.validity' + (yes ? '.yes' : no ? '.no' : ''), yes ? icon('check', 12) : no ? icon('close', 12) : null, v);
}

/* ---- rows & cards ------------------------------------------------------------------ */
function riskRow(r, extra) {
  return h('button.rrow', { type: 'button', onclick: (e) => { e.stopPropagation(); openObj(r); }, tip: 'Open ' + r.id },
    h('span.rrow-id', r.id), h('span.rrow-text', r.description || '—'), extra || null, issueBadges(r.issues), pillPair(r));
}
function riskList(risks, limit) {
  if (!risks.length) return h('div.muted.small', 'None');
  const sorted = risks.slice().sort((a, b) => (b.index || 0) - (a.index || 0) || natCmp(a.id, b.id));
  const box = h('div.rrows');
  const draw = (n) => {
    clear(box);
    sorted.slice(0, n).forEach((r) => box.append(riskRow(r)));
    if (sorted.length > n) box.append(h('button.more', { type: 'button', onclick: () => draw(sorted.length) }, 'Show all ' + sorted.length));
  };
  draw(limit || 12);
  return box;
}
function issueRow(it, withObj) {
  return h('div.issue.cat-' + it.cat,
    h('span.ibadge.cat-' + it.cat, { tip: ISSUE_CATS[it.cat].label }, icon(ISSUE_CATS[it.cat].icon, 12)),
    h('div.issue-main',
      h('div.issue-msg', it.msg),
      it.excerpt ? h('code.excerpt', it.excerpt) : null,
      it.hint ? h('div.issue-hint', it.hint) : null,
      h('div.issue-meta',
        it.sheet ? h('span.loc', { tip: 'Where to fix it in Excel' }, icon('file', 11), '“' + it.sheet + '”' + (it.cell ? ' · ' + (/^row/.test(it.cell) ? it.cell : 'cell ' + it.cell) : '') + (it.line ? ' · line ' + it.line : '')) : null,
        withObj ? it.refs.filter((o) => o.type).slice(0, 4).map((o) => chip(o)) : null)));
}
function issuesSection(o) {
  if (!o.issues.length) return null;
  const order = { format: 0, consistency: 1, warning: 2 };
  return section('Issues', h('div.issues', o.issues.slice().sort((a, b) => order[a.cat] - order[b.cat]).map((it) => issueRow(it))), { count: o.issues.length });
}

/** Expandable object card. opts: {main, side, ctx} */
function objCard(o, opts) {
  opts = opts || {};
  const key = o.type + ':' + (o.key || o.id);
  const t = TYPES[o.type];
  let open = state.expanded.has(key);
  const body = h('div.obj-body');
  const el = h('article.card.obj.t-' + o.type + (open ? '.open' : ''), { data: { key } });
  const toggle = () => {
    open = !open;
    el.classList.toggle('open', open);
    head.setAttribute('aria-expanded', String(open));
    if (open) { state.expanded.add(key); if (!body.firstChild) body.append(detailBody(o, { inline: true })); } else state.expanded.delete(key);
  };
  const head = h('header.obj-head', {
    tabindex: '0', role: 'button', 'aria-expanded': String(open),
    onclick: toggle, onkeydown: (e) => { if (e.target === head && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } },
  },
    h('span.obj-chev', icon('chevron', 13)),
    h('span.obj-ico', { tip: t.label }, icon(t.icon, 15)),
    h('div.obj-main', h('div.obj-line', h('span.obj-id', objLabel(o)), h('span.obj-title', opts.title != null ? opts.title : objTitle(o))), opts.main ? h('div.obj-meta', opts.main) : null),
    h('div.obj-side', opts.side || null, issueBadges(o.issues, () => openObj(o, 'issues')),
      h('button.icon-btn.sm', { type: 'button', tip: 'Open in side panel', onclick: (e) => { e.stopPropagation(); openObj(o); } }, icon('open', 13))));
  if (open) body.append(detailBody(o, { inline: true }));
  el.append(head, body);
  return el;
}

/* ---- detail renderers (used inline in cards and in the side panel) ------------------ */
function assessTable(r) {
  const cellTxt = (item, raw) => (item ? [item.label, h('span.muted', ' (' + item.value + ')')] : (raw ? h('span.tag.bad', raw) : dash()));
  const diff = r.index != null && r.residual != null ? r.index - r.residual : null;
  return h('table.assess',
    h('thead', h('tr', h('th'), h('th', 'Before treatment'), h('th', 'After treatment'))),
    h('tbody',
      h('tr', h('th', 'Frequency of occurrence'), h('td', cellTxt(r.freq, r.freqRaw)), h('td', r.assumedAfter ? h('span.muted', 'unchanged (accepted)') : cellTxt(r.freqAfter, r.freqAfterRaw))),
      h('tr', h('th', 'Effects'), h('td', cellTxt(r.effect, r.effectRaw)), h('td', r.assumedAfter ? h('span.muted', 'unchanged (accepted)') : cellTxt(r.effectAfter, r.effectAfterRaw))),
      h('tr', h('th', 'Risk index'), h('td', pill(r.index)), h('td', pill(r.residual))),
      h('tr', h('th', 'Risk reduction'), h('td', { colspan: '2' }, r.reductionRaw ? r.reductionRaw : (diff != null ? [str(diff), h('span.muted', ' (calculated)')] : dash())))));
}
function miniMatrix(r) {
  const g = h('div.mini-mx', { role: 'img', 'aria-label': 'Position in the risk matrix before and after treatment' });
  const effects = CFG.effect.slice().reverse();
  for (const e of effects) for (const f of CFG.freq) {
    const isB = r.freq === f && r.effect === e, isA = r.posAfter.f === f && r.posAfter.e === e;
    g.append(h('span.mini-c.lvl-' + levelOf(f.value * e.value), { tip: f.label + ' × ' + e.label + ' = ' + f.value * e.value + (isB ? '\nBefore treatment' : '') + (isA ? '\nAfter treatment' : '') },
      isB ? h('i.mk.before') : null, isA ? h('i.mk.after') : null));
  }
  return h('div.mini-wrap', g, h('div.mini-leg', h('span', h('i.mk.before'), 'before'), h('span', h('i.mk.after'), 'after')));
}
function itemGroups(o) {
  if (o.groups.length) return o.groups.map((g) => chip(g));
  return h('span.tag.bad', { tip: 'Consistency error: no identical line in the Content of any Risk Mitigation Group' }, 'no group');
}
function matchMark(item) {
  if (item.match === 'exact') return h('span.match.ok', { tip: 'An identical line exists in the risk analysis' }, icon('check', 12));
  if (item.match === 'near') return h('span.match.near', { tip: 'Only a near-identical line exists in the risk analysis' }, icon('consistency', 12));
  return h('span.match.none', { tip: 'No such line exists in the risk analysis' }, icon('consistency', 12));
}

const DETAIL = {
  risk(r, ctx) {
    return h('div.detail',
      ctx.inline ? null : h('p.lead', r.description || h('span.muted', 'No description')),
      h('div.assess-wrap', assessTable(r), miniMatrix(r)),
      section('Context', h('div.fields',
        field('Threat', r.threat ? chip(r.threat, { label: true }) : null),
        field('Affected component', r.components.map((c) => chip(c))),
        field('Core values at risk', r.coreValues.length ? ciaBadges(r.coreValues, true) : null),
        field('Related assumptions', r.assumptions.length ? h('div.chips.col', r.assumptions.map((a) => chip(a, { label: true }))) : null))),
      section('Treatment', h('div',
        h('div.treat-head', catTag(r), r.category ? h('span.muted.small', r.category.desc) : null),
        r.intro ? h('p.intro', r.intro) : null,
        r.items.length ? h('ul.items', r.items.map((o) => h('li.item',
          h('button.item-text', { type: 'button', tip: o.rmi.id + ' — open this mitigation item', onclick: () => openObj(o.rmi) }, o.text),
          h('span.item-side', itemGroups(o), issueBadges(o.issues))))) : h('div.muted.small', 'No individual mitigation items listed.')),
        { count: r.items.length }),
      r.save ? section('Description for SAVe database', h('p.text', r.save), { open: false }) : null,
      issuesSection(r), sourceLine(r));
  },
  threat(t, ctx) {
    const cat = t.num != null ? BSI_THREATS.find((x) => x.n === t.num) : null;
    const used = uniq(t.risks.flatMap((r) => r.coreValues));
    const comps = uniq(t.risks.flatMap((r) => r.components));
    return h('div.detail',
      ctx.inline ? null : h('p.lead', t.name || h('span.muted', 'No threat name')),
      h('div.fields',
        field('Threat relevance', t.relevance ? h('span.text', t.relevance) : null),
        field('BSI catalogue', cat ? [h('span', 'G 0.' + cat.n + ' ' + cat.name + ' '), h('span.muted.small', '— core values primarily affected: '), ciaBadges(cat.cia)] : h('span.muted', 'Not an elementary threat of the BSI catalogue')),
        field('Core values in the risks', used.length ? ciaBadges(used) : null),
        field('Components affected', comps.map((c) => chip(c)))),
      section('Risks', riskList(t.risks, 20), { count: t.risks.length }),
      issuesSection(t), sourceLine(t));
  },
  rmi(m, ctx) {
    const status = () => null;
    return h('div.detail',
      ctx.inline ? null : h('p.lead', m.text),
      m.base ? h('div.fields', field('Extended Description', m.extDescription ? h('span.text', m.extDescription) : null), field('Responsible', m.responsible || null), field('Comment', m.comment ? h('span.text', m.comment) : null),
        field('“Groups” / “Assigned” in the sheet', (m.groupsRaw || '—').replace(/\n/g, ', ') + ' / ' + (m.assignedRaw || '—'))) : h('p.note', icon('warning', 12), 'Not in “' + (M.sheetNames.rmi || 'Risk mitigations individual') + '”: this text has no RMI ID and is shown as RMI-X.'),
      h('div.fields',
        field('Mitigation group', m.groups.length ? h('div.chips.col', m.groups.map((g) => h('span.chips', chip(g, { label: true }), status(g)))) : h('span.tag.bad', 'no group')),
        m.variants.size > 1 ? field('Spellings found', h('ul.variants', [...m.variants].map(([txt, n]) => h('li', h('code.excerpt', txt), h('span.muted.small', ' × ' + n))))) : null),
      section('Used in risks', m.occ.length ? h('div.rrows', m.occ.map((o) => riskRow(o.risk, h('span.rrow-extra', 'line ' + o.line + (o.groups.length ? '' : ' · not in any group'))))) : h('div.muted.small', 'No risk uses this item — it only appears in a group’s Content.'), { count: m.risks.length }),
      m.listed.length ? section('Listed in group content', h('div.chips.col', m.listed.map((i) => h('span.chips', chip(i.group, { label: true }), h('span.muted.small', 'line ' + i.line), matchMark(i)))), { count: m.listed.length }) : null,
      issuesSection(m), m.base ? sourceLine(m) : null);
  },
  group(g, ctx) {
    const comps = uniq(g.risks.flatMap((r) => r.components));
    const tagOnly = [];
    return h('div.detail',
      ctx.inline ? null : h('p.lead', g.name || h('span.muted', 'No group name')),
      h('div.stats',
        h('div.stat', h('b', g.rmis.length), 'mitigation items'), h('div.stat', h('b', g.risks.length), 'risks addressed'),
        h('div.stat', h('b', pill(maxOf(g.risks, (r) => r.index))), 'highest index before'), h('div.stat', h('b', pill(maxOf(g.risks, (r) => r.residual))), 'highest index after')),
      h('div.fields', field('Risk treatment', g.treatment ? h('span.text', g.treatment) : null), field('Components protected', comps.map((c) => chip(c)))),
      section('Content', h('div',
        g.items.length ? h('ul.items', g.items.map((i) => h('li.item',
          h('button.item-text', { type: 'button', tip: i.rmi.id + ' — open this mitigation item', onclick: () => openObj(i.rmi) }, i.text),
          h('span.item-side', h('span.muted.small', { tip: 'Risks using this item' }, plural(i.rmi.risks.length, 'risk')), matchMark(i), issueBadges(i.issues))))) : h('div.muted.small', 'The Content cell is empty.'),
        tagOnly.length ? h('div.subhead', 'Tagged [' + g.id + '] in the risk analysis but missing from Content') : null,
        tagOnly.length ? h('ul.items', tagOnly.map((m) => h('li.item', h('button.item-text', { type: 'button', onclick: () => openObj(m) }, m.text), h('span.item-side', h('span.muted.small', plural(m.risks.length, 'risk')), issueBadges(m.issues))))) : null),
        { count: g.items.length }),
      section('Risks addressed', riskList(g.risks), { count: g.risks.length }),
      issuesSection(g), sourceLine(g));
  },
  assumption(a, ctx) {
    return h('div.detail',
      ctx.inline ? null : h('p.lead', a.title || h('span.muted', 'No title')),
      a.description ? h('p.text', a.description) : null,
      h('div.fields',
        field('Validity for Alpha release', validityBadge(a.validityAlpha)), field('Validity for Beta release', validityBadge(a.validityBeta)),
        field('Affected components', a.components.map((c) => chip(c))),
        field('Comment', a.comment ? h('span.text', a.comment) : null)),
      section('Linked risks', riskList(a.risks), { count: a.risks.length, note: 'derived from “Related assumptions” in the risk analysis' }),
      issuesSection(a), sourceLine(a));
  },
  component(c) {
    const threats = uniq(c.risks.map((r) => r.threat).filter(Boolean)).sort((a, b) => (a.num || 0) - (b.num || 0));
    const groups = uniq(c.risks.flatMap((r) => r.groups));
    return h('div.detail',
      h('div.stats',
        h('div.stat', h('b', c.risks.length), 'risks'), h('div.stat', h('b', threats.length), 'threats'),
        h('div.stat', h('b', pill(maxOf(c.risks, (r) => r.index))), 'highest index before'), h('div.stat', h('b', pill(maxOf(c.risks, (r) => r.residual))), 'highest index after')),
      h('div.fields',
        field('Before treatment', levelBar(levelCounts(c.risks, (r) => r.index))), field('After treatment', levelBar(levelCounts(c.risks, (r) => r.residual))),
        field('Threats', h('div.chips', threats.map((t) => chip(t)))),
        field('Assumptions', c.assumptions.length ? h('div.chips.col', c.assumptions.map((a) => chip(a, { label: true }))) : null),
        field('Mitigation groups', h('div.chips', groups.map((g) => chip(g))))),
      section('Risks', riskList(c.risks, 20), { count: c.risks.length }),
      issuesSection(c));
  },
};
function detailBody(o, ctx) { return DETAIL[o.type](o, ctx || {}); }

/* ---- side panel -------------------------------------------------------------------------- */
function openObj(o, focus) {
  if (!o || !DETAIL[o.type]) return;
  const top = state.drawer[state.drawer.length - 1];
  if (!top || top.obj !== o) state.drawer.push({ obj: o });
  renderDrawer(focus);
}
function openList(title, sub, risks) { state.drawer.push({ list: { title, sub, risks } }); renderDrawer(); }
function closeDrawer() { state.drawer = []; renderDrawer(); }
function renderDrawer(focus) {
  const host = document.getElementById('drawer');
  if (!host) return;
  clear(host);
  const top = state.drawer[state.drawer.length - 1];
  document.body.classList.toggle('drawer-open', !!top);
  if (!top) return;
  const back = state.drawer.length > 1 ? h('button.icon-btn', { type: 'button', tip: 'Back', onclick: () => { state.drawer.pop(); renderDrawer(); } }, icon('back', 15)) : null;
  const close = h('button.icon-btn', { type: 'button', tip: 'Close (Esc)', onclick: closeDrawer }, icon('close', 15));
  let head, body;
  if (top.obj) {
    const o = top.obj, t = TYPES[o.type];
    head = h('header.dr-head.t-' + o.type, back, h('span.obj-ico', icon(t.icon, 16)), h('div.dr-title', h('span.dr-type', t.label), h('span.dr-id', objLabel(o))),
      issueBadges(o.issues), h('button.btn.ghost.sm', { type: 'button', tip: 'Show this object and everything linked to it in the Connections view', onclick: () => { state.ui.flow.focus = [[o]]; state.ui.flow.pending = []; if (!state.ui.flow.cols.includes(o.type)) state.ui.flow.cols = FLOW_ORDER.filter((x) => state.ui.flow.cols.includes(x) || x === o.type); closeDrawer(); go('connections', true); } }, icon('flow', 13), 'Connections'), editButtons(o), close);
    body = detailBody(o, {});
    const hs = historySection(o);
    if (hs) body.append(hs);
  } else {
    head = h('header.dr-head', back, h('span.obj-ico', icon('risk', 16)), h('div.dr-title', h('span.dr-type', top.list.sub || 'Risks'), h('span.dr-id.plain', top.list.title)), close);
    body = h('div.detail', top.list.risks.length ? riskList(top.list.risks, 200) : emptyState('No risks'));
  }
  const panel = h('aside.drawer', { role: 'dialog', 'aria-label': 'Details' }, head, h('div.dr-body', body));
  host.append(h('div.scrim', { onclick: closeDrawer }), panel);
  if (focus === 'issues') { const sec = [...panel.querySelectorAll('.sec-t')].find((x) => x.textContent === 'Issues'); if (sec) sec.scrollIntoView({ block: 'start' }); }
}

/* ---- tooltip (text only) ------------------------------------------------------------------ */
function initTooltip() {
  const tip = h('div.tooltip', { role: 'tooltip' });
  document.body.append(tip);
  let cur = null;
  const show = (el) => {
    cur = el;
    tip.textContent = el.dataset.tip;
    tip.classList.add('on');
    const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2, y = r.top - tr.height - 8;
    if (y < 6) y = r.bottom + 8;
    x = Math.max(6, Math.min(x, window.innerWidth - tr.width - 6));
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  const hide = () => { cur = null; tip.classList.remove('on'); };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && el !== cur) show(el); else if (!el && cur) hide(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('mousedown', hide);
  document.addEventListener('scroll', hide, true);
}

/* ---- shared risk filters -------------------------------------------------------------------- */
function riskFilterControls(f, onChange, opts) {
  opts = opts || {};
  const set = (k) => (v) => { f[k] = v; onChange(); };
  const out = [
    selectBox('Component', [{ value: '', label: 'All' }].concat(M.components.map((c) => ({ value: c.name, label: c.name }))), f.component, set('component')),
    selectBox('Threat', [{ value: '', label: 'All' }].concat(M.threats.filter((t) => t.risks.length).map((t) => ({ value: t.id, label: truncate(t.id + ' — ' + (t.title || ''), 60) }))), f.threat, set('threat')),
    selectBox('Treatment', [{ value: '', label: 'All' }].concat(CFG.categories.map((c) => ({ value: c.key, label: c.short }))), f.category, set('category')),
    selectBox('Core value', [{ value: '', label: 'All' }].concat(CFG.coreValues.map((c) => ({ value: c.key, label: c.label }))), f.cv, set('cv')),
  ];
  if (opts.levels) {
    const lv = [{ value: '', label: 'All' }].concat(CFG.bands.map((b) => ({ value: b.key, label: b.label + ' ' + b.range })));
    out.push(selectBox('Before', lv, f.before, set('before')), selectBox('After', lv, f.after, set('after')));
  }
  if (Object.keys(f).some((k) => f[k])) out.push(h('button.btn.ghost.sm', { type: 'button', onclick: () => { for (const k in f) delete f[k]; onChange(true); } }, icon('close', 12), 'Clear filters'));
  return out;
}
function applyRiskFilter(risks, f) {
  const q = (f.q || '').toLowerCase();
  return risks.filter((r) => (!f.component || r.components.some((c) => c.name === f.component))
    && (!f.threat || (r.threat && r.threat.id === f.threat))
    && (!f.category || (r.category && r.category.key === f.category))
    && (!f.cv || r.coreValues.includes(f.cv))
    && (!f.before || levelOf(r.index) === f.before)
    && (!f.after || levelOf(r.residual) === f.after)
    && (!f.issues || r.issues.length)
    && (!q || (r.id + ' ' + r.description + ' ' + r.componentRaw + ' ' + (r.threat ? r.threat.id + ' ' + r.threat.name : '') + ' ' + r.treatmentRaw).toLowerCase().includes(q)));
}
