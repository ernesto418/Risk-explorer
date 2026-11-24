/* ---------------------------------------------------------------------------
 * 06-views-a.js — Overview, Risk matrix, Risks, Threats.
 * ------------------------------------------------------------------------- */

const VIEWS = {};

function viewHead(title, sub, right) {
  return h('div.view-head', h('div', h('h1', title), sub ? h('p.view-sub', sub) : null), right ? h('div.view-head-r', right) : null);
}
function cardBox(title, sub, content, cls, action) {
  return h('section.card.box' + (cls ? '.' + cls : ''), h('header.box-head', h('div', h('h2', title), sub ? h('p', sub) : null), action || null), content);
}
function barList(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('div.bars', rows.map((r) => h((r.onclick ? 'button' : 'div') + '.bar-row', { type: r.onclick ? 'button' : null, tip: r.tip, onclick: r.onclick || null },
    h('span.bar-l', r.label),
    h('span.bar-track', h('span.bar-fill', { style: { flexBasis: 'calc((100% - 40px) * ' + (r.value / max).toFixed(4) + ')' } }), h('span.bar-v', r.value)))));
}
function posOf(r, when) { return when === 'before' ? { f: r.freq, e: r.effect } : r.posAfter; }
const cellKey = (f, e) => f.key + '|' + e.key;

/** Small 4×4 matrix with counts only. */
function countMatrix(risks, when, onclick, noY) {
  const counts = new Map();
  for (const r of risks) { const p = posOf(r, when); if (p.f && p.e) counts.set(cellKey(p.f, p.e), (counts.get(cellKey(p.f, p.e)) || 0) + 1); }
  const g = h('div.cmx' + (noY ? '.no-y' : ''));
  for (const e of CFG.effect.slice().reverse()) {
    if (!noY) g.append(h('span.cmx-y', { tip: 'Effects: ' + e.label }, e.label.split(' ')[0]));
    for (const f of CFG.freq) {
      const n = counts.get(cellKey(f, e)) || 0;
      g.append(h('button.cmx-c.lvl-' + levelOf(f.value * e.value) + (n ? '' : '.zero'), { type: 'button', tip: f.label + ' × ' + e.label + ' (index ' + f.value * e.value + ')\n' + plural(n, 'risk'), onclick }, n ? String(n) : ''));
    }
  }
  if (!noY) g.append(h('span'));
  for (const f of CFG.freq) g.append(h('span.cmx-x', { tip: 'Frequency: ' + f.label }, f.label));
  return g;
}

