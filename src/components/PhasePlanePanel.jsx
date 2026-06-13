/**
 * PhasePlanePanel — Two-parameter phenotypic phase plane analysis
 * Edwards et al. (2001) Biotechnol Bioeng 77:27-36
 */
import React, { useState, useCallback, useRef } from 'react';
import { X, Play, Square, Download, BarChart2 } from 'lucide-react';
import { useModel } from '../contexts/ModelContext';
import { compute } from '../lib/ComputeWorker';

function getExchangeRxns(model) {
  if (!model?.reactions) return [];
  return Object.entries(model.reactions)
    .filter(([id]) => /^(EX_|R_EX_|DM_|SINK_)/i.test(id))
    .map(([id, rxn]) => ({ id, name: rxn.name || id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function heatColor(val, maxVal) {
  if (val == null || maxVal < 1e-9) return '#d1d5db';
  const t = Math.max(0, Math.min(1, val / maxVal));
  const r = Math.round(220 - 180 * t);
  const g = Math.round(50  + 150 * t);
  return `rgb(${r},${g},60)`;
}

export default function PhasePlanePanel({ onClose }) {
  const { currentModel } = useModel();
  const exRxns = getExchangeRxns(currentModel);

  const [rxnX, setRxnX]   = useState(() => exRxns.find(r => /glc/i.test(r.id))?.id || exRxns[0]?.id || '');
  const [rxnY, setRxnY]   = useState(() => exRxns.find(r => /o2/i.test(r.id))?.id  || exRxns[1]?.id || '');
  const [xMin, setXMin]   = useState(-20);
  const [xMax, setXMax]   = useState(0);
  const [yMin, setYMin]   = useState(-20);
  const [yMax, setYMax]   = useState(0);
  const [gridN, setGridN] = useState(10);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [grid, setGrid]   = useState(null);
  const [hovered, setHovered] = useState(null);
  const cancelRef = useRef(false);

  const run = useCallback(async () => {
    if (!currentModel || !rxnX || !rxnY) return;
    setRunning(true); setProgress(0); setGrid(null);
    cancelRef.current = false;

    const n = gridN;
    const xVals = Array.from({ length: n }, (_, i) => xMin + i * (xMax - xMin) / Math.max(1, n - 1));
    const yVals = Array.from({ length: n }, (_, i) => yMin + i * (yMax - yMin) / Math.max(1, n - 1));
    const cells = [];
    let done = 0;

    for (let yi = 0; yi < n; yi++) {
      const row = [];
      for (let xi = 0; xi < n; xi++) {
        if (cancelRef.current) { row.push(null); continue; }
        const res = await compute('fba', currentModel, {
          constraints: {
            [rxnX]: { lb: xVals[xi], ub: 1000 },
            [rxnY]: { lb: yVals[yi], ub: 1000 },
          },
        });
        row.push(res.status === 'optimal' ? res.objectiveValue : null);
        done++;
      }
      cells.push(row);
      setProgress(Math.round(done / (n * n) * 100));
    }

    const flat = cells.flat().filter(v => v != null);
    const maxVal = flat.length ? Math.max(...flat) : 0;
    setGrid({ cells, xVals, yVals, maxVal, rxnX, rxnY, n });
    setRunning(false);
  }, [currentModel, rxnX, rxnY, xMin, xMax, yMin, yMax, gridN]);

  const exportCSV = () => {
    if (!grid) return;
    const header = [`${grid.rxnX}\\${grid.rxnY}`, ...grid.yVals.map(v => v.toFixed(2))];
    const rows = grid.cells.map((row, xi) => [
      grid.xVals[xi].toFixed(2), ...row.map(v => v?.toFixed(6) ?? 'inf'),
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `phase_plane_${grid.rxnX}_vs_${grid.rxnY}.csv`;
    a.click();
  };

  const CELL = grid ? Math.max(18, Math.min(44, Math.floor(380 / grid.n))) : 36;

  const labelInterval = n => Math.max(1, Math.ceil(n / 6));

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <BarChart2 className="w-4 h-4" style={{ color: 'var(--primary)' }} />
        <span className="font-bold text-[var(--text-primary)]">Phenotypic Phase Plane</span>
        <span className="text-xs text-[var(--text-muted)] ml-1">Two-parameter robustness analysis</span>
        <div className="ml-auto flex items-center gap-2">
          {grid && !running && (
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
            : <button onClick={run} disabled={!currentModel || !rxnX || !rxnY}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white rounded disabled:opacity-40"
                style={{ background: 'var(--primary)', borderRadius: 3 }}>
                <Play className="w-3 h-3" fill="currentColor" />Compute
              </button>
          }
          <button onClick={onClose} className="p-1.5 rounded hover:bg-[var(--bg-primary)] text-[var(--text-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 px-5 py-4 border-b border-[var(--border-color)] flex flex-wrap gap-8"
        style={{ background: 'var(--bg-secondary)' }}>
        {/* X axis */}
        <div className="flex flex-col gap-2">
          <label className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">X axis reaction</label>
          <select value={rxnX} onChange={e => setRxnX(e.target.value)}
            className="px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono outline-none w-52">
            {exRxns.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] w-6">Min</span>
            <input type="number" value={xMin} onChange={e => setXMin(+e.target.value)}
              className="w-16 px-1.5 py-0.5 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono outline-none" />
            <span className="text-[10px] text-[var(--text-muted)] w-6">Max</span>
            <input type="number" value={xMax} onChange={e => setXMax(+e.target.value)}
              className="w-16 px-1.5 py-0.5 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono outline-none" />
          </div>
        </div>

        {/* Y axis */}
        <div className="flex flex-col gap-2">
          <label className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Y axis reaction</label>
          <select value={rxnY} onChange={e => setRxnY(e.target.value)}
            className="px-2 py-1 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono outline-none w-52">
            {exRxns.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] w-6">Min</span>
            <input type="number" value={yMin} onChange={e => setYMin(+e.target.value)}
              className="w-16 px-1.5 py-0.5 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono outline-none" />
            <span className="text-[10px] text-[var(--text-muted)] w-6">Max</span>
            <input type="number" value={yMax} onChange={e => setYMax(+e.target.value)}
              className="w-16 px-1.5 py-0.5 text-xs rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono outline-none" />
          </div>
        </div>

        {/* Grid */}
        <div className="flex flex-col gap-2">
          <label className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Grid resolution</label>
          <div className="flex gap-1">
            {[5, 8, 10, 15].map(n => (
              <button key={n} onClick={() => setGridN(n)}
                className="px-2 py-1 text-[10px] rounded border font-mono"
                style={{
                  borderColor: gridN === n ? 'var(--primary)' : 'var(--border-color)',
                  background:  gridN === n ? 'var(--primary)' : 'transparent',
                  color:       gridN === n ? '#fff' : 'var(--text-muted)',
                }}>
                {n}×{n}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-[var(--text-muted)]">{gridN * gridN} FBA solves</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        {!currentModel && <p className="text-sm text-amber-600">No model loaded</p>}

        {running && (
          <div className="flex flex-col items-center gap-4 py-16">
            <div className="w-64 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-color)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--primary)' }} />
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              {Math.round(progress / 100 * gridN * gridN)}/{gridN * gridN} solves ({progress}%)
            </p>
          </div>
        )}

        {!grid && !running && currentModel && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--text-muted)]">
            <BarChart2 className="w-10 h-10 opacity-20" />
            <p className="text-sm font-medium">
              Select reactions and click <span className="font-bold text-[var(--text-primary)]">Compute</span>
            </p>
            <p className="text-xs max-w-sm text-center leading-relaxed">
              The phase plane maps growth rate across combinations of two uptake fluxes,
              revealing phenotypic trade-offs and optimal operating regions (Edwards et al. 2001).
            </p>
          </div>
        )}

        {grid && !running && (
          <div className="flex gap-10 items-start">
            {/* Heatmap */}
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3 text-center">
                Growth rate (h⁻¹)
              </p>
              <div className="flex gap-2">
                {/* Y-axis labels */}
                <div className="flex flex-col justify-between items-end pr-1 text-[8px] font-mono text-[var(--text-muted)]"
                  style={{ height: grid.n * (CELL + 2) }}>
                  {[...grid.yVals].reverse().map((v, i) => (
                    <span key={i} style={{ visibility: i % labelInterval(grid.n) === 0 ? 'visible' : 'hidden' }}>
                      {v.toFixed(0)}
                    </span>
                  ))}
                </div>

                <div>
                  {/* Rows: Y from high (top) to low (bottom) */}
                  {[...grid.cells].reverse().map((row, yi_inv) => {
                    const yi = grid.n - 1 - yi_inv;
                    return (
                      <div key={yi_inv} className="flex" style={{ gap: 2, marginBottom: 2 }}>
                        {row.map((val, xi) => {
                          const isHov = hovered?.xi === xi && hovered?.yi === yi;
                          return (
                            <div key={xi}
                              onMouseEnter={() => setHovered({ xi, yi, val, x: grid.xVals[xi], y: grid.yVals[yi] })}
                              onMouseLeave={() => setHovered(null)}
                              style={{
                                width: CELL, height: CELL,
                                background: heatColor(val, grid.maxVal),
                                borderRadius: 2,
                                border: isHov ? '1.5px solid var(--text-primary)' : '1.5px solid transparent',
                                cursor: 'crosshair',
                              }}
                              title={`${grid.rxnX}=${grid.xVals[xi].toFixed(2)}, ${grid.rxnY}=${grid.yVals[yi].toFixed(2)}: μ=${val?.toFixed(4) ?? 'inf'}`}
                            />
                          );
                        })}
                      </div>
                    );
                  })}

                  {/* X-axis labels */}
                  <div className="flex mt-1" style={{ gap: 2 }}>
                    {grid.xVals.map((v, i) => (
                      <div key={i} style={{ width: CELL }}
                        className="text-center text-[8px] font-mono text-[var(--text-muted)] overflow-hidden">
                        {i % labelInterval(grid.n) === 0 ? v.toFixed(0) : ''}
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mt-1 text-center">
                    {grid.rxnX} (mmol·gDW⁻¹·h⁻¹)
                  </p>
                </div>
              </div>
              <p className="text-[9px] text-[var(--text-muted)] mt-2 text-right" style={{ writingMode: 'initial' }}>
                ↑ {grid.rxnY}
              </p>
            </div>

            {/* Legend + hover info + stats */}
            <div className="flex flex-col gap-5 min-w-[160px]">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">Colour scale</p>
                <div className="w-28 h-3 rounded" style={{ background: 'linear-gradient(to right, #dc3c3c, #f59e0b, #16a34a)' }} />
                <div className="flex justify-between text-[9px] font-mono text-[var(--text-muted)] mt-0.5 w-28">
                  <span>0</span><span>{grid.maxVal.toFixed(3)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <div className="w-3 h-3 rounded" style={{ background: '#d1d5db' }} />
                  <span className="text-[9px] text-[var(--text-muted)]">Infeasible</span>
                </div>
              </div>

              {hovered && (
                <div className="p-2.5 rounded border border-[var(--border-color)] text-[10px] font-mono"
                  style={{ background: 'var(--bg-secondary)' }}>
                  <div className="text-[var(--text-muted)] mb-1 font-sans font-semibold text-[9px] uppercase tracking-wide">Cursor</div>
                  <div className="text-[var(--text-secondary)]">{grid.rxnX.slice(0, 16)} = {hovered.x.toFixed(2)}</div>
                  <div className="text-[var(--text-secondary)]">{grid.rxnY.slice(0, 16)} = {hovered.y.toFixed(2)}</div>
                  <div className="font-bold mt-1"
                    style={{ color: hovered.val != null ? 'var(--primary)' : '#9333ea' }}>
                    μ = {hovered.val != null ? hovered.val.toFixed(4) + ' h⁻¹' : 'infeasible'}
                  </div>
                </div>
              )}

              {(() => {
                const flat = grid.cells.flat();
                const feasible = flat.filter(v => v != null);
                const mean = feasible.length
                  ? feasible.reduce((s, v) => s + v, 0) / feasible.length : 0;
                return (
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">Summary</p>
                    {[
                      ['Max μ',   `${grid.maxVal.toFixed(4)} h⁻¹`],
                      ['Mean μ',  `${mean.toFixed(4)} h⁻¹`],
                      ['Feasible', `${feasible.length}/${flat.length}`],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between text-[10px] py-0.5 border-b border-[var(--border-color)]">
                        <span className="text-[var(--text-muted)]">{k}</span>
                        <span className="font-mono font-semibold text-[var(--text-primary)]">{v}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-5 py-2 border-t border-[var(--border-color)] text-[10px] text-[var(--text-muted)]">
        Reference: Edwards JS, Ramakrishna R, Palsson BØ (2001) Characterizing the metabolic phenotype: a phenotype phase plane analysis. Biotechnol Bioeng 77:27–36 ·
        Each cell = one FBA solve with lower bounds set to the specified uptake rates
      </div>
    </div>
  );
}
