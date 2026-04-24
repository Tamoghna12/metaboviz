/**
 * NetworkCanvas — instant metabolic network viewer
 *
 * < 60 reactions → Cytoscape bipartite graph, preset positions (O(n), instant)
 * ≥ 60 reactions → searchable sortable table (instant)
 *
 * Cose/force layouts dropped entirely — they block the main thread.
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import cytoscape from 'cytoscape';
import { useModel } from '../contexts/ModelContext';

const HUB_METABOLITES = new Set([
  'atp','adp','amp','atp_c','adp_c','amp_c',
  'nad','nadh','nad_c','nadh_c','nadp','nadph','nadp_c','nadph_c',
  'h2o','h2o_c','h2o_e','h2o_p','h','h_c','h_e','h_p',
  'pi','pi_c','pi_e','ppi','ppi_c','co2','co2_c','co2_e',
  'o2','o2_c','o2_e','coa','coa_c','accoa','accoa_c',
  'fad','fadh2','fad_c','fadh2_c','gtp','gdp','gtp_c','gdp_c',
]);

const COMPARTMENT_COLOR = {
  c: '#3b82f6', e: '#f59e0b', p: '#10b981',
  m: '#8b5cf6', x: '#ef4444', n: '#6366f1',
  default: '#94a3b8',
};

// ─── Instant layout: topology-aware preset positions ───────────────────────

/**
 * Place reactions in a grid, metabolites near centroid of connected reactions.
 * O(n) — no simulation, no blocking.
 */
function computePositions(reactions, metabolites, showHubs) {
  const rxnEntries = Object.keys(reactions);
  const cols = Math.max(2, Math.ceil(Math.sqrt(rxnEntries.length * 1.6)));
  const RXN_SPACING = 130;
  const MET_OFFSET = 55;

  // Reaction grid positions
  const rxnPos = {};
  rxnEntries.forEach((id, i) => {
    rxnPos[id] = {
      x: (i % cols) * RXN_SPACING + RXN_SPACING / 2,
      y: Math.floor(i / cols) * RXN_SPACING + RXN_SPACING / 2,
    };
  });

  // Metabolite positions: centroid of connected reactions + radial offset
  const metConnections = {}; // metId → list of reaction positions
  Object.entries(reactions).forEach(([rxnId, rxn]) => {
    Object.keys(rxn.metabolites || {}).forEach(mId => {
      if (!showHubs && HUB_METABOLITES.has(mId.toLowerCase())) return;
      if (!metConnections[mId]) metConnections[mId] = [];
      if (rxnPos[rxnId]) metConnections[mId].push(rxnPos[rxnId]);
    });
  });

  const metPos = {};
  let orphanIdx = 0;
  Object.keys(metConnections).forEach((mId, i) => {
    const rxnList = metConnections[mId];
    if (!rxnList || rxnList.length === 0) {
      metPos[mId] = { x: orphanIdx++ * 60, y: -80 };
      return;
    }
    const cx = rxnList.reduce((s, p) => s + p.x, 0) / rxnList.length;
    const cy = rxnList.reduce((s, p) => s + p.y, 0) / rxnList.length;
    const angle = (i / Math.max(Object.keys(metConnections).length, 1)) * Math.PI * 2;
    metPos[mId] = { x: cx + Math.cos(angle) * MET_OFFSET, y: cy + Math.sin(angle) * MET_OFFSET };
  });

  return { rxnPos, metPos };
}