/* =============================== OVERVIEW =============================== */
VIEWS.overview = function () {
  const risks = M.risks;
  const before = levelCounts(risks, (r) => r.index), after = levelCounts(risks, (r) => r.residual);
  const both = risks.filter((r) => r.index != null && r.residual != null);
  const sumB = sum(both, (r) => r.index), sumA = sum(both, (r) => r.residual);
  const pct = sumB ? Math.round((1 - sumA / sumB) * 100) : null;
  const elementary = new Set(M.threats.filter((t) => t.risks.length && t.num >= 1 && t.num <= 47).map((t) => t.num));
  const toRisks = (f) => () => { state.ui.risks.f = f; go('risks'); };
  const kpi = (type, value, label, sub, view) => h('button.card.kpi.t-' + type, { type: 'button', onclick: () => go(view) },
    h('span.kpi-ico', icon(TYPES[type].icon, 16)), h('span.kpi-v', value), h('span.kpi-l', label), sub ? h('span.kpi-s', sub) : null);

  const hero = h('section.card.box.hero',
    h('div.hero-l', 'Risks still rated High after treatment'),
    h('div.hero-row', h('div.hero-v', String(after.high)), h('div.hero-d', h('span', 'of ' + risks.length + ' risks'), h('span', before.high + ' before treatment'))),
    h('div.hero-stats',
      h('div', h('b', sumB ? str(sumB) : '–'), h('span', 'total index before')),
      h('div', h('b', sumB ? str(sumA) : '–'), h('span', 'total index after')),
      h('div', h('b', pct != null ? (pct >= 0 ? '−' : '+') + Math.abs(pct) + '%' : '–'), h('span', 'change'))),
    after.none ? h('p.note', icon('info', 12), plural(after.none, 'risk') + ' without an after-treatment assessment.') : null);

  const profile = cardBox('Risk profile', 'Number of risks per risk-index band, before and after treatment', h('div',
    h('div.prof-row', h('span.prof-l', 'Before treatment'), levelBar(before, { tall: true, onclick: (k) => toRisks({ before: k })() })),
    h('div.prof-row', h('span.prof-l', 'After treatment'), levelBar(after, { tall: true, onclick: (k) => toRisks({ after: k })() })),
    levelLegend()), 'span8');

  const kpis = h('div.kpis',
    kpi('risk', risks.length, 'Risks', plural(M.risks.filter((r) => r.issues.length).length, 'has', 'have') + ' open issues', 'risks'),
    kpi('threat', M.threats.filter((t) => t.risks.length).length, 'Threats with risks', elementary.size + ' of 47 elementary threats', 'threats'),
    kpi('rmi', M.rmis.length, 'Mitigation items', M.stats.occ + ' risk links (RMI IDs of the risks)', 'mitigations'),
    kpi('group', M.groups.length, 'Mitigation groups', (M.stats.occ - M.stats.occAssigned) + ' risk links without group yet', 'mitigations'),
    kpi('assumption', M.assumptions.length, 'Assumptions', M.assumptions.filter((a) => a.risks.length).length + ' linked to risks', 'assumptions'),
    kpi('component', M.components.length, 'Components', 'affected assets', 'components'));

  const top = risks.filter((r) => r.residual != null).sort((a, b) => b.residual - a.residual || (b.index || 0) - (a.index || 0) || natCmp(a.id, b.id)).slice(0, 7);
  const topBox = cardBox('Highest residual risks', 'Ranked by risk index after treatment', top.length ? h('div.rrows', top.map((r) => riskRow(r))) : emptyState('No assessed risks'), 'span6',
    h('button.btn.ghost.sm', { type: 'button', onclick: () => { state.ui.risks.sort = 'after'; state.ui.risks.group = 'none'; go('risks'); } }, 'All risks', icon('arrow', 12)));

  const mx = cardBox('Risk matrix', 'Risks per cell — effects (rows) × frequency (columns)', h('div.cmx-pair',
    h('div', h('div.cmx-t', 'Before treatment'), countMatrix(risks, 'before', () => go('matrix'))),
    h('div.cmx-arrow', icon('arrow', 18)),
    h('div', h('div.cmx-t.no-y', 'After treatment'), countMatrix(risks, 'after', () => go('matrix'), true))), 'span6',
    h('button.btn.ghost.sm', { type: 'button', onclick: () => go('matrix') }, 'Open matrix', icon('arrow', 12)));

  const cats = cardBox('Treatment decisions', 'Risks per treatment category', barList(CFG.categories.map((c) => ({
    label: c.short, value: risks.filter((r) => r.category === c).length, tip: c.label + '\n' + c.desc, onclick: toRisks({ category: c.key }),
  })).concat(risks.some((r) => !r.category) ? [{ label: 'Not set', value: risks.filter((r) => !r.category).length }] : [])), 'span4');

  const cvs = cardBox('Core values at risk', 'Risks naming each protection goal', barList(CFG.coreValues.map((c) => ({
    label: c.label, value: risks.filter((r) => r.coreValues.includes(c.key)).length, onclick: toRisks({ cv: c.key }),
  }))), 'span4');

  const ap = M.stats.occ ? Math.round((M.stats.occAssigned / M.stats.occ) * 100) : 0;
  const assign = cardBox('Group assignment', 'Risk links whose RMI ID is listed by a Risk Mitigation Group', h('div',
    h('div.meter-head', h('b', ap + '%'), h('span.muted', M.stats.occAssigned + ' of ' + M.stats.occ + ' links assigned')),
    h('div.meter', { role: 'img', 'aria-label': ap + '% assigned' }, h('span', { style: { width: ap + '%' } })),
    h('p.note', icon('info', 12), M.rmis.length + ' distinct mitigation items in ' + M.groups.length + ' groups; ' + M.rmis.filter((m) => m.occ.length && !m.groups.length).length + ' items used by risks but not in any group.')), 'span4',
    h('button.btn.ghost.sm', { type: 'button', onclick: () => go('mitigations') }, 'Mitigations', icon('arrow', 12)));

  const quality = cardBox('Workbook quality', 'Findings of the automatic format and consistency checks', h('div.q-tiles', Object.keys(ISSUE_CATS).map((c) =>
    h('button.q-tile.cat-' + c, { type: 'button', tip: ISSUE_CATS[c].desc, onclick: () => { state.ui.issues.cats = new Set([c]); go('issues'); } },
      h('span.ibadge.cat-' + c, icon(ISSUE_CATS[c].icon, 14)), h('b', M.stats.cats[c]), h('span', ISSUE_CATS[c].plural)))), 'span6');

  const comps = M.components.slice().sort((a, b) => (maxOf(b.risks, (r) => r.residual) || 0) - (maxOf(a.risks, (r) => r.residual) || 0) || b.risks.length - a.risks.length).slice(0, 6);
  const compBox = cardBox('Most exposed components', 'Risk bands after treatment and highest residual index', h('div.comp-rows', comps.map((c) =>
    h('button.comp-row', { type: 'button', onclick: () => openObj(c) }, h('span.comp-n', c.name), levelBar(levelCounts(c.risks, (r) => r.residual)), h('span.muted.small', plural(c.risks.length, 'risk')), pill(maxOf(c.risks, (r) => r.residual))))), 'span6',
    h('button.btn.ghost.sm', { type: 'button', onclick: () => go('components') }, 'Components', icon('arrow', 12)));

  return h('div.view',
    viewHead('Overview', 'Risk analysis following BSI Standard 200-3 — read from “' + (M.sheetNames.risk || '?') + '”'),
    h('div.grid12', hero, profile), kpis, h('div.grid12', topBox, mx, cats, cvs, assign, quality, compBox));
};

