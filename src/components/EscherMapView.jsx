import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  ecoliCentralCarbon,
  glycolysisTemplate,
  tcaCycleTemplate,
  pentosePhosphateTemplate,
} from '../data/pathwayTemplates';
import { parseEscherMap } from '../lib/EscherParser';

const LOCAL_TEMPLATES = [
  { id: 'ecoli_central_carbon', label: 'E. coli Central Carbon', template: ecoliCentralCarbon },
  { id: 'glycolysis',           label: 'Glycolysis',              template: glycolysisTemplate  },
  { id: 'tca_cycle',            label: 'TCA Cycle',               template: tcaCycleTemplate    },
  { id: 'ppp',                  label: 'Pentose Phosphate',       template: pentosePhosphateTemplate },
];

const BIGG_MAPS = [
  { value: 'e_coli_core.Core metabolism',        label: '↓ E. coli Core (BiGG)'       },
  { value: 'iJO1366.Central metabolism',          label: '↓ E. coli iJO1366 (BiGG)'    },
  { value: 'iMM904.Central carbon metabolism',    label: '↓ S. cerevisiae iMM904 (BiGG)' },
];

const FLUX_TOL = 1e-6;
const PADDING  = 70;

/* ─── colour / width helpers ─────────────────────────────────────────────── */

function edgeColor(flux, phenotype, rxnId, isDark) {
  if (phenotype) {
    const { wt, ko } = phenotype;
    const wtV = wt?.fluxes?.[rxnId];
    const koV = ko?.fluxes?.[rxnId];
    const wtA = wtV !== undefined && Math.abs(wtV) > FLUX_TOL;
    const koA = koV !== undefined && Math.abs(koV) > FLUX_TOL;
    if (wtA && !koA) return '#ef4444';
    if (!wtA && koA) return '#8b5cf6';
    if (wtA && koA && Math.abs(koV) < Math.abs(wtV) * 0.5) return '#f97316';
    if (wtA && koA)  return '#22c55e';
    return isDark ? '#1f2937' : '#e2e8f0';
  }
  if (flux === undefined) return isDark ? '#4b5563' : '#94a3b8';
  if (flux >  FLUX_TOL)  return '#22c55e';
  if (flux < -FLUX_TOL)  return '#f97316';
  return isDark ? '#1f2937' : '#e2e8f0';
}

function edgeWidth(flux) {
  if (flux === undefined) return 2;
  return Math.min(6, 2 + Math.abs(flux) * 0.1);
}

/* ─── bounding-box helper ─────────────────────────────────────────────────── */

function computeBBox(nodes) {
  if (!nodes || nodes.length === 0) return { minX: 0, minY: 0, maxX: 600, maxY: 450 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  });
  return { minX, minY, maxX, maxY };
}

/* ─── bezier helpers ──────────────────────────────────────────────────────── */

// Quadratic bezier: point + tangent at t
function qbez(x1, y1, cx, cy, x2, y2, t) {
  const mt = 1 - t;
  return {
    x:  mt*mt*x1 + 2*mt*t*cx + t*t*x2,
    y:  mt*mt*y1 + 2*mt*t*cy + t*t*y2,
    tx: 2*mt*(cx - x1) + 2*t*(x2 - cx),
    ty: 2*mt*(cy - y1) + 2*t*(y2 - cy),
  };
}

// Cubic bezier: point + tangent at t
function cbez(x1, y1, b1x, b1y, b2x, b2y, x2, y2, t) {
  const mt = 1 - t;
  return {
    x:  mt*mt*mt*x1 + 3*mt*mt*t*b1x + 3*mt*t*t*b2x + t*t*t*x2,
    y:  mt*mt*mt*y1 + 3*mt*mt*t*b1y + 3*mt*t*t*b2y + t*t*t*y2,
    tx: 3*mt*mt*(b1x - x1) + 6*mt*t*(b2x - b1x) + 3*t*t*(x2 - b2x),
    ty: 3*mt*mt*(b1y - y1) + 6*mt*t*(b2y - b1y) + 3*t*t*(y2 - b2y),
  };
}

/* ─── SVG primitives ─────────────────────────────────────────────────────── */

function Arrow({ x, y, tx, ty, color }) {
  const angle = Math.atan2(ty, tx) * 180 / Math.PI;
  return (
    <polygon
      points="-7,-3.5 0,0 -7,3.5"
      fill={color}
      transform={`translate(${x},${y}) rotate(${angle})`}
    />
  );
}

