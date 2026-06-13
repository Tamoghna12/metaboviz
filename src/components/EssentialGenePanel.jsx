/**
 * EssentialGenePanel — Single-gene knockout screening via GPR boolean logic
 * Reed et al. (2003) Genome Res 13:2364-2369
 */
import React, { useState, useCallback, useRef, useMemo } from 'react';
import { X, Play, Square, Download, Dna } from 'lucide-react';
import { useModel } from '../contexts/ModelContext';
import { compute } from '../lib/ComputeWorker';
import { evaluateGPR, extractGenesFromGPR } from '../lib/GPRExpression';

function getAllGeneIds(model) {
  const genes = new Set();
  if (model.genes) Object.keys(model.genes).forEach(g => genes.add(g));
  Object.values(model.reactions || {}).forEach(rxn => {
    const gpr = rxn.gpr || rxn.gene_reaction_rule || '';
    if (gpr) extractGenesFromGPR(gpr).forEach(g => genes.add(g));
  });
  return genes;
}

function getKnockedReactions(model, geneId, allGeneIds) {
  const activeGenes = new Set(allGeneIds);
  activeGenes.delete(geneId);
  const knocked = {};
  Object.entries(model.reactions || {}).forEach(([rxnId, rxn]) => {
    const gpr = rxn.gpr || rxn.gene_reaction_rule || '';
    if (!gpr.trim()) return;
    if (!evaluateGPR(gpr, activeGenes)) knocked[rxnId] = { lb: 0, ub: 0 };
  });
  return knocked;
}

function classify(koGrowth, wtGrowth) {
  if (koGrowth == null) return 'lethal';
  const ratio = wtGrowth > 1e-9 ? koGrowth / wtGrowth : 0;
  if (ratio < 0.01) return 'essential';
  if (ratio < 0.50) return 'impaired';
  return 'dispensable';
}

const CLS = {
  all:         { label: 'All',               color: 'var(--text-muted)', bg: 'transparent' },
  essential:   { label: 'Essential',         color: '#dc2626', bg: '#fef2f2' },
  impaired:    { label: 'Growth-impaired',   color: '#d97706', bg: '#fffbeb' },
  dispensable: { label: 'Dispensable',       color: '#16a34a', bg: '#f0fdf4' },
  lethal:      { label: 'Lethal/infeasible', color: '#9333ea', bg: '#fdf4ff' },
};