/* =============================== RISK MATRIX =============================== */
function matrixGrid(risks, when, show) {
  const cells = new Map();
  const unplaced = [];
  for (const r of risks) { const p = posOf(r, when); if (p.f && p.e) { const k = cellKey(p.f, p.e); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(r); } else unplaced.push(r); }
  const whenLabel = when === 'before' ? 'before treatment' : 'after treatment';
  const g = h('div.mx');
  g.append(h('div.mx-ytitle', h('span', 'Effects')));
  CFG.effect.slice().reverse().forEach((e, ri) => {
    g.append(h('div.mx-ylab', { style: { gridRow: String(ri + 1) }, tip: e.desc }, h('b', e.label), h('span', 'value ' + e.value)));
    CFG.freq.forEach((f, ci) => {
      const list = (cells.get(cellKey(f, e)) || []).slice().sort((a, b) => natCmp(a.id, b.id));
      const lv = levelOf(f.value * e.value);
      const chips = h('div.mx-chips');
      const MAXC = 36;
      if (show === 'risks') {
        list.slice(0, MAXC).forEach((r) => {
          const moved = r.freq && r.effect && r.posAfter.f && r.posAfter.e && (r.freq !== r.posAfter.f || r.effect !== r.posAfter.e);
          chips.append(h('button.mchip' + (moved ? '' : '.same'), { type: 'button', data: { k: 'r:' + r.id }, onclick: () => openObj(r),
            tip: r.id + ' — ' + truncate(r.description, 160) + '\nRisk index ' + (r.index == null ? '–' : r.index) + ' → ' + (r.residual == null ? '–' : r.residual) + (r.threat ? '\n' + r.threat.id + ' ' + (r.threat.title || '') : '') + issueSummary(r.issues) }, r.id, issueDot(r.issues)));
        });
        if (list.length > MAXC) chips.append(h('button.mchip.more', { type: 'button', onclick: () => openList(f.label + ' × ' + e.label, 'Risks ' + whenLabel, list) }, '+' + (list.length - MAXC) + ' more'));
      } else {
        const byT = groupBy(list.filter((r) => r.threat), (r) => r.threat);
        [...byT.entries()].sort((a, b) => (a[0].num || 0) - (b[0].num || 0) || natCmp(a[0].id, b[0].id)).forEach(([t, rs]) => {
          chips.append(h('button.mchip.th', { type: 'button', data: { k: 't:' + t.id }, onclick: () => openList(t.id + ' in ' + f.label + ' × ' + e.label, 'Risks ' + whenLabel, rs),
            tip: t.id + ' — ' + (t.name || '') + '\n' + plural(rs.length, 'risk') + ' in this cell: ' + rs.map((r) => r.id).join(', ') }, t.id, rs.length > 1 ? h('span.mchip-n', '×' + rs.length) : null));
        });
      }
      g.append(h('div.mx-cell.lvl-' + lv, { style: { gridRow: String(ri + 1), gridColumn: String(ci + 3) } },
        h('div.mx-cell-head',
          list.length ? h('button.mx-count', { type: 'button', tip: 'List the risks in this cell', onclick: () => openList(f.label + ' × ' + e.label, 'Risks ' + whenLabel, list) }, plural(list.length, 'risk')) : h('span'),
          h('span.mx-val', { tip: 'Risk index of this cell: ' + f.label + ' (' + f.value + ') × ' + e.label + ' (' + e.value + ') = ' + f.value * e.value + ' — ' + LEVEL_LABEL[lv] }, String(f.value * e.value))),
        chips));
    });
  });
  CFG.freq.forEach((f, ci) => g.append(h('div.mx-xlab', { style: { gridColumn: String(ci + 3) }, tip: f.desc }, h('b', f.label), h('span', 'value ' + f.value))));
  g.append(h('div.mx-xtitle', 'Frequency of occurrence'));
  return { el: g, unplaced };
}

