import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Play, X, RotateCcw, ChevronDown } from 'lucide-react';
import { useModel } from '../contexts/ModelContext';
import { compute, computeManager } from '../lib/ComputeWorker';

// ── detect biomass/objective reaction from model ──────────────────────────
function detectObjective(model) {
  const rxns = Object.entries(model.reactions || {});
  for (const [id, r] of rxns) {
    if (r.objective_coefficient && r.objective_coefficient !== 0) return id;
  }
  const patterns = [/biomass/i, /growth/i, /^bm_/i, /^BIOMASS/i, /objective/i];
  for (const [id, r] of rxns) {
    for (const pat of patterns) {
      if (pat.test(id) || (r.name && pat.test(r.name))) return id;
    }
  }
  return rxns[0]?.[0] ?? null;
}

const PRIORITY_EX = [
  'EX_glc__D_e', 'EX_glc_e', 'EX_glc_D_e', 'EX_glc',
  'EX_o2_e', 'EX_o2', 'EX_nh4_e', 'EX_nh4', 'EX_pi_e', 'EX_pi',
  'EX_co2_e', 'EX_co2', 'EX_ac_e', 'EX_h2o_e', 'EX_h_e',
];

const FLUX_TOL = 1e-6;
const DEFAULT_HEIGHT = 380;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 620;

const METHODS = [
  { id: 'fba',  label: 'FBA',  title: 'Flux Balance Analysis' },
  { id: 'pfba', label: 'pFBA', title: 'Parsimonious FBA — minimise total flux' },
  { id: 'fva',  label: 'FVA',  title: 'Flux Variability Analysis — range per reaction' },
];

// Mini horizontal bar proportional to flux magnitude
function FluxBar({ value, maxAbs, width = 72 }) {
  if (maxAbs === 0) return <span style={{ display: 'inline-block', width }} />;
  const pct = Math.min(Math.abs(value) / maxAbs, 1);
  const fwd = value >= 0;
  const barW = Math.round(pct * width);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', width, height: 10 }}>
      <span style={{
        display: 'inline-block', height: 6, width: barW,
        background: fwd ? '#3b82f6' : '#f97316',
        borderRadius: 1, flexShrink: 0,
      }} />
    </span>
  );
}

// FVA range bar: shows [min, max] span on a symmetric axis
function FVARangeBar({ min, max, absMax, width = 100 }) {
  if (absMax === 0 || min === null || max === null) {
    return <span style={{ display: 'inline-block', width, height: 10 }} />;
  }
  const scale = v => Math.min(Math.max(v / absMax, -1), 1);
  const center = width / 2;
  const lo = scale(min) * (width / 2);
  const hi = scale(max) * (width / 2);
  const barLeft  = center + Math.min(lo, hi);
  const barWidth = Math.abs(hi - lo);
  const isFixed  = Math.abs(max - min) < 1e-6;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', width, height: 10, position: 'relative' }}>
      {/* zero line */}
      <span style={{ position: 'absolute', left: center - 0.5, top: 1, width: 1, height: 8, background: '#94a3b8' }} />
      {/* range bar */}
      <span style={{
        position: 'absolute',
        left: barLeft,
        width: Math.max(barWidth, 2),
        height: 6, top: 2,
        background: isFixed ? '#64748b' : (min >= 0 ? '#3b82f6' : max <= 0 ? '#f97316' : '#8b5cf6'),
        borderRadius: 1,
        opacity: 0.85,
      }} />
    </span>
  );
}

