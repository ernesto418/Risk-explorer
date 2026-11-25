/* ---------------------------------------------------------------------------
 * 07-views-b.js — Mitigations, Assumptions, Components, Connections, Issues.
 * ------------------------------------------------------------------------- */

/* =============================== MITIGATIONS =============================== */
function rmiCard(m) {
  return objCard(m, {
    main: [m.groups.length ? m.groups.map((g) => chip(g)) : h('span.tag.bad', { tip: 'Error: not assigned to any Risk Mitigation Group' }, 'no group'),
      h('span.meta-n', { tip: 'Risks using this item' }, icon('risk', 12), plural(m.risks.length, 'risk')),
      m.base ? null : h('span.tag.bad', { tip: 'Consistency error: this RMI ID is not in the master list' }, 'unknown ID')],
    side: m.risks.length ? pill(maxOf(m.risks, (r) => r.index), 'Highest initial risk index among the risks using this item') : null,
  });
}
function groupCard(g) {
  return objCard(g, {
    main: [h('span.meta-n', icon('rmi', 12), plural(g.rmis.length, 'item')), h('span.meta-n', icon('risk', 12), plural(g.risks.length, 'risk')),
      h('span.meta-n', icon('component', 12), plural(uniq(g.risks.flatMap((r) => r.components)).length, 'component')),
      g.risks.length ? levelBar(levelCounts(g.risks, (r) => r.index)) : null],
    side: g.risks.length ? h('span.pill-pair', pill(maxOf(g.risks, (r) => r.index), 'Highest index before treatment'), icon('arrow', 11), pill(maxOf(g.risks, (r) => r.residual), 'Highest index after treatment')) : null,
  });
}
VIEWS.mitigations = function () {
  const ui = state.ui.mit;
  const body = h('div'), controls = h('div.controls'), nrSlot = h('div.ctl.nr-slot');
  const unassigned = M.rmis.filter((m) => m.occ.length && !m.groups.length);
  /* “Hide not relevant”, separately per tab: hides groups / items whose risks are all not relevant (unused ones stay) */
  const draw = () => {
    clear(body);
    if (ui.tab === 'groups') {
      const groups = ui.hideNRg ? M.groups.filter((g) => !onlyNotRelevant(g)) : M.groups;
      fill(nrSlot, nrToggle(ui, 'hideNRg', plural(M.groups.length - groups.length, 'group') + ' hidden', draw));
      if (!M.groups.length) { body.append(emptyState('No mitigation groups found', 'The workbook has no “Risk Mitigation Groups” sheet or it is empty.')); }
      else {
        const rows = groups.slice().sort((a, b) => b.risks.length - a.risks.length || natCmp(a.id, b.id)).map((g) => ({ label: [h('b', g.id), ' ', truncate(g.name, 34)], value: g.risks.length, tip: g.id + ' — ' + g.name + '\n' + plural(g.rmis.length, 'item') + ', ' + plural(g.risks.length, 'risk') + ' addressed', onclick: () => openObj(g) }));
        body.append(cardBox('Reach of each group', 'Number of risks addressed by the mitigation items of each group', barList(rows), 'wide-labels'));
        body.append(h('h2.list-title', 'Mitigation groups ', h('span.count', groups.length)), h('div.list', groups.map(groupCard)));
      }
      if (unassigned.length) {
        add(body, h('h2.list-title', 'Used by risks but not in any group ', h('span.count', unassigned.length), h('span.ibadge.cat-consistency', { tip: 'Consistency error: every mitigation item used by a risk must be listed by a group' }, icon('consistency', 12))),
          h('div.list', unassigned.slice(0, 200).map(rmiCard)), unassigned.length > 200 ? h('p.note', 'Showing the first 200. Use “All items” to search.') : null);
      }
    } else {
      const q = ui.q.toLowerCase();
      let items = M.rmis.filter((m) => !q || (m.id + ' ' + m.text + ' ' + m.groups.map((g) => g.id + ' ' + g.name).join(' ')).toLowerCase().includes(q));
      if (ui.only === 'unassigned') items = items.filter((m) => !m.groups.length);
      else if (ui.only === 'issues') items = items.filter((m) => m.issues.some((i) => i.cat !== 'warning'));
      else if (ui.only === 'orphan') items = items.filter((m) => !m.occ.length);
      else if (ui.only === 'shared') items = items.filter((m) => m.risks.length > 1);
      const nrN = ui.hideNRi ? items.filter(onlyNotRelevant).length : 0;
      if (ui.hideNRi) items = items.filter((m) => !onlyNotRelevant(m));
      fill(nrSlot, nrToggle(ui, 'hideNRi', plural(nrN, 'item') + ' hidden', draw));
      body.append(h('div.list-info', items.length + ' of ' + M.rmis.length + ' mitigation items' + (nrN ? ' (' + nrN + ' linked only to not-relevant risks hidden)' : '')));
      const list = h('div.list');
      const show = (n) => { clear(list); items.slice(0, n).forEach((m) => list.append(rmiCard(m))); if (items.length > n) list.append(h('button.more', { type: 'button', onclick: () => show(n + 300) }, 'Show more (' + (items.length - n) + ' remaining)')); if (!items.length) list.append(emptyState('No mitigation items match')); };
      show(150);
      body.append(list);
    }
  };
  const drawControls = () => {
    fill(controls, segmented([{ value: 'groups', label: 'Groups', icon: 'group' }, { value: 'items', label: 'All items', icon: 'rmi' }], ui.tab, (v) => { ui.tab = v; drawControls(); draw(); }, 'View'));
    if (ui.tab === 'items') controls.append(searchBox('Search mitigation items…', ui.q, (v) => { ui.q = v; draw(); }),
      segmented([{ value: 'all', label: 'All' }, { value: 'unassigned', label: 'Without group' }, { value: 'shared', label: 'Used by several risks' }, { value: 'issues', label: 'With errors' }, { value: 'orphan', label: 'Not linked to any risk' }], ui.only, (v) => { ui.only = v; drawControls(); draw(); }, 'Filter'));
    controls.append(nrSlot); // always last: aligned to the right
  };
  drawControls(); draw();
  return h('div.view', viewHead('Mitigations', 'Mitigation items (RMI) and their texts come from “Risk mitigations individual”. Risks and Risk Mitigation Groups (RMG) refer to them by RMI ID in their “RMI ID” column (one ID per line).'), controls, body);
};