function movementGrid(risks) {
  const stay = new Map(), moves = new Map(), afterCount = new Map(), beforeCount = new Map();
  let skipped = 0;
  for (const r of risks) {
    const a = posOf(r, 'before'), b = posOf(r, 'after');
    if (!(a.f && a.e && b.f && b.e)) { skipped++; continue; }
    const ka = cellKey(a.f, a.e), kb = cellKey(b.f, b.e);
    beforeCount.set(ka, (beforeCount.get(ka) || 0) + 1); afterCount.set(kb, (afterCount.get(kb) || 0) + 1);
    if (ka === kb) { if (!stay.has(ka)) stay.set(ka, []); stay.get(ka).push(r); }
    else { const k = ka + '>' + kb; if (!moves.has(k)) moves.set(k, { from: a, to: b, risks: [] }); moves.get(k).risks.push(r); }
  }
  const wrap = h('div.mv-wrap');
  const g = h('div.mx.mv');
  const cellEls = new Map();
  g.append(h('div.mx-ytitle', h('span', 'Effects')));
  CFG.effect.slice().reverse().forEach((e, ri) => {
    g.append(h('div.mx-ylab', { style: { gridRow: String(ri + 1) }, tip: e.desc }, h('b', e.label), h('span', 'value ' + e.value)));
    CFG.freq.forEach((f, ci) => {
      const k = cellKey(f, e), nb = beforeCount.get(k) || 0, na = afterCount.get(k) || 0, st = (stay.get(k) || []);
      const anchor = h('i.mv-anchor' + (nb || na ? '' : '.idle'));
      const cell = h('div.mx-cell.lvl-' + levelOf(f.value * e.value), { style: { gridRow: String(ri + 1), gridColumn: String(ci + 3) } },
        h('div.mx-cell-head',
          h('div.mv-num', { tip: f.label + ' × ' + e.label + '\nBefore treatment: ' + plural(nb, 'risk') + '\nAfter treatment: ' + plural(na, 'risk') + '\nUnchanged: ' + st.length },
            h('span.mv-b', String(nb)), icon('arrow', 11), h('b.mv-a', String(na))),
          h('span.mx-val', String(f.value * e.value))),
        h('div.mv-hub', anchor),
        st.length ? h('button.mv-stay', { type: 'button', onclick: () => openList(f.label + ' × ' + e.label, 'Risks that stay in this cell', st) }, st.length + ' unchanged') : h('span.mv-stay'));
      cellEls.set(k, anchor);
      g.append(cell);
    });
  });
  CFG.freq.forEach((f, ci) => g.append(h('div.mx-xlab', { style: { gridColumn: String(ci + 3) }, tip: f.desc }, h('b', f.label), h('span', 'value ' + f.value))));
  g.append(h('div.mx-xtitle', 'Frequency of occurrence'));
  const overlay = svg('svg', { class: 'mv-svg' });
  wrap.append(g, overlay);
  const draw = () => {
    clear(overlay);
    const base = wrap.getBoundingClientRect();
    if (!base.width) return;
    overlay.setAttribute('viewBox', '0 0 ' + base.width + ' ' + base.height);
    const max = Math.max(1, ...[...moves.values()].map((m) => m.risks.length));
    for (const m of moves.values()) {
      const A = cellEls.get(cellKey(m.from.f, m.from.e)).getBoundingClientRect(), B = cellEls.get(cellKey(m.to.f, m.to.e)).getBoundingClientRect();
      const ax = A.left + A.width / 2 - base.left, ay = A.top + A.height / 2 - base.top, bx = B.left + B.width / 2 - base.left, by = B.top + B.height / 2 - base.top;
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      const pad = 12;
      const sx = ax + ux * pad, sy = ay + uy * pad, ex = bx - ux * pad, ey = by - uy * pad;
      const bend = Math.min(18, len * 0.08);
      const cx = (sx + ex) / 2 - uy * bend, cy = (sy + ey) / 2 + ux * bend;
      const w = 1.5 + (m.risks.length / max) * 5;
      const worse = m.to.f.value * m.to.e.value > m.from.f.value * m.from.e.value;
      const tx = ex - cx, ty = ey - cy, tl = Math.hypot(tx, ty), hx = tx / tl, hy = ty / tl, hs = 5 + w;
      const tipTxt = m.from.f.label + ' × ' + m.from.e.label + '  →  ' + m.to.f.label + ' × ' + m.to.e.label + '\n' + plural(m.risks.length, 'risk') + ': ' + m.risks.slice(0, 12).map((r) => r.id).join(', ') + (m.risks.length > 12 ? ', …' : '');
      const open = () => openList(m.from.f.label + ' × ' + m.from.e.label + ' → ' + m.to.f.label + ' × ' + m.to.e.label, 'Risks moved by treatment', m.risks);
      const grp = svg('g', { class: 'mv-arrow' + (worse ? ' worse' : ''), tip: tipTxt, onclick: open, tabindex: '0', role: 'button' },
        svg('path', { d: 'M' + sx + ' ' + sy + ' Q' + cx + ' ' + cy + ' ' + (ex - hx * hs * 0.8) + ' ' + (ey - hy * hs * 0.8), 'stroke-width': w, class: 'mv-line' }),
        svg('path', { d: 'M' + ex + ' ' + ey + ' L' + (ex - hx * hs * 1.6 - hy * hs * 0.75) + ' ' + (ey - hy * hs * 1.6 + hx * hs * 0.75) + ' L' + (ex - hx * hs * 1.6 + hy * hs * 0.75) + ' ' + (ey - hy * hs * 1.6 - hx * hs * 0.75) + 'Z', class: 'mv-head' }),
        svg('path', { d: 'M' + sx + ' ' + sy + ' Q' + cx + ' ' + cy + ' ' + ex + ' ' + ey, class: 'mv-hit' }));
      const mx = 0.25 * sx + 0.5 * cx + 0.25 * ex, my = 0.25 * sy + 0.5 * cy + 0.25 * ey;
      grp.append(svg('circle', { cx: mx, cy: my, r: 10, class: 'mv-dot' }), svg('text', { x: mx, y: my + 3.5, 'text-anchor': 'middle', class: 'mv-txt' }, String(m.risks.length)));
      overlay.append(grp);
    }
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => requestAnimationFrame(draw)).observe(wrap);
  requestAnimationFrame(draw);
  return { el: wrap, skipped, moves: moves.size };
}