export default function FBAPanel({ onFluxUpdate, onClose, onPhenotypeUpdate, onCellAdded }) {
  const { currentModel, exchangeReactions } = useModel();

  const [panelHeight, setPanelHeight]   = useState(DEFAULT_HEIGHT);
  const [objective, setObjective]       = useState(null);
  const [method, setMethod]             = useState('fba');
  const [constraints, setConstraints]   = useState({});
  const [knockoutQuery, setKnockoutQuery] = useState('');
  const [knockouts, setKnockouts]       = useState(new Set());
  const [running, setRunning]           = useState(false);
  const [result, setResult]             = useState(null);
  const [solveError, setSolveError]     = useState(null);
  const [phenotypeResult, setPhenotypeResult] = useState(null);
  const [phenotypeRunning, setPhenotypeRunning] = useState(false);
  const [autoSolve, setAutoSolve]       = useState(false);
  const [boundsTab, setBoundsTab]       = useState('exchange'); // 'exchange' | 'all' | 'added'
  const [rxnBoundQuery, setRxnBoundQuery] = useState('');
  const [addedRxnIds, setAddedRxnIds]   = useState(new Set());
  const [solveTs, setSolveTs]           = useState(null);

  const dropdownRef    = useRef(null);
  const rxnBoundRef    = useRef(null);
  const autoSolveTimer = useRef(null);
  const runFBARef      = useRef(null);
  const resizeStartY   = useRef(null);
  const resizeStartH   = useRef(null);

  // Auto-detect objective when model changes
  useEffect(() => {
    if (currentModel) setObjective(detectObjective(currentModel));
  }, [currentModel]);

  // Close gene dropdown on outside click
  useEffect(() => {
    const h = e => { if (!dropdownRef.current?.contains(e.target)) setKnockoutQuery(''); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => {
    const h = e => { if (!rxnBoundRef.current?.contains(e.target)) setRxnBoundQuery(''); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Resize drag
  const onResizeStart = useCallback(e => {
    e.preventDefault();
    resizeStartY.current = e.clientY;
    resizeStartH.current = panelHeight;
    const onMove = ev => {
      const dy = resizeStartY.current - ev.clientY;
      setPanelHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStartH.current + dy)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelHeight]);

  // Key exchanges
  const keyExchanges = useMemo(() => {
    const rxns = currentModel?.reactions || {};
    const found = PRIORITY_EX.filter(id => rxns[id]);
    const extras = exchangeReactions
      .filter(r => r.id.startsWith('EX_') && !found.includes(r.id))
      .slice(0, Math.max(0, 12 - found.length))
      .map(r => r.id);
    return [...found, ...extras].slice(0, 12);
  }, [currentModel, exchangeReactions]);

  const allExchangeIds = useMemo(() => {
    const rxns = currentModel?.reactions || {};
    return Object.keys(rxns).filter(id => id.startsWith('EX_') || (rxns[id]?.lower_bound ?? 0) < -999);
  }, [currentModel]);

  const allReactionIds = useMemo(() => Object.keys(currentModel?.reactions || {}), [currentModel]);

  const displayedExchanges = useMemo(() => {
    if (boundsTab === 'exchange') return keyExchanges;
    if (boundsTab === 'all') return allExchangeIds;
    return [];
  }, [boundsTab, keyExchanges, allExchangeIds]);

  const rxnMatches = useMemo(() => {
    const q = rxnBoundQuery.trim().toLowerCase();
    if (!q) return [];
    const rxns = currentModel?.reactions || {};
    return Object.entries(rxns)
      .filter(([id, r]) =>
        (id.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q)) &&
        !addedRxnIds.has(id)
      )
      .slice(0, 10)
      .map(([id]) => id);
  }, [rxnBoundQuery, currentModel, addedRxnIds]);

  const objTerms = useMemo(() => {
    if (!currentModel?.reactions || !objective) return [];
    const rxns = currentModel.reactions;
    const terms = Object.entries(rxns)
      .filter(([, r]) => r.objective_coefficient && r.objective_coefficient !== 0)
      .map(([id, r]) => ({ id, coef: r.objective_coefficient }));
    return terms.length ? terms : [{ id: objective, coef: 1.0 }];
  }, [currentModel, objective]);

  const getLB = id => constraints[id]?.lb ?? currentModel?.reactions?.[id]?.lower_bound ?? -1000;
  const getUB = id => constraints[id]?.ub ?? currentModel?.reactions?.[id]?.upper_bound ?? 1000;
  const isModified = id => constraints[id]?.lb !== undefined || constraints[id]?.ub !== undefined;
  const setLB = (id, v) => setConstraints(p => ({ ...p, [id]: { ...p[id], lb: v === '' ? undefined : parseFloat(v) } }));
  const setUB = (id, v) => setConstraints(p => ({ ...p, [id]: { ...p[id], ub: v === '' ? undefined : parseFloat(v) } }));
  const resetBound = id => setConstraints(p => { const n = { ...p }; delete n[id]; return n; });

  const toggleKO = geneId => {
    setKnockouts(prev => { const n = new Set(prev); n.has(geneId) ? n.delete(geneId) : n.add(geneId); return n; });
    setKnockoutQuery('');
  };

  const allGenes = useMemo(() => Object.keys(currentModel?.genes || {}), [currentModel]);
  const geneMatches = useMemo(() => {
    const q = knockoutQuery.trim().toLowerCase();
    if (!q) return [];
    return allGenes.filter(g => g.toLowerCase().includes(q) && !knockouts.has(g)).slice(0, 10);
  }, [allGenes, knockoutQuery, knockouts]);

  const buildConstraints = () => {
    const out = {};
    Object.entries(constraints).forEach(([id, { lb, ub }]) => {
      out[id] = {};
      if (lb !== undefined) out[id].lb = lb;
      if (ub !== undefined) out[id].ub = ub;
    });
    return out;
  };

  const runFBA = async () => {
    if (!objective) return;
    setRunning(true);
    setSolveError(null);
    const koList = [...knockouts];
    const koStr = koList.length ? `, knockouts=[${koList.slice(0, 3).join(', ')}${koList.length > 3 ? ', …' : ''}]` : '';
    const cellInput = `${method}(model, objective='${objective}'${koStr})`;
    const cellId = `cell_${Date.now()}`;
    onCellAdded?.({ id: cellId, input: cellInput, status: 'running', output: true });
    try {
      const res = await compute(method === 'fba' ? 'fba' : method, currentModel, {
        objective, knockouts: koList, constraints: buildConstraints(),
      });
      setResult(res);
      setSolveTs(Date.now());
      onFluxUpdate(res.fluxes ?? {});
      onCellAdded?.({
        id: cellId, input: cellInput,
        status: res.status?.toLowerCase() === 'optimal' ? 'optimal' : res.status,
        output: true, result: res,
        tier: res._tier || computeManager.activeTier,
        solveTime: res.solveTime,
      });
    } catch (err) {
      setSolveError(err.message);
      onFluxUpdate({});
      onCellAdded?.({ id: cellId, input: cellInput, status: 'error', output: true, error: err.message });
    }
    setRunning(false);
  };
  runFBARef.current = runFBA;

  useEffect(() => {
    if (!autoSolve || !objective || !currentModel || running) return;
    clearTimeout(autoSolveTimer.current);
    autoSolveTimer.current = setTimeout(() => runFBARef.current?.(), 600);
    return () => clearTimeout(autoSolveTimer.current);
  }, [autoSolve, constraints, knockouts, objective, currentModel]);

  const phenoWT  = phenotypeResult?.wt?.objectiveValue ?? 0;
  const phenoKO  = phenotypeResult?.ko?.objectiveValue ?? 0;
  const phenoPct = phenoWT !== 0 ? ((phenoKO - phenoWT) / Math.abs(phenoWT) * 100).toFixed(1) : null;

  const runPhenotype = async () => {
    if (!objective) return;
    setPhenotypeRunning(true);
    setSolveError(null);
    try {
      const fbaConstraints = buildConstraints();
      const [wtRes, koRes] = await Promise.all([
        compute('fba', currentModel, { objective, constraints: fbaConstraints }),
        compute('fba', currentModel, { objective, knockouts: [...knockouts], constraints: fbaConstraints }),
      ]);
      const p = { wt: wtRes, ko: koRes };
      setPhenotypeResult(p);
      onPhenotypeUpdate?.(p);
    } catch (err) {
      setSolveError(err.message);
    }
    setPhenotypeRunning(false);
  };

  const clearAll = () => {
    setResult(null); setSolveError(null);
    setPhenotypeResult(null); setSolveTs(null);
    onFluxUpdate({}); onPhenotypeUpdate?.(null);
  };

  const isFVA = method === 'fva';

  const topFluxes = useMemo(() => {
    if (!result?.fluxes) return [];
    return Object.entries(result.fluxes)
      .filter(([, v]) => Math.abs(v) > FLUX_TOL)
      .sort((a, b) => {
        if (a[0] === objective) return -1;
        if (b[0] === objective) return 1;
        return Math.abs(b[1]) - Math.abs(a[1]);
      })
      .slice(0, 80);
  }, [result, objective]);

  const maxFluxAbs = useMemo(() =>
    topFluxes.reduce((m, [, v]) => Math.max(m, Math.abs(v)), 0),
  [topFluxes]);

  // FVA ranges sorted by span width (most variable first), objective pinned
  const fvaRows = useMemo(() => {
    if (!result?.ranges) return [];
    return Object.entries(result.ranges)
      .map(([id, { min, max }]) => ({
        id,
        min: min ?? -Infinity,
        max: max ?? Infinity,
        span: (max ?? 0) - (min ?? 0),
        isFixed: Math.abs((max ?? 0) - (min ?? 0)) < 1e-6,
      }))
      .sort((a, b) => {
        if (a.id === objective) return -1;
        if (b.id === objective) return 1;
        return b.span - a.span;
      })
      .slice(0, 100);
  }, [result, objective]);

  const fvaAbsMax = useMemo(() =>
    fvaRows.reduce((m, r) => Math.max(m, Math.abs(r.min ?? 0), Math.abs(r.max ?? 0)), 1e-9),
  [fvaRows]);

  const isOptimal   = result?.status?.toLowerCase() === 'optimal';
  const activeCount = result ? Object.values(result.fluxes ?? {}).filter(v => Math.abs(v) > FLUX_TOL).length : 0;
  const zeroCount   = result ? Object.values(result.fluxes ?? {}).filter(v => Math.abs(v) <= FLUX_TOL).length : 0;
  const modCount    = Object.keys(constraints).length + addedRxnIds.size;

  const fmtTime = ms => ms == null ? '' : ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`;
  const tierBadge = result?._tier ?? computeManager?.activeTier ?? 'js';

  const rxnName = id => {
    const r = currentModel?.reactions?.[id];
    return r?.name ? r.name.slice(0, 28) : id;
  };

  // ── shared style tokens ───────────────────────────────────────────────────
  const S = {
    bg1: 'var(--bg-primary)',
    bg2: 'var(--bg-secondary)',
    border: 'var(--border-color)',
    muted: 'var(--text-muted)',
    secondary: 'var(--text-secondary)',
    primary: 'var(--primary)',
    mono: 'var(--font-mono)',
  };

  const inputCls = 'w-full text-[10px] px-2 py-0.5 border bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--primary)]';
  const numCls   = 'w-[68px] text-[10px] px-1.5 py-0.5 border bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono text-right focus:outline-none focus:ring-1 focus:ring-[var(--primary)]';
  const thCls    = 'text-[9px] font-semibold uppercase tracking-widest text-left px-2 py-1.5 select-none';
  const trBase   = 'grid items-center hover:bg-[var(--bg-primary)] transition-colors';
  const sectionLabel = 'text-[9px] font-semibold uppercase tracking-[0.12em] px-3 py-1.5 flex items-center gap-1.5';

  return (
    <div className="flex flex-col flex-shrink-0 font-mono"
         style={{ height: panelHeight, background: S.bg2, borderTop: `1px solid ${S.border}` }}>

      {/* ── Resize handle ────────────────────────────────────────────── */}
      <div
        onMouseDown={onResizeStart}
        style={{
          height: 4, cursor: 'ns-resize', flexShrink: 0,
          background: 'transparent',
          borderTop: `1px solid ${S.border}`,
        }}
        title="Drag to resize panel"
      />

      {/* ── Header toolbar ───────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-2 flex-shrink-0"
           style={{ height: 30, background: S.bg1, borderBottom: `1px solid ${S.border}` }}>

        {/* Title */}
        <span className="text-[10px] font-bold tracking-wide font-sans flex items-center gap-1.5" style={{ color: S.secondary }}>
          <span className="text-yellow-500" style={{ fontSize: 11 }}>⚡</span>
          FBA Analysis
        </span>

        <span style={{ width: 1, height: 14, background: S.border, flexShrink: 0 }} />

        {/* Method selector */}
        <div className="flex items-center" style={{ border: `1px solid ${S.border}`, borderRadius: 2 }}>
          {METHODS.map((m, i) => (
            <button key={m.id} onClick={() => setMethod(m.id)} title={m.title}
              className="text-[9px] px-2 py-0.5 font-sans transition-colors"
              style={{
                background: method === m.id ? S.primary : 'transparent',
                color: method === m.id ? '#fff' : S.muted,
                borderRight: i < METHODS.length - 1 ? `1px solid ${S.border}` : 'none',
              }}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Solve result — inline */}
        {isOptimal && !phenotypeResult && (
          <div className="flex items-center gap-2 ml-1">
            <span className="text-[10px] font-bold font-mono" style={{ color: S.primary }}>
              obj = {result.objectiveValue.toFixed(6)}
            </span>
            <span className="text-[9px] font-sans" style={{ color: S.muted }}>
              {activeCount} active · {zeroCount} zero
              {result.solveTime ? ` · ${fmtTime(result.solveTime)}` : ''}
            </span>
            <span className="text-[8px] px-1 py-px font-sans uppercase tracking-wide"
                  style={{ background: S.bg2, border: `1px solid ${S.border}`, color: S.muted, borderRadius: 2 }}>
              {tierBadge}
            </span>
          </div>
        )}
        {phenotypeResult && (
          <span className="text-[9px] font-sans ml-1" style={{ color: S.muted }}>
            WT={phenoWT.toFixed(4)} → KO={phenoKO.toFixed(4)}
            {phenoPct !== null && (
              <span className={`ml-1 font-bold ${phenoKO < phenoWT ? 'text-red-500' : 'text-green-600'}`}>
                ({phenoKO < phenoWT ? '' : '+'}{phenoPct}%)
              </span>
            )}
          </span>
        )}
        {result && !isOptimal && !solveError && (
          <span className="text-[9px] px-1.5 py-px font-sans"
                style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 2 }}>
            {result.status}
          </span>
        )}
        {solveError && (
          <span className="text-[9px] font-sans truncate max-w-[200px]" style={{ color: '#ef4444' }}>
            {solveError}
          </span>
        )}

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-1">
          {/* Live toggle */}
          <button onClick={() => setAutoSolve(v => !v)}
            className="flex items-center gap-1 text-[9px] px-2 py-0.5 font-sans transition-colors"
            style={{
              border: `1px solid ${autoSolve ? '#22c55e' : S.border}`,
              borderRadius: 2,
              background: autoSolve ? '#f0fdf4' : 'transparent',
              color: autoSolve ? '#16a34a' : S.muted,
            }}>
            <span className={`w-1.5 h-1.5 rounded-full ${autoSolve ? 'animate-pulse bg-green-500' : ''}`}
                  style={{ background: autoSolve ? '#22c55e' : S.muted }} />
            Live
          </button>

          {(result || phenotypeResult) && (
            <button onClick={clearAll}
              className="flex items-center gap-1 text-[9px] px-2 py-0.5 font-sans transition-colors"
              style={{ border: `1px solid ${S.border}`, borderRadius: 2, color: S.muted }}>
              <RotateCcw className="w-2.5 h-2.5" /> Clear
            </button>
          )}
          <button onClick={onClose}
            className="p-0.5 rounded transition-colors"
            style={{ color: S.muted }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── 3-column body ────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* ═══ Col 1 — Problem Setup ═══════════════════════════════════ */}
        <div className="flex flex-col flex-shrink-0 border-r"
             style={{ width: 220, borderColor: S.border }}>

          {/* Objective */}
          <div style={{ borderBottom: `1px solid ${S.border}` }}>
            <p className={sectionLabel} style={{ color: S.muted, background: S.bg1 }}>
              Objective
            </p>
            <div className="px-2 pb-2">
              <select value={objective || ''} onChange={e => setObjective(e.target.value)}
                className={`${inputCls} border-[var(--border-color)]`}
                style={{ borderRadius: 2 }}>
                {!objective && <option value="">— select —</option>}
                {Object.keys(currentModel?.reactions || {}).map(id => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>

              {objective && (
                <div className="mt-1.5 px-2 py-1.5 text-[10px] leading-relaxed"
                     style={{ background: S.bg1, border: `1px solid ${S.border}`, borderRadius: 2 }}>
                  <span className="font-bold" style={{ color: '#a855f7' }}>max </span>
                  {objTerms.map(({ id, coef }, i) => (
                    <span key={id}>
                      {i > 0 && <span style={{ color: S.muted }}> + </span>}
                      {coef !== 1 && <span style={{ color: S.muted }}>{coef}·</span>}
                      <span style={{ color: S.primary }}>{id}</span>
                    </span>
                  ))}
                  <div className="mt-1 pt-1 text-[8px]" style={{ color: S.muted, borderTop: `1px solid ${S.border}` }}>
                    s.t. Sv = 0, lb ≤ v ≤ ub
                    {modCount > 0 && ` · ${modCount} custom bounds`}
                    {knockouts.size > 0 && ` · ${knockouts.size} KO`}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Gene Knockouts */}
          <div className="flex flex-col" style={{ borderBottom: `1px solid ${S.border}` }}>
            <p className={sectionLabel} style={{ color: S.muted, background: S.bg1 }}>
              Gene Knockouts
              {knockouts.size > 0 && (
                <span className="ml-auto text-[8px] px-1 py-px"
                      style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 2 }}>
                  {knockouts.size} KO
                </span>
              )}
            </p>
            <div className="px-2 pb-2 relative" ref={dropdownRef}>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {[...knockouts].map(g => (
                  <span key={g} className="flex items-center gap-0.5 px-1 py-px text-[9px]"
                        style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 2 }}>
                    {g}
                    <button onClick={() => toggleKO(g)} className="ml-0.5 hover:text-red-900 font-bold">×</button>
                  </span>
                ))}
              </div>
              <input value={knockoutQuery} onChange={e => setKnockoutQuery(e.target.value)}
                placeholder="Search gene ID…"
                className={`${inputCls} border-[var(--border-color)]`}
                style={{ borderRadius: 2 }} />
              {geneMatches.length > 0 && (
                <div className="absolute left-2 right-2 top-full z-50 overflow-y-auto"
                     style={{ background: S.bg2, border: `1px solid ${S.border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 140, borderRadius: 2 }}>
                  {geneMatches.map(g => (
                    <button key={g} onClick={() => toggleKO(g)}
                      className="w-full text-left px-2 py-1 text-[10px] transition-colors"
                      style={{ color: S.secondary }}
                      onMouseEnter={e => e.currentTarget.style.background = S.bg1}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      {g}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Run buttons — push to bottom */}
          <div className="mt-auto p-2 flex flex-col gap-1.5" style={{ borderTop: `1px solid ${S.border}` }}>
            <button onClick={runFBA} disabled={running || !objective}
              className="flex items-center justify-center gap-1.5 py-2 text-[11px] font-bold text-white font-sans transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: running ? '#6b7280' : S.primary, borderRadius: 2 }}>
              {running
                ? <><span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />Solving…</>
                : <><Play className="w-3 h-3" fill="currentColor" />Run {method.toUpperCase()}</>}
            </button>

            {knockouts.size > 0 && (
              <button onClick={runPhenotype} disabled={phenotypeRunning || !objective}
                className="flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-bold font-sans transition-all disabled:opacity-40"
                style={{ border: '1px solid #a855f7', color: '#7c3aed', borderRadius: 2 }}>
                {phenotypeRunning
                  ? <><span className="w-2.5 h-2.5 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />Comparing…</>
                  : <>WT vs KO phenotype</>}
              </button>
            )}

            {!objective && (
              <p className="text-[9px] font-sans text-center" style={{ color: '#ef4444' }}>
                No objective detected in model
              </p>
            )}
          </div>
        </div>

        {/* ═══ Col 2 — Flux Bounds ═════════════════════════════════════ */}
        <div className="flex flex-col flex-1 min-w-0 border-r" style={{ borderColor: S.border }}>

          {/* Bounds tab strip */}
          <div className="flex items-center flex-shrink-0 px-2"
               style={{ height: 30, background: S.bg1, borderBottom: `1px solid ${S.border}`, gap: 0 }}>
            {[
              { id: 'exchange', label: `Key Exchanges (${keyExchanges.length})` },
              { id: 'all',     label: `All Exchanges (${allExchangeIds.length})` },
              { id: 'added',   label: `Custom${addedRxnIds.size ? ` (${addedRxnIds.size})` : ''}` },
            ].map(t => (
              <button key={t.id} onClick={() => setBoundsTab(t.id)}
                className="text-[9px] px-2 py-0.5 font-sans transition-colors"
                style={{
                  borderBottom: boundsTab === t.id ? `2px solid ${S.primary}` : '2px solid transparent',
                  color: boundsTab === t.id ? S.primary : S.muted,
                  marginBottom: -1,
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Table header */}
          <div className="grid flex-shrink-0" style={{ gridTemplateColumns: '1fr 68px 68px 22px', background: S.bg1, borderBottom: `1px solid ${S.border}` }}>
            <span className={thCls} style={{ color: S.muted }}>Reaction</span>
            <span className={`${thCls} text-right`} style={{ color: S.muted }}>LB</span>
            <span className={`${thCls} text-right`} style={{ color: S.muted }}>UB</span>
            <span />
          </div>

          {/* Scrollable rows */}
          <div className="flex-1 overflow-y-auto">
            {/* Exchange/all rows */}
            {displayedExchanges.map(id => {
              const mod = isModified(id);
              return (
                <div key={id} className={trBase} style={{ gridTemplateColumns: '1fr 68px 68px 22px', borderBottom: `1px solid ${S.border}` }}>
                  <span className="text-[10px] px-2 truncate" title={id}
                        style={{ color: mod ? S.primary : S.secondary }}>
                    {id}
                  </span>
                  <input type="number" value={getLB(id)} onChange={e => setLB(id, e.target.value)}
                    className={numCls}
                    style={{ border: `1px solid ${mod ? S.primary : S.border}`, borderRadius: 1 }} />
                  <input type="number" value={getUB(id)} onChange={e => setUB(id, e.target.value)}
                    className={numCls}
                    style={{ border: `1px solid ${mod ? S.primary : S.border}`, borderRadius: 1 }} />
                  {mod
                    ? <button onClick={() => resetBound(id)} title="Reset to model default"
                        className="text-[9px] text-center leading-none transition-colors"
                        style={{ color: S.muted }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = S.muted}>↺</button>
                    : <span />}
                </div>
              );
            })}

            {/* Custom added reactions (shown in all tabs) */}
            {[...addedRxnIds].map(id => {
              const mod = isModified(id);
              return (
                <div key={id} className={trBase} style={{ gridTemplateColumns: '1fr 68px 68px 22px', borderBottom: `1px solid ${S.border}` }}>
                  <span className="text-[10px] px-2 truncate" title={id}
                        style={{ color: S.primary }}>
                    {id}
                  </span>
                  <input type="number" value={getLB(id)} onChange={e => setLB(id, e.target.value)}
                    className={numCls} style={{ border: `1px solid ${S.primary}`, borderRadius: 1 }} />
                  <input type="number" value={getUB(id)} onChange={e => setUB(id, e.target.value)}
                    className={numCls} style={{ border: `1px solid ${S.primary}`, borderRadius: 1 }} />
                  <button onClick={() => {
                    setAddedRxnIds(prev => { const s = new Set(prev); s.delete(id); return s; });
                    setConstraints(p => { const n = { ...p }; delete n[id]; return n; });
                  }} className="text-[10px] text-center font-bold transition-colors"
                     style={{ color: S.muted }}
                     onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                     onMouseLeave={e => e.currentTarget.style.color = S.muted}>×</button>
                </div>
              );
            })}

            {/* Add reaction search */}
            <div className="px-2 py-1.5 relative" ref={rxnBoundRef}
                 style={{ borderBottom: `1px solid ${S.border}` }}>
              <input value={rxnBoundQuery} onChange={e => setRxnBoundQuery(e.target.value)}
                placeholder="+ pin reaction…"
                className={`${inputCls} border-dashed border-[var(--border-color)]`}
                style={{ borderRadius: 2 }} />
              {rxnMatches.length > 0 && (
                <div className="absolute left-2 right-2 top-full z-50 overflow-y-auto"
                     style={{ background: S.bg2, border: `1px solid ${S.border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 160, borderRadius: 2 }}>
                  {rxnMatches.map(id => (
                    <button key={id} onClick={() => { setAddedRxnIds(prev => new Set([...prev, id])); setRxnBoundQuery(''); }}
                      className="w-full text-left px-2 py-1 text-[10px] transition-colors"
                      style={{ color: S.secondary }}
                      onMouseEnter={e => e.currentTarget.style.background = S.bg1}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <span className="font-bold">{id}</span>
                      {currentModel?.reactions?.[id]?.name && (
                        <span className="ml-2" style={{ color: S.muted }}>
                          {currentModel.reactions[id].name.slice(0, 28)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {displayedExchanges.length === 0 && addedRxnIds.size === 0 && boundsTab !== 'added' && (
              <p className="px-3 py-3 text-[9px] font-sans" style={{ color: S.muted }}>
                No exchanges found in model
              </p>
            )}
          </div>

          {/* Bounds footer */}
          <div className="flex items-center gap-3 px-3 py-1 flex-shrink-0 text-[9px] font-sans"
               style={{ background: S.bg1, borderTop: `1px solid ${S.border}`, color: S.muted }}>
            <span>{modCount} modified</span>
            {modCount > 0 && (
              <button onClick={() => setConstraints({})}
                className="transition-colors hover:text-red-500">reset all</button>
            )}
          </div>
        </div>

        {/* ═══ Col 3 — Solution ════════════════════════════════════════ */}
        <div className="flex flex-col flex-shrink-0" style={{ width: 360, borderLeft: `1px solid ${S.border}` }}>

          {/* Solution header */}
          <div className="flex items-center gap-2 px-2 flex-shrink-0"
               style={{ height: 30, background: S.bg1, borderBottom: `1px solid ${S.border}` }}>
            <span className="text-[9px] font-semibold uppercase tracking-widest font-sans" style={{ color: S.muted }}>
              Solution
            </span>
            {isOptimal && (
              <span className="text-[8px] px-1.5 py-px font-sans"
                    style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', borderRadius: 2 }}>
                OPTIMAL
              </span>
            )}
          </div>

          {result && isOptimal && !isFVA ? (
            <>
              {/* Summary banner — FBA / pFBA */}
              <div className="grid grid-cols-4 flex-shrink-0"
                   style={{ borderBottom: `1px solid ${S.border}`, background: S.bg1 }}>
                {[
                  { label: method === 'pfba' ? 'Biomass (FBA)' : 'Objective', value: result.objectiveValue.toFixed(4) },
                  { label: 'Active',  value: activeCount },
                  { label: 'Zero',    value: zeroCount },
                  { label: 'Solver',  value: tierBadge?.toUpperCase() },
                ].map((s, i) => (
                  <div key={s.label} className="px-2 py-1.5 flex flex-col"
                       style={{ borderRight: i < 3 ? `1px solid ${S.border}` : 'none' }}>
                    <span className="text-[8px] font-sans uppercase tracking-wide" style={{ color: S.muted }}>{s.label}</span>
                    <span className="text-[11px] font-bold" style={{ color: i === 0 ? S.primary : S.secondary, fontFamily: S.mono }}>
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Flux table header */}
              <div className="grid flex-shrink-0"
                   style={{ gridTemplateColumns: '1fr 74px 80px', background: S.bg1, borderBottom: `1px solid ${S.border}` }}>
                <span className={thCls} style={{ color: S.muted }}>Reaction</span>
                <span className={`${thCls} text-right`} style={{ color: S.muted }}>Magnitude</span>
                <span className={`${thCls} text-right`} style={{ color: S.muted }}>Flux (mmol/gDW/h)</span>
              </div>

              {/* Flux rows */}
              <div className="flex-1 overflow-y-auto">
                {topFluxes.map(([id, v]) => {
                  const fwd  = v > FLUX_TOL;
                  const isObj = id === objective;
                  return (
                    <div key={id} className={trBase}
                         style={{ gridTemplateColumns: '1fr 74px 80px', borderBottom: `1px solid ${S.border}` }}>
                      <span className="px-2 text-[10px] truncate" title={`${id}\n${rxnName(id)}`}
                            style={{ color: isObj ? S.primary : S.secondary, fontWeight: isObj ? 700 : 400 }}>
                        {id}
                      </span>
                      <span className="flex items-center justify-end pr-1">
                        <FluxBar value={v} maxAbs={maxFluxAbs} width={64} />
                      </span>
                      <span className="pr-2 text-right text-[10px]"
                            style={{ color: fwd ? '#2563eb' : '#ea580c', fontFamily: S.mono }}>
                        {v > 0 ? '+' : ''}{v.toFixed(4)}
                      </span>
                    </div>
                  );
                })}
                {topFluxes.length === 0 && (
                  <p className="px-3 py-3 text-[9px] font-sans" style={{ color: S.muted }}>
                    All fluxes below tolerance ({FLUX_TOL})
                  </p>
                )}
              </div>

              {/* Solution footer */}
              <div className="flex items-center gap-3 px-2 py-1 flex-shrink-0 text-[9px] font-sans"
                   style={{ background: S.bg1, borderTop: `1px solid ${S.border}`, color: S.muted }}>
                <span className="flex items-center gap-1">
                  <span style={{ width: 8, height: 4, display: 'inline-block', background: '#3b82f6', borderRadius: 1 }} />fwd
                </span>
                <span className="flex items-center gap-1">
                  <span style={{ width: 8, height: 4, display: 'inline-block', background: '#f97316', borderRadius: 1 }} />rev
                </span>
                <span className="ml-auto">
                  {result.solveTime ? fmtTime(result.solveTime) : ''}
                  {solveTs ? ` · ${new Date(solveTs).toLocaleTimeString()}` : ''}
                </span>
              </div>
            </>
          ) : result && isFVA && result.ranges ? (
            <>
              {/* FVA summary banner */}
              <div className="grid grid-cols-4 flex-shrink-0"
                   style={{ borderBottom: `1px solid ${S.border}`, background: S.bg1 }}>
                {[
                  { label: 'Opt. Obj.',   value: result.objectiveValue?.toFixed(4) ?? '—' },
                  { label: 'Reactions',   value: Object.keys(result.ranges).length },
                  { label: 'Fixed (=0)',  value: fvaRows.filter(r => r.isFixed && Math.abs(r.min) < FLUX_TOL).length },
                  { label: 'Solver',      value: tierBadge?.toUpperCase() },
                ].map((s, i) => (
                  <div key={s.label} className="px-2 py-1.5 flex flex-col"
                       style={{ borderRight: i < 3 ? `1px solid ${S.border}` : 'none' }}>
                    <span className="text-[8px] font-sans uppercase tracking-wide" style={{ color: S.muted }}>{s.label}</span>
                    <span className="text-[11px] font-bold" style={{ color: i === 0 ? S.primary : S.secondary, fontFamily: S.mono }}>
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* FVA table header */}
              <div className="grid flex-shrink-0"
                   style={{ gridTemplateColumns: '1fr 108px 60px 60px', background: S.bg1, borderBottom: `1px solid ${S.border}` }}>
                <span className={thCls} style={{ color: S.muted }}>Reaction</span>
                <span className={thCls} style={{ color: S.muted }}>Range [min, max]</span>
                <span className={`${thCls} text-right`} style={{ color: S.muted }}>Min</span>
                <span className={`${thCls} text-right`} style={{ color: S.muted }}>Max</span>
              </div>

              {/* FVA rows — sorted by span (most variable first) */}
              <div className="flex-1 overflow-y-auto">
                {fvaRows.map(({ id, min, max, isFixed }) => {
                  const isObj = id === objective;
                  const fmtV = v => (v === -Infinity ? '-∞' : v === Infinity ? '+∞' : (v >= 0 ? '+' : '') + v.toFixed(3));
                  return (
                    <div key={id} className={trBase}
                         style={{ gridTemplateColumns: '1fr 108px 60px 60px', borderBottom: `1px solid ${S.border}` }}>
                      <span className="px-2 text-[10px] truncate" title={id}
                            style={{ color: isObj ? S.primary : S.secondary, fontWeight: isObj ? 700 : 400 }}>
                        {id}
                      </span>
                      <span className="flex items-center pl-1">
                        <FVARangeBar min={min} max={max} absMax={fvaAbsMax} width={100} />
                      </span>
                      <span className="text-right pr-1 text-[9px]"
                            style={{ color: min < 0 ? '#ea580c' : S.muted, fontFamily: S.mono }}>
                        {fmtV(min)}
                      </span>
                      <span className="text-right pr-2 text-[9px]"
                            style={{ color: max > 0 ? '#2563eb' : S.muted, fontFamily: S.mono }}>
                        {fmtV(max)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* FVA footer */}
              <div className="flex items-center gap-3 px-2 py-1 flex-shrink-0 text-[9px] font-sans"
                   style={{ background: S.bg1, borderTop: `1px solid ${S.border}`, color: S.muted }}>
                <span className="flex items-center gap-1">
                  <span style={{ width: 8, height: 4, display: 'inline-block', background: '#3b82f6', borderRadius: 1 }} />fwd-only
                </span>
                <span className="flex items-center gap-1">
                  <span style={{ width: 8, height: 4, display: 'inline-block', background: '#f97316', borderRadius: 1 }} />rev-only
                </span>
                <span className="flex items-center gap-1">
                  <span style={{ width: 8, height: 4, display: 'inline-block', background: '#8b5cf6', borderRadius: 1 }} />bidirectional
                </span>
                <span className="ml-auto">sorted by span · {solveTs ? new Date(solveTs).toLocaleTimeString() : ''}</span>
              </div>
            </>
          ) : phenotypeResult ? (
            <div className="flex-1 flex flex-col p-3 gap-3">
              <p className="text-[9px] font-semibold uppercase tracking-widest font-sans" style={{ color: S.muted }}>
                Phenotype Comparison
              </p>
              {[
                { label: 'Wild-type',       value: phenoWT,  color: '#3b82f6' },
                { label: 'Knockout',        value: phenoKO,  color: '#ef4444' },
              ].map(row => (
                <div key={row.label}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[10px] font-sans" style={{ color: S.secondary }}>{row.label}</span>
                    <span className="text-[10px] font-mono" style={{ color: row.color }}>{row.value.toFixed(6)}</span>
                  </div>
                  <div style={{ height: 6, background: S.border, borderRadius: 1 }}>
                    <div style={{
                      height: '100%', borderRadius: 1, background: row.color,
                      width: `${Math.min(Math.abs(row.value) / Math.max(Math.abs(phenoWT), 1e-9) * 100, 100)}%`
                    }} />
                  </div>
                </div>
              ))}
              {phenoPct !== null && (
                <p className="text-[11px] font-bold font-mono mt-1"
                   style={{ color: phenoKO < phenoWT ? '#dc2626' : '#16a34a' }}>
                  Δ = {phenoKO < phenoWT ? '' : '+'}{phenoPct}% growth
                </p>
              )}
              <p className="text-[9px] font-sans mt-1" style={{ color: S.muted }}>
                {knockouts.size} gene(s) knocked out: {[...knockouts].slice(0, 5).join(', ')}{knockouts.size > 5 ? '…' : ''}
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: S.muted }}>
              {solveError ? (
                <>
                  <span className="text-[10px] font-sans text-red-500 text-center px-4">
                    {solveError}
                  </span>
                  <button onClick={runFBA}
                    className="text-[9px] font-sans px-3 py-1 mt-1"
                    style={{ border: `1px solid ${S.border}`, borderRadius: 2, color: S.muted }}>
                    Retry
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[22px] opacity-20">∑</span>
                  <span className="text-[10px] font-sans" style={{ color: S.secondary }}>No solution yet</span>
                  <span className="text-[9px] font-sans opacity-50">Configure bounds and press Run {method.toUpperCase()}</span>
                </>
              )}
            </div>
          )}
        </div>

      </div>

      {/* ── Status bar ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-3 flex-shrink-0 text-[8px] font-sans"
           style={{ height: 18, background: S.bg1, borderTop: `1px solid ${S.border}`, color: S.muted }}>
        {currentModel && (
          <>
            <span>{Object.keys(currentModel.reactions || {}).length} reactions</span>
            <span>{Object.keys(currentModel.metabolites || {}).length} metabolites</span>
            <span>{Object.keys(currentModel.genes || {}).length} genes</span>
          </>
        )}
        <span className="ml-auto">MetaboViz · {method.toUpperCase()} · drag top border to resize</span>
      </div>
    </div>
  );
}