/* =============================== ASSUMPTIONS =============================== */
VIEWS.assumptions = function () {
  const ui = state.ui.asm;
  const list = h('div.list');
  const draw = () => {
    const q = ui.q.toLowerCase();
    const items = M.assumptions.filter((a) => !q || (a.id + ' ' + a.title + ' ' + a.description + ' ' + a.componentsRaw + ' ' + a.comment).toLowerCase().includes(q));
    clear(list);
    if (!items.length) list.append(emptyState(M.assumptions.length ? 'No assumptions match' : 'No assumptions found'));
    items.forEach((a) => list.append(objCard(a, {
      main: [h('span.meta-n', { tip: 'Validity for Alpha release' }, 'Alpha ', validityBadge(a.validityAlpha)), h('span.meta-n', { tip: 'Validity for Beta release' }, 'Beta ', validityBadge(a.validityBeta)),
        h('span.meta-n', icon('risk', 12), plural(a.risks.length, 'risk')), a.components.slice(0, 4).map((c) => h('span.meta-comp', icon('component', 12), c.name))],
      side: a.risks.length ? h('span.pill-pair', pill(maxOf(a.risks, (r) => r.index), 'Highest index before treatment among linked risks'), icon('arrow', 11), pill(maxOf(a.risks, (r) => r.residual), 'Highest index after treatment among linked risks')) : null,
    })));
  };
  draw();
  return h('div.view', viewHead('Architecture assumptions', 'Assumptions the risk assessment relies on. Linked risks are derived from the “Related assumptions” column of the risk analysis.'),
    h('div.controls', searchBox('Search assumptions…', ui.q, (v) => { ui.q = v; draw(); })), list);
};