VIEWS.matrix = function () {
  const ui = state.ui.matrix;
  const body = h('div');
  const controls = h('div.controls');
  const update = (full) => {
    fill(controls, 
      h('div.ctl', h('span.ctl-l', 'Show'), segmented([{ value: 'risks', label: 'Risks', icon: 'risk' }, { value: 'threats', label: 'Threats', icon: 'threat' }], ui.show, (v) => { ui.show = v; update(); }, 'Objects shown in the cells')),
      h('div.ctl', h('span.ctl-l', 'Assessment'), segmented([
        { value: 'before', label: 'Before treatment' }, { value: 'after', label: 'After treatment' }, { value: 'both', label: 'Side by side' }, { value: 'move', label: 'Movement', tip: 'How treatment moves risks across the matrix' },
      ], ui.when, (v) => { ui.when = v; update(); }, 'Assessment state')),
      h('div.ctl.grow'), riskFilterControls(ui.f, update));
    const risks = applyRiskFilter(M.risks, ui.f);
    clear(body);
    const note = h('p.note', icon('info', 12), risks.length + ' of ' + M.risks.length + ' risks shown. The number in each cell’s corner is its risk index (frequency value × effects value). ', levelLegend());
    if (ui.when === 'move') {
      const mv = movementGrid(risks);
      body.append(h('section.card.box', h('header.box-head', h('div', h('h2', 'Effect of treatment'), h('p', 'Each arrow carries the number of risks that treatment moves from one cell to another. Top left of each cell: risks before → after treatment.'))), mv.el,
        mv.skipped ? h('p.note', icon('info', 12), plural(mv.skipped, 'risk') + ' not shown because the before or after assessment is incomplete.') : null), note);
      return;
    }
    const whens = ui.when === 'both' ? ['before', 'after'] : [ui.when];
    const row = h('div.mx-row' + (whens.length > 1 ? '.two' : ''));
    const unplaced = [];
    for (const w of whens) {
      const m = matrixGrid(risks, w, ui.show);
      row.append(h('section.card.box', h('header.box-head', h('div', h('h2', w === 'before' ? 'Before treatment' : 'After treatment'), h('p', w === 'before' ? 'Frequency and effects without additional safeguards' : 'Frequency and effects after rollout of the treatment'))), m.el));
      if (m.unplaced.length) unplaced.push({ w, list: m.unplaced });
    }
    body.append(row, note);
    for (const u of unplaced) body.append(h('section.card.box', h('header.box-head', h('div', h('h2', 'Not placed — ' + (u.w === 'before' ? 'before treatment' : 'after treatment')), h('p', 'Frequency or effects are missing or not an allowed value'))), riskList(u.list, 8)));
    /* hovering a chip highlights the same risk / threat in the other matrix */
    row.addEventListener('mouseover', (e) => {
      const c = e.target.closest('.mchip[data-k]');
      row.querySelectorAll('.mchip.hl').forEach((x) => x.classList.remove('hl'));
      row.classList.toggle('hovering', !!c);
      if (c) row.querySelectorAll('.mchip[data-k]').forEach((x) => { if (x.dataset.k === c.dataset.k) x.classList.add('hl'); });
    });
    row.addEventListener('mouseleave', () => { row.classList.remove('hovering'); row.querySelectorAll('.mchip.hl').forEach((x) => x.classList.remove('hl')); });
  };
  update();
  return h('div.view', viewHead('Risk matrix', 'Risks grouped by frequency of occurrence and effects. Choose whether the cells list risks or threats; click a chip to open it. In “Side by side”, hovering a chip highlights the same object in the other matrix.'), controls, body);
};