export default function EssentialGenePanel({ onClose }) {
  const { currentModel } = useModel();
  const [running, setRunning]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults]   = useState([]);
  const [wtGrowth, setWtGrowth] = useState(null);
  const [filter, setFilter]     = useState('all');
  const [sortBy, setSortBy]     = useState('class');
  const [query, setQuery]       = useState('');
  const cancelRef = useRef(false);

  const geneCount = useMemo(
    () => (currentModel ? getAllGeneIds(currentModel).size : 0),
    [currentModel],
  );

  const run = useCallback(async () => {
    if (!currentModel) return;
    setRunning(true); setResults([]); setProgress(0);
    cancelRef.current = false;

    const wtRes = await compute('fba', currentModel, {});
    const wt = wtRes.status === 'optimal' ? wtRes.objectiveValue : null;
    setWtGrowth(wt);

    const allGenes = getAllGeneIds(currentModel);
    const geneList = [...allGenes];
    const total = geneList.length;
    const acc = [];

    for (let i = 0; i < total; i++) {
      if (cancelRef.current) break;
      const geneId = geneList[i];
      const knocked = getKnockedReactions(currentModel, geneId, allGenes);
      const nKnocked = Object.keys(knocked).length;

      let koGrowth = wt;
      if (nKnocked > 0) {
        const res = await compute('fba', currentModel, { constraints: knocked });
        koGrowth = res.status === 'optimal' ? res.objectiveValue : null;
      }

      const meta = currentModel.genes?.[geneId];
      const name = typeof meta === 'string' ? meta
        : (meta?.name || meta?.annotation?.name || '');
      const ratio = wt > 1e-9 && koGrowth != null ? koGrowth / wt
        : (koGrowth == null ? 0 : 1);

      acc.push({ id: geneId, name, nKnocked, koGrowth, wtGrowth: wt, ratio, class: classify(koGrowth, wt) });

      if (i % 10 === 9 || i === total - 1) {
        setResults([...acc]);
        setProgress(Math.round((i + 1) / total * 100));
      }
    }
    setRunning(false);
  }, [currentModel]);

  const exportCSV = () => {
    const header = ['Gene ID', 'Name', 'Knocked rxns', 'WT mu (h-1)', 'KO mu (h-1)', 'mu ratio', 'Class'];
    const rows = results.map(r => [
      r.id, r.name, r.nKnocked,
      r.wtGrowth?.toFixed(6) ?? '',
      r.koGrowth?.toFixed(6) ?? 'infeasible',
      r.ratio?.toFixed(4) ?? '0',
      r.class,
    ]);
    const csv = [header, ...rows].map(row => row.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${currentModel?.id || 'model'}_gene_essentiality.csv`;
    a.click();
  };

  const counts = results.reduce((acc, r) => {
    acc[r.class] = (acc[r.class] || 0) + 1; return acc;
  }, {});

  const filtered = results
    .filter(r => filter === 'all' || r.class === filter)
    .filter(r => !query
      || r.id.toLowerCase().includes(query.toLowerCase())
      || r.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'ratio') return (a.ratio ?? 0) - (b.ratio ?? 0);
      if (sortBy === 'id')    return a.id.localeCompare(b.id);
      const ORD = { essential: 0, lethal: 1, impaired: 2, dispensable: 3 };
      return (ORD[a.class] ?? 4) - (ORD[b.class] ?? 4);
    });

  const thCls = 'text-left px-3 py-2 text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)] border-b border-[var(--border-color)] bg-[var(--bg-secondary)] select-none cursor-pointer';
  const tdCls = 'px-3 py-1.5 text-xs border-b border-[var(--border-color)]';

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <Dna className="w-4 h-4" style={{ color: 'var(--primary)' }} />
        <span className="font-bold text-[var(--text-primary)]">Gene Essentiality</span>
        <span className="text-xs text-[var(--text-muted)] ml-1">Single-gene knockout screening via GPR logic</span>
        <div className="ml-auto flex items-center gap-2">
          {results.length > 0 && !running && (
            <button onClick={exportCSV}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <Download className="w-3 h-3" />CSV
            </button>
          )}
          {running
            ? <button onClick={() => { cancelRef.current = true; }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded"
                style={{ background: '#dc2626', color: '#fff', borderRadius: 3 }}>
                <Square className="w-3 h-3" fill="currentColor" />Stop
              </button>
            : <button onClick={run} disabled={!currentModel}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white rounded disabled:opacity-40"
                style={{ background: 'var(--primary)', borderRadius: 3 }}>
                <Play className="w-3 h-3" fill="currentColor" />Run Screen
              </button>
          }
          <button onClick={onClose} className="p-1.5 rounded hover:bg-[var(--bg-primary)] text-[var(--text-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Info + progress */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-[var(--border-color)] flex items-center gap-4 flex-wrap"
        style={{ background: 'var(--bg-secondary)' }}>
        {currentModel ? (
          <>
            <span className="text-xs text-[var(--text-muted)]">
              Model: <span className="font-semibold text-[var(--text-primary)]">{currentModel.id || 'Loaded'}</span>
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              Genes to screen: <span className="font-mono font-semibold text-[var(--text-primary)]">{geneCount}</span>
            </span>
            {wtGrowth != null && (
              <span className="text-xs text-[var(--text-muted)]">
                WT μ: <span className="font-mono font-semibold" style={{ color: 'var(--primary)' }}>{wtGrowth.toFixed(4)} h⁻¹</span>
              </span>
            )}
            {geneCount > 300 && (
              <span className="text-[10px] text-amber-600">Large model — screening may take 1–5 min</span>
            )}
          </>
        ) : (
          <span className="text-xs text-amber-600">No model loaded — upload a model first</span>
        )}
        {running && (
          <div className="flex items-center gap-2 ml-auto">
            <div className="w-40 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-color)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--primary)' }} />
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)]">{progress}%</span>
          </div>
        )}
      </div>

      {/* Filters */}
      {results.length > 0 && (
        <div className="flex-shrink-0 px-5 py-2.5 border-b border-[var(--border-color)] flex items-center gap-2 flex-wrap"
          style={{ background: 'var(--bg-secondary)' }}>
          {Object.entries(CLS).map(([key, st]) => {
            const n = key === 'all' ? results.length : (counts[key] || 0);
            const active = filter === key;
            return (
              <button key={key} onClick={() => setFilter(key)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-full border transition-all"
                style={{
                  background:   active ? st.bg  : 'transparent',
                  color:        active ? st.color : 'var(--text-muted)',
                  borderColor:  active ? st.color : 'var(--border-color)',
                }}>
                {st.label} <span className="font-mono">{n}</span>
              </button>
            );
          })}
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Filter gene ID / name…"
            className="ml-auto px-2.5 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none w-44"
          />
          <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            Sort:
            {[['class', 'Class'], ['ratio', 'μ ratio'], ['id', 'Gene ID']].map(([k, l]) => (
              <button key={k} onClick={() => setSortBy(k)}
                className="px-1.5 py-0.5 rounded"
                style={{
                  background: sortBy === k ? 'var(--primary)' : 'transparent',
                  color: sortBy === k ? '#fff' : 'var(--text-muted)',
                }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 && !running && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
            <Dna className="w-8 h-8 opacity-20" />
            <p className="text-sm font-medium">
              Click <span className="font-bold text-[var(--text-primary)]">Run Screen</span> to start single-gene knockout analysis
            </p>
            <p className="text-xs max-w-xs text-center leading-relaxed">
              Each gene is knocked out via GPR boolean logic. Reactions that can no longer be catalysed
              are constrained to zero and FBA is re-solved to measure growth impact.
            </p>
          </div>
        )}
        {filtered.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={thCls} onClick={() => setSortBy('id')}>
                  Gene ID{sortBy === 'id' ? ' ↑' : ''}
                </th>
                <th className={thCls}>Name</th>
                <th className={thCls}>Knocked rxns</th>
                <th className={thCls}>WT μ (h⁻¹)</th>
                <th className={thCls}>KO μ (h⁻¹)</th>
                <th className={thCls} onClick={() => setSortBy('ratio')}>
                  μ ratio{sortBy === 'ratio' ? ' ↑' : ''}
                </th>
                <th className={thCls} onClick={() => setSortBy('class')}>
                  Class{sortBy === 'class' ? ' ↑' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const st = CLS[r.class];
                return (
                  <tr key={r.id} style={{ background: i % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
                    <td className={`${tdCls} font-mono font-semibold text-[var(--text-primary)]`}>{r.id}</td>
                    <td className={`${tdCls} text-[var(--text-secondary)]`}>{r.name || '—'}</td>
                    <td className={`${tdCls} font-mono text-right`}>
                      {r.nKnocked > 0
                        ? <span style={{ color: '#d97706' }} className="font-semibold">{r.nKnocked}</span>
                        : <span className="text-[var(--text-muted)]">0</span>
                      }
                    </td>
                    <td className={`${tdCls} font-mono`} style={{ color: 'var(--primary)' }}>
                      {r.wtGrowth?.toFixed(4) ?? '—'}
                    </td>
                    <td className={`${tdCls} font-mono`} style={{ color: st.color }}>
                      {r.koGrowth != null ? r.koGrowth.toFixed(4) : 'infeasible'}
                    </td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border-color)' }}>
                          <div className="h-full rounded-full"
                            style={{ width: `${Math.min(100, (r.ratio ?? 0) * 100)}%`, background: st.color }} />
                        </div>
                        <span className="font-mono text-[10px] text-[var(--text-muted)]">
                          {((r.ratio ?? 0) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className={tdCls}>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                        style={{ background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex-shrink-0 px-5 py-2 border-t border-[var(--border-color)] text-[10px] text-[var(--text-muted)]">
        Classification: Essential μ_KO/μ_WT &lt; 1% · Impaired 1–50% · Dispensable &gt;50% · Lethal = infeasible LP ·
        Method: GPR-evaluated single-gene deletion (Reed et al. 2003 Genome Res 13:2364)
      </div>
    </div>
  );
}