/* =============================== COMPONENTS =============================== */
VIEWS.components = function () {
  const ui = state.ui.comp;
  const heatHost = h('div');
  const val = (r) => (ui.when === 'before' ? r.index : r.residual);
  const drawHeat = () => {
    clear(heatHost);
    const threats = M.threats.filter((t) => t.risks.length).sort((a, b) => (a.num || 999) - (b.num || 999) || natCmp(a.id, b.id));
    const comps = M.components.slice().sort((a, b) => (maxOf(b.risks, val) || 0) - (maxOf(a.risks, val) || 0) || b.risks.length - a.risks.length);
    if (!threats.length || !comps.length) { heatHost.append(emptyState('Nothing to show')); return; }
    const tbl = h('table.heat');
    tbl.append(h('thead', h('tr', h('th.heat-corner', 'Component \\ Threat'), threats.map((t) => h('th.heat-col', { tip: t.id + ' — ' + (t.name || '') }, h('button', { type: 'button', onclick: () => openObj(t) }, t.num != null ? 'G 0.' + t.num : t.id))), h('th.heat-sum', 'Highest'))));
    const tb = h('tbody');
    for (const c of comps) {
      const tr = h('tr', h('th.heat-row', h('button', { type: 'button', onclick: () => openObj(c), tip: c.name + ' — ' + plural(c.risks.length, 'risk') }, c.name)));
      for (const t of threats) {
        const rs = c.risks.filter((r) => r.threat === t);
        const mx = maxOf(rs, val);
        tr.append(h('td', rs.length ? h('button.heat-c.lvl-' + levelOf(mx), { type: 'button',
          tip: c.name + ' × ' + t.id + ' ' + (t.title || '') + '\n' + plural(rs.length, 'risk') + ' · highest index ' + (ui.when === 'before' ? 'before' : 'after') + ' treatment: ' + (mx == null ? '–' : mx),
          onclick: () => openList(c.name + ' × ' + t.id, 'Risks', rs) }, String(rs.length)) : h('span.heat-0')));
      }
      tr.append(h('td.heat-sum', pill(maxOf(c.risks, val))));
      tb.append(tr);
    }
    tbl.append(tb);
    heatHost.append(h('div.heat-scroll', tbl), h('div.legend', h('span.legend-i', 'Cell number = risks; colour = highest risk index in the cell:'), levelLegend()));
  };
  drawHeat();
  const cards = h('div.comp-grid', M.components.map((c) => h('button.card.comp-card', { type: 'button', onclick: () => openObj(c) },
    h('div.comp-card-h', h('span.obj-ico.t-component', icon('component', 15)), h('b', c.name), issueBadges(c.issues)),
    h('div.comp-card-s', h('span', plural(c.risks.length, 'risk')), h('span', plural(uniq(c.risks.map((r) => r.threat)).length, 'threat')), h('span', plural(c.assumptions.length, 'assumption'))),
    h('div.comp-card-b', h('span.prof-l', 'Before'), levelBar(levelCounts(c.risks, (r) => r.index)), pill(maxOf(c.risks, (r) => r.index))),
    h('div.comp-card-b', h('span.prof-l', 'After'), levelBar(levelCounts(c.risks, (r) => r.residual)), pill(maxOf(c.risks, (r) => r.residual))),
    h('div.comp-card-c', CFG.coreValues.map((cv) => h('span', { tip: 'Risks naming ' + cv.label }, h('b', cv.key), ' ' + c.risks.filter((r) => r.coreValues.includes(cv.key)).length))))));
  const seg = h('div');
  const drawSeg = () => fill(seg, segmented([{ value: 'before', label: 'Before treatment' }, { value: 'after', label: 'After treatment' }], ui.when, (v) => { ui.when = v; drawSeg(); drawHeat(); }, 'Assessment state'));
  drawSeg();
  return h('div.view', viewHead('Components', 'The affected assets of the project and where their risks concentrate.'),
    cardBox('Exposure map', 'Components (rows) × threats (columns)', heatHost, null, seg),
    h('h2.list-title', 'Components ', h('span.count', M.components.length)), cards);
};

/* =============================== CONNECTIONS =============================== */
let flowApply = null, clickTimer = null, lastClick = null;
const DBL_MS = 650, DBL_PX = 6;
/* Slow double click: the first click already applied the focus and the view was redrawn, so the second click lands
   on whatever is now under the pointer. A second click at the same spot within the double-click time undoes that
   focus and opens the details of the first object instead. */