function EdgeLabel({ x, y, text, isDark }) {
  if (!text) return null;
  const w = text.length * 5.8 + 6;
  return (
    <g>
      <rect
        x={x - w / 2} y={y + 5}
        width={w} height={13}
        rx={3}
        fill={isDark ? '#1e293b' : '#ffffff'}
        fillOpacity={0.93}
        stroke="var(--card-border)"
        strokeWidth={0.5}
      />
      <text
        x={x} y={y + 13.5}
        textAnchor="middle" fontSize={8.5} fill="var(--text-secondary)"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {text}
      </text>
    </g>
  );
}

/* ─── Local-template edge (quadratic bezier, auto-arched) ────────────────── */

function LocalEdge({ edge, fromNode, toNode, fluxVal, phenotype, isDark, edgeIdx, showLabel }) {
  if (!fromNode || !toNode) return null;
  const { x: x1, y: y1 } = fromNode;
  const { x: x2, y: y2 } = toNode;

  const rxnId = edge.reaction || '';
  const col   = edgeColor(fluxVal, phenotype, rxnId, isDark);
  const sw    = edgeWidth(fluxVal);

  // Perpendicular arch — alternate side per edge index for visual variety
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;                   // unit perp
  const sign = edgeIdx % 2 === 0 ? 1 : -1;
  const arch = Math.min(50, len * 0.22) * sign;

  // Quadratic bezier control point (actual arch at midpoint ≈ arch/2)
  const cpx = (x1 + x2) / 2 + px * arch * 2;
  const cpy = (y1 + y2) / 2 + py * arch * 2;
  const path = `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;

  const mid = qbez(x1, y1, cpx, cpy, x2, y2, 0.5);   // reaction dot
  const arr = qbez(x1, y1, cpx, cpy, x2, y2, 0.80);  // arrowhead

  return (
    <g opacity={0.9}>
      <path d={path} fill="none" stroke={col} strokeWidth={sw} />
      {/* Reaction midpoint dot */}
      <circle
        cx={mid.x} cy={mid.y} r={4}
        fill={col}
        stroke={isDark ? '#0f172a' : '#ffffff'}
        strokeWidth={1}
      />
      <Arrow x={arr.x} y={arr.y} tx={arr.tx} ty={arr.ty} color={col} />
      {showLabel && (
        <EdgeLabel x={mid.x} y={mid.y} text={edge.label} isDark={isDark} />
      )}
    </g>
  );
}

/* ─── Imported Escher JSON edge (cubic bezier) ───────────────────────────── */

function EscherSegmentEdge({ edge, fluxVal, phenotype, isDark, showLabel }) {
  const x1 = edge.fromX, y1 = edge.fromY;
  const x2 = edge.toX,   y2 = edge.toY;
  if (x1 === undefined || x2 === undefined) return null;

  const rxnId = edge.reactionId || '';
  const col   = edgeColor(fluxVal, phenotype, rxnId, isDark);
  const sw    = edgeWidth(fluxVal);

  let path, arr, mid;
  if (edge.bezier) {
    const { b1x, b1y, b2x, b2y } = edge.bezier;
    path = `M ${x1} ${y1} C ${b1x} ${b1y} ${b2x} ${b2y} ${x2} ${y2}`;
    arr  = cbez(x1, y1, b1x, b1y, b2x, b2y, x2, y2, 0.80);
    mid  = cbez(x1, y1, b1x, b1y, b2x, b2y, x2, y2, 0.50);
  } else {
    path = `M ${x1} ${y1} L ${x2} ${y2}`;
    const t = 0.80;
    arr  = { x: x1 + t*(x2-x1), y: y1 + t*(y2-y1), tx: x2-x1, ty: y2-y1 };
    mid  = { x: (x1+x2)/2, y: (y1+y2)/2 };
  }

  return (
    <g opacity={0.9}>
      <path d={path} fill="none" stroke={col} strokeWidth={sw} />
      <Arrow x={arr.x} y={arr.y} tx={arr.tx} ty={arr.ty} color={col} />
      {showLabel && (
        <EdgeLabel x={mid.x} y={mid.y} text={edge.label || edge.reactionId} isDark={isDark} />
      )}
    </g>
  );
}

/* ─── Metabolite / special node shapes ──────────────────────────────────── */

function MetNode({ node, isDark }) {
  const fill   = isDark ? '#1e293b' : '#f8fafc';
  const stroke = isDark ? '#64748b' : '#64748b';

  if (node.type === 'biomass') {
    const s = 16;
    const pts = Array.from({ length: 8 }, (_, i) => {
      const a = i * Math.PI / 4 - Math.PI / 2;
      const r = i % 2 === 0 ? s : s * 0.4;
      return `${node.x + r * Math.cos(a)},${node.y + r * Math.sin(a)}`;
    }).join(' ');
    return <polygon points={pts} fill="#f59e0b" stroke="#d97706" strokeWidth={1.5} />;
  }

  if (node.type === 'exchange') {
    return (
      <circle cx={node.x} cy={node.y} r={10}
        fill={fill} stroke={stroke} strokeWidth={1.5} strokeDasharray="4,3" />
    );
  }

  const r = node.type === 'cofactor' ? 9 : 14;
  return (
    <circle cx={node.x} cy={node.y} r={r}
      fill={fill} stroke={stroke} strokeWidth={1.8} />
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export default function EscherMapView({ fluxes = {}, phenotype = null }) {
  const { isDark } = useTheme();
  const svgRef  = useRef(null);
  const dragRef = useRef(null);
  const fileRef = useRef(null);

  const [selectedId,  setSelectedId]  = useState('ecoli_central_carbon');
  const [customMap,   setCustomMap]   = useState(null);
  const [zoom,        setZoom]        = useState(1);
  const [pan,         setPan]         = useState({ x: 0, y: 0 });
  const [loading,     setLoading]     = useState(false);
  const [fetchError,  setFetchError]  = useState(null);

  const isEscher = customMap !== null;
  const localTpl = LOCAL_TEMPLATES.find(t => t.id === selectedId)?.template || ecoliCentralCarbon;
  const activeMap = isEscher ? customMap : localTpl;

  const nodes       = activeMap.nodes       || [];
  const edges       = activeMap.edges       || [];
  const annotations = activeMap.annotations || activeMap.textLabels || [];

  // Node lookup (both modes)
  const nodeById = {};
  nodes.forEach(n => { nodeById[n.id] = n; });

  // Visible nodes (skip routing markers in imported Escher maps)
  const visibleNodes = isEscher
    ? nodes.filter(n => n.type === 'metabolite' || n.type === 'cofactor')
    : nodes;

  /* ── fit / zoom ─────────────────────────────────────────────────────────── */

  const fitToScreen = useCallback(() => {
    if (!svgRef.current) return;
    const { width: W, height: H } = svgRef.current.getBoundingClientRect();
    const fitNodes = isEscher ? nodes.filter(n => n.type !== 'marker') : nodes;
    const bb = computeBBox(fitNodes);
    if (!isFinite(bb.minX)) return;
    const cW = bb.maxX - bb.minX + PADDING * 2;
    const cH = bb.maxY - bb.minY + PADDING * 2;
    const z  = Math.min((W || 800) / cW, (H || 600) / cH, 3);
    const px = (W || 800) / 2 - ((bb.minX + bb.maxX) / 2) * z;
    const py = (H || 600) / 2 - ((bb.minY + bb.maxY) / 2) * z;
    setZoom(z);
    setPan({ x: px, y: py });
  }, [nodes, isEscher]);

  useLayoutEffect(() => { fitToScreen(); }, [activeMap, fitToScreen]);

  /* ── passive wheel (fixes console warning) ─────────────────────────────── */

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      setZoom(z => Math.min(10, Math.max(0.05, z * (e.deltaY > 0 ? 0.9 : 1.1))));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  /* ── pan (mouse drag) ───────────────────────────────────────────────────── */

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX - pan.x, startY: e.clientY - pan.y };
  }, [pan]);

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    setPan({ x: e.clientX - dragRef.current.startX, y: e.clientY - dragRef.current.startY });
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  /* ── file import ────────────────────────────────────────────────────────── */

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      setCustomMap(parseEscherMap(json));
      setSelectedId('__escher__');
    } catch (err) {
      alert(`Failed to parse Escher map: ${err.message}`);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  /* ── BiGG fetch ─────────────────────────────────────────────────────────── */

  const loadBiGGMap = async (biggId) => {
    setLoading(true);
    setFetchError(null);
    try {
      const url = `https://escher.github.io/1-0-0/6/maps/Escher%20Maps/${encodeURIComponent(biggId)}.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setCustomMap(parseEscherMap(json));
      setSelectedId('__escher__');
    } catch (err) {
      setFetchError(`Could not load BiGG map: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  /* ── pre-compute label deduplication (avoid side-effects during render) ── */

  const labelSeen = new Set();
  const edgesTagged = edges.map((e, i) => {
    const rxnId  = isEscher ? (e.reactionId || '') : (e.reaction || '');
    const lk     = `${rxnId}::${e.label || e.reactionId || ''}`;
    const showLabel = !!(e.label || e.reactionId) && !labelSeen.has(lk);
    if (showLabel) labelSeen.add(lk);
    return { edge: e, idx: i, rxnId, showLabel };
  });

  const hasPhenotype = !!(phenotype?.wt && phenotype?.ko);

  /* ── render ─────────────────────────────────────────────────────────────── */

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex-shrink-0 flex-wrap">
        <select
          value={selectedId}
          onChange={e => {
            const val = e.target.value;
            if (val === '__file__') {
              fileRef.current?.click();
            } else if (val.startsWith('__bigg__')) {
              loadBiGGMap(val.slice(8));
            } else {
              setSelectedId(val);
              setCustomMap(null);
              setFetchError(null);
            }
          }}
          className="text-xs px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none"
        >
          <optgroup label="Built-in Templates">
            {LOCAL_TEMPLATES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </optgroup>
          <optgroup label="BiGG / Escher (online)">
            {BIGG_MAPS.map(m => (
              <option key={m.value} value={`__bigg__${m.value}`}>{m.label}</option>
            ))}
          </optgroup>
          <optgroup label="Import">
            {isEscher && (
              <option value="__escher__">{customMap?.name || 'Imported Map'}</option>
            )}
            <option value="__file__">+ Load Escher JSON…</option>
          </optgroup>
        </select>
        <input ref={fileRef} type="file" accept=".json" onChange={handleFileUpload} className="hidden" />

        <div className="w-px self-stretch bg-[var(--border-color)] mx-1" />

        <button
          onClick={fitToScreen}
          className="px-2 py-1 text-xs rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors"
        >
          Fit
        </button>
        <button
          onClick={() => setZoom(z => Math.min(10, z * 1.3))}
          className="w-7 h-7 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] flex items-center justify-center font-bold text-sm"
        >
          +
        </button>
        <button
          onClick={() => setZoom(z => Math.max(0.05, z / 1.3))}
          className="w-7 h-7 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] flex items-center justify-center font-bold text-sm"
        >
          −
        </button>

        <div className="flex-1" />

        {/* Legend */}
        <div className="flex items-center gap-3 text-[9px] text-[var(--text-muted)]">
          {hasPhenotype ? (
            [['#ef4444','Lost'],['#8b5cf6','Gained'],['#f97316','Reduced'],['#22c55e','Active']].map(([c,l]) => (
              <span key={l} className="flex items-center gap-1">
                <span className="w-3 h-2 rounded inline-block" style={{ background: c }} />{l}
              </span>
            ))
          ) : (
            <>
              <span className="flex items-center gap-1">
                <span className="w-3 h-2 rounded inline-block" style={{ background: '#22c55e' }} />Fwd
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-2 rounded inline-block" style={{ background: '#f97316' }} />Rev
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-2 rounded inline-block" style={{ background: isDark ? '#374151' : '#e2e8f0', border: '1px solid #aaa' }} />Blocked
              </span>
            </>
          )}
        </div>
      </div>

      {/* Fetch error */}
      {fetchError && (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 flex-shrink-0">
          {fetchError}
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)] bg-opacity-80 z-10 text-sm text-[var(--text-secondary)]">
            Loading BiGG map…
          </div>
        )}

        <svg
          ref={svgRef}
          className="w-full h-full"
          style={{ cursor: 'grab', display: 'block' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

            {/* Edges (drawn under nodes) */}
            {isEscher
              ? edgesTagged.map(({ edge: e, idx, rxnId, showLabel }) => (
                  <EscherSegmentEdge
                    key={e.id || idx}
                    edge={e}
                    fluxVal={fluxes[rxnId]}
                    phenotype={hasPhenotype ? phenotype : null}
                    isDark={isDark}
                    showLabel={showLabel}
                  />
                ))
              : edgesTagged.map(({ edge: e, idx, rxnId, showLabel }) => (
                  <LocalEdge
                    key={idx}
                    edge={e}
                    fromNode={nodeById[e.from]}
                    toNode={nodeById[e.to]}
                    fluxVal={fluxes[rxnId]}
                    phenotype={hasPhenotype ? phenotype : null}
                    isDark={isDark}
                    edgeIdx={idx}
                    showLabel={showLabel}
                  />
                ))
            }

            {/* Metabolite nodes */}
            {visibleNodes.map((n, i) => (
              <g key={n.id || i}>
                <MetNode node={n} isDark={isDark} />
                <text
                  x={n.labelX ?? n.x}
                  y={n.labelY ?? (n.y + (n.type === 'biomass' ? 24 : n.type === 'exchange' ? 15 : 19))}
                  textAnchor="middle"
                  fontSize={n.type === 'cofactor' ? 8 : 9.5}
                  fontWeight={n.type === 'biomass' ? '700' : '500'}
                  fill="var(--text-primary)"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {(n.label || n.name || '').slice(0, 18)}
                </text>
              </g>
            ))}

            {/* Section annotations */}
            {annotations.map((a, i) => (
              <text
                key={i}
                x={a.x} y={a.y}
                fontSize={a.fontSize || 14}
                fill={a.color || 'var(--primary)'}
                fontWeight="700"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {a.text}
              </text>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}
