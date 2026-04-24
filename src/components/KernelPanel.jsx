import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, ChevronDown, ChevronUp, Copy, Check, Cpu, Wifi, WifiOff, Zap, FlaskConical, Gauge } from 'lucide-react';
import { computeManager } from '../lib/ComputeWorker';
import { KernelStatus } from '../lib/KernelSolver';
import { runTierCalibration, formatReport } from '../lib/TierCalibration';
import { useModel } from '../contexts/ModelContext';

// ── Notebook cell ─────────────────────────────────────────────────────────────
function NotebookCell({ cell, index }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(cell.input).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const statusColor = {
    optimal: 'var(--primary)',
    infeasible: 'var(--danger)',
    error: 'var(--danger)',
    running: 'var(--reaction-color)',
  }[cell.status] || 'var(--text-muted)';

  return (
    <div style={{ borderBottom: '1px solid var(--border-color)' }}>
      {/* Input */}
      <div className="flex items-start gap-2 px-3 py-2"
        style={{ background: 'color-mix(in srgb, var(--bg-primary) 60%, transparent)' }}>
        <span className="text-[9px] font-mono mt-0.5 flex-shrink-0"
          style={{ color: 'var(--text-muted)', minWidth: 28 }}>
          In [{index + 1}]:
        </span>
        <code className="text-[10px] flex-1 break-all leading-relaxed"
          style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>
          {cell.input}
        </code>
        <button onClick={copy} className="flex-shrink-0 p-0.5 rounded opacity-40 hover:opacity-80 transition-opacity"
          style={{ color: 'var(--text-muted)' }}>
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>

      {/* Output */}
      {cell.output && (
        <div className="px-3 py-2" style={{ background: 'var(--bg-secondary)' }}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)', minWidth: 28 }}>
              Out:
            </span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{
                background: `color-mix(in srgb, ${statusColor} 15%, transparent)`,
                color: statusColor,
              }}>
              {cell.status?.toUpperCase()}
            </span>
            {cell.tier && (
              <TierBadge tier={cell.tier} />
            )}
            {cell.solveTime != null && (
              <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                {cell.solveTime < 1 ? `${(cell.solveTime * 1000).toFixed(0)}ms` : `${cell.solveTime.toFixed(2)}s`}
              </span>
            )}
          </div>

          {cell.status === 'running' && (
            <div className="flex items-center gap-2 py-1">
              <div className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: 'var(--reaction-color)', borderTopColor: 'transparent' }} />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {cell.progressMsg || (cell.progress != null
                  ? `${(cell.progress * 100).toFixed(0)}% — Solving…`
                  : 'Solving…')}
              </span>
            </div>
          )}

          {cell.status === 'optimal' && cell.calibReport && (
            <pre className="text-[9px] leading-relaxed overflow-x-auto"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
              {cell.calibReport}
            </pre>
          )}

          {cell.status === 'optimal' && !cell.calibReport && cell.result && (
            <OutputTable result={cell.result} />
          )}

          {cell.status === 'error' && (
            <p className="text-[10px] font-mono" style={{ color: 'var(--danger)' }}>
              {cell.calibReport || cell.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function OutputTable({ result }) {
  const topFluxes = Object.entries(result.fluxes || {})
    .filter(([, v]) => Math.abs(v) > 1e-6)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 8);

  return (
    <div className="space-y-2 text-[10px]">
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <Kv k="Growth rate" v={`${result.objectiveValue?.toFixed(6)} h⁻¹`} accent="--primary" />
        <Kv k="Solver" v={result.solver || '—'} />
        <Kv k="Active rxns"
          v={Object.values(result.fluxes || {}).filter(v => Math.abs(v) > 1e-6).length} />
        <Kv k="Phenotype" v={result.phenotype || '—'} accent={result.phenotype === 'viable' ? '--success' : '--danger'} />
      </div>
      {topFluxes.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 6, marginTop: 4 }}>
          <p className="text-[9px] uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
            Top fluxes (mmol/gDW/h)
          </p>
          <div className="space-y-0.5">
            {topFluxes.map(([id, v]) => (
              <div key={id} className="flex items-center gap-2">
                <span className="font-mono truncate flex-1" style={{ color: 'var(--text-secondary)', maxWidth: 120 }}
                  title={id}>{id}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className="h-1 rounded"
                    style={{
                      width: Math.min(60, Math.abs(v) / topFluxes[0][1] * 60),
                      background: v > 0 ? 'var(--primary)' : 'var(--reaction-color)',
                      opacity: 0.7,
                    }} />
                  <span className="font-mono w-16 text-right"
                    style={{ color: v > 0 ? 'var(--primary)' : 'var(--reaction-color)' }}>
                    {v > 0 ? '+' : ''}{v.toFixed(4)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Kv({ k, v, accent }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color: 'var(--text-muted)' }}>{k}:</span>
      <span style={{ color: accent ? `var(${accent})` : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
        {v}
      </span>
    </div>
  );
}

function TierBadge({ tier }) {
  const cfg = {
    kernel:  { label: 'Python Kernel', color: '#f59e0b',             icon: FlaskConical },
    wasm:    { label: 'HiGHS WASM',    color: 'var(--primary)',       icon: Cpu },
    pyodide: { label: 'Pyodide',       color: '#3b82f6',              icon: Zap },
    edge:    { label: 'Edge',          color: '#a855f7',              icon: Wifi },
    main:    { label: 'GLPK',          color: 'var(--text-muted)',    icon: null },
  }[tier] || { label: tier, color: 'var(--text-muted)', icon: null };

  const Icon = cfg.icon;
  return (
    <span className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded"
      style={{ background: `color-mix(in srgb, ${cfg.color} 15%, transparent)`, color: cfg.color }}>
      {Icon && <Icon className="w-2.5 h-2.5" />}
      {cfg.label}
    </span>
  );
}

// ── Connection status indicator ───────────────────────────────────────────────
function StatusDot({ status }) {
  const cfg = {
    [KernelStatus.CONNECTED]:    { color: '#22c55e', pulse: true },
    [KernelStatus.CONNECTING]:   { color: 'var(--reaction-color)', pulse: true },
    [KernelStatus.DISCONNECTED]: { color: 'var(--text-muted)', pulse: false },
    [KernelStatus.ERROR]:        { color: 'var(--danger)', pulse: false },
  }[status] || { color: 'var(--text-muted)', pulse: false };

  return (
    <span className="relative flex-shrink-0" style={{ width: 8, height: 8 }}>
      {cfg.pulse && (
        <span className="absolute inset-0 rounded-full animate-ping"
          style={{ background: cfg.color, opacity: 0.4 }} />
      )}
      <span className="absolute inset-0 rounded-full" style={{ background: cfg.color }} />
    </span>
  );
}

// ── Install instructions ──────────────────────────────────────────────────────
function InstallInstructions() {
  const [copied, setCopied] = useState('');
  const cmd = 'pip install metaboviz-kernel';
  const run = 'metaboviz-kernel start';

  const copyCmd = key => txt => {
    navigator.clipboard.writeText(txt);
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  };

  return (
    <div className="p-3 space-y-3 text-[10px]">
      <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
        FBA runs in-browser via HiGHS WASM or Pyodide (scipy). For full
        COBRApy access and faster FVA on large models, connect a local kernel.
        No data ever leaves your machine.
      </p>

      <div className="space-y-2">
        {[
          { key: 'install', label: '1. Install', cmd },
          { key: 'start', label: '2. Start kernel', cmd: run },
        ].map(({ key, label, cmd: c }) => (
          <div key={key}>
            <p className="text-[9px] uppercase tracking-widest mb-1"
              style={{ color: 'var(--text-muted)' }}>{label}</p>
            <div className="flex items-center gap-2 rounded px-2 py-1.5"
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
              <code className="flex-1 font-mono" style={{ color: 'var(--primary)' }}>{c}</code>
              <button onClick={() => copyCmd(key)(c)}
                className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
                style={{ color: 'var(--text-muted)' }}>
                {copied === key ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
        MetaboViz will connect automatically. For HTTPS pages, add{' '}
        <code style={{ color: 'var(--primary)' }}>--tls</code> and trust the certificate once.
      </p>
    </div>
  );
}

// ── Main KernelPanel ──────────────────────────────────────────────────────────
export default function KernelPanel({ onClose, cells: externalCells }) {
  const { currentModel } = useModel();
  const [status, setStatus] = useState(KernelStatus.DISCONNECTED);
  const [kernelInfo, setKernelInfo] = useState(null);
  const [pyodideStatus, setPyodideStatus] = useState('idle');
  const [expanded, setExpanded] = useState(true);
  const [cells, setCells] = useState([]);
  const [calibrating, setCalibrating] = useState(false);
  const bottomRef = useRef(null);

  // Sync external cells (from FBAPanel solves routed via kernel)
  useEffect(() => {
    if (externalCells?.length) setCells(externalCells);
  }, [externalCells]);

  useEffect(() => {
    const unsub = computeManager.kernelSolver.onStatusChange((s, info) => {
      setStatus(s);
      if (info) setKernelInfo(info);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = computeManager.onPyodideStatus(s => setPyodideStatus(s));
    return unsub;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [cells]);

  const activeTier = computeManager.activeTier;

  const runCalibration = async () => {
    if (calibrating) return;
    setCalibrating(true);
    const cellId = `calib_${Date.now()}`;
    const inputStr = 'tier_calibration.run()  # WASM FBA timing across 7 BiGG models';
    setCells(prev => [...prev, { id: cellId, input: inputStr, status: 'running', output: false }]);
    try {
      const report = await runTierCalibration((frac, msg) => {
        setCells(prev => prev.map(c =>
          c.id === cellId ? { ...c, progressMsg: `[${Math.round(frac * 100)}%] ${msg}` } : c
        ));
      });
      const text = formatReport(report);
      setCells(prev => prev.map(c =>
        c.id === cellId ? { ...c, status: 'optimal', output: true, calibReport: text, result: report } : c
      ));
    } catch (err) {
      setCells(prev => prev.map(c =>
        c.id === cellId ? { ...c, status: 'error', output: true, calibReport: err.message } : c
      ));
    } finally {
      setCalibrating(false);
    }
  };

  return (
    <div className="flex flex-col"
      style={{
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-color)',
        width: 340,
        minWidth: 340,
        maxHeight: '100%',
        overflow: 'hidden',
      }}>

      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-color)' }}>
        <Terminal className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
        <span className="text-xs font-bold flex-1"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
          Python Kernel
        </span>

        <StatusDot status={status} />
        <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
          {status === KernelStatus.CONNECTED ? 'Connected'
           : status === KernelStatus.CONNECTING ? 'Connecting…'
           : 'Disconnected'}
        </span>

        <div className="flex items-center gap-1 ml-1">
          <button
            onClick={runCalibration}
            disabled={calibrating}
            title="Calibrate WASM tier threshold"
            className="p-0.5 rounded hover:bg-[var(--bg-primary)] transition-colors disabled:opacity-40"
            style={{ color: 'var(--text-muted)' }}>
            <Gauge className={`w-3.5 h-3.5 ${calibrating ? 'animate-pulse' : ''}`} />
          </button>
          <button onClick={() => setExpanded(v => !v)}
            className="p-0.5 rounded hover:bg-[var(--bg-primary)] transition-colors"
            style={{ color: 'var(--text-muted)' }}>
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col overflow-hidden flex-1">

          {/* ── Tier status bar ── */}
          <div className="px-3 py-1.5 flex-shrink-0 space-y-1"
            style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                Active tier:
              </span>
              <TierBadge tier={activeTier} />
              {currentModel && (
                <span className="text-[9px] ml-auto" style={{ color: 'var(--text-muted)' }}>
                  {Object.keys(currentModel.reactions || {}).length} rxns
                </span>
              )}
            </div>
            {/* Pyodide loading progress */}
            {pyodideStatus === 'loading' && (
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full border border-t-transparent animate-spin"
                  style={{ borderColor: '#3b82f6', borderTopColor: 'transparent' }} />
                <span className="text-[9px]" style={{ color: '#3b82f6' }}>
                  Pyodide loading…
                </span>
              </div>
            )}
            {pyodideStatus === 'ready' && activeTier !== 'pyodide' && (
              <div className="flex items-center gap-1.5">
                <Zap className="w-2.5 h-2.5" style={{ color: '#3b82f6' }} />
                <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                  Pyodide ready (fallback)
                </span>
              </div>
            )}
          </div>

          {/* ── Kernel info (when connected) ── */}
          {status === KernelStatus.CONNECTED && kernelInfo && (
            <div className="px-3 py-2 flex-shrink-0 text-[9px] space-y-0.5"
              style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <div className="flex gap-2">
                <span>COBRApy</span>
                <code style={{ color: 'var(--primary)' }}>{kernelInfo.cobra_version || '—'}</code>
                <span className="ml-auto">kernel</span>
                <code style={{ color: 'var(--primary)' }}>{kernelInfo.version || '—'}</code>
              </div>
            </div>
          )}

          {/* ── Install instructions (when disconnected) ── */}
          {status !== KernelStatus.CONNECTED && (
            <div className="flex-shrink-0">
              <InstallInstructions />
            </div>
          )}

          {/* ── Notebook cells ── */}
          {cells.length > 0 && (
            <div className="flex-1 overflow-y-auto text-[10px]">
              {cells.map((cell, i) => (
                <NotebookCell key={cell.id || i} cell={cell} index={i} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}

          {cells.length === 0 && status === KernelStatus.CONNECTED && (
            <div className="flex-1 flex items-center justify-center p-4">
              <p className="text-center text-[10px]" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Run an analysis — results will appear here as notebook cells.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Hook: accumulate solve cells ──────────────────────────────────────────────
/**
 * useKernelCells — tracks analysis results as Jupyter-style cells.
 *
 * Usage:
 *   const { cells, addCell, updateCell } = useKernelCells();
 *   // pass cells to <KernelPanel cells={cells} />
 *   // call addCell/updateCell around compute() calls
 */
export function useKernelCells() {
  const [cells, setCells] = useState([]);

  // Upsert: insert if id is new, merge patch if id exists.
  // FBAPanel emits full cell objects with a stable id for both
  // the "running" placeholder and the final result.
  const onCellAdded = useCallback((cellPatch) => {
    setCells(prev => {
      const idx = prev.findIndex(c => c.id === cellPatch.id);
      if (idx >= 0) {
        return prev.map((c, i) => (i === idx ? { ...c, ...cellPatch } : c));
      }
      return [...prev, cellPatch];
    });
  }, []);

  return { cells, onCellAdded };
}