function buildElementsWithPositions(reactions, metabolites, showHubs) {
  const { rxnPos, metPos } = computePositions(reactions, metabolites, showHubs);
  const elements = [];
  const addedMets = new Set();

  Object.entries(reactions).forEach(([rxnId, rxn]) => {
    const mets = rxn.metabolites || {};
    const hasVisible = Object.keys(mets).some(m => showHubs || !HUB_METABOLITES.has(m.toLowerCase()));
    if (!hasVisible || !rxnPos[rxnId]) return;

    elements.push({ data: {
      id: rxnId, label: rxnId, nodeType: 'reaction',
      reversible: (rxn.lower_bound ?? -1000) < 0,
      name: rxn.name || rxnId, gpr: rxn.gene_reaction_rule || '',
    }, position: rxnPos[rxnId] });

    Object.entries(mets).forEach(([mId, coef]) => {
      if (!showHubs && HUB_METABOLITES.has(mId.toLowerCase())) return;
      if (!addedMets.has(mId) && metPos[mId]) {
        addedMets.add(mId);
        const met = metabolites?.[mId] || {};
        const comp = mId.split('_').pop() || 'c';
        elements.push({ data: {
          id: mId,
          label: met.name || mId.replace(/_[cepmxn]$/, ''),
          nodeType: 'metabolite',
          compartment: comp,
          formula: met.formula || '',
        }, position: metPos[mId] });
      }
      elements.push({ data: {
        id: `${coef < 0 ? mId : rxnId}__${coef < 0 ? rxnId : mId}`,
        source: coef < 0 ? mId : rxnId,
        target: coef < 0 ? rxnId : mId,
      }});
    });
  });

  return elements;
}

