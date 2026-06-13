import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Upload, X, ArrowLeftRight, FlaskConical, Database, Dna, Search, ChevronUp, ChevronDown, BarChart2, Play, RotateCcw, Plus } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { parseModel } from '../utils/modelParser';
import { compute } from '../lib/ComputeWorker';

// ── colour tokens per slot ────────────────────────────────────────────────────
const SLOT = {
  A: { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-300 dark:border-blue-700', text: 'text-blue-700 dark:text-blue-300', badge: 'bg-blue-100 text-blue-700 border-blue-200', dot: '#3b82f6', label: 'Model A' },
  B: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-300 dark:border-amber-700', text: 'text-amber-700 dark:text-amber-300', badge: 'bg-amber-100 text-amber-700 border-amber-200', dot: '#f59e0b', label: 'Model B' },
};
const SHARED_COLOR = '#10b981';

// ── model loading drop zone ───────────────────────────────────────────────────
function ModelSlot({ slotKey, model, loading, error, onLoad }) {
  const { isDark: _isDark } = useTheme();
  const fileRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const s = SLOT[slotKey];

  const handleFile = async (file) => {
    if (!file) return;
    onLoad({ loading: true, model: null, error: null });
    try {
      const parsed = await parseModel(file);
      onLoad({ loading: false, model: { ...parsed, _fileName: file.name }, error: null });
    } catch (err) {
      onLoad({ loading: false, model: null, error: err.message });
    }
  };

  const onDrop = (e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files?.[0]); };
  const onDragOver = (e) => { e.preventDefault(); setDrag(true); };

  const rxnCount = Object.keys(model?.reactions || {}).length;
  const metCount = Object.keys(model?.metabolites || {}).length;
  const geneCount = Object.keys(model?.genes || {}).length;

  return (
    <div className={`flex-1 rounded-xl border-2 ${drag ? s.border + ' scale-[1.01]' : model ? s.border : 'border-[var(--border-color)]'} transition-all`}
      onDragOver={onDragOver} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      <div className={`px-4 py-2 rounded-t-xl border-b border-[var(--border-color)] flex items-center gap-2 ${model ? s.bg : 'bg-[var(--bg-secondary)]'}`}>
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.dot }} />
        <span className={`text-sm font-bold ${model ? s.text : 'text-[var(--text-secondary)]'}`}>{s.label}</span>
        {model && (
          <button onClick={() => onLoad({ model: null, loading: false, error: null })}
            className="ml-auto p-0.5 rounded hover:bg-[var(--bg-primary)] text-[var(--text-muted)]">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {!model ? (
        <div className="p-6 flex flex-col items-center gap-3 cursor-pointer" onClick={() => fileRef.current?.click()}>
          <div className={`w-12 h-12 rounded-xl border-2 flex items-center justify-center ${drag ? s.border + ' ' + s.text : 'border-dashed border-[var(--border-color)] text-[var(--text-muted)]'}`}>
            <Upload className="w-5 h-5" />
          </div>
          <p className="text-sm text-[var(--text-secondary)] text-center">
            {loading ? 'Parsing…' : 'Drop SBML / JSON or click to browse'}
          </p>
          {error && <p className="text-xs text-red-600 text-center">{error}</p>}
          <input ref={fileRef} type="file" accept=".xml,.sbml,.json" className="hidden"
            onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div>
            <p className="font-semibold text-[var(--text-primary)] text-sm truncate" title={model.id}>{model.id || model._fileName}</p>
            <p className="text-xs text-[var(--text-muted)] truncate">{model._fileName}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: BarChart2, label: 'Reactions', val: rxnCount },
              { icon: FlaskConical, label: 'Metabolites', val: metCount },
              { icon: Dna, label: 'Genes', val: geneCount },
            ].map(({ label, val }) => (
              <div key={label} className={`rounded-lg px-3 py-2 text-center border ${s.bg} ${s.border}`}>
                <p className={`text-lg font-black ${s.text}`}>{val.toLocaleString()}</p>
                <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wide">{label}</p>
              </div>
            ))}
          </div>
          <button onClick={() => fileRef.current?.click()}
            className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] py-1.5 border border-dashed border-[var(--border-color)] rounded-lg transition-colors">
            Replace model
          </button>
          <input ref={fileRef} type="file" accept=".xml,.sbml,.json" className="hidden"
            onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}
    </div>
  );
}

// ── diff computation ──────────────────────────────────────────────────────────
function computeDiff(modelA, modelB) {
  const rxnsA = new Set(Object.keys(modelA.reactions || {}));
  const rxnsB = new Set(Object.keys(modelB.reactions || {}));
  const sharedRxns = new Set([...rxnsA].filter(r => rxnsB.has(r)));
  const onlyA = new Set([...rxnsA].filter(r => !rxnsB.has(r)));
  const onlyB = new Set([...rxnsB].filter(r => !rxnsA.has(r)));

  const genesA = new Set(Object.keys(modelA.genes || {}));
  const genesB = new Set(Object.keys(modelB.genes || {}));
  const sharedGenes = new Set([...genesA].filter(g => genesB.has(g)));
  const onlyGenesA = new Set([...genesA].filter(g => !genesB.has(g)));
  const onlyGenesB = new Set([...genesB].filter(g => !genesA.has(g)));

  // Gene rows
  const allGenes = new Set([...genesA, ...genesB]);
  const geneRows = [...allGenes].map(id => {
    const status = genesA.has(id) && genesB.has(id) ? 'shared' : genesA.has(id) ? 'onlyA' : 'onlyB';
    return { id, status };
  });

  // Metabolite diff
  const metsA = new Set(Object.keys(modelA.metabolites || {}));
  const metsB = new Set(Object.keys(modelB.metabolites || {}));
  const sharedMets = new Set([...metsA].filter(m => metsB.has(m)));
  const onlyMetsA = new Set([...metsA].filter(m => !metsB.has(m)));
  const onlyMetsB = new Set([...metsB].filter(m => !metsA.has(m)));

  const allMets = new Set([...metsA, ...metsB]);
  const metRows = [...allMets].map(id => {
    const mA = modelA.metabolites?.[id];
    const mB = modelB.metabolites?.[id];
    const status = metsA.has(id) && metsB.has(id) ? 'shared' : metsA.has(id) ? 'onlyA' : 'onlyB';
    return {
      id,
      name: mA?.name || mB?.name || id,
      compartmentA: mA?.compartment || '—',
      compartmentB: mB?.compartment || '—',
      formulaA: mA?.formula || '—',
      formulaB: mB?.formula || '—',
      status,
    };
  });

  // Objective detection
  const detectObj = (model) => {
    const rxns = Object.entries(model.reactions || {});
    for (const [id, r] of rxns) {
      if (r.objective_coefficient && r.objective_coefficient !== 0)
        return { id, coef: r.objective_coefficient, name: r.name || id, lb: r.lower_bound, ub: r.upper_bound, gpr: r.gene_reaction_rule || '' };
    }
    const patterns = [/biomass/i, /growth/i, /^bm_/i, /objective/i];
    for (const [id, r] of rxns) {
      for (const pat of patterns) {
        if (pat.test(id) || (r.name && pat.test(r.name)))
          return { id, coef: 1.0, name: r.name || id, lb: r.lower_bound, ub: r.upper_bound, gpr: r.gene_reaction_rule || '' };
      }
    }
    if (rxns[0]) {
      const [id, r] = rxns[0];
      return { id, coef: 1.0, name: r.name || id, lb: r.lower_bound, ub: r.upper_bound, gpr: r.gene_reaction_rule || '' };
    }
    return null;
  };

  const objA = detectObj(modelA);
  const objB = detectObj(modelB);

  // Subsystem-level diff
  const subsA = new Map(); // subsystem → reaction count
  Object.values(modelA.reactions || {}).forEach(r => {
    if (r.subsystem) subsA.set(r.subsystem, (subsA.get(r.subsystem) || 0) + 1);
  });
  const subsB = new Map();
  Object.values(modelB.reactions || {}).forEach(r => {
    if (r.subsystem) subsB.set(r.subsystem, (subsB.get(r.subsystem) || 0) + 1);
  });
  const allSubs = new Set([...subsA.keys(), ...subsB.keys()]);
  const subsDiff = [...allSubs].map(sub => ({
    sub,
    countA: subsA.get(sub) || 0,
    countB: subsB.get(sub) || 0,
    status: subsA.has(sub) && subsB.has(sub) ? 'shared' : subsA.has(sub) ? 'onlyA' : 'onlyB',
  })).sort((a, b) => {
    const order = { shared: 0, onlyA: 1, onlyB: 2 };
    return order[a.status] - order[b.status] || b.countA + b.countB - a.countA - a.countB;
  });

  // Unified reaction rows
  const allRxns = new Set([...rxnsA, ...rxnsB]);
  const rxnRows = [...allRxns].map(id => {
    const rxnA = modelA.reactions?.[id];
    const rxnB = modelB.reactions?.[id];
    const status = rxnsA.has(id) && rxnsB.has(id) ? 'shared' : rxnsA.has(id) ? 'onlyA' : 'onlyB';
    return {
      id,
      name: rxnA?.name || rxnB?.name || id,
      subsystem: rxnA?.subsystem || rxnB?.subsystem || '—',
      lbA: rxnA?.lower_bound ?? null,
      ubA: rxnA?.upper_bound ?? null,
      lbB: rxnB?.lower_bound ?? null,
      ubB: rxnB?.upper_bound ?? null,
      gprA: rxnA?.gene_reaction_rule || '',
      gprB: rxnB?.gene_reaction_rule || '',
      status,
    };
  });

  return {
    rxnsA, rxnsB, sharedRxns, onlyA, onlyB,
    genesA, genesB, sharedGenes, onlyGenesA, onlyGenesB, geneRows,
    metsA, metsB, sharedMets, onlyMetsA, onlyMetsB, metRows,
    objA, objB,
    subsDiff, rxnRows,
    overlapPct: rxnsA.size + rxnsB.size > 0
      ? Math.round((2 * sharedRxns.size) / (rxnsA.size + rxnsB.size) * 100)
      : 0,
  };
}

