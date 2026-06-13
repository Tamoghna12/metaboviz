/**
 * GapFillPanel — Media optimization and blocked reaction analysis
 *
 * Two analyses:
 * 1. Minimal media scan: identify which exchange reactions are essential for growth
 * 2. Blocked reactions: find reactions with zero flux across all feasible solutions (FVA-based)
 *
 * Gap-filling in the strict sense (adding reactions from a universal database) requires
 * a MILP formulation (Satish Kumar et al. 2007 Metab Eng 9:263) and is outside the
 * scope of this browser-based tool. This panel addresses the practical use cases that
 * drive most gap-filling requests: diagnosing why a model cannot grow and finding the
 * minimum nutrient set that restores growth.
 */
import React, { useState, useCallback, useRef } from 'react';
import { X, Play, Square, Download, FlaskConical } from 'lucide-react';
import { useModel } from '../contexts/ModelContext';
import { compute } from '../lib/ComputeWorker';

function getExchangeRxns(model) {
  if (!model?.reactions) return [];
  return Object.entries(model.reactions)
    .filter(([id]) => /^(EX_|R_EX_)/i.test(id))
    .map(([id, rxn]) => ({
      id,
      name: rxn.name || id,
      lb: rxn.lower_bound ?? -1000,
      ub: rxn.upper_bound ?? 1000,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const thCls = 'text-left px-3 py-2 text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)] border-b border-[var(--border-color)] bg-[var(--bg-secondary)] select-none';
const tdCls = 'px-3 py-1.5 text-xs border-b border-[var(--border-color)]';

// ── Tab A: Minimal Media ──────────────────────────────────────────────────────
function MinimalMediaTab({ model }) {
  const [running, setRunning]     = useState(false);
  const [progress, setProgress]   = useState(0);
  const [_wtGrowth, setWtGrowth]  = useState(null);
  const [results, setResults]     = useState([]);
  const [filter, setFilter]       = useState('all');
  const cancelRef = useRef(false);

  const run = useCallback(async () => {
    if (!model) return;
    setRunning(true); setResults([]); setProgress(0);
    cancelRef.current = false;

    // WT growth (all exchanges at default bounds)
    const wtRes = await compute('fba', model, {});
    const wt = wtRes.status === 'optimal' ? wtRes.objectiveValue : null;
    setWtGrowth(wt);

    // Test each uptake exchange (lb < 0) individually blocked
    const exchanges = getExchangeRxns(model).filter(r => r.lb < 0);
    const total = exchanges.length;
    const acc = [];

    for (let i = 0; i < total; i++) {
      if (cancelRef.current) break;
      const ex = exchanges[i];
      // Block this single exchange
      const res = await compute('fba', model, {
        constraints: { [ex.id]: { lb: 0, ub: ex.ub } },
      });
      const koGrowth = res.status === 'optimal' ? res.objectiveValue : null;
      const ratio = wt > 1e-9 && koGrowth != null ? koGrowth / wt : 0;
      const role = koGrowth == null || koGrowth < 1e-6 ? 'essential'
        : ratio < 0.5 ? 'important' : 'dispensable';
      acc.push({ id: ex.id, name: ex.name, lb: ex.lb, wtGrowth: wt, koGrowth, ratio, role });
      if (i % 5 === 4 || i === total - 1) {
        setResults([...acc]);
        setProgress(Math.round((i + 1) / total * 100));
      }
    }
    setResults(r => r.sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0)));
    setRunning(false);
  }, [model]);

  const exportCSV = () => {
    const rows = [['Exchange ID', 'Name', 'Current lb', 'WT growth', 'Blocked growth', 'Ratio', 'Role'],
      ...results.map(r => [r.id, r.name, r.lb, r.wtGrowth?.toFixed(6) ?? '', r.koGrowth?.toFixed(6) ?? 'infeasible', r.ratio?.toFixed(4) ?? '0', r.role])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `${model?.id || 'model'}_minimal_media.csv`;
    a.click();
  };

  const ROLE = {
    all:         { label: 'All',         color: 'var(--text-muted)' },
    essential:   { label: 'Essential',   color: '#dc2626', bg: '#fef2f2' },
    important:   { label: 'Important',   color: '#d97706', bg: '#fffbeb' },
    dispensable: { label: 'Dispensable', color: '#16a34a', bg: '#f0fdf4' },
  };
  const counts = results.reduce((a, r) => { a[r.role] = (a[r.role] || 0) + 1; return a; }, {});
  const filtered = filter === 'all' ? results : results.filter(r => r.role === filter);

  return (
    <div className="flex flex-col gap-0 h-full">
      <div className="px-6 py-4 border-b border-[var(--border-color)]">
        <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1">Minimal Media Screen</h3>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed max-w-2xl mb-3">
          Each uptake exchange reaction is individually blocked (lb set to 0) and FBA is re-solved.
          Reactions whose removal abolishes growth are <strong>Essential</strong> nutrients.
          This identifies the minimal medium required for in silico growth.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {running
            ? <button onClick={() => { cancelRef.current = true; }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded"
                style={{ background: '#dc2626', color: '#fff', borderRadius: 3 }}>
                <Square className="w-3 h-3" fill="currentColor" />Stop
              </button>
            : <button onClick={run} disabled={!model}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white rounded disabled:opacity-40"
                style={{ background: 'var(--primary)', borderRadius: 3 }}>
                <Play className="w-3 h-3" fill="currentColor" />Run Screen
              </button>
          }
          {running && (
            <div className="flex items-center gap-2">
              <div className="w-32 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-color)' }}>
                <div className="h-full rounded-full" style={{ width: `${progress}%`, background: 'var(--primary)' }} />
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">{progress}%</span>
            </div>
          )}
          {results.length > 0 && !running && (
            <>
              {Object.entries(ROLE).slice(1).map(([key, st]) => (
                <button key={key} onClick={() => setFilter(key === filter ? 'all' : key)}
                  className="px-2.5 py-1 text-[10px] font-semibold rounded-full border"
                  style={{
                    background: filter === key ? st.bg : 'transparent',
                    color: filter === key ? st.color : 'var(--text-muted)',
                    borderColor: filter === key ? st.color : 'var(--border-color)',
                  }}>
                  {st.label} {counts[key] || 0}
                </button>
              ))}
              <button onClick={exportCSV}
                className="ml-auto flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <Download className="w-3 h-3" />CSV
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {results.length === 0 && !running && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)]">
            <FlaskConical className="w-8 h-8 opacity-20" />
            <p className="text-sm">Click <strong className="text-[var(--text-primary)]">Run Screen</strong> to identify essential nutrients</p>
          </div>
        )}
        {filtered.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                {['Exchange', 'Name', 'Default lb', 'WT μ', 'Blocked μ', 'Ratio', 'Role'].map(h => (
                  <th key={h} className={thCls}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const st = ROLE[r.role];
                return (
                  <tr key={r.id} style={{ background: i % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
                    <td className={`${tdCls} font-mono font-semibold text-[var(--text-primary)]`}>{r.id}</td>
                    <td className={`${tdCls} text-[var(--text-secondary)]`}>{r.name !== r.id ? r.name : '—'}</td>
                    <td className={`${tdCls} font-mono`} style={{ color: 'var(--text-muted)' }}>{r.lb}</td>
                    <td className={`${tdCls} font-mono`} style={{ color: 'var(--primary)' }}>{r.wtGrowth?.toFixed(4) ?? '—'}</td>
                    <td className={`${tdCls} font-mono`} style={{ color: st?.color }}>
                      {r.koGrowth != null ? r.koGrowth.toFixed(4) : 'infeasible'}
                    </td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border-color)' }}>
                          <div style={{ width: `${Math.min(100, (r.ratio ?? 0) * 100)}%`, height: '100%', background: st?.color, borderRadius: 2 }} />
                        </div>
                        <span className="font-mono text-[10px] text-[var(--text-muted)]">{((r.ratio ?? 0) * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className={tdCls}>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                        style={{ background: st?.bg, color: st?.color }}>{st?.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex-shrink-0 px-5 py-2 border-t border-[var(--border-color)] text-[10px] text-[var(--text-muted)]">
        Essential: blocked growth &lt; 1e-6 h⁻¹ · Important: μ_blocked/μ_WT &lt; 50% · Dispensable: &gt;50% ·
        Each exchange individually blocked; full minimal-medium MILP (Satish Kumar et al. 2007 Metab Eng 9:263) not implemented
      </div>
    </div>
  );
}

// ── Tab B: Blocked Reactions ──────────────────────────────────────────────────
function BlockedTab({ model }) {
  const [running, setRunning]   = useState(false);
  const [results, setResults]   = useState(null);
  const cancelRef = useRef(false);

  const run = useCallback(async () => {
    if (!model) return;
    setRunning(true); setResults(null);
    cancelRef.current = false;

    const rxnIds = Object.keys(model.reactions || {});
    // FVA on all reactions to find zero-flux ones (fraction=0 to allow any feasible range)
    const fvaRes = await compute('fva', model, { reactions: rxnIds, fractionOfOptimum: 0 });
    if (!fvaRes || !fvaRes.ranges) { setRunning(false); return; }

    const blocked = [];
    const variable = [];
    for (const [id, range] of Object.entries(fvaRes.ranges)) {
      const rxn = model.reactions[id];
      const entry = { id, name: rxn?.name || id, subsystem: rxn?.subsystem || '—', min: range.min, max: range.max };
      if (Math.abs(range.min) < 1e-9 && Math.abs(range.max) < 1e-9) blocked.push(entry);
      else variable.push(entry);
    }
    blocked.sort((a, b) => a.id.localeCompare(b.id));
    setResults({ blocked, total: rxnIds.length, active: variable.length });
    setRunning(false);
  }, [model]);

  const exportCSV = () => {
    if (!results) return;
    const rows = [['Reaction ID', 'Name', 'Subsystem', 'FVA min', 'FVA max', 'Status'],
      ...results.blocked.map(r => [r.id, r.name, r.subsystem, r.min?.toFixed(6), r.max?.toFixed(6), 'blocked'])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `${model?.id || 'model'}_blocked_reactions.csv`;
    a.click();
  };

  return (
    <div className="flex flex-col gap-0 h-full">
      <div className="px-6 py-4 border-b border-[var(--border-color)]">
        <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1">Blocked Reactions (FVA)</h3>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed max-w-2xl mb-3">
          Flux Variability Analysis (fraction of optimum = 0) identifies reactions that carry zero flux
          across <em>all</em> feasible solutions — these are structurally blocked reactions, typically
          due to missing transporters, dead-end metabolites, or incorrect stoichiometry.
        </p>
        <div className="flex items-center gap-3">
          {running
            ? <button onClick={() => { cancelRef.current = true; }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded"
                style={{ background: '#dc2626', color: '#fff', borderRadius: 3 }}>
                <Square className="w-3 h-3" fill="currentColor" />Stop
              </button>
            : <button onClick={run} disabled={!model}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white rounded disabled:opacity-40"
                style={{ background: 'var(--primary)', borderRadius: 3 }}>
                <Play className="w-3 h-3" fill="currentColor" />Run FVA
              </button>
          }
          {running && <span className="text-xs text-[var(--text-muted)] animate-pulse">Running FVA on all reactions…</span>}
          {results && !running && (
            <>
              <span className="text-xs text-[var(--text-muted)]">
                <span className="font-semibold text-red-600">{results.blocked.length}</span> blocked /&nbsp;
                <span className="font-semibold" style={{ color: 'var(--primary)' }}>{results.active}</span> active out of {results.total} reactions
              </span>
              <button onClick={exportCSV}
                className="ml-auto flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <Download className="w-3 h-3" />CSV
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!results && !running && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)]">
            <FlaskConical className="w-8 h-8 opacity-20" />
            <p className="text-sm">Click <strong className="text-[var(--text-primary)]">Run FVA</strong> to identify blocked reactions</p>
          </div>
        )}
        {results?.blocked.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                {['Reaction ID', 'Name', 'Subsystem', 'FVA min', 'FVA max'].map(h => (
                  <th key={h} className={thCls}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.blocked.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
                  <td className={`${tdCls} font-mono font-semibold text-red-600`}>{r.id}</td>
                  <td className={`${tdCls} text-[var(--text-secondary)]`}>{r.name !== r.id ? r.name : '—'}</td>
                  <td className={`${tdCls} text-[var(--text-muted)]`}>{r.subsystem}</td>
                  <td className={`${tdCls} font-mono text-right`} style={{ color: 'var(--text-muted)' }}>0.000000</td>
                  <td className={`${tdCls} font-mono text-right`} style={{ color: 'var(--text-muted)' }}>0.000000</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {results?.blocked.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
            <p className="text-sm">No blocked reactions found — all reactions carry non-zero flux in at least one feasible solution.</p>
          </div>
        )}
      </div>
      <div className="flex-shrink-0 px-5 py-2 border-t border-[var(--border-color)] text-[10px] text-[var(--text-muted)]">
        Blocked: FVA [min, max] = [0, 0] at fraction_of_optimum=0 ·
        Reference: Mahadevan & Schilling (2003) Metab Eng 5:264–276
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
const TABS = [
  { id: 'media',   label: '🧪 Minimal Media',      Comp: MinimalMediaTab },
  { id: 'blocked', label: '🔒 Blocked Reactions',   Comp: BlockedTab      },
];

export default function GapFillPanel({ onClose }) {
  const { currentModel } = useModel();
  const [tab, setTab] = useState('media');
  const { Comp } = TABS.find(t => t.id === tab) || TABS[0];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <FlaskConical className="w-4 h-4" style={{ color: 'var(--primary)' }} />
        <span className="font-bold text-[var(--text-primary)]">Media Analysis</span>
        <span className="text-xs text-[var(--text-muted)] ml-1">Minimal medium screen · blocked reaction diagnosis · FBA-based (MILP gap-filling not available client-side)</span>

        <div className="flex items-center gap-0 ml-6 border border-[var(--border-color)] rounded overflow-hidden">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-3 py-1 text-xs font-medium transition-colors"
              style={{
                background: tab === t.id ? 'var(--primary)' : 'transparent',
                color:      tab === t.id ? '#fff' : 'var(--text-muted)',
                borderRight: '1px solid var(--border-color)',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        <button onClick={onClose} className="ml-auto p-1.5 rounded hover:bg-[var(--bg-primary)] text-[var(--text-muted)]">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Comp model={currentModel} />
      </div>
    </div>
  );
}
