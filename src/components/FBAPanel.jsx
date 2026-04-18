import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Play, X, RotateCcw, ChevronDown } from 'lucide-react';
import { useModel } from '../contexts/ModelContext';
import { useTheme } from '../contexts/ThemeContext';
import { solveFBA } from '../lib/FBASolver';

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

// ── priority exchange IDs to surface first ────────────────────────────────
const PRIORITY_EX = [
  'EX_glc__D_e', 'EX_glc_e', 'EX_glc_D_e', 'EX_glc',
  'EX_o2_e', 'EX_o2',
  'EX_nh4_e', 'EX_nh4',
  'EX_pi_e', 'EX_pi',
  'EX_co2_e', 'EX_co2',
  'EX_ac_e',
];

const FLUX_TOL = 1e-6;

export default function FBAPanel({ onFluxUpdate, onClose, onPhenotypeUpdate }) {
  const { currentModel, exchangeReactions } = useModel();
  const { isDark } = useTheme();

  const [objective, setObjective] = useState(null);
  const [constraints, setConstraints] = useState({});
  const [knockoutQuery, setKnockoutQuery] = useState('');
  const [knockouts, setKnockouts] = useState(new Set());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [solveError, setSolveError] = useState(null);
  const [phenotypeResult, setPhenotypeResult] = useState(null);
  const [phenotypeRunning, setPhenotypeRunning] = useState(false);
  const dropdownRef = useRef(null);

  // Auto-detect objective when model changes
  useEffect(() => {
    if (currentModel) setObjective(detectObjective(currentModel));
  }, [currentModel]);

  // Close gene dropdown on outside click
  useEffect(() => {
    const handler = e => { if (!dropdownRef.current?.contains(e.target)) setKnockoutQuery(''); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Key exchanges to show lb/ub inputs for
  const keyExchanges = useMemo(() => {
    const rxns = currentModel?.reactions || {};
    const found = PRIORITY_EX.filter(id => rxns[id]);
    const extras = exchangeReactions
      .filter(r => r.id.startsWith('EX_') && !found.includes(r.id))
      .slice(0, Math.max(0, 6 - found.length))
      .map(r => r.id);
    return [...found, ...extras].slice(0, 6);
  }, [currentModel, exchangeReactions]);

  const getLB = id => constraints[id]?.lb ?? currentModel?.reactions?.[id]?.lower_bound ?? -1000;
  const getUB = id => constraints[id]?.ub ?? currentModel?.reactions?.[id]?.upper_bound ?? 1000;
  const setLB = (id, v) => setConstraints(p => ({ ...p, [id]: { ...p[id], lb: parseFloat(v) || 0 } }));
  const setUB = (id, v) => setConstraints(p => ({ ...p, [id]: { ...p[id], ub: parseFloat(v) || 0 } }));

  const toggleKO = geneId => {
    setKnockouts(prev => { const n = new Set(prev); n.has(geneId) ? n.delete(geneId) : n.add(geneId); return n; });
    setKnockoutQuery('');
  };

  const allGenes = useMemo(() => Object.keys(currentModel?.genes || {}), [currentModel]);
  const geneMatches = useMemo(() => {
    const q = knockoutQuery.trim().toLowerCase();
    if (!q) return [];
    return allGenes.filter(g => g.toLowerCase().includes(q) && !knockouts.has(g)).slice(0, 8);
  }, [allGenes, knockoutQuery, knockouts]);

  const buildConstraints = () => {
    const fbaConstraints = {};
    Object.entries(constraints).forEach(([id, { lb, ub }]) => {
      fbaConstraints[id] = {};
      if (lb !== undefined) fbaConstraints[id].lb = lb;
      if (ub !== undefined) fbaConstraints[id].ub = ub;
    });
    return fbaConstraints;
  };

  const runFBA = async () => {
    if (!objective) return;
    setRunning(true);
    setSolveError(null);
    try {
      const res = await solveFBA(currentModel, {
        objective,
        knockoutGenes: knockouts,
        constraints: buildConstraints(),
      });
      setResult(res);
      onFluxUpdate(res.fluxes ?? {});
    } catch (err) {
      setSolveError(err.message);
      onFluxUpdate({});
    }
    setRunning(false);
  };

  const runPhenotype = async () => {
    if (!objective) return;
    setPhenotypeRunning(true);
    setSolveError(null);
    try {
      const fbaConstraints = buildConstraints();
      const [wtRes, koRes] = await Promise.all([
        solveFBA(currentModel, { objective, constraints: fbaConstraints }),
        solveFBA(currentModel, { objective, knockoutGenes: knockouts, constraints: fbaConstraints }),
      ]);
      const p = { wt: wtRes, ko: koRes };
      setPhenotypeResult(p);
      onPhenotypeUpdate?.(p);
    } catch (err) {
      setSolveError(err.message);
    }
    setPhenotypeRunning(false);
  };

  const clearFluxes = () => {
    setResult(null);
    setSolveError(null);
    setPhenotypeResult(null);
    onFluxUpdate({});
    onPhenotypeUpdate?.(null);
  };

  const activeCount  = result ? Object.values(result.fluxes ?? {}).filter(v => Math.abs(v) > FLUX_TOL).length : 0;
  const blockedCount = result ? Object.values(result.fluxes ?? {}).filter(v => Math.abs(v) <= FLUX_TOL).length : 0;
  const isOptimal = result?.status === 'OPTIMAL';

  const label = id => {
    const r = currentModel?.reactions?.[id];
    if (r?.name) return r.name.replace(/exchange/i, '').trim().substring(0, 14);
    return id.replace('EX_', '').replace(/_e$/, '');
  };

  const inputCls = 'w-14 text-[10px] px-1 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono text-center focus:outline-none focus:ring-1 focus:ring-[var(--primary)]';
  const dividerCls = `w-px self-stretch bg-[var(--border-color)] flex-shrink-0 mx-1`;

  return (
    <div className="flex flex-col bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex-shrink-0">
      {/* ── header bar ── */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[var(--border-color)]">
        <span className="text-xs font-bold text-[var(--text-primary)] tracking-wide flex items-center gap-1.5">
          <span className="text-yellow-500">⚡</span> FBA Analysis
        </span>
        {result && (
          <span className={`px-2 py-0.5 text-[10px] rounded-full font-bold ${isOptimal ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {result.status}
          </span>
        )}
        {isOptimal && !phenotypeResult && (
          <span className="text-sm font-mono font-bold" style={{ color: 'var(--primary)' }}>
            μ = {result.objectiveValue.toFixed(4)} h⁻¹
          </span>
        )}
        {isOptimal && !phenotypeResult && (
          <span className="text-[10px] text-[var(--text-muted)]">
            {activeCount} active · {blockedCount} blocked
          </span>
        )}
        {phenotypeResult && (() => {
          const wtMu = phenotypeResult.wt?.objectiveValue ?? 0;
          const koMu = phenotypeResult.ko?.objectiveValue ?? 0;
          const pct = wtMu !== 0 ? ((koMu - wtMu) / Math.abs(wtMu) * 100).toFixed(1) : 'N/A';
          const decrease = koMu < wtMu;
          const wtFluxes = phenotypeResult.wt?.fluxes ?? {};
          const koFluxes = phenotypeResult.ko?.fluxes ?? {};
          const allRxns = new Set([...Object.keys(wtFluxes), ...Object.keys(koFluxes)]);
          let lost = 0, gained = 0;
          allRxns.forEach(r => {
            const wA = Math.abs(wtFluxes[r] ?? 0) > FLUX_TOL;
            const kA = Math.abs(koFluxes[r] ?? 0) > FLUX_TOL;
            if (wA && !kA) lost++;
            if (!wA && kA) gained++;
          });
          return (
            <>
              <span className="text-xs font-mono text-[var(--text-muted)]">
                WT μ = {wtMu.toFixed(4)}
              </span>
              <span className="text-[var(--text-muted)] text-xs">→</span>
              <span className="text-xs font-mono text-[var(--text-muted)]">
                KO μ = {koMu.toFixed(4)}
              </span>
              <span className={`text-xs font-bold ${decrease ? 'text-red-600' : 'text-purple-600'}`}>
                ({decrease ? '' : '+'}{pct}%)
              </span>
              <span className="text-[10px] text-red-500">{lost} lost</span>
              <span className="text-[10px] text-purple-500">{gained} gained</span>
            </>
          );
        })()}
        {solveError && <span className="text-[10px] text-red-600">{solveError}</span>}
        <div className="ml-auto flex items-center gap-2">
          {(result || phenotypeResult) && (
            <button onClick={clearFluxes} title="Clear flux overlay"
              className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-0.5 rounded border border-[var(--border-color)] hover:bg-[var(--bg-primary)] transition-colors">
              <RotateCcw className="w-3 h-3" /> Clear
            </button>
          )}
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-muted)]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── controls row ── */}
      <div className="flex items-start gap-0 px-4 py-2.5 overflow-x-auto min-h-0">

        {/* Objective */}
        <div className="flex flex-col gap-1 flex-shrink-0 pr-4">
          <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Objective</span>
          <select value={objective || ''}
            onChange={e => setObjective(e.target.value)}
            className="text-[10px] px-1.5 py-1 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] max-w-[150px] focus:outline-none">
            {!objective && <option value="">— none —</option>}
            {Object.keys(currentModel?.reactions || {}).map(id => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>

        <div className={dividerCls} />

        {/* Exchange constraints */}
        <div className="flex flex-col gap-1 flex-shrink-0 px-4">
          <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Exchange Constraints</span>
          <div className="grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: 'repeat(2, auto)' }}>
            {keyExchanges.map(id => (
              <div key={id} className="flex items-center gap-1.5">
                <span className="text-[10px] text-[var(--text-secondary)] w-20 truncate font-medium" title={id}>{label(id)}</span>
                <input type="number" value={getLB(id)} onChange={e => setLB(id, e.target.value)} className={inputCls} title="lower bound (lb)" />
                <span className="text-[9px] text-[var(--text-muted)]">→</span>
                <input type="number" value={getUB(id)} onChange={e => setUB(id, e.target.value)} className={inputCls} title="upper bound (ub)" />
              </div>
            ))}
          </div>
        </div>

        <div className={dividerCls} />

        {/* Gene knockouts */}
        <div className="flex flex-col gap-1 flex-shrink-0 px-4 min-w-[170px]" ref={dropdownRef}>
          <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Gene Knockouts</span>
          <div className="relative">
            <input value={knockoutQuery} onChange={e => setKnockoutQuery(e.target.value)}
              placeholder="Search gene ID…"
              className="w-full text-[10px] px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]" />
            {geneMatches.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-[var(--card-bg)] border border-[var(--card-border)] rounded shadow-xl z-50 max-h-36 overflow-y-auto">
                {geneMatches.map(g => (
                  <button key={g} onClick={() => toggleKO(g)}
                    className="w-full text-left px-2 py-1 text-[10px] hover:bg-[var(--bg-secondary)] font-mono text-[var(--text-secondary)]">
                    {g}
                  </button>
                ))}
              </div>
            )}
          </div>
          {knockouts.size > 0 && (
            <div className="flex flex-wrap gap-1 max-h-12 overflow-y-auto mt-0.5">
              {[...knockouts].map(g => (
                <span key={g} className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] bg-red-100 text-red-700 rounded border border-red-200 font-mono">
                  {g}
                  <button onClick={() => toggleKO(g)} className="ml-0.5 hover:text-red-900 font-bold">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className={dividerCls} />

        {/* Run button */}
        <div className="flex flex-col justify-center pl-4 flex-shrink-0">
          <button onClick={runFBA} disabled={running || !objective}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-lg text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--primary)' }}>
            {running
              ? <><div className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" /> Solving…</>
              : <><Play className="w-3.5 h-3.5" fill="currentColor" /> Run FBA</>}
          </button>
          {!objective && (
            <p className="text-[9px] text-red-500 mt-1 max-w-[110px]">No objective detected</p>
          )}
        </div>

        {knockouts.size > 0 && (
          <>
            <div className="w-px self-stretch bg-[var(--border-color)] flex-shrink-0 mx-1" />
            <div className="flex flex-col justify-center pl-4 flex-shrink-0">
              <button onClick={runPhenotype} disabled={phenotypeRunning || !objective}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg border transition-all hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                  phenotypeRunning
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-transparent text-purple-600 border-purple-500 hover:bg-purple-50'
                }`}>
                {phenotypeRunning
                  ? <><div className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" /> Comparing…</>
                  : <>Compare WT vs KO</>}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── flux colour legend ── */}
      {result && isOptimal && (
        <div className="flex items-center gap-4 px-4 pb-2 text-[9px] text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--text-secondary)]">Flux legend:</span>
          {[
            { color: '#22c55e', label: 'Forward flux' },
            { color: '#f97316', label: 'Reverse flux' },
            { color: isDark ? '#374151' : '#e2e8f0', label: 'Blocked (v ≈ 0)' },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1">
              <span className="w-3 h-2 rounded inline-block" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
          <span className="ml-2 italic">Edge width ∝ |flux|</span>
        </div>
      )}
    </div>
  );
}