let flowUndo = null;
document.addEventListener('click', (e) => {
    const lc = lastClick;
    if (state.view !== 'connections' || !flowUndo) return;
    if (!lc || !lc.applied || e.ctrlKey || e.metaKey || Date.now() - lc.t >= DBL_MS || !sameSpot(lc, e)) return;
    e.stopPropagation(); e.preventDefault(); clearTimeout(clickTimer); lastClick = null;
    flowUndo(lc);
}, true);
const sameSpot = (lc, e) => Math.abs(lc.x - e.clientX) <= DBL_PX && Math.abs(lc.y - e.clientY) <= DBL_PX;
document.addEventListener('keyup', (e) => { if ((e.key === 'Control' || e.key === 'Meta') && flowApply && state.view === 'connections') flowApply(); });
window.addEventListener('blur', () => { if (flowApply && state.view === 'connections') flowApply(); });
const FLOW_ORDER = ['component', 'assumption', 'threat', 'risk', 'rmi', 'group'];
VIEWS.connections = function () {
  const ui = state.ui.flow;
  const controls = h('div.controls'), host = h('div.flow-host');
  flowUndo = (lc) => { if (lc.prev !== ui.focus) { ui.focus = lc.prev; drawControls(); draw(); } openObj(lc.o); };
  let cleanup = null;

  const draw = () => {
    if (cleanup) { cleanup(); cleanup = null; }
    clear(host);
    /* Focus = list of terms; a term = one or more objects of the same type.
       Objects inside a term combine with OR (Ctrl+click batch), terms combine with AND (each plain click adds a term). */
    const T = ui.focus, F = T.flat(), f = F.length > 0, single = F.length === 1;
    const byType = (t) => F.filter((o) => o.type === t);
    const cols = FLOW_ORDER.filter((t) => ui.cols.includes(t));
    /* “Hide not relevant”: not-relevant risks leave the view, and threats whose risks are all not relevant;
       every other column keeps its objects (only links through hidden risks disappear). */
    const baseRisks = ui.hideNR ? M.risks.filter((r) => !r.notRelevant) : M.risks;
    if (f && ui.hideNR && F.some(onlyNotRelevant)) {
      host.append(emptyState('The focus contains objects hidden by “Hide not relevant”', 'Their risks are all not relevant (column “Threat relevance”). Switch the filter off to show them.'),
        h('p', h('button.btn', { type: 'button', id: 'nr-show', onclick: () => { ui.hideNR = false; ui.hideNRFlash = true; drawControls(); draw(); } }, 'Show not relevant')));
      return;
    }
    let riskSet = baseRisks, rmiSet = null, groupSet = null;
    if (f) {
      for (const term of T) { const rs = new Set(term.flatMap((o) => (o.type === 'risk' ? [o] : o.risks))); riskSet = riskSet.filter((r) => rs.has(r)); }
      for (const term of T.filter((x) => x[0].type === 'group')) { const ok = new Set(term.flatMap((g) => g.rmis)); rmiSet = new Set([...(rmiSet || ok)].filter((m) => ok.has(m))); }
      const fg = byType('group'), fm = byType('rmi');
      if (fg.length) groupSet = new Set(fg);
      if (fm.length) { rmiSet = new Set(fm.filter((m) => !rmiSet || rmiSet.has(m))); if (!groupSet) groupSet = new Set(fm.flatMap((m) => m.groups)); }
      if (rmiSet) riskSet = riskSet.filter((r) => r.items.some((i) => rmiSet.has(i.rmi)));
      if (!single && !riskSet.length) { host.append(emptyState('No path satisfies the whole focus', 'No risk in the risk analysis matches every term of the focus. Remove an object from the focus bar above.')); return; }
    }
    const only = (type, list) => { const sel = byType(type); return sel.length ? list.filter((x) => sel.includes(x)) : list; };
    const rel = {
      component: (r) => only('component', r.components), assumption: (r) => only('assumption', r.assumptions), threat: (r) => (r.threat ? [r.threat] : []), risk: (r) => [r],
      rmi: (r) => uniq(r.items.map((o) => o.rmi)).filter((m) => !rmiSet || rmiSet.has(m)),
      group: (r) => uniq(r.items.filter((o) => !rmiSet || rmiSet.has(o.rmi)).flatMap((o) => o.groups)).filter((g) => !groupSet || groupSet.has(g)),
    };
    /* nodes per column */
    const nodes = {};
    for (const t of cols) {
      if (!f) nodes[t] = { component: M.components, assumption: M.assumptions, threat: M.threats.filter((x) => x.risks.length && (!ui.hideNR || !onlyNotRelevant(x))), risk: baseRisks, rmi: M.rmis, group: M.groups }[t].slice();
      else if (t === 'rmi' && rmiSet && single) nodes[t] = [...rmiSet];
      else if (t === 'group' && groupSet && single) nodes[t] = [...groupSet];
      else nodes[t] = uniq(riskSet.flatMap(rel[t]));
    }
    const baseSort = {
      component: (a, b) => natCmp(a.name, b.name), assumption: (a, b) => natCmp(a.id, b.id), threat: (a, b) => (a.num || 999) - (b.num || 999) || natCmp(a.id, b.id),
      risk: (a, b) => ((a.threat && a.threat.num) || 999) - ((b.threat && b.threat.num) || 999) || natCmp(a.id, b.id), rmi: (a, b) => natCmp(a.id, b.id), group: (a, b) => natCmp(a.id, b.id),
    };
    for (const t of cols) nodes[t].sort(baseSort[t]);
    /* edges between adjacent columns */
    const edgeSets = [];
    for (let i = 0; i < cols.length - 1; i++) {
      const X = cols[i], Y = cols[i + 1], map = new Map();
      const add = (a, b, warn, r) => { const k = a.type + ':' + a.id + '>' + b.type + ':' + b.id; let e = map.get(k); if (e) e.w++; else { e = { a, b, w: 1, warn }; map.set(k, e); } if (r) (e.risks || (e.risks = new Set())).add(r); };
      if (X === 'rmi' && Y === 'group') {
        for (const m of nodes.rmi) for (const g of m.groups) if (!groupSet || groupSet.has(g)) add(m, g, false);
      } else {
        for (const r of riskSet) for (const a of rel[X](r)) for (const b of rel[Y](r)) add(a, b, false, r);
      }
      edgeSets.push([...map.values()]);
    }
    /* reduce crossings: order each column by the average position of its neighbours */
    const pos = new Map();
    const index = (t) => nodes[t].forEach((n, i) => pos.set(n, i));
    cols.forEach(index);
    const sweep = (i, dir) => {
      const t = cols[i], edges = edgeSets[dir > 0 ? i - 1 : i], acc = new Map();
      if (!edges) return;
      for (const e of edges) { const self = dir > 0 ? e.b : e.a, other = dir > 0 ? e.a : e.b; const x = acc.get(self) || [0, 0]; x[0] += pos.get(other); x[1]++; acc.set(self, x); }
      const cur = new Map(nodes[t].map((n, k) => [n, k]));
      nodes[t].sort((a, b) => { const A = acc.get(a), B = acc.get(b); return (A ? A[0] / A[1] : 1e9) - (B ? B[0] / B[1] : 1e9) || cur.get(a) - cur.get(b); });
      index(t);
    };
    for (let pass = 0; pass < 2; pass++) { for (let i = 1; i < cols.length; i++) sweep(i, 1); for (let i = cols.length - 2; i >= 0; i--) sweep(i, -1); }
    for (let i = 1; i < cols.length; i++) sweep(i, 1);

    /* render */
    const total = sum(cols, (t) => nodes[t].length);
    flowLast = { riskSet, nodes, cols };
    const els = new Map();
    const flow = h('div.flow', { style: { gridTemplateColumns: 'repeat(' + cols.length + ', minmax(150px, 1fr))' } });
    const addFocus = (o) => { ui.focus = T.concat([[o]]); drawControls(); draw(); };
    /* Ctrl/Cmd + click: collect objects first; they are applied together when the key is released. */
    const togglePending = (o, el) => {
      ui.pending = ui.pending.includes(o) ? ui.pending.filter((x) => x !== o) : ui.pending.concat(o);
      el.classList.toggle('pending', ui.pending.includes(o));
      drawControls();
    };
    flowApply = () => {
      if (!ui.pending.length) return;
      const byT = groupBy(ui.pending.filter((o) => !F.includes(o)), (o) => o.type);
      ui.pending = [];
      ui.focus = T.concat([...byT.values()]);
      drawControls(); draw();
    };
    for (const t of cols) {
      const col = h('div.flow-col.t-' + t, h('div.flow-col-h', icon(TYPES[t].icon, 14), TYPES[t].plural, h('span.count', nodes[t].length)));
      for (const o of nodes[t]) {
        const el = h('button.fnode.t-' + t + (F.includes(o) ? '.focus' : '') + (ui.pending.includes(o) ? '.pending' : ''), {
          type: 'button', tip: TYPES[t].label + ' ' + objLabel(o) + (objTitle(o) ? '\n' + truncate(objTitle(o), 200) : '') + (F.includes(o) ? '\nFocused — click to open details' : f ? '\nClick to add to the focus (AND)' : '\nClick to isolate its connections') + '\nDouble-click: open details' + '\nCtrl+click: select several, applied when Ctrl is released (same type = OR)',
          onclick: (e) => {
            if (e.ctrlKey || e.metaKey) { togglePending(o, e.currentTarget); return; }
            /* Single click = focus, double click = details only. The focus is applied after a short delay; if the
               second click comes later than that (slow double click, or the system's double-click time is longer),
               the focus added by the first click is undone, so a double click never changes the focus. */
            const now = Date.now();
            clearTimeout(clickTimer);
            if (e.detail >= 2 || (lastClick && lastClick.o === o && now - lastClick.t < DBL_MS && sameSpot(lastClick, e))) {
              const lc = lastClick; lastClick = null;
              if (lc && lc.applied && lc.prev !== ui.focus) { ui.focus = lc.prev; drawControls(); draw(); }
              openObj(o); return;
            }
            const lc = lastClick = { o, t: now, x: e.clientX, y: e.clientY, prev: ui.focus, applied: false };
            clickTimer = setTimeout(() => { lc.applied = true; if (F.includes(o)) openObj(o); else addFocus(o); }, 280);
          },
        }, icon(TYPES[t].icon, 13), h('span.fnode-id', objLabel(o)), t !== 'component' ? h('span.fnode-t', objTitle(o)) : null,
          t === 'risk' ? pill(o.residual, 'Risk index after treatment') : null, o.issues.some((i) => i.cat !== 'warning') ? h('i.fnode-err') : null);
        els.set(o, el);
        col.append(el);
      }
      if (!nodes[t].length) col.append(h('div.muted.small', 'none'));
      flow.append(col);
    }
    const overlay = svg('svg', { class: 'flow-svg' });
    const wrap = h('div.flow-wrap', overlay, flow);
    host.append(wrap);
    const edges = edgeSets.flat();
    const paint = () => {
      clear(overlay);
      const base = wrap.getBoundingClientRect();
      if (!base.width) return;
      overlay.setAttribute('width', base.width); overlay.setAttribute('height', base.height);
      for (const e of edges) {
        const A = els.get(e.a), B = els.get(e.b);
        if (!A || !B) continue;
        const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
        const x1 = ra.right - base.left, y1 = ra.top + ra.height / 2 - base.top, x2 = rb.left - base.left, y2 = rb.top + rb.height / 2 - base.top, dx = (x2 - x1) * 0.5;
        e.el = svg('path', { d: 'M' + x1 + ' ' + y1 + ' C' + (x1 + dx) + ' ' + y1 + ' ' + (x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2, class: 'edge' + (e.warn ? ' warn' : ''), 'stroke-width': Math.min(4, 1 + (e.w - 1) * 0.6) });
        overlay.append(e.el);
      }
    };
    /* hover: highlight only what the risk analysis links to the hovered object. Every link runs through
       the risks: object -> its own risks -> the threats, components, assumptions, items and groups of exactly those risks. */
    const inScope = new Set(riskSet);
    const lineage = (o) => {
      const rs = new Set((o.type === 'risk' ? [o] : o.risks).filter((r) => inScope.has(r)));
      const ns = new Set([o]);
      for (const r of rs) {
        ns.add(r);
        if (o.type !== 'threat' && r.threat) ns.add(r.threat);
        if (o.type !== 'component') r.components.forEach((c) => ns.add(c));
        if (o.type !== 'assumption') r.assumptions.forEach((a) => ns.add(a));
        if (o.type !== 'rmi' && o.type !== 'group') { r.items.forEach((i) => ns.add(i.rmi)); r.groups.forEach((g) => ns.add(g)); }
      }
      if (o.type === 'rmi') o.groups.forEach((g) => ns.add(g));
      if (o.type === 'group') o.rmis.forEach((m) => ns.add(m));
      const es = new Set();
      for (const e of edges) {
        if (!ns.has(e.a) || !ns.has(e.b)) continue;
        if (!e.risks) { es.add(e); continue; } // item-to-group membership
        for (const r of e.risks) if (rs.has(r)) { es.add(e); break; }
      }
      return { ns, es };
    };
    const over = (ev) => {
      const el = ev.target.closest('.fnode');
      wrap.classList.toggle('hovering', !!el);
      wrap.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'));
      if (!el) return;
      let obj = null;
      for (const [o, e2] of els) if (e2 === el) { obj = o; break; }
      const { ns, es } = lineage(obj);
      for (const n of ns) { const ne = els.get(n); if (ne) ne.classList.add('hl'); }
      for (const e of es) if (e.el) { e.el.classList.add('hl'); overlay.append(e.el); }
    };
    wrap.addEventListener('mouseover', over);
    wrap.addEventListener('mouseleave', () => { wrap.classList.remove('hovering'); wrap.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl')); });
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => requestAnimationFrame(paint)); ro.observe(wrap); }
    requestAnimationFrame(paint);
    cleanup = () => { if (ro) ro.disconnect(); };
    host.prepend(h('p.note', icon('info', 12), f ? 'Showing ' + total + ' objects on the paths through ' + (single ? 'the focused object' : 'the focus') + '. Click another object to narrow further (AND); Ctrl+click several objects to add them together (same type = OR). ' : total + ' objects. Click any object to isolate its connections, or Ctrl+click several and release Ctrl; hover to highlight only the objects linked to it through its own risks. ',
      'Line thickness = number of risks behind a link. Items are linked to groups by the RMI IDs listed in the group’s “RMI ID” cell.'));
  };
  const drawControls = () => {
    const nrR = M.risks.filter((r) => r.notRelevant).length, nrT = M.threats.filter((t) => t.risks.length && onlyNotRelevant(t)).length;
    fill(controls, h('div.ctl', h('span.ctl-l', 'Columns'), h('div.seg.multi', FLOW_ORDER.map((t) => h('button.t-' + t + (ui.cols.includes(t) ? '.on' : ''), {
      type: 'button', 'aria-pressed': String(ui.cols.includes(t)),
      onclick: () => { if (ui.cols.includes(t)) { if (ui.cols.length > 2) ui.cols = ui.cols.filter((x) => x !== t); } else ui.cols = ui.cols.concat(t); drawControls(); draw(); },
    }, icon(TYPES[t].icon, 13), TYPES[t].plural)))),
      h('div.ctl.nr-slot', nrToggle(ui, 'hideNR', plural(nrR, 'risk') + ', ' + plural(nrT, 'threat') + ' hidden', () => { drawControls(); draw(); })));
    const removeObj = (o) => { ui.focus = ui.focus.map((term) => term.filter((x) => x !== o)).filter((term) => term.length); drawControls(); draw(); };
    if (ui.focus.length) controls.append(h('div.ctl.focusbar', h('span.ctl-l', 'Focused on'),
      ui.focus.map((term, ti) => [ti ? h('span.focus-op', { tip: 'Every shown path satisfies both sides' }, 'and') : null,
        h('span.focus-term' + (term.length > 1 ? '.multi' : ''), term.map((o, oi) => [oi ? h('span.focus-op', { tip: 'Either object' }, 'or') : null,
          h('span.focus-i', chip(o, { label: ui.focus.flat().length < 3, max: 40 }), h('button.icon-btn.sm', { type: 'button', tip: 'Remove from focus', onclick: () => removeObj(o) }, icon('close', 11)))]))]),
      h('button.btn.ghost.sm', { type: 'button', onclick: () => { ui.focus = []; ui.pending = []; drawControls(); draw(); } }, icon('close', 12), 'Show everything')));
    if (ui.pending.length) controls.append(h('div.ctl.pendingbar', { id: 'flow-pending' }, h('span.ctl-l', 'Selecting'), ui.pending.map((o) => chip(o)), h('span.muted.small', 'release Ctrl to apply')));
  };
  drawControls(); draw();
  return h('div.view', viewHead('Connections', 'How components, assumptions, threats, risks, mitigation items and groups hang together. Choose the columns; links between non-adjacent object types are derived through the risks.'), controls, host);
};

/* =============================== ISSUES =============================== */
VIEWS.issues = function () {
  const ui = state.ui.issues;
  const tiles = h('div.q-tiles.big'), list = h('div.list'), info = h('div.list-info'), controls = h('div.controls');
  const catOrder = { format: 0, consistency: 1, warning: 2 };
  const draw = () => {
    fill(tiles, Object.keys(ISSUE_CATS).map((c) => h('button.q-tile.cat-' + c + (ui.cats.has(c) ? '.on' : ''), {
      type: 'button', 'aria-pressed': String(ui.cats.has(c)), tip: ISSUE_CATS[c].desc + '\nClick to filter',
      onclick: () => { if (ui.cats.has(c)) ui.cats.delete(c); else ui.cats.add(c); draw(); },
    }, h('span.ibadge.cat-' + c, icon(ISSUE_CATS[c].icon, 16)), h('b', M.stats.cats[c]), h('span', ISSUE_CATS[c].plural), h('small', ISSUE_CATS[c].desc))));
    const q = ui.q.toLowerCase();
    const items = M.issues.filter((it) => (!ui.cats.size || ui.cats.has(it.cat)) && (!q || (it.title + ' ' + it.msg + ' ' + (it.excerpt || '') + ' ' + (it.cell || '') + ' ' + it.refs.map((o) => o.id).join(' ')).toLowerCase().includes(q)));
    fill(info, items.length + ' of ' + M.issues.length + ' findings');
    clear(list);
    if (!items.length) { list.append(emptyState(M.issues.length ? 'No findings match the filter' : 'No findings — the workbook passes every check', M.issues.length ? null : 'Format conventions and cross-references are consistent.')); return; }
    const groups = [];
    if (ui.by === 'type') {
      for (const [code, arr] of groupBy(items, (it) => it.code)) groups.push({ key: code, cat: arr[0].cat, title: arr[0].title, sub: ISSUE_TYPES[code][2], items: arr });
      groups.sort((a, b) => catOrder[a.cat] - catOrder[b.cat] || b.items.length - a.items.length);
    } else if (ui.by === 'object') {
      const m = new Map();
      for (const it of items) for (const o of (it.refs.length ? it.refs : [null])) { if (!m.has(o)) m.set(o, []); m.get(o).push(it); }
      for (const [o, arr] of m) groups.push({ key: o ? o.type + o.id : '-', obj: o, title: o ? null : 'Workbook', items: arr });
      groups.sort((a, b) => b.items.length - a.items.length);
    } else {
      for (const [sheet, arr] of groupBy(items, (it) => it.sheet || 'Workbook')) groups.push({ key: sheet, title: '“' + sheet + '”', items: arr.slice().sort((a, b) => (a.row || 0) - (b.row || 0) || (a.col || 0) - (b.col || 0) || (a.line || 0) - (b.line || 0)) });
    }
    const openAll = items.length <= 40;
    groups.slice(0, 400).forEach((g, gi) => {
      const body = h('div.sec-b.issues');
      const fillRows = () => { if (body.firstChild) return; const show = (n) => { clear(body); g.items.slice(0, n).forEach((it) => body.append(issueRow(it, ui.by !== 'object'))); if (g.items.length > n) body.append(h('button.more', { type: 'button', onclick: () => show(g.items.length) }, 'Show all ' + g.items.length)); }; show(60); };
      const cats = uniq(g.items.map((it) => it.cat)).sort((a, b) => catOrder[a] - catOrder[b]);
      const det = h('details.card.igroup', { open: openAll || (gi < 3 && g.items.length <= 12), ontoggle: (e) => { if (e.target.open) fillRows(); } },
        h('summary', icon('chevron', 12), cats.map((c) => h('span.ibadge.cat-' + c, { tip: ISSUE_CATS[c].label }, icon(ISSUE_CATS[c].icon, 12))),
          g.obj ? [chip(g.obj), h('span.igroup-t', truncate(objTitle(g.obj), 90))] : h('span.igroup-t.strong', g.title), h('span.count', g.items.length), g.sub ? h('span.igroup-s', g.sub) : null), body);
      if (det.open) fillRows();
      list.append(det);
    });
  };
  const drawControls = () => fill(controls, searchBox('Search findings, cells, IDs…', ui.q, (v) => { ui.q = v; draw(); }), h('div.ctl.grow'),
    h('div.ctl', h('span.ctl-l', 'Group by'), segmented([{ value: 'type', label: 'Check' }, { value: 'object', label: 'Object' }, { value: 'sheet', label: 'Sheet & row' }], ui.by, (v) => { ui.by = v; drawControls(); draw(); }, 'Group by')));
  drawControls(); draw();
  return h('div.view', viewHead('Errors & warnings', 'Everything the tool noticed while reading the workbook. Each finding names the sheet, cell and line so it can be fixed in Excel.', info), tiles, controls, list);
};