function cytoscapeStyle(isDark) {
  const edgeColor = isDark ? '#4b5563' : '#9ca3af';
  const textColor = isDark ? '#f3f4f6' : '#111827';
  return [
    { selector: 'node[nodeType="metabolite"]', style: {
      shape: 'ellipse', width: 26, height: 26,
      'background-color': COMPARTMENT_COLOR.default,
      'border-width': 2, 'border-color': isDark ? '#374151' : '#e5e7eb',
      label: 'data(label)', 'font-size': 9, color: textColor,
      'text-valign': 'bottom', 'text-margin-y': 3,
      'text-max-width': 80, 'text-wrap': 'ellipsis', 'min-zoomed-font-size': 5,
    }},
    ...Object.entries(COMPARTMENT_COLOR).map(([comp, color]) => ({
      selector: `node[nodeType="metabolite"][compartment="${comp}"]`,
      style: { 'background-color': color },
    })),
    { selector: 'node[nodeType="reaction"]', style: {
      shape: 'round-rectangle', width: 42, height: 14,
      'background-color': isDark ? '#374151' : '#f1f5f9',
      'border-width': 1.5, 'border-color': isDark ? '#6b7280' : '#94a3b8',
      label: 'data(label)', 'font-size': 8,
      color: isDark ? '#d1d5db' : '#475569',
      'text-valign': 'center', 'text-halign': 'center',
      'text-max-width': 40, 'text-wrap': 'ellipsis', 'min-zoomed-font-size': 4,
    }},
    { selector: 'node[?reversible][nodeType="reaction"]', style: { 'border-style': 'dashed' }},
    { selector: 'edge', style: {
      width: 1.5, 'line-color': edgeColor,
      'target-arrow-color': edgeColor, 'target-arrow-shape': 'triangle',
      'arrow-scale': 0.7, 'curve-style': 'bezier', opacity: 0.6,
    }},
    { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#3b82f6', 'z-index': 10 }},
    { selector: 'node[nodeType="reaction"]:selected', style: { 'background-color': '#3b82f6', color: '#fff' }},
    { selector: '.faded', style: { opacity: 0.1 }},
    { selector: '.highlighted', style: { opacity: 1, 'z-index': 5 }},
  ];
}

// ─── Graph view ─────────────────────────────────────────────────────────────

const FLUX_TOL = 1e-6;

function GraphView({ reactions, metabolites, isDark, fluxes = {}, phenotype = null, onSelect }) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [showHubs, setShowHubs] = useState(false);
  const [nodeCount, setNodeCount] = useState(0);
  const hasFluxes = Object.keys(fluxes).length > 0;

  useEffect(() => {
    if (!containerRef.current) return;

    const elements = buildElementsWithPositions(reactions, metabolites, showHubs);
    setNodeCount(elements.filter(e => !e.data.source).length);

    cyRef.current?.destroy();

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: cytoscapeStyle(isDark),
      layout: { name: 'preset' },   // ← positions already baked in, zero computation
      minZoom: 0.05, maxZoom: 8, wheelSensitivity: 0.3,
    });

    cy.fit(undefined, 40);

    cy.on('tap', 'node[nodeType="reaction"]', e => {
      const n = e.target;
      onSelect?.({ type: 'reaction', id: n.id(), name: n.data('name'), gpr: n.data('gpr') });
      cy.elements().addClass('faded');
      n.neighborhood().addClass('highlighted');
      n.addClass('highlighted');
    });
    cy.on('tap', 'node[nodeType="metabolite"]', e => {
      const n = e.target;
      onSelect?.({ type: 'metabolite', id: n.id(), name: n.data('label'), formula: n.data('formula'), compartment: n.data('compartment') });
      cy.elements().addClass('faded');
      n.neighborhood().addClass('highlighted');
      n.addClass('highlighted');
    });
    cy.on('tap', evt => { if (evt.target === cy) { cy.elements().removeClass('faded highlighted'); onSelect?.(null); }});

    cyRef.current = cy;
    return () => { cy.destroy(); };
  }, [reactions, metabolites, showHubs, isDark]);

  // Apply flux/phenotype overlay whenever fluxes, phenotype, or theme changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    if (phenotype) {
      const { wt, ko } = phenotype;
      cy.nodes('[nodeType="reaction"]').forEach(n => {
        const rxnId = n.id();
        const wtV = wt?.fluxes?.[rxnId];
        const koV = ko?.fluxes?.[rxnId];
        if (wtV === undefined && koV === undefined) return;
        const wtActive = wtV !== undefined && Math.abs(wtV) > FLUX_TOL;
        const koActive = koV !== undefined && Math.abs(koV) > FLUX_TOL;

        let col, op;
        if (wtActive && !koActive)                                                  { col = '#ef4444'; op = 1; }
        else if (!wtActive && koActive)                                             { col = '#8b5cf6'; op = 1; }
        else if (wtActive && koActive && Math.abs(koV) < Math.abs(wtV) * 0.5)     { col = '#f97316'; op = 1; }
        else if (wtActive && koActive)                                              { col = '#22c55e'; op = 1; }
        else                                                                        { col = isDark ? '#1f2937' : '#e2e8f0'; op = 0.25; }

        n.style({ 'background-color': col, 'border-color': col, opacity: op, color: op < 0.5 ? 'var(--text-muted)' : '#fff' });
        n.connectedEdges().forEach(e => e.style({ 'line-color': col, 'target-arrow-color': col, opacity: op > 0.5 ? 0.8 : 0.1, width: 1.5 }));
      });
      return;
    }

    if (!hasFluxes) {
      cy.nodes('[nodeType="reaction"]').forEach(n => {
        n.style({ 'background-color': isDark ? '#374151' : '#f1f5f9', 'border-color': isDark ? '#6b7280' : '#94a3b8', opacity: 1 });
      });
      cy.edges().forEach(e => { e.style({ width: 1.5, 'line-color': isDark ? '#4b5563' : '#9ca3af', 'target-arrow-color': isDark ? '#4b5563' : '#9ca3af', opacity: 0.6, 'line-style': 'solid' }); });
      return;
    }
    cy.edges().removeClass('flux-live');
    cy.nodes('[nodeType="reaction"]').forEach(n => {
      const rxnId = n.id();
      const v = fluxes[rxnId];
      if (v === undefined) return;
      if (Math.abs(v) > FLUX_TOL) {
        const col = v > 0 ? '#22c55e' : '#f97316';
        n.style({ 'background-color': col, 'border-color': col, opacity: 1, color: '#fff' });
        n.connectedEdges().forEach(e => {
          e.addClass('flux-live');
          e.style({ width: Math.min(8, 1.5 + Math.abs(v) * 0.3), 'line-color': col, 'target-arrow-color': col, opacity: 0.85, 'line-style': 'dashed', 'line-dash-pattern': [8, 4] });
        });
      } else {
        n.style({ 'background-color': isDark ? '#1f2937' : '#e2e8f0', 'border-color': isDark ? '#374151' : '#cbd5e1', opacity: 0.25, color: isDark ? '#6b7280' : '#9ca3af' });
        n.connectedEdges().forEach(e => { e.style({ opacity: 0.1, 'line-style': 'solid' }); });
      }
    });
  }, [fluxes, phenotype, isDark, hasFluxes]);

  // Marching-ants animation: increment line-dash-offset on active flux edges
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !hasFluxes) return;
    let t = 0;
    const id = setInterval(() => {
      t = (t + 2) % 100;
      cy.edges('.flux-live').style({ 'line-dash-offset': -t });
    }, 40);
    return () => clearInterval(id);
  }, [hasFluxes]);

  return (
    <div className="relative w-full h-full">
      {/* Controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
        {[
          { label: '⊡', title: 'Fit', fn: () => cyRef.current?.fit(undefined, 30) },
          { label: '+', fn: () => cyRef.current?.zoom({ level: cyRef.current.zoom() * 1.3 }) },
          { label: '−', fn: () => cyRef.current?.zoom({ level: cyRef.current.zoom() / 1.3 }) },
        ].map(b => (
          <button key={b.label} onClick={b.fn} title={b.title || b.label}
            className="w-8 h-8 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-bold shadow-sm flex items-center justify-center text-sm">
            {b.label}
          </button>
        ))}
        <button onClick={() => setShowHubs(v => !v)} title="Toggle currency metabolites (H2O, ATP…)"
          className={`w-8 h-8 rounded border shadow-sm text-xs font-bold flex items-center justify-center ${showHubs ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-muted)]'}`}>
          H
        </button>
      </div>

      {/* Flux legend */}
      {hasFluxes && (
        <div className="absolute top-3 left-3 z-10 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs shadow-sm space-y-1">
          <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Flux overlay</div>
          {[['#22c55e', 'Forward (v > 0)'], ['#f97316', 'Reverse (v < 0)'], [isDark ? '#1f2937' : '#e2e8f0', 'Blocked (v ≈ 0)']].map(([c, l]) => (
            <div key={l} className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded flex-shrink-0" style={{ background: c, border: '1px solid #aaa' }} />
              <span className="text-[var(--text-muted)]">{l}</span>
            </div>
          ))}
          <div className="text-[var(--text-muted)] pt-0.5 border-t border-[var(--border-color)]">Width ∝ |flux|</div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-xs shadow-sm space-y-1">
        {[['Cytosol','c','#3b82f6'],['Extracell.','e','#f59e0b'],['Periplasm','p','#10b981'],['Other','','#94a3b8']].map(([l,,c]) => (
          <div key={l} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c }} />
            <span className="text-[var(--text-muted)]">{l}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 border-t border-[var(--border-color)] pt-1">
          <span className="w-5 h-2.5 rounded flex-shrink-0 bg-slate-200 dark:bg-slate-600 border border-slate-400" />
          <span className="text-[var(--text-muted)]">Reaction (dashed = rev)</span>
        </div>
        <div className="text-[var(--text-muted)]">{nodeCount} nodes</div>
      </div>

      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function buildCSV(reactions, metabolites) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['id', 'name', 'lower_bound', 'upper_bound', 'gene_reaction_rule', 'subsystem', 'stoichiometry_info'].join(',');
  const lines = Object.entries(reactions).map(([id, rxn]) => {
    const mets = rxn.metabolites || {};
    const reactants = Object.entries(mets).filter(([,c]) => c < 0).map(([m]) => metabolites?.[m]?.name || m).join(' + ');
    const products  = Object.entries(mets).filter(([,c]) => c > 0).map(([m]) => metabolites?.[m]?.name || m).join(' + ');
    const stoich = `${reactants} → ${products}`;
    return [id, rxn.name || '', rxn.lower_bound ?? -1000, rxn.upper_bound ?? 1000, rxn.gene_reaction_rule || '', rxn.subsystem || '', stoich].map(esc).join(',');
  });
  return [header, ...lines].join('\n');
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return {};
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const idIdx  = headers.indexOf('id');
  const lbIdx  = headers.indexOf('lower_bound');
  const ubIdx  = headers.indexOf('upper_bound');
  const gprIdx = headers.indexOf('gene_reaction_rule');
  const subIdx = headers.indexOf('subsystem');
  const nameIdx = headers.indexOf('name');
  if (idIdx === -1) throw new Error('CSV must have an "id" column');

  const updates = {};
  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parse (handles quoted fields)
    const cols = [];
    let cur = '', inQ = false;
    for (const ch of lines[i] + ',') {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
      else cur += ch;
    }
    const id = cols[idIdx]?.trim();
    if (!id) continue;
    const update = {};
    if (lbIdx !== -1 && cols[lbIdx] !== undefined) update.lower_bound  = parseFloat(cols[lbIdx]) || 0;
    if (ubIdx !== -1 && cols[ubIdx] !== undefined) update.upper_bound  = parseFloat(cols[ubIdx]) || 0;
    if (gprIdx !== -1 && cols[gprIdx] !== undefined) update.gene_reaction_rule = cols[gprIdx].trim();
    if (subIdx !== -1 && cols[subIdx] !== undefined) update.subsystem = cols[subIdx].trim();
    if (nameIdx !== -1 && cols[nameIdx] !== undefined) update.name = cols[nameIdx].trim();
    updates[id] = update;
  }
  return updates;
}

// ─── Table view (large subsystems) ──────────────────────────────────────────

function TableView({ reactions, metabolites, onSelect }) {
  const { updateReactions } = useModel();
  const csvImportRef = useRef(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('id');
  const [selected, setSelected] = useState(null);
  const [importMsg, setImportMsg] = useState(null);

  const rows = useMemo(() => Object.entries(reactions).map(([id, rxn]) => {
    const mets = rxn.metabolites || {};
    const reactants = Object.entries(mets).filter(([,c]) => c < 0).map(([m]) => metabolites?.[m]?.name || m);
    const products  = Object.entries(mets).filter(([,c]) => c > 0).map(([m]) => metabolites?.[m]?.name || m);
    return { id, name: rxn.name || '', reactants, products,
      reversible: (rxn.lower_bound ?? -1000) < 0,
      hasGPR: !!(rxn.gene_reaction_rule),
      lb: rxn.lower_bound ?? -1000, ub: rxn.upper_bound ?? 1000,
      gpr: rxn.gene_reaction_rule || '' };
  }), [reactions, metabolites]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const r = q ? rows.filter(r =>
      r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) ||
      r.reactants.some(m => m.toLowerCase().includes(q)) ||
      r.products.some(m => m.toLowerCase().includes(q)) ||
      r.gpr.toLowerCase().includes(q)
    ) : rows;
    return [...r].sort((a, b) => {
      if (sort === 'id')   return a.id.localeCompare(b.id);
      if (sort === 'mets') return (b.reactants.length + b.products.length) - (a.reactants.length + a.products.length);
      if (sort === 'rev')  return Number(b.reversible) - Number(a.reversible);
      if (sort === 'gpr')  return Number(b.hasGPR) - Number(a.hasGPR);
      return 0;
    });
  }, [rows, query, sort]);

  const exportCSV = useCallback(() => {
    const csv = buildCSV(reactions, metabolites);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reactions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [reactions, metabolites]);

  const handleImport = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const updates = parseCSV(text);
      const count = Object.keys(updates).length;
      if (count === 0) throw new Error('No valid rows found');
      updateReactions(updates);
      setImportMsg({ ok: true, text: `Updated ${count} reactions from CSV` });
    } catch (err) {
      setImportMsg({ ok: false, text: err.message });
    }
    if (csvImportRef.current) csvImportRef.current.value = '';
    setTimeout(() => setImportMsg(null), 4000);
  }, [updateReactions]);

  const SortBtn = ({ col, label }) => (
    <button onClick={() => setSort(col)}
      className={`px-2 py-1 text-xs rounded ${sort === col ? 'bg-[var(--primary)] text-white' : 'bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex-shrink-0 flex-wrap gap-y-2">
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search reactions, metabolites, genes…"
          className="flex-1 min-w-48 px-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--text-muted)] mr-1">Sort:</span>
          <SortBtn col="id" label="ID" /><SortBtn col="mets" label="Mets" />
          <SortBtn col="rev" label="Rev" /><SortBtn col="gpr" label="GPR" />
        </div>
        <div className="flex gap-3 text-xs text-[var(--text-muted)]">
          <span>{filtered.length}/{rows.length}</span>
          <span className="text-amber-600">{rows.filter(r => r.reversible).length} reversible</span>
          <span className="text-blue-600">{rows.filter(r => r.hasGPR).length} w/ GPR</span>
        </div>
        {/* CSV export/import */}
        <div className="flex items-center gap-1.5 ml-auto">
          <button onClick={exportCSV}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors"
            title="Export reactions as CSV (open in Excel)">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            Export CSV
          </button>
          <button onClick={() => csvImportRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors"
            title="Import updated CSV to apply bound/GPR changes">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4 4l4-4m0 0l4 4m-4-4V4"/></svg>
            Import CSV
          </button>
          <input ref={csvImportRef} type="file" accept=".csv,.txt" onChange={handleImport} className="hidden" />
        </div>
      </div>
      {importMsg && (
        <div className={`px-4 py-2 text-xs font-medium ${importMsg.ok ? 'bg-green-50 text-green-700 border-b border-green-200' : 'bg-red-50 text-red-700 border-b border-red-200'}`}>
          {importMsg.ok ? '✓' : '✗'} {importMsg.text}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-[var(--bg-secondary)] z-10">
            <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-color)]">
              <th className="px-3 py-2 font-medium w-36">ID</th>
              <th className="px-3 py-2 font-medium">Stoichiometry</th>
              <th className="px-3 py-2 font-medium w-24">Bounds</th>
              <th className="px-3 py-2 font-medium w-52">GPR</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.id} onClick={() => { setSelected(row.id); onSelect?.({ type: 'reaction', id: row.id, name: row.name, gpr: row.gpr }); }}
                className={`border-b border-[var(--border-color)] cursor-pointer transition-colors ${selected === row.id ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-[var(--bg-secondary)]'}`}>
                <td className="px-3 py-2">
                  <div className="font-mono text-xs font-medium text-[var(--text-primary)]">{row.id}</div>
                  {row.name && row.name !== row.id && <div className="text-xs text-[var(--text-muted)] truncate max-w-[130px]" title={row.name}>{row.name}</div>}
                  <div className="flex gap-1 mt-0.5">
                    {row.reversible && <span className="px-1 text-[10px] rounded bg-amber-100 text-amber-700">rev</span>}
                    {row.hasGPR    && <span className="px-1 text-[10px] rounded bg-blue-100 text-blue-700">gpr</span>}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--text-secondary)]">
                  <span className="text-red-500">{row.reactants.slice(0,3).join(' + ')}{row.reactants.length > 3 ? ` +${row.reactants.length-3}` : ''}</span>
                  <span className="mx-1 text-[var(--text-muted)]">{row.reversible ? '⇌' : '→'}</span>
                  <span className="text-green-600">{row.products.slice(0,3).join(' + ')}{row.products.length > 3 ? ` +${row.products.length-3}` : ''}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--text-muted)]">[{row.lb}, {row.ub}]</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--text-muted)] break-all" style={{lineHeight:1.3}}>
                  {row.gpr || <span className="italic">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-center py-12 text-[var(--text-muted)] text-sm">No reactions match "{query}"</div>}
      </div>
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

const GRAPH_THRESHOLD = 60;

export default function NetworkCanvas({ reactions, metabolites, onSelect, isDark, fluxes = {}, phenotype = null }) {
  const count = Object.keys(reactions || {}).length;
  if (!reactions || count === 0) {
    return <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">No reactions in this subsystem</div>;
  }
  return count <= GRAPH_THRESHOLD
    ? <GraphView reactions={reactions} metabolites={metabolites} isDark={isDark} fluxes={fluxes} phenotype={phenotype} onSelect={onSelect} />
    : <TableView reactions={reactions} metabolites={metabolites} isDark={isDark} onSelect={onSelect} />;
}
