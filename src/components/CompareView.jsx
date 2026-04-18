import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Upload, X, ArrowLeftRight, FlaskConical, Database, Dna, Search, ChevronUp, ChevronDown, BarChart2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { parseModel } from '../utils/modelParser';

// ── colour tokens per slot ────────────────────────────────────────────────────
const SLOT = {
  A: { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-300 dark:border-blue-700', text: 'text-blue-700 dark:text-blue-300', badge: 'bg-blue-100 text-blue-700 border-blue-200', dot: '#3b82f6', label: 'Model A' },
  B: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-300 dark:border-amber-700', text: 'text-amber-700 dark:text-amber-300', badge: 'bg-amber-100 text-amber-700 border-amber-200', dot: '#f59e0b', label: 'Model B' },
};
const SHARED_COLOR = '#10b981';

// ── model loading drop zone ───────────────────────────────────────────────────
function ModelSlot({ slotKey, model, loading, error, onLoad }) {
  const { isDark } = useTheme();
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
            ].map(({ icon: Icon, label, val }) => (
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
    genesA, genesB, sharedGenes, onlyGenesA, onlyGenesB,
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

// ── main component ────────────────────────────────────────────────────────────
export default function CompareView({ onClose }) {
  const [slotA, setSlotA] = useState({ model: null, loading: false, error: null });
  const [slotB, setSlotB] = useState({ model: null, loading: false, error: null });
  const [filter, setFilter] = useState('all'); // 'all' | 'shared' | 'onlyA' | 'onlyB'
  const [query, setQuery] = useState('');
  const [rxnSort, setRxnSort] = useState({ col: 'status', dir: 1 });
  const [subFilter, setSubFilter] = useState('all');

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

  const sortBy = (col) => setRxnSort(p => ({ col, dir: p.col === col ? -p.dir : 1 }));
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

            {/* ── reaction diff table ── */}
            <div className="rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-3 flex-wrap">
                <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Reactions</span>
                <span className="text-xs text-[var(--text-muted)]">{filteredRxns.length} shown</span>
                {/* Filter buttons */}
                <div className="flex items-center gap-1.5">
                  {[
                    { key: 'all', label: `All (${diff.rxnRows.length})` },
                    { key: 'shared', label: `Shared (${diff.sharedRxns.size})` },
                    { key: 'onlyA', label: `A only (${diff.onlyA.size})` },
                    { key: 'onlyB', label: `B only (${diff.onlyB.size})` },
                  ].map(({ key, label }) => (
                    <button key={key} onClick={() => setFilter(key)}
                      className={`px-2 py-0.5 text-[10px] rounded-md border transition-colors ${filter === key ? 'bg-[var(--primary)] text-white border-transparent' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {/* Search */}
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
                        { col: 'id', label: 'ID' },
                        { col: 'name', label: 'Name' },
                        { col: 'subsystem', label: 'Subsystem' },
                        { col: 'status', label: 'Status' },
                        { col: 'lbA', label: 'lb A' },
                        { col: 'ubA', label: 'ub A' },
                        { col: 'lbB', label: 'lb B' },
                        { col: 'ubB', label: 'ub B' },
                      ].map(({ col, label }) => (
                        <th key={col} onClick={() => sortBy(col)}
                          className="text-left px-3 py-2 font-semibold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] whitespace-nowrap select-none">
                          {label} <SortIcon col={col} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRxns.slice(0, 500).map(row => {
                      const rowColor = row.status === 'shared' ? 'border-emerald-100 dark:border-emerald-900/20'
                        : row.status === 'onlyA' ? 'border-blue-100 dark:border-blue-900/20'
                        : 'border-amber-100 dark:border-amber-900/20';
                      const dotColor = row.status === 'shared' ? SHARED_COLOR : row.status === 'onlyA' ? SLOT.A.dot : SLOT.B.dot;
                      return (
                        <tr key={row.id} className={`border-b ${rowColor} hover:bg-[var(--bg-secondary)] transition-colors`}>
                          <td className="px-3 py-1.5 font-mono text-[var(--text-primary)] whitespace-nowrap">
                            <span className="w-2 h-2 rounded-full inline-block mr-1.5 flex-shrink-0" style={{ background: dotColor, verticalAlign: 'middle' }} />
                            {row.id}
                          </td>
                          <td className="px-3 py-1.5 text-[var(--text-secondary)] max-w-[180px] truncate" title={row.name}>{row.name}</td>
                          <td className="px-3 py-1.5 text-[var(--text-muted)] max-w-[140px] truncate" title={row.subsystem}>{row.subsystem}</td>
                          <td className="px-3 py-1.5"><StatusBadge status={row.status} /></td>
                          <td className="px-3 py-1.5 font-mono text-right" style={{ color: row.lbA !== null ? SLOT.A.dot : 'var(--text-muted)' }}>
                            {row.lbA !== null ? row.lbA : '—'}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-right" style={{ color: row.ubA !== null ? SLOT.A.dot : 'var(--text-muted)' }}>
                            {row.ubA !== null ? row.ubA : '—'}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-right" style={{ color: row.lbB !== null ? SLOT.B.dot : 'var(--text-muted)' }}>
                            {row.lbB !== null ? row.lbB : '—'}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-right" style={{ color: row.ubB !== null ? SLOT.B.dot : 'var(--text-muted)' }}>
                            {row.ubB !== null ? row.ubB : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRxns.length > 500 && (
                      <tr><td colSpan={8} className="px-4 py-3 text-center text-[var(--text-muted)] text-xs">
                        Showing first 500 of {filteredRxns.length} — refine search to see more
                      </td></tr>
                    )}
                    {filteredRxns.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--text-muted)]">No reactions match</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