/* =============================== RISKS =============================== */
function riskCard(r) {
  return objCard(r, {
    main: [r.components.map((c) => h('span.meta-comp', icon('component', 12), c.name)), ciaBadges(r.coreValues), catTag(r),
      h('span.meta-n', { tip: 'Individual mitigation items' }, icon('rmi', 12), String(r.items.length)),
      r.assumptions.length ? h('span.meta-n', { tip: 'Related assumptions' }, icon('assumption', 12), String(r.assumptions.length)) : null],
    side: pillPair(r),
  });
}
VIEWS.risks = function () {
  const ui = state.ui.risks;
  const controls = h('div.controls'), list = h('div.list'), info = h('div.list-info');
  const draw = () => {
    const risks = applyRiskFilter(M.risks, ui.f);
    const sorters = {
      index: (a, b) => (b.index || 0) - (a.index || 0), after: (a, b) => (b.residual || 0) - (a.residual || 0),
      reduction: (a, b) => ((b.index || 0) - (b.residual || 0)) - ((a.index || 0) - (a.residual || 0)), id: () => 0,
    };
    risks.sort((a, b) => sorters[ui.sort](a, b) || natCmp(a.id, b.id));
    fill(info, risks.length + ' of ' + M.risks.length + ' risks');
    clear(list);
    if (!risks.length) { list.append(emptyState('No risks match the filters')); return; }
    if (ui.group === 'none') { risks.forEach((r) => list.append(riskCard(r))); return; }
    const keyFn = { threat: (r) => [r.threat], component: (r) => (r.components.length ? r.components : [null]), category: (r) => [r.category] }[ui.group];
    const groups = new Map();
    for (const r of risks) for (const k of keyFn(r)) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const entries = [...groups.entries()];
    if (ui.group === 'threat') entries.sort((a, b) => ((a[0] && a[0].num) || 999) - ((b[0] && b[0].num) || 999) || natCmp(a[0] ? a[0].id : '', b[0] ? b[0].id : ''));
    else if (ui.group === 'component') entries.sort((a, b) => natCmp(a[0] ? a[0].name : 'zzz', b[0] ? b[0].name : 'zzz'));
    else entries.sort((a, b) => CFG.categories.indexOf(a[0]) - CFG.categories.indexOf(b[0]));
    for (const [k, rs] of entries) {
      const title = !k ? h('span.muted', 'Not set') : k.type ? [chip(k), h('span.grp-title', objTitle(k))] : h('span.grp-title', k.label);
      list.append(h('div.grp', h('div.grp-head', title, h('span.count', rs.length), h('span.grp-r', levelBar(levelCounts(rs, (r) => r.residual)), pill(maxOf(rs, (r) => r.index), 'Highest index before treatment'), icon('arrow', 11), pill(maxOf(rs, (r) => r.residual), 'Highest index after treatment'))), rs.map(riskCard)));
    }
  };
  const drawControls = () => {
    fill(controls, 
      searchBox('Search risks…', ui.f.q, (v) => { ui.f.q = v; draw(); }),
      riskFilterControls(ui.f, () => { drawControls(); draw(); }, { levels: true }),
      h('div.ctl.grow'),
      h('div.ctl', h('span.ctl-l', 'Group by'), segmented([{ value: 'threat', label: 'Threat' }, { value: 'component', label: 'Component' }, { value: 'category', label: 'Treatment' }, { value: 'none', label: 'None' }], ui.group, (v) => { ui.group = v; drawControls(); draw(); }, 'Group by')),
      selectBox('Sort', [{ value: 'index', label: 'Index before ↓' }, { value: 'after', label: 'Index after ↓' }, { value: 'reduction', label: 'Reduction ↓' }, { value: 'id', label: 'Risk ID' }], ui.sort, (v) => { ui.sort = v; draw(); }, true));
  };
  drawControls(); draw();
  return h('div.view', viewHead('Risks', 'Every row of the risk analysis as an object. Expand a card for the full assessment, context and treatment.', info), controls, list);
};