// ── status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (status === 'shared')
    return <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-emerald-50 text-emerald-700 border-emerald-200 whitespace-nowrap">Both</span>;
  if (status === 'onlyA')
    return <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-blue-50 text-blue-700 border-blue-200 whitespace-nowrap">A only</span>;
  return <span className="px-1.5 py-0.5 text-[9px] font-bold rounded border bg-amber-50 text-amber-700 border-amber-200 whitespace-nowrap">B only</span>;
}

// ── Flux Movement Map ─────────────────────────────────────────────────────────
const FLUX_TOL = 1e-6;
const BAR_W    = 130; // px per side

function FluxMovementMap({ fluxesA, fluxesB, objective, labelA = 'Model A', labelB = 'Model B' }) {
  const rows = useMemo(() => {
    const all = new Set([...Object.keys(fluxesA), ...Object.keys(fluxesB)]);
    return [...all]
      .map(id => ({
        id,
        a: fluxesA[id] ?? 0,
        b: fluxesB[id] ?? 0,
        delta: Math.abs((fluxesA[id] ?? 0) - (fluxesB[id] ?? 0)),
      }))
      .filter(r => Math.abs(r.a) > FLUX_TOL || Math.abs(r.b) > FLUX_TOL)
      .sort((x, y) => {
        if (x.id === objective) return -1;
        if (y.id === objective) return  1;
        return y.delta - x.delta;
      })
      .slice(0, 40);
  }, [fluxesA, fluxesB, objective]);

  const absMax = useMemo(() =>
    rows.reduce((m, r) => Math.max(m, Math.abs(r.a), Math.abs(r.b)), 1e-9),
  [rows]);

  if (!rows.length) return (
    <div className="flex items-center justify-center py-10 text-xs text-[var(--text-muted)]">
      Run FBA on both models to see the flux movement map
    </div>
  );

  return (
    <div className="flex flex-col min-h-0">
      {/* axis header */}
      <div className="flex items-center px-3 py-1.5 sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] z-10">
        <span className="w-32 flex-shrink-0" />
        <div className="flex items-center justify-end text-[9px] font-semibold uppercase tracking-wide"
             style={{ width: BAR_W, color: SLOT.A.dot }}>← {labelA}</div>
        <div style={{ width: 1, height: 14, background: 'var(--border-color)', flexShrink: 0, margin: '0 4px' }} />
        <div className="flex items-center text-[9px] font-semibold uppercase tracking-wide"
             style={{ width: BAR_W, color: SLOT.B.dot }}>{labelB} →</div>
        <span className="w-16 text-right text-[9px] uppercase tracking-wide text-[var(--text-muted)] flex-shrink-0">|Δ|</span>
      </div>
      <div className="overflow-y-auto flex-1" style={{ maxHeight: 340 }}>
        {rows.map((r, i) => {
          const isObj   = r.id === objective;
          const barPxA  = Math.max(1, Math.round(Math.abs(r.a) / absMax * BAR_W));
          const barPxB  = Math.max(1, Math.round(Math.abs(r.b) / absMax * BAR_W));
          const bigDelta = r.delta / absMax > 0.05;
          const colorA  = r.a >= 0 ? SLOT.A.dot : '#93c5fd';
          const colorB  = r.b >= 0 ? SLOT.B.dot : '#fcd34d';
          return (
            <div key={r.id} className="flex items-center px-3"
                 style={{ height: 20, background: i % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
              {/* label */}
              <span className="w-32 flex-shrink-0 text-[9px] font-mono truncate"
                    title={r.id}
                    style={{ color: isObj ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: isObj ? 700 : 400 }}>
                {r.id}
              </span>
              {/* A bar — right-aligned toward center */}
              <div className="flex items-center justify-end" style={{ width: BAR_W }}>
                {Math.abs(r.a) > FLUX_TOL && (
                  <div title={`A: ${r.a.toFixed(4)}`}
                       style={{ width: barPxA, height: 8, background: colorA, borderRadius: '2px 0 0 2px', opacity: 0.85 }} />
                )}
              </div>
              {/* center tick */}
              <div style={{ width: 1, height: 16, background: 'var(--border-color)', flexShrink: 0, margin: '0 4px' }} />
              {/* B bar — left-aligned from center */}
              <div className="flex items-center justify-start" style={{ width: BAR_W }}>
                {Math.abs(r.b) > FLUX_TOL && (
                  <div title={`B: ${r.b.toFixed(4)}`}
                       style={{ width: barPxB, height: 8, background: colorB, borderRadius: '0 2px 2px 0', opacity: 0.85 }} />
                )}
              </div>
              {/* delta */}
              <span className="w-16 flex-shrink-0 text-right text-[9px] font-mono"
                    style={{ color: bigDelta ? '#ef4444' : 'var(--text-muted)' }}>
                {r.delta < 0.001 ? '~0' : r.delta.toFixed(3)}
              </span>
            </div>
          );
        })}
      </div>
      {/* legend */}
      <div className="flex items-center gap-4 px-3 py-1.5 border-t border-[var(--border-color)] text-[9px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1"><span style={{ width: 12, height: 6, background: SLOT.A.dot, borderRadius: 1, display: 'inline-block' }} />{labelA} fwd</span>
        <span className="flex items-center gap-1"><span style={{ width: 12, height: 6, background: '#93c5fd', borderRadius: 1, display: 'inline-block' }} />{labelA} rev</span>
        <span className="flex items-center gap-1"><span style={{ width: 12, height: 6, background: SLOT.B.dot, borderRadius: 1, display: 'inline-block' }} />{labelB} fwd</span>
        <span className="flex items-center gap-1"><span style={{ width: 12, height: 6, background: '#fcd34d', borderRadius: 1, display: 'inline-block' }} />{labelB} rev</span>
        <span className="ml-auto">sorted by |Δ| · top 40 active reactions</span>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export default function CompareView({ onClose }) {
  const [slotA, setSlotA] = useState({ model: null, loading: false, error: null });
  const [slotB, setSlotB] = useState({ model: null, loading: false, error: null });
  const [bottomTab, setBottomTab] = useState('reactions'); // 'reactions' | 'genes' | 'metabolites' | 'objective' | 'fba'
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [rxnSort, setRxnSort] = useState({ col: 'status', dir: 1 });
  const [subFilter, setSubFilter] = useState('all');
  const [geneFilter, setGeneFilter] = useState('all');
  const [geneQuery, setGeneQuery] = useState('');
  const [metFilter, setMetFilter] = useState('all');
  const [metQuery, setMetQuery] = useState('');

  // FBA Compare state
  const [fbaObjA, setFbaObjA]           = useState(null);
  const [fbaObjB, setFbaObjB]           = useState(null);
  const [sharedConstraints, setSharedConstraints] = useState({});
  const [fbaResultA, setFbaResultA]     = useState(null);
  const [fbaResultB, setFbaResultB]     = useState(null);
  const [fbaRunning, setFbaRunning]     = useState(false);
  const [fbaError, setFbaError]         = useState(null);
  const [fbaAutoRun, setFbaAutoRun]     = useState(false);
  const fbaAutoTimer = useRef(null);
  const runFBABothRef = useRef(null);
  // per-model bound overrides: { [rxnId]: { lb, ub } }
  const [editsA, setEditsA] = useState({});
  const [editsB, setEditsB] = useState({});
  const [editQuery, setEditQuery]   = useState('');
  const [editFilter, setEditFilter] = useState('all');
  const [newRxnId, setNewRxnId]   = useState('');
  const [newLbA, setNewLbA]       = useState(-1000);
  const [newUbA, setNewUbA]       = useState(1000);
  const [newLbB, setNewLbB]       = useState(-1000);
  const [newUbB, setNewUbB]       = useState(1000);

  const diff = useMemo(() => {
    if (!slotA.model || !slotB.model) return null;
    return computeDiff(slotA.model, slotB.model);
  }, [slotA.model, slotB.model]);

  const filteredRxns = useMemo(() => {
    if (!diff) return [];
    let rows = diff.rxnRows;
    if (filter !== 'all') rows = rows.filter(r => r.status === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter(r => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.subsystem.toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => {
      const va = a[rxnSort.col] ?? '';
      const vb = b[rxnSort.col] ?? '';
      return String(va).localeCompare(String(vb)) * rxnSort.dir;
    });
  }, [diff, filter, query, rxnSort]);

  const filteredSubs = useMemo(() => {
    if (!diff) return [];
    if (subFilter === 'all') return diff.subsDiff;
    return diff.subsDiff.filter(s => s.status === subFilter);
  }, [diff, subFilter]);

  const filteredGenes = useMemo(() => {
    if (!diff) return [];
    let rows = diff.geneRows;
    if (geneFilter !== 'all') rows = rows.filter(r => r.status === geneFilter);
    if (geneQuery.trim()) {
      const q = geneQuery.toLowerCase();
      rows = rows.filter(r => r.id.toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => {
      const order = { shared: 0, onlyA: 1, onlyB: 2 };
      return (order[a.status] - order[b.status]) || a.id.localeCompare(b.id);
    });
  }, [diff, geneFilter, geneQuery]);

  const filteredMets = useMemo(() => {
    if (!diff) return [];
    let rows = diff.metRows;
    if (metFilter !== 'all') rows = rows.filter(r => r.status === metFilter);
    if (metQuery.trim()) {
      const q = metQuery.toLowerCase();
      rows = rows.filter(r => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => {
      const order = { shared: 0, onlyA: 1, onlyB: 2 };
      return (order[a.status] - order[b.status]) || a.id.localeCompare(b.id);
    });
  }, [diff, metFilter, metQuery]);

  const editRows = useMemo(() => {
    if (!diff) return [];
    const allIds = [...new Set([
      ...Object.keys(slotA.model?.reactions || {}),
      ...Object.keys(slotB.model?.reactions || {}),
    ])];
    const q = editQuery.trim().toLowerCase();
    return allIds
      .map(id => {
        const rxnA = slotA.model?.reactions?.[id];
        const rxnB = slotB.model?.reactions?.[id];
        const eA = editsA[id]; const eB = editsB[id];
        return {
          id,
          inA: !!rxnA, inB: !!rxnB,
          name: rxnA?.name || rxnB?.name || '',
          origLbA: rxnA?.lower_bound ?? -1000, origUbA: rxnA?.upper_bound ?? 1000,
          origLbB: rxnB?.lower_bound ?? -1000, origUbB: rxnB?.upper_bound ?? 1000,
          curLbA: eA?.lb ?? rxnA?.lower_bound ?? -1000,
          curUbA: eA?.ub ?? rxnA?.upper_bound ?? 1000,
          curLbB: eB?.lb ?? rxnB?.lower_bound ?? -1000,
          curUbB: eB?.ub ?? rxnB?.upper_bound ?? 1000,
          editedA: !!eA, editedB: !!eB,
          koA: eA?.lb === 0 && eA?.ub === 0,
          koB: eB?.lb === 0 && eB?.ub === 0,
          status: rxnA && rxnB ? 'shared' : rxnA ? 'onlyA' : 'onlyB',
        };
      })
      .filter(r => {
        if (editFilter === 'edited' && !r.editedA && !r.editedB) return false;
        if (editFilter === 'shared' && r.status !== 'shared') return false;
        if (editFilter === 'onlyA' && r.status !== 'onlyA') return false;
        if (editFilter === 'onlyB' && r.status !== 'onlyB') return false;
        if (q && !r.id.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const ea = (a.editedA || a.editedB) ? 0 : 1;
        const eb = (b.editedA || b.editedB) ? 0 : 1;
        if (ea !== eb) return ea - eb;
        const sa = a.status === 'shared' ? 0 : 1;
        const sb = b.status === 'shared' ? 0 : 1;
        return sa - sb || a.id.localeCompare(b.id);
      });
  }, [diff, slotA.model, slotB.model, editsA, editsB, editQuery, editFilter]);

  const setEditA = (id, field, val) => setEditsA(p => ({ ...p, [id]: { ...p[id], [field]: val } }));
  const setEditB = (id, field, val) => setEditsB(p => ({ ...p, [id]: { ...p[id], [field]: val } }));
  const knockoutA  = id => setEditsA(p => ({ ...p, [id]: { lb: 0, ub: 0 } }));
  const knockoutB  = id => setEditsB(p => ({ ...p, [id]: { lb: 0, ub: 0 } }));
  const resetEditA = id => setEditsA(p => { const n = { ...p }; delete n[id]; return n; });
  const resetEditB = id => setEditsB(p => { const n = { ...p }; delete n[id]; return n; });
  const addOverride = () => {
    const id = newRxnId.trim();
    if (!id) return;
    setEditsA(p => ({ ...p, [id]: { lb: newLbA, ub: newUbA } }));
    setEditsB(p => ({ ...p, [id]: { lb: newLbB, ub: newUbB } }));
    setNewRxnId('');
  };

  const sortBy = (col) => setRxnSort(p => ({ col, dir: p.col === col ? -p.dir : 1 }));

  // Auto-detect FBA objectives when models load
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (diff?.objA) setFbaObjA(diff.objA.id); }, [diff?.objA?.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (diff?.objB) setFbaObjB(diff.objB.id); }, [diff?.objB?.id]);

  // Key shared exchanges for constraint panel
  const PRIORITY_EX = ['EX_glc__D_e','EX_glc_e','EX_glc_D_e','EX_o2_e','EX_nh4_e','EX_pi_e','EX_co2_e','EX_ac_e','EX_h2o_e','EX_h_e'];
  const fbaExchanges = useMemo(() => {
    if (!diff) return [];
    const present = PRIORITY_EX.filter(id => diff.rxnsA.has(id) || diff.rxnsB.has(id));
    const extra = [...diff.rxnsA].filter(id => id.startsWith('EX_') && !present.includes(id)).slice(0, Math.max(0, 10 - present.length));
    return [...present, ...extra].slice(0, 10);
  }, [diff]);

  const getSCLB = id => sharedConstraints[id]?.lb ?? slotA.model?.reactions?.[id]?.lower_bound ?? slotB.model?.reactions?.[id]?.lower_bound ?? -1000;
  const getSCUB = id => sharedConstraints[id]?.ub ?? slotA.model?.reactions?.[id]?.upper_bound ?? slotB.model?.reactions?.[id]?.upper_bound ?? 1000;
  const setSCLB = (id, v) => setSharedConstraints(p => ({ ...p, [id]: { ...p[id], lb: v === '' ? undefined : parseFloat(v) } }));
  const setSCUB = (id, v) => setSharedConstraints(p => ({ ...p, [id]: { ...p[id], ub: v === '' ? undefined : parseFloat(v) } }));

  const runFBABoth = useCallback(async () => {
    if (!slotA.model || !slotB.model || !fbaObjA || !fbaObjB) return;
    setFbaRunning(true); setFbaError(null);
    try {
      const [resA, resB] = await Promise.all([
        compute('fba', slotA.model, { objective: fbaObjA, constraints: { ...sharedConstraints, ...editsA } }),
        compute('fba', slotB.model, { objective: fbaObjB, constraints: { ...sharedConstraints, ...editsB } }),
      ]);
      setFbaResultA(resA); setFbaResultB(resB);
    } catch (err) { setFbaError(err.message); }
    setFbaRunning(false);
  }, [slotA.model, slotB.model, fbaObjA, fbaObjB, sharedConstraints, editsA, editsB]);
  useEffect(() => { runFBABothRef.current = runFBABoth; });

  // Auto-run on constraint/objective changes
  useEffect(() => {
    if (!fbaAutoRun || !slotA.model || !slotB.model) return;
    clearTimeout(fbaAutoTimer.current);
    fbaAutoTimer.current = setTimeout(() => runFBABothRef.current?.(), 500);
    return () => clearTimeout(fbaAutoTimer.current);
  }, [fbaAutoRun, sharedConstraints, fbaObjA, fbaObjB, slotA.model, slotB.model]);
  const SortIcon = ({ col }) => rxnSort.col === col
    ? (rxnSort.dir > 0 ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />)
    : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)]">
      {/* ── header ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <ArrowLeftRight className="w-4 h-4" style={{ color: 'var(--primary)' }} />
        <span className="font-bold text-[var(--text-primary)]">Comparative Model Viewer</span>
        <span className="text-xs text-[var(--text-muted)] ml-1">Load two GEMs to highlight structural differences</span>
        <button onClick={onClose} className="ml-auto p-1.5 rounded hover:bg-[var(--bg-primary)] text-[var(--text-muted)]">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* ── two model slots ── */}
        <div className="flex gap-4">
          <ModelSlot slotKey="A" {...slotA} onLoad={s => setSlotA(p => ({ ...p, ...s }))} />
          <div className="flex items-center flex-shrink-0 text-[var(--text-muted)]">
            <ArrowLeftRight className="w-5 h-5" />
          </div>
          <ModelSlot slotKey="B" {...slotB} onLoad={s => setSlotB(p => ({ ...p, ...s }))} />
        </div>

        {/* ── placeholder when models not yet loaded ── */}
        {!diff && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-[var(--border-color)] flex items-center justify-center mb-4 text-[var(--text-muted)]">
              <ArrowLeftRight className="w-7 h-7" />
            </div>
            <p className="font-semibold text-[var(--text-secondary)]">Load both models to compare</p>
            <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">
              Upload an SBML or JSON model for each slot above. Reactions, subsystems, and genes will be compared automatically.
            </p>
          </div>
        )}

        {diff && (
          <>
            {/* ── summary stats ── */}
            <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Overview</span>
                <span className="ml-auto text-xs font-mono font-bold" style={{ color: SHARED_COLOR }}>
                  {diff.overlapPct}% reaction overlap (Sørensen–Dice)
                </span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-[var(--border-color)]">
                {[
                  { label: 'Shared reactions', value: diff.sharedRxns.size, color: SHARED_COLOR, sub: `${diff.overlapPct}% of union` },
                  { label: 'Only in A', value: diff.onlyA.size, color: SLOT.A.dot, sub: `${Math.round(diff.onlyA.size / Math.max(diff.rxnsA.size, 1) * 100)}% of Model A` },
                  { label: 'Only in B', value: diff.onlyB.size, color: SLOT.B.dot, sub: `${Math.round(diff.onlyB.size / Math.max(diff.rxnsB.size, 1) * 100)}% of Model B` },
                ].map(({ label, value, color, sub }) => (
                  <div key={label} className="p-4 text-center">
                    <p className="text-3xl font-black" style={{ color }}>{value.toLocaleString()}</p>
                    <p className="text-xs font-semibold text-[var(--text-secondary)] mt-0.5">{label}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Stacked bar */}
              <div className="px-4 pb-4">
                <div className="flex h-4 rounded-full overflow-hidden w-full">
                  {[
                    { size: diff.onlyA.size, color: SLOT.A.dot },
                    { size: diff.sharedRxns.size, color: SHARED_COLOR },
                    { size: diff.onlyB.size, color: SLOT.B.dot },
                  ].map(({ size, color }, i) => {
                    const total = diff.rxnsA.size + diff.rxnsB.size - diff.sharedRxns.size || 1;
                    return <div key={i} style={{ width: `${size / total * 100}%`, background: color }} />;
                  })}
                </div>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-[var(--text-muted)]">
                  {[
                    { dot: SLOT.A.dot, label: 'A only' },
                    { dot: SHARED_COLOR, label: 'Shared' },
                    { dot: SLOT.B.dot, label: 'B only' },
                  ].map(({ dot, label }) => (
                    <span key={label} className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ background: dot }} />
                      {label}
                    </span>
                  ))}
                  <span className="ml-auto">Genes: {diff.sharedGenes.size} shared · {diff.onlyGenesA.size} A-only · {diff.onlyGenesB.size} B-only</span>
                </div>
              </div>
            </div>

            {/* ── subsystem comparison ── */}
            <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-3 flex-wrap">
                <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Subsystems</span>
                <span className="text-xs text-[var(--text-muted)]">{diff.subsDiff.length} total</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {[
                    { key: 'all', label: 'All' },
                    { key: 'shared', label: 'Shared' },
                    { key: 'onlyA', label: 'A only' },
                    { key: 'onlyB', label: 'B only' },
                  ].map(({ key, label }) => (
                    <button key={key} onClick={() => setSubFilter(key)}
                      className={`px-2 py-0.5 text-[10px] rounded-md border transition-colors ${subFilter === key ? 'bg-[var(--primary)] text-white border-transparent' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold text-[var(--text-muted)]">Subsystem</th>
                      <th className="text-center px-3 py-2 font-semibold text-[var(--text-muted)]">Status</th>
                      <th className="text-right px-4 py-2 font-semibold" style={{ color: SLOT.A.dot }}>A rxns</th>
                      <th className="text-right px-4 py-2 font-semibold" style={{ color: SLOT.B.dot }}>B rxns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSubs.map(({ sub, countA, countB, status }) => (
                      <tr key={sub} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors">
                        <td className="px-4 py-1.5 text-[var(--text-primary)] font-medium">{sub}</td>
                        <td className="px-3 py-1.5 text-center"><StatusBadge status={status} /></td>
                        <td className="px-4 py-1.5 text-right font-mono" style={{ color: countA ? SLOT.A.dot : 'var(--text-muted)' }}>
                          {countA || '—'}
                        </td>
                        <td className="px-4 py-1.5 text-right font-mono" style={{ color: countB ? SLOT.B.dot : 'var(--text-muted)' }}>
                          {countB || '—'}
                        </td>
                      </tr>
                    ))}
                    {filteredSubs.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-[var(--text-muted)]">No subsystems match</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── tabbed entity diff panel ── */}
            <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">

              {/* Tab strip */}
              <div className="flex items-center bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                {[
                  { key: 'reactions',   label: 'Reactions',   count: diff.rxnRows.length },
                  { key: 'genes',       label: 'Genes',       count: diff.geneRows.length },
                  { key: 'metabolites', label: 'Metabolites', count: diff.metRows.length },
                  { key: 'objective',   label: 'FBA Objective', count: null },
                  { key: 'fba',         label: '⚡ FBA Compare', count: null },
                  { key: 'edit',        label: '✎ Edit Models',  count: Object.keys(editsA).length + Object.keys(editsB).length || null },
                ].map(({ key, label, count }) => (
                  <button key={key} onClick={() => setBottomTab(key)}
                    className="px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap"
                    style={{
                      borderBottom: bottomTab === key ? `2px solid var(--primary)` : '2px solid transparent',
                      color: bottomTab === key ? 'var(--primary)' : 'var(--text-muted)',
                      marginBottom: -1,
                    }}>
                    {label}{count !== null && <span className="ml-1.5 text-[10px] opacity-60">{count.toLocaleString()}</span>}
                  </button>
                ))}
              </div>

              {/* ── REACTIONS tab ── */}
              {bottomTab === 'reactions' && (
                <>
                  <div className="px-4 py-2 bg-[var(--bg-primary)] border-b border-[var(--border-color)] flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-[var(--text-muted)]">{filteredRxns.length} shown</span>
                    <div className="flex items-center gap-1">
                      {[
                        { key: 'all', label: `All (${diff.rxnRows.length})` },
                        { key: 'shared', label: `Shared (${diff.sharedRxns.size})` },
                        { key: 'onlyA', label: `A only (${diff.onlyA.size})` },
                        { key: 'onlyB', label: `B only (${diff.onlyB.size})` },
                      ].map(({ key, label }) => (
                        <button key={key} onClick={() => setFilter(key)}
                          className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${filter === key ? 'bg-[var(--primary)] text-white border-transparent' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="ml-auto relative">
                      <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input value={query} onChange={e => setQuery(e.target.value)}
                        placeholder="Search reactions…"
                        className="pl-7 pr-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] w-44" />
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                        <tr>
                          {[
                            { col: 'id', label: 'ID' }, { col: 'name', label: 'Name' },
                            { col: 'subsystem', label: 'Subsystem' }, { col: 'status', label: 'Status' },
                            { col: 'lbA', label: 'lb A' }, { col: 'ubA', label: 'ub A' },
                            { col: 'lbB', label: 'lb B' }, { col: 'ubB', label: 'ub B' },
                          ].map(({ col, label }) => (
                            <th key={col} onClick={() => sortBy(col)}
                              className="text-left px-3 py-2 font-semibold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] whitespace-nowrap select-none">
                              {label} <SortIcon col={col} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRxns.slice(0, 500).map((row, i) => {
                          const dotColor = row.status === 'shared' ? SHARED_COLOR : row.status === 'onlyA' ? SLOT.A.dot : SLOT.B.dot;
                          return (
                            <tr key={row.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors"
                                style={{ background: i % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
                              <td className="px-3 py-1.5 font-mono text-[var(--text-primary)] whitespace-nowrap">
                                <span className="w-2 h-2 rounded-full inline-block mr-1.5" style={{ background: dotColor, verticalAlign: 'middle' }} />
                                {row.id}
                              </td>
                              <td className="px-3 py-1.5 text-[var(--text-secondary)] max-w-[180px] truncate" title={row.name}>{row.name}</td>
                              <td className="px-3 py-1.5 text-[var(--text-muted)] max-w-[140px] truncate" title={row.subsystem}>{row.subsystem}</td>
                              <td className="px-3 py-1.5"><StatusBadge status={row.status} /></td>
                              <td className="px-3 py-1.5 font-mono text-right" style={{ color: row.lbA !== null ? SLOT.A.dot : 'var(--text-muted)' }}>{row.lbA !== null ? row.lbA : '—'}</td>
                              <td className="px-3 py-1.5 font-mono text-right" style={{ color: row.ubA !== null ? SLOT.A.dot : 'var(--text-muted)' }}>{row.ubA !== null ? row.ubA : '—'}</td>
                              <td className="px-3 py-1.5 font-mono text-right" style={{ color: row.lbB !== null ? SLOT.B.dot : 'var(--text-muted)' }}>{row.lbB !== null ? row.lbB : '—'}</td>
                              <td className="px-3 py-1.5 font-mono text-right" style={{ color: row.ubB !== null ? SLOT.B.dot : 'var(--text-muted)' }}>{row.ubB !== null ? row.ubB : '—'}</td>
                            </tr>
                          );
                        })}
                        {filteredRxns.length > 500 && (
                          <tr><td colSpan={8} className="px-4 py-3 text-center text-[var(--text-muted)] text-xs">Showing first 500 of {filteredRxns.length} — refine search to see more</td></tr>
                        )}
                        {filteredRxns.length === 0 && (
                          <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">No reactions match</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* ── GENES tab ── */}
              {bottomTab === 'genes' && (
                <>
                  <div className="px-4 py-2 bg-[var(--bg-primary)] border-b border-[var(--border-color)] flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-[var(--text-muted)]">{filteredGenes.length} shown</span>
                    <div className="flex items-center gap-1">
                      {[
                        { key: 'all', label: `All (${diff.geneRows.length})` },
                        { key: 'shared', label: `Shared (${diff.sharedGenes.size})` },
                        { key: 'onlyA', label: `A only (${diff.onlyGenesA.size})` },
                        { key: 'onlyB', label: `B only (${diff.onlyGenesB.size})` },
                      ].map(({ key, label }) => (
                        <button key={key} onClick={() => setGeneFilter(key)}
                          className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${geneFilter === key ? 'bg-[var(--primary)] text-white border-transparent' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="ml-auto relative">
                      <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input value={geneQuery} onChange={e => setGeneQuery(e.target.value)}
                        placeholder="Search gene ID…"
                        className="pl-7 pr-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] w-44" />
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">Gene ID</th>
                          <th className="text-center px-3 py-2 font-semibold text-[var(--text-muted)]">Status</th>
                          <th className="text-center px-3 py-2 font-semibold" style={{ color: SLOT.A.dot }}>Model A</th>
                          <th className="text-center px-3 py-2 font-semibold" style={{ color: SLOT.B.dot }}>Model B</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredGenes.slice(0, 500).map((row, i) => {
                          const dotColor = row.status === 'shared' ? SHARED_COLOR : row.status === 'onlyA' ? SLOT.A.dot : SLOT.B.dot;
                          const inA = row.status === 'shared' || row.status === 'onlyA';
                          const inB = row.status === 'shared' || row.status === 'onlyB';
                          return (
                            <tr key={row.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors"
                                style={{ background: i % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
                              <td className="px-3 py-1.5 font-mono text-[var(--text-primary)]">
                                <span className="w-2 h-2 rounded-full inline-block mr-1.5" style={{ background: dotColor, verticalAlign: 'middle' }} />
                                {row.id}
                              </td>
                              <td className="px-3 py-1.5 text-center"><StatusBadge status={row.status} /></td>
                              <td className="px-3 py-1.5 text-center text-lg">{inA ? '✓' : <span className="text-[var(--text-muted)]">—</span>}</td>
                              <td className="px-3 py-1.5 text-center text-lg">{inB ? '✓' : <span className="text-[var(--text-muted)]">—</span>}</td>
                            </tr>
                          );
                        })}
                        {filteredGenes.length > 500 && (
                          <tr><td colSpan={4} className="px-4 py-3 text-center text-[var(--text-muted)] text-xs">Showing first 500 of {filteredGenes.length}</td></tr>
                        )}
                        {filteredGenes.length === 0 && (
                          <tr><td colSpan={4} className="px-4 py-8 text-center text-[var(--text-muted)]">No genes match</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* ── METABOLITES tab ── */}
              {bottomTab === 'metabolites' && (
                <>
                  <div className="px-4 py-2 bg-[var(--bg-primary)] border-b border-[var(--border-color)] flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-[var(--text-muted)]">{filteredMets.length} shown</span>
                    <div className="flex items-center gap-1">
                      {[
                        { key: 'all', label: `All (${diff.metRows.length})` },
                        { key: 'shared', label: `Shared (${diff.sharedMets.size})` },
                        { key: 'onlyA', label: `A only (${diff.onlyMetsA.size})` },
                        { key: 'onlyB', label: `B only (${diff.onlyMetsB.size})` },
                      ].map(({ key, label }) => (
                        <button key={key} onClick={() => setMetFilter(key)}
                          className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${metFilter === key ? 'bg-[var(--primary)] text-white border-transparent' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="ml-auto relative">
                      <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input value={metQuery} onChange={e => setMetQuery(e.target.value)}
                        placeholder="Search metabolite…"
                        className="pl-7 pr-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] w-44" />
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">ID</th>
                          <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">Name</th>
                          <th className="text-center px-3 py-2 font-semibold text-[var(--text-muted)]">Status</th>
                          <th className="text-center px-3 py-2 font-semibold" style={{ color: SLOT.A.dot }}>Compartment A</th>
                          <th className="text-center px-3 py-2 font-semibold" style={{ color: SLOT.B.dot }}>Compartment B</th>
                          <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">Formula A</th>
                          <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">Formula B</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMets.slice(0, 500).map((row, i) => {
                          const dotColor = row.status === 'shared' ? SHARED_COLOR : row.status === 'onlyA' ? SLOT.A.dot : SLOT.B.dot;
                          return (
                            <tr key={row.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors"
                                style={{ background: i % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
                              <td className="px-3 py-1.5 font-mono text-[var(--text-primary)] whitespace-nowrap">
                                <span className="w-2 h-2 rounded-full inline-block mr-1.5" style={{ background: dotColor, verticalAlign: 'middle' }} />
                                {row.id}
                              </td>
                              <td className="px-3 py-1.5 text-[var(--text-secondary)] max-w-[180px] truncate" title={row.name}>{row.name}</td>
                              <td className="px-3 py-1.5 text-center"><StatusBadge status={row.status} /></td>
                              <td className="px-3 py-1.5 text-center font-mono text-[var(--text-muted)]">{row.compartmentA}</td>
                              <td className="px-3 py-1.5 text-center font-mono text-[var(--text-muted)]">{row.compartmentB}</td>
                              <td className="px-3 py-1.5 font-mono text-[var(--text-muted)]">{row.formulaA}</td>
                              <td className="px-3 py-1.5 font-mono text-[var(--text-muted)]">{row.formulaB}</td>
                            </tr>
                          );
                        })}
                        {filteredMets.length > 500 && (
                          <tr><td colSpan={7} className="px-4 py-3 text-center text-[var(--text-muted)] text-xs">Showing first 500 of {filteredMets.length}</td></tr>
                        )}
                        {filteredMets.length === 0 && (
                          <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">No metabolites match</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* ── FBA OBJECTIVE tab ── */}
              {bottomTab === 'objective' && (
                <div className="p-5 grid grid-cols-2 gap-5">
                  {[
                    { key: 'A', obj: diff.objA, slot: SLOT.A },
                    { key: 'B', obj: diff.objB, slot: SLOT.B },
                  ].map(({ key, obj, slot }) => (
                    <div key={key} className={`rounded-xl border-2 ${slot.border} p-4 space-y-3`}>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: slot.dot }} />
                        <span className={`text-sm font-bold ${slot.text}`}>Model {key} — Objective</span>
                      </div>
                      {obj ? (
                        <>
                          <div className={`rounded-lg px-4 py-3 ${slot.bg} border ${slot.border}`}>
                            <p className="text-[9px] uppercase tracking-widest text-[var(--text-muted)] mb-1">maximize</p>
                            <p className="font-black text-base font-mono" style={{ color: slot.dot }}>{obj.id}</p>
                            {obj.name && obj.name !== obj.id && (
                              <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">{obj.name}</p>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded border border-[var(--border-color)] px-3 py-2 bg-[var(--bg-secondary)]">
                              <p className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">Lower bound</p>
                              <p className="font-mono font-bold text-[var(--text-primary)]">{obj.lb ?? '—'}</p>
                            </div>
                            <div className="rounded border border-[var(--border-color)] px-3 py-2 bg-[var(--bg-secondary)]">
                              <p className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">Upper bound</p>
                              <p className="font-mono font-bold text-[var(--text-primary)]">{obj.ub ?? '—'}</p>
                            </div>
                          </div>
                          <div className="rounded border border-[var(--border-color)] px-3 py-2 bg-[var(--bg-secondary)] text-xs">
                            <p className="text-[9px] uppercase tracking-wide text-[var(--text-muted)] mb-1">GPR</p>
                            <p className="font-mono text-[var(--text-secondary)] break-all leading-relaxed">
                              {obj.gpr || <span className="text-[var(--text-muted)] italic">no GPR</span>}
                            </p>
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] pt-1">
                            {diff.objA && diff.objB && diff.objA.id === diff.objB.id
                              ? <span className="text-emerald-600 font-semibold">✓ Same objective reaction in both models</span>
                              : <span className="text-amber-600 font-semibold">⚠ Objective reactions differ between models</span>}
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-[var(--text-muted)] italic">No objective detected</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── FBA COMPARE tab ── */}
              {bottomTab === 'fba' && (
                <div className="flex flex-col">

                  {/* Toolbar */}
                  <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex-wrap">
                    <button onClick={runFBABoth} disabled={fbaRunning || !slotA.model || !slotB.model}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-white rounded transition-opacity disabled:opacity-40"
                      style={{ background: fbaRunning ? '#6b7280' : 'var(--primary)', borderRadius: 3 }}>
                      {fbaRunning
                        ? <><span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />Solving…</>
                        : <><Play className="w-3 h-3" fill="currentColor" />Run Both</>}
                    </button>
                    <button onClick={() => setFbaAutoRun(v => !v)}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 font-sans transition-colors"
                      style={{
                        border: `1px solid ${fbaAutoRun ? '#22c55e' : 'var(--border-color)'}`,
                        borderRadius: 3,
                        background: fbaAutoRun ? '#f0fdf4' : 'transparent',
                        color: fbaAutoRun ? '#16a34a' : 'var(--text-muted)',
                      }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', marginRight: 3,
                                     background: fbaAutoRun ? '#22c55e' : 'var(--text-muted)' }} />
                      Live
                    </button>
                    {fbaResultA && (
                      <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono"
                            style={{ background: '#eff6ff', border: `1px solid ${SLOT.A.dot}`, color: SLOT.A.dot, borderRadius: 3 }}>
                        A: {fbaResultA.status === 'optimal' ? fbaResultA.objectiveValue.toFixed(4) : fbaResultA.status}
                      </span>
                    )}
                    {fbaResultB && (
                      <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono"
                            style={{ background: '#fffbeb', border: `1px solid ${SLOT.B.dot}`, color: SLOT.B.dot, borderRadius: 3 }}>
                        B: {fbaResultB.status === 'optimal' ? fbaResultB.objectiveValue.toFixed(4) : fbaResultB.status}
                      </span>
                    )}
                    {fbaResultA?.status === 'optimal' && fbaResultB?.status === 'optimal' && (() => {
                      const d = fbaResultA.objectiveValue - fbaResultB.objectiveValue;
                      return <span className="text-[10px] font-mono" style={{ color: Math.abs(d) < 1e-4 ? '#16a34a' : '#ef4444' }}>
                        Δobj = {d >= 0 ? '+' : ''}{d.toFixed(4)}
                      </span>;
                    })()}
                    {fbaError && <span className="text-[10px] text-red-500 truncate max-w-xs">{fbaError}</span>}
                    {(fbaResultA || fbaResultB) && (
                      <button onClick={() => { setFbaResultA(null); setFbaResultB(null); setFbaError(null); }}
                        className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5"
                        style={{ border: '1px solid var(--border-color)', borderRadius: 3, color: 'var(--text-muted)' }}>
                        <RotateCcw className="w-2.5 h-2.5" />Clear
                      </button>
                    )}
                  </div>

                  {/* Objective selectors */}
                  <div className="grid grid-cols-2 divide-x divide-[var(--border-color)] border-b border-[var(--border-color)]">
                    {[
                      { key: 'A', obj: fbaObjA, setObj: setFbaObjA, model: slotA.model, slot: SLOT.A, result: fbaResultA },
                      { key: 'B', obj: fbaObjB, setObj: setFbaObjB, model: slotB.model, slot: SLOT.B, result: fbaResultB },
                    ].map(({ key, obj, setObj, model, slot, result }) => (
                      <div key={key} className="p-3 flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: slot.dot }} />
                          <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: slot.dot }}>Model {key} — max</span>
                        </div>
                        <select value={obj || ''} onChange={e => setObj(e.target.value)} disabled={!model}
                          className="w-full text-[10px] px-2 py-1 border font-mono bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1"
                          style={{ borderColor: slot.dot, borderRadius: 3 }}>
                          {!obj && <option value="">— select —</option>}
                          {Object.keys(model?.reactions || {}).map(id => <option key={id} value={id}>{id}</option>)}
                        </select>
                        {result?.status === 'optimal' && (
                          <div className="flex justify-between text-[10px] font-mono px-0.5">
                            <span style={{ color: 'var(--text-muted)' }}>obj =</span>
                            <span className="font-bold" style={{ color: slot.dot }}>{result.objectiveValue.toFixed(6)}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Shared exchange constraints */}
                  <div className="border-b border-[var(--border-color)]">
                    <div className="flex items-center gap-2 px-4 py-1 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                      <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                        Exchange Constraints
                      </span>
                      <span className="text-[9px] text-[var(--text-muted)]">applied to both</span>
                      {Object.keys(sharedConstraints).length > 0 && (
                        <button onClick={() => setSharedConstraints({})}
                          className="ml-auto text-[9px] px-1.5 py-px rounded border text-red-500 border-red-200 hover:bg-red-50">
                          reset all
                        </button>
                      )}
                    </div>
                    <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                      {/* header */}
                      <div className="grid text-[9px] font-semibold text-[var(--text-muted)] px-3 py-0.5 uppercase tracking-wide bg-[var(--bg-primary)]"
                           style={{ gridTemplateColumns: '1fr 68px 68px' }}>
                        <span>Reaction</span><span className="text-right">LB</span><span className="text-right">UB</span>
                      </div>
                      {fbaExchanges.length === 0 && (
                        <p className="px-3 py-2 text-[9px] text-[var(--text-muted)]">Load both models to see exchanges</p>
                      )}
                      {fbaExchanges.map((id, i) => {
                        const mod = sharedConstraints[id]?.lb !== undefined || sharedConstraints[id]?.ub !== undefined;
                        return (
                          <div key={id} className="grid items-center px-3"
                               style={{ gridTemplateColumns: '1fr 68px 68px', height: 22,
                                        background: i % 2 === 0 ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                                        borderTop: '1px solid var(--border-color)' }}>
                            <span className="text-[9px] font-mono truncate" style={{ color: mod ? 'var(--primary)' : 'var(--text-secondary)' }}>{id}</span>
                            <input type="number" value={getSCLB(id)} onChange={e => setSCLB(id, e.target.value)}
                              className="w-full text-[9px] px-1 text-right border font-mono bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none"
                              style={{ borderColor: mod ? 'var(--primary)' : 'var(--border-color)', borderRadius: 2 }} />
                            <input type="number" value={getSCUB(id)} onChange={e => setSCUB(id, e.target.value)}
                              className="w-full text-[9px] px-1 text-right border font-mono bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none"
                              style={{ borderColor: mod ? 'var(--primary)' : 'var(--border-color)', borderRadius: 2 }} />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Flux Movement Map */}
                  <div>
                    <div className="flex items-center gap-2 px-4 py-1 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                      <span className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Flux Movement Map</span>
                      <span className="text-[9px] text-[var(--text-muted)]">— sorted by |ΔFlux|, top 40 active</span>
                    </div>
                    <FluxMovementMap
                      fluxesA={fbaResultA?.fluxes ?? {}}
                      fluxesB={fbaResultB?.fluxes ?? {}}
                      objective={fbaObjA}
                      labelA={slotA.model?.id?.slice(0, 20) || 'Model A'}
                      labelB={slotB.model?.id?.slice(0, 20) || 'Model B'}
                    />
                  </div>

                </div>
              )}

              {/* ── EDIT MODELS tab ── */}
              {bottomTab === 'edit' && (() => {
                const totalEdits = Object.keys(editsA).length + Object.keys(editsB).length;
                const numInput = (val, onChange, highlight) => (
                  <input
                    type="number"
                    value={val}
                    onChange={e => onChange(parseFloat(e.target.value))}
                    style={{
                      width: 62, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10,
                      padding: '1px 3px', borderRadius: 2, background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      border: `1px solid ${highlight ? '#f59e0b' : 'var(--border-color)'}`,
                    }}
                  />
                );
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
                    {/* ── toolbar ── */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        placeholder="Search reactions…"
                        value={editQuery}
                        onChange={e => setEditQuery(e.target.value)}
                        style={{
                          flex: 1, minWidth: 140, fontSize: 11, padding: '3px 8px',
                          border: '1px solid var(--border-color)', borderRadius: 4,
                          background: 'var(--bg-primary)', color: 'var(--text-primary)',
                        }}
                      />
                      {['all','edited','shared','onlyA','onlyB'].map(f => (
                        <button key={f} onClick={() => setEditFilter(f)}
                          style={{
                            fontSize: 10, padding: '2px 7px', borderRadius: 10, cursor: 'pointer',
                            border: '1px solid var(--border-color)',
                            background: editFilter === f ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                            color: editFilter === f ? '#fff' : 'var(--text-secondary)',
                          }}>
                          {f === 'all' ? 'All' : f === 'edited' ? `Edited (${totalEdits})` : f === 'shared' ? 'Shared' : f === 'onlyA' ? 'Only A' : 'Only B'}
                        </button>
                      ))}
                      <button onClick={() => { setEditsA({}); setEditsB({}); }}
                        style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                          border: '1px solid #ef4444', color: '#ef4444', background: 'transparent',
                          marginLeft: 'auto',
                        }}>
                        Reset All
                      </button>
                    </div>

                    {/* ── reaction table ── */}
                    <div style={{ overflowY: 'auto', maxHeight: 300, border: '1px solid var(--border-color)', borderRadius: 4 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                            <th style={{ padding: '4px 6px', textAlign: 'left', borderBottom: '1px solid var(--border-color)', fontWeight: 600, color: 'var(--text-secondary)' }}>Reaction</th>
                            <th style={{ padding: '4px 6px', textAlign: 'center', borderBottom: '1px solid var(--border-color)', color: SLOT.A.dot, fontWeight: 600 }}>Model A — lb / ub</th>
                            <th style={{ padding: '4px 6px', textAlign: 'center', borderBottom: '1px solid var(--border-color)', color: SLOT.B.dot, fontWeight: 600 }}>Model B — lb / ub</th>
                          </tr>
                        </thead>
                        <tbody>
                          {editRows.length === 0 && (
                            <tr><td colSpan={3} style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: 11 }}>No reactions match the filter.</td></tr>
                          )}
                          {editRows.map(r => (
                            <tr key={r.id} style={{
                              borderBottom: '1px solid var(--border-color)',
                              background: (r.editedA || r.editedB) ? 'rgba(245,158,11,0.05)' : 'transparent',
                            }}>
                              {/* reaction id + name */}
                              <td style={{ padding: '3px 6px', maxWidth: 160 }}>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.id}</div>
                                {r.name && r.name !== r.id && (
                                  <div style={{ fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                                )}
                                <span style={{
                                  fontSize: 9, padding: '0 4px', borderRadius: 6,
                                  background: r.status === 'shared' ? '#16a34a22' : r.status === 'onlyA' ? SLOT.A.dot + '22' : SLOT.B.dot + '22',
                                  color: r.status === 'shared' ? '#16a34a' : r.status === 'onlyA' ? SLOT.A.dot : SLOT.B.dot,
                                }}>{r.status}</span>
                              </td>

                              {/* Model A controls */}
                              <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                                {r.inA ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center' }}>
                                    {numInput(r.curLbA, v => setEditA(r.id, 'lb', v), r.editedA)}
                                    {numInput(r.curUbA, v => setEditA(r.id, 'ub', v), r.editedA)}
                                    <button onClick={() => knockoutA(r.id)} title="Knockout (lb=ub=0)"
                                      style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border-color)', background: r.koA ? '#ef444422' : 'transparent', color: r.koA ? '#ef4444' : 'var(--text-muted)', cursor: 'pointer' }}>KO</button>
                                    {r.editedA && (
                                      <button onClick={() => resetEditA(r.id)} title="Reset A"
                                        style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>↺</button>
                                    )}
                                  </div>
                                ) : <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>—</span>}
                              </td>

                              {/* Model B controls */}
                              <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                                {r.inB ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center' }}>
                                    {numInput(r.curLbB, v => setEditB(r.id, 'lb', v), r.editedB)}
                                    {numInput(r.curUbB, v => setEditB(r.id, 'ub', v), r.editedB)}
                                    <button onClick={() => knockoutB(r.id)} title="Knockout (lb=ub=0)"
                                      style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border-color)', background: r.koB ? '#ef444422' : 'transparent', color: r.koB ? '#ef4444' : 'var(--text-muted)', cursor: 'pointer' }}>KO</button>
                                    {r.editedB && (
                                      <button onClick={() => resetEditB(r.id)} title="Reset B"
                                        style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>↺</button>
                                    )}
                                  </div>
                                ) : <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* ── custom override row ── */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                      padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 4,
                      border: '1px solid var(--border-color)',
                    }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Add / override reaction:</span>
                      <input
                        placeholder="Reaction ID"
                        value={newRxnId}
                        onChange={e => setNewRxnId(e.target.value)}
                        style={{
                          width: 120, fontSize: 10, padding: '2px 6px', fontFamily: 'var(--font-mono)',
                          border: '1px solid var(--border-color)', borderRadius: 3,
                          background: 'var(--bg-primary)', color: 'var(--text-primary)',
                        }}
                      />
                      <span style={{ fontSize: 10, color: SLOT.A.dot }}>A:</span>
                      {numInput(newLbA, setNewLbA, false)}
                      {numInput(newUbA, setNewUbA, false)}
                      <span style={{ fontSize: 10, color: SLOT.B.dot }}>B:</span>
                      {numInput(newLbB, setNewLbB, false)}
                      {numInput(newUbB, setNewUbB, false)}
                      <button onClick={addOverride}
                        style={{
                          fontSize: 10, padding: '2px 10px', borderRadius: 4, cursor: 'pointer',
                          background: 'var(--accent-primary)', color: '#fff', border: 'none',
                        }}>
                        Apply
                      </button>
                    </div>

                    {/* ── run FBA with edits ── */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        onClick={runFBABoth}
                        disabled={!slotA.model || !slotB.model}
                        style={{
                          fontSize: 11, padding: '4px 14px', borderRadius: 4, cursor: 'pointer',
                          background: totalEdits > 0 ? '#f59e0b' : 'var(--accent-primary)',
                          color: '#fff', border: 'none', fontWeight: 600,
                          opacity: (!slotA.model || !slotB.model) ? 0.4 : 1,
                        }}>
                        {totalEdits > 0 ? `Run FBA with ${totalEdits} edit${totalEdits > 1 ? 's' : ''}` : 'Run FBA'}
                      </button>
                      {fbaResultA && fbaResultB && (
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          A: <strong style={{ color: SLOT.A.dot }}>{fbaResultA.objectiveValue?.toFixed(4) ?? '—'}</strong>
                          {'  '}B: <strong style={{ color: SLOT.B.dot }}>{fbaResultB.objectiveValue?.toFixed(4) ?? '—'}</strong>
                          {'  '}Δ: <strong style={{ color: Math.abs((fbaResultA.objectiveValue ?? 0) - (fbaResultB.objectiveValue ?? 0)) < 1e-4 ? '#16a34a' : '#ef4444' }}>
                            {((fbaResultA.objectiveValue ?? 0) - (fbaResultB.objectiveValue ?? 0) >= 0 ? '+' : '')}
                            {((fbaResultA.objectiveValue ?? 0) - (fbaResultB.objectiveValue ?? 0)).toFixed(4)}
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

            </div>
          </>
        )}
      </div>
    </div>
  );
}