/* =============================== THREATS =============================== */
VIEWS.threats = function () {
  const byNum = new Map(M.threats.filter((t) => t.num != null).map((t) => [t.num, t]));
  const tiles = h('div.tgrid');
  for (const c of BSI_THREATS) {
    const t = byNum.get(c.n);
    const st = t ? (t.risks.length ? 'used' : 'listed') : 'absent';
    const mxB = t ? maxOf(t.risks, (r) => r.index) : null, mxA = t ? maxOf(t.risks, (r) => r.residual) : null;
    tiles.append(h((t ? 'button' : 'div') + '.ttile.' + st, {
      type: t ? 'button' : null, onclick: t ? () => openObj(t) : null,
      tip: 'G 0.' + c.n + ' ' + c.name + '\nCore values primarily affected (BSI 200-3): ' + c.cia.join(', ') + '\n' + (st === 'used' ? plural(t.risks.length, 'risk') + ' in the analysis' : st === 'listed' ? 'Listed in the workbook without risks' + (t.relevance ? ': ' + truncate(t.relevance, 120) : '') : 'Not part of the workbook'),
    }, h('span.ttile-n', 'G 0.' + c.n), h('span.ttile-t', c.name),
      st === 'used' ? h('span.ttile-f', h('span.muted', plural(t.risks.length, 'risk')), h('span.pill-pair', pill(mxB), icon('arrow', 10), pill(mxA))) : h('span.ttile-f.muted', st === 'listed' ? 'no risks' : 'not analysed')));
  }
  const extra = M.threats.filter((t) => !(t.num >= 1 && t.num <= 47));
  const used = M.threats.filter((t) => t.risks.length).sort((a, b) => (a.num || 999) - (b.num || 999) || natCmp(a.id, b.id));
  const others = M.threats.filter((t) => !t.risks.length);
  const card = (t) => objCard(t, { title: t.name, main: [h('span.meta-n', icon('risk', 12), plural(t.risks.length, 'risk')), uniq(t.risks.flatMap((r) => r.components)).slice(0, 5).map((c) => h('span.meta-comp', icon('component', 12), c.name))], side: t.risks.length ? h('span.pill-pair', pill(maxOf(t.risks, (r) => r.index), 'Highest index before treatment'), icon('arrow', 11), pill(maxOf(t.risks, (r) => r.residual), 'Highest index after treatment')) : null });
  return h('div.view',
    viewHead('Threats', 'Coverage of the 47 elementary threats of the IT-Grundschutz Compendium, and the threats analysed in the workbook.'),
    cardBox('Elementary threat coverage', used.filter((t) => t.num >= 1 && t.num <= 47).length + ' of 47 elementary threats have risks · pills show the highest risk index before → after treatment',
      h('div', tiles, h('div.legend', h('span.legend-i', h('i.sw.tt-used'), 'analysed with risks'), h('span.legend-i', h('i.sw.tt-listed'), 'listed, no risks'), h('span.legend-i', h('i.sw.tt-absent'), 'not in the workbook')))),
    h('h2.list-title', 'Threats with risks ', h('span.count', used.length)),
    h('div.list', used.map(card)),
    others.length ? [h('h2.list-title', 'Threats listed without risks ', h('span.count', others.length)), h('div.list', others.map(card))] : null,
    extra.length ? h('p.note', icon('info', 12), plural(extra.length, 'threat') + ' outside the BSI catalogue numbering: ' + extra.map((t) => t.id).join(', ')) : null);
};
