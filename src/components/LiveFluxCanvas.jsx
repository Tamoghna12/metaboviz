/**
 * LiveFluxCanvas — animated metabolic flux profile viewer
 *
 * Clustered layout: reactions grouped into subsystem zones.
 * Labels always visible at zoom >0.35. Flux values on nodes at zoom >0.55.
 * Pan/zoom, click-to-select, hover tooltips, search highlight.
 * Particle animation tracks FBA flux magnitudes in real time.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { RefreshCw, X, ChevronLeft, Search } from 'lucide-react';
import { useModel } from '../contexts/ModelContext';
import { compute } from '../lib/ComputeWorker';

// ── Okabe-Ito palette (colorblind-safe, Nature Methods standard) ──────────────
const HUB_IDS = new Set([
  'atp','adp','amp','nad','nadh','nadp','nadph','h2o','h','pi','ppi','co2','o2','coa',
  'fad','fadh2','gtp','gdp','atp_c','adp_c','amp_c','nad_c','nadh_c','nadp_c','nadph_c',
  'h2o_c','h2o_e','h_c','h_e','h_p','pi_c','ppi_c','co2_c','co2_e','o2_c','o2_e',
  'coa_c','fad_c','fadh2_c','gtp_c','gdp_c',
]);

// [keyword fragments] → [fill color, light tint for zone bg]
const SUBSYS_MAP = [
  [['glycolysis','gluconeogenesis','glycolytic'], '#E69F00', '#fff8e6'],
  [['tca','citric','krebs'],                      '#009E73', '#e6f7f2'],
  [['pentose','ppp'],                             '#CC79A7', '#fdf0f6'],
  [['oxidative','electron','atp syn'],            '#D55E00', '#fdf0eb'],
  [['transport'],                                 '#56B4E9', '#eef7fd'],
  [['amino'],                                     '#0072B2', '#e6f0f9'],
  [['nucleotide','purine','pyrimidine'],          '#8B6914', '#f5f0e3'],
  [['fatty','lipid','membrane'],                  '#CC79A7', '#fdf0f6'],
  [['cofactor','vitamin'],                        '#009E73', '#e6f7f2'],
];

function subsysColors(sub) {
  if (!sub) return { stroke: '#6b7280', bg: '#f3f4f6' };
  const sl = sub.toLowerCase();
  for (const [keys, stroke, bg] of SUBSYS_MAP) {
    if (keys.some(k => sl.includes(k))) return { stroke, bg };
  }
  let h = 0;
  for (let i = 0; i < sl.length; i++) h = (h * 31 + sl.charCodeAt(i)) % 360;
  return { stroke: `hsl(${h},55%,40%)`, bg: `hsl(${h},55%,95%)` };
}

// ── Clustered layout ──────────────────────────────────────────────────────────
const ZONE_PAD   = 10;
const ZONE_HDR   = 18;
const RXN_W      = 52;
const RXN_H      = 18;
const RXN_GAP_X  = 12;
const RXN_GAP_Y  = 14;

function buildClusteredLayout(reactions, showHubs, W, H) {
  // Group by subsystem
  const groups = {};
  Object.entries(reactions).forEach(([id, rxn]) => {
    const sub = rxn.subsystem || 'Other';
    if (!groups[sub]) groups[sub] = [];
    groups[sub].push(id);
  });

  const subs = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  // Assign zones: fill rows left→right, next row when width exhausted
  const ROW_H_MIN = 90;
  const MARGIN    = 10;
  const usableW   = W - MARGIN * 2;
  const usableH   = H - MARGIN * 2;

  // Estimate how many columns each subsystem needs
  const zonesWithSize = subs.map(([sub, ids]) => {
    const rxnPerCol = Math.max(1, Math.floor((ROW_H_MIN - ZONE_HDR - ZONE_PAD * 2) / (RXN_H + RXN_GAP_Y)));
    const cols = Math.ceil(ids.length / rxnPerCol);
    const zoneW = ZONE_PAD * 2 + cols * (RXN_W + RXN_GAP_X) - RXN_GAP_X;
    return { sub, ids, cols, zoneW };
  });

  // Pack zones into rows
  const rows = [];
  let currentRow = [], currentW = 0;
  zonesWithSize.forEach(z => {
    if (currentW + z.zoneW > usableW && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = []; currentW = 0;
    }
    currentRow.push(z);
    currentW += z.zoneW + MARGIN;
  });
  if (currentRow.length > 0) rows.push(currentRow);

  const nRows = rows.length;
  const rowH  = Math.max(ROW_H_MIN, Math.floor(usableH / nRows) - MARGIN);

  // Assign pixel rects to zones
  const zones = {};
  const rxnPos = {};

  rows.forEach((row, ri) => {
    const totalZoneW = row.reduce((s, z) => s + z.zoneW, 0) + (row.length - 1) * MARGIN;
    let x = MARGIN + Math.max(0, (usableW - totalZoneW) / 2);
    const y = MARGIN + ri * (rowH + MARGIN);

    row.forEach(z => {
      zones[z.sub] = { x, y, w: z.zoneW, h: rowH, sub: z.sub, ids: z.ids };

      // Place reactions in grid within zone
      const _innerW = z.zoneW - ZONE_PAD * 2;
      const innerH = rowH - ZONE_HDR - ZONE_PAD;
      const rxnPerCol = Math.max(1, Math.floor(innerH / (RXN_H + RXN_GAP_Y)));
      z.ids.forEach((id, i) => {
        const col = Math.floor(i / rxnPerCol);
        const row2 = i % rxnPerCol;
        rxnPos[id] = {
          x: x + ZONE_PAD + col * (RXN_W + RXN_GAP_X) + RXN_W / 2,
          y: y + ZONE_HDR + ZONE_PAD + row2 * (RXN_H + RXN_GAP_Y) + RXN_H / 2,
          sub: z.sub,
        };
      });

      x += z.zoneW + MARGIN;
    });
  });

  // Metabolite positions: centroid of connected reactions + small jitter
  const metConns = {};
  Object.entries(reactions).forEach(([rId, rxn]) => {
    Object.keys(rxn.metabolites || {}).forEach(mId => {
      if (!showHubs && HUB_IDS.has(mId)) return;
      if (!rxnPos[rId]) return;
      if (!metConns[mId]) metConns[mId] = [];
      metConns[mId].push(rxnPos[rId]);
    });
  });

  const metPos = {};
  const metIds = Object.keys(metConns);
  metIds.forEach((mId, i) => {
    const pts = metConns[mId];
    if (!pts?.length) return;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const angle = (i / Math.max(metIds.length, 1)) * Math.PI * 2;
    const r = 22;
    metPos[mId] = {
      x: Math.max(8, Math.min(W - 8, cx + Math.cos(angle) * r)),
      y: Math.max(8, Math.min(H - 8, cy + Math.sin(angle) * r)),
      comp: mId.split('_').pop() || 'c',
    };
  });

  // Edges
  const edges = [];
  Object.entries(reactions).forEach(([rId, rxn]) => {
    const rp = rxnPos[rId]; if (!rp) return;
    Object.entries(rxn.metabolites || {}).forEach(([mId, coef]) => {
      if (!showHubs && HUB_IDS.has(mId)) return;
      const mp = metPos[mId]; if (!mp) return;
      edges.push({
        key: `${rId}:${mId}`, rxnId: rId, metId: mId, coef,
        x1: coef < 0 ? mp.x : rp.x, y1: coef < 0 ? mp.y : rp.y,
        x2: coef < 0 ? rp.x : mp.x, y2: coef < 0 ? rp.y : mp.y,
        sub: rxn.subsystem,
      });
    });
  });

  return { mode: 'atomic', rxnPos, metPos, edges, zones };
}

function buildSubsystemLayout(reactions, W, H) {
  const groups = {};
  Object.entries(reactions).forEach(([id, rxn]) => {
    const sub = rxn.subsystem || 'Other';
    if (!groups[sub]) groups[sub] = { sub, ids: [] };
    groups[sub].ids.push(id);
  });
  const subs = Object.values(groups).sort((a, b) => b.ids.length - a.ids.length);
  const ns = subs.length;
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) * 0.36;
  const subsPos = {};
  subs.forEach((s, i) => {
    const a = (i / ns) * Math.PI * 2 - Math.PI / 2;
    const nodeR = 10 + Math.min(18, s.ids.length / 8);
    subsPos[s.sub] = { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, count: s.ids.length, ids: s.ids, sub: s.sub, nodeR, cx, cy };
  });

  // Build edges — skip hub metabolites (they falsely connect every subsystem to every other)
  const metSubs = {};
  Object.entries(reactions).forEach(([, rxn]) => {
    const sub = rxn.subsystem || 'Other';
    Object.keys(rxn.metabolites || {}).forEach(mId => {
      if (HUB_IDS.has(mId.replace(/_[cepmxn]$/, ''))) return; // exclude hubs
      if (!metSubs[mId]) metSubs[mId] = new Set();
      metSubs[mId].add(sub);
    });
  });
  const edgeSet = {};
  Object.entries(metSubs).forEach(([, sset]) => {
    const arr = [...sset];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const k = arr[i] < arr[j] ? `${arr[i]}|||${arr[j]}` : `${arr[j]}|||${arr[i]}`;
      edgeSet[k] = (edgeSet[k] || 0) + 1;
    }
  });

  // Keep only the top 20% strongest edges to reduce clutter
  const allWeights = Object.values(edgeSet).sort((a, b) => a - b);
  const threshold = allWeights[Math.floor(allWeights.length * 0.8)] ?? 1;

  const edges = Object.entries(edgeSet)
    .filter(([, w]) => w >= threshold)
    .map(([k, w]) => {
      const [sa, sb] = k.split('|||');
      const pa = subsPos[sa], pb = subsPos[sb];
      if (!pa || !pb) return null;
      return { key: k, sa, sb, x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, weight: w };
    }).filter(Boolean);

  return { mode: 'subsystem', subsPos, edges, cx, cy };
}

// ── Focused subsystem layout: spacious grid + repulsion ──────────────────────
function buildFocusedLayout(reactions, showHubs, W, H) {
  const rxnIds = Object.keys(reactions);
  const nRxns  = rxnIds.length;

  // Grid: pick column count so cells are roughly square
  const COLS   = Math.max(2, Math.min(6, Math.ceil(Math.sqrt(nRxns * (W / H)))));
  const ROWS   = Math.ceil(nRxns / COLS);
  const PAD    = 60;
  const cellW  = (W - PAD * 2) / COLS;
  const cellH  = (H - PAD * 2) / ROWS;

  const rxnPos = {};
  rxnIds.forEach((id, i) => {
    rxnPos[id] = {
      x: PAD + (i % COLS) * cellW + cellW / 2,
      y: PAD + Math.floor(i / COLS) * cellH + cellH / 2,
      sub: reactions[id]?.subsystem,
    };
  });

  // Metabolite positions: centroid of connected reactions + radial spread
  const metConns = {};
  Object.entries(reactions).forEach(([rId, rxn]) => {
    Object.keys(rxn.metabolites || {}).forEach(mId => {
      if (!showHubs && HUB_IDS.has(mId)) return;
      if (!rxnPos[rId]) return;
      if (!metConns[mId]) metConns[mId] = [];
      metConns[mId].push(rxnPos[rId]);
    });
  });

  const metPos  = {};
  const metIds  = Object.keys(metConns);
  const MET_R   = Math.min(100, Math.max(cellW, cellH) * 0.42);

  metIds.forEach((mId, i) => {
    const pts = metConns[mId];
    if (!pts?.length) return;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const angle = (i / Math.max(metIds.length, 1)) * Math.PI * 2;
    metPos[mId] = {
      x: Math.max(14, Math.min(W - 14, cx + Math.cos(angle) * MET_R)),
      y: Math.max(14, Math.min(H - 14, cy + Math.sin(angle) * MET_R)),
      comp: mId.split('_').pop() || 'c',
    };
  });

  // Repulsion pass: push overlapping metabolite nodes apart
  const MIN_D = 50;
  for (let iter = 0; iter < 40; iter++) {
    const arr = Object.values(metPos);
    for (let a = 0; a < arr.length; a++) {
      for (let b = a + 1; b < arr.length; b++) {
        const ap = arr[a], bp = arr[b];
        const dx = bp.x - ap.x, dy = bp.y - ap.y;
        const d  = Math.hypot(dx, dy);
        if (d < MIN_D && d > 0.01) {
          const push = (MIN_D - d) / 2 * 0.6;
          const ux = dx / d * push, uy = dy / d * push;
          ap.x = Math.max(14, Math.min(W - 14, ap.x - ux));
          ap.y = Math.max(14, Math.min(H - 14, ap.y - uy));
          bp.x = Math.max(14, Math.min(W - 14, bp.x + ux));
          bp.y = Math.max(14, Math.min(H - 14, bp.y + uy));
        }
      }
    }
  }

  // Edges
  const edges = [];
  Object.entries(reactions).forEach(([rId, rxn]) => {
    const rp = rxnPos[rId]; if (!rp) return;
    Object.entries(rxn.metabolites || {}).forEach(([mId, coef]) => {
      if (!showHubs && HUB_IDS.has(mId)) return;
      const mp = metPos[mId]; if (!mp) return;
      edges.push({
        key: `${rId}:${mId}`, rxnId: rId, metId: mId, coef,
        x1: coef < 0 ? mp.x : rp.x, y1: coef < 0 ? mp.y : rp.y,
        x2: coef < 0 ? rp.x : mp.x, y2: coef < 0 ? rp.y : mp.y,
        sub: rxn.subsystem,
      });
    });
  });

  return { mode: 'atomic', rxnPos, metPos, edges, zones: null };
}

function buildLayout(reactions, showHubs, W, H, focusSub) {
  const rxnIds = Object.keys(reactions);
  if (focusSub) {
    const filtered = {};
    rxnIds.forEach(id => { if ((reactions[id]?.subsystem || 'Other') === focusSub) filtered[id] = reactions[id]; });
    return buildFocusedLayout(filtered, showHubs, W, H);
  }
  if (rxnIds.length > 200) return buildSubsystemLayout(reactions, W, H);
  return buildClusteredLayout(reactions, showHubs, W, H);
}

// ── Hit test ─────────────────────────────────────────────────────────────────
const ESCHER_RXN_R = 9; // reaction node radius for hit-test + rendering

function hitTest(wx, wy, layout) {
  if (!layout) return null;
  if (layout.mode === 'atomic') {
    for (const [id, pos] of Object.entries(layout.rxnPos || {})) {
      if (Math.hypot(wx - pos.x, wy - pos.y) < ESCHER_RXN_R + 4)
        return { type: 'rxn', id };
    }
    for (const [id, pos] of Object.entries(layout.metPos || {})) {
      if (Math.hypot(wx - pos.x, wy - pos.y) < 10) return { type: 'met', id };
    }
  } else {
    for (const [sub, sp] of Object.entries(layout.subsPos || {})) {
      if (Math.hypot(wx - sp.x, wy - sp.y) < sp.nodeR + 14) return { type: 'sub', id: sub };
    }
  }
  return null;
}

// ── rrect ────────────────────────────────────────────────────────────────────
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function LiveFluxCanvas({ onClose }) {
  const { currentModel } = useModel();
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  const sizeRef   = useRef({ W: 900, H: 520 });
  const T         = useRef({ x: 0, y: 0, scale: 1 });
  const drag      = useRef(null);
  const hoverRef  = useRef(null);

  const S = useRef({
    layout: null, fluxes: {}, smooth: {}, maxFlux: 1,
    particles: {}, lastTs: 0,
    showHubs: false, speedMult: 1, modelRef: null, focusSub: null,
    selectedId: null, searchTerm: '',
  });

  const [status, setStatus]     = useState('idle');
  const [mu, setMu]             = useState(null);
  const [tier, setTier]         = useState(null);
  const [showHubs, _setShowHubs] = useState(false);
  const [speedMult, setSpeedMult] = useState(1);
  const [glcLb, setGlcLb]      = useState(-10);
  const [o2Lb, setO2Lb]        = useState(-20);
  const [focusSub, setFocusSub] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch]     = useState('');

  useEffect(() => { S.current.showHubs   = showHubs; }, [showHubs]);
  useEffect(() => { S.current.speedMult  = speedMult; }, [speedMult]);
  useEffect(() => { S.current.searchTerm = search.toLowerCase(); }, [search]);
  useEffect(() => { S.current.focusSub = focusSub; S.current.selectedId = null; setSelected(null); }, [focusSub]);

  const rebuildLayout = useCallback(() => {
    const model = S.current.modelRef;
    if (!model?.reactions) return;
    const { W, H } = sizeRef.current;
    const layout = buildLayout(model.reactions, S.current.showHubs, W, H, S.current.focusSub);
    S.current.layout   = layout;
    S.current.particles = {};

    // Auto-fit: compute bounding box of all nodes and scale to fill canvas
    if (layout?.mode === 'atomic') {
      const xs = [...Object.values(layout.rxnPos || {}).map(p => p.x), ...Object.values(layout.metPos || {}).map(p => p.x)];
      const ys = [...Object.values(layout.rxnPos || {}).map(p => p.y), ...Object.values(layout.metPos || {}).map(p => p.y)];
      if (xs.length) {
        const margin = 40;
        const minX = Math.min(...xs) - margin, maxX = Math.max(...xs) + margin;
        const minY = Math.min(...ys) - margin, maxY = Math.max(...ys) + margin;
        const cW = maxX - minX, cH = maxY - minY;
        const sc = Math.min(2, Math.min(W / cW, H / cH) * 0.92);
        T.current = {
          x: (W - cW * sc) / 2 - minX * sc,
          y: (H - cH * sc) / 2 - minY * sc,
          scale: sc,
        };
      }
    } else {
      T.current = { x: 0, y: 0, scale: 1 };
    }
  }, []);

  useEffect(() => { S.current.modelRef = currentModel; rebuildLayout(); }, [currentModel, rebuildLayout]);
  useEffect(() => { rebuildLayout(); }, [showHubs, focusSub, rebuildLayout]);

  const runFBA = useCallback(async (model, glc, o2) => {
    if (!model?.reactions) return;
    setStatus('running');
    try {
      const rxns = model.reactions;
      const glcId = ['EX_glc__D_e','EX_glc_D_e','EX_glc_e'].find(id => rxns[id]);
      const o2Id  = ['EX_o2_e','EX_o2(e)'].find(id => rxns[id]);
      const constraints = {};
      if (glcId) constraints[glcId] = { lb: glc, ub: 1000 };
      if (o2Id)  constraints[o2Id]  = { lb: o2,  ub: 1000 };
      const res = await compute('fba', model, { constraints });
      if (res?.status === 'optimal') {
        S.current.fluxes  = res.fluxes || {};
        S.current.maxFlux = Math.max(1, ...Object.values(res.fluxes || {}).map(Math.abs));
        setMu(res.objectiveValue); setTier(res._tier); setStatus('done');
      } else { setStatus('error'); }
    } catch { setStatus('error'); }
  }, []);

  useEffect(() => { if (!currentModel) return; const t = setTimeout(() => runFBA(currentModel, glcLb, o2Lb), 300); return () => clearTimeout(t); }, [currentModel]); // eslint-disable-line
  useEffect(() => { const t = setTimeout(() => runFBA(S.current.modelRef, glcLb, o2Lb), 420); return () => clearTimeout(t); }, [glcLb, o2Lb, runFBA]);

  // ── Mouse ─────────────────────────────────────────────────────────────────
  const screenToWorld = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const tr = T.current;
    return { wx: (sx - tr.x) / tr.scale, wy: (sy - tr.y) / tr.scale, sx, sy };
  };

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const tr = T.current;
    const ns = Math.max(0.05, Math.min(12, tr.scale * factor));
    T.current = { x: sx - (sx - tr.x) * (ns / tr.scale), y: sy - (sy - tr.y) * (ns / tr.scale), scale: ns };
  }, []);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    drag.current = { startX: e.clientX, startY: e.clientY, panX: T.current.x, panY: T.current.y, moved: false };
  }, []);

  const onMouseMove = useCallback((e) => {
    if (drag.current) {
      const dx = e.clientX - drag.current.startX, dy = e.clientY - drag.current.startY;
      if (Math.hypot(dx, dy) > 3) drag.current.moved = true;
      T.current = { ...T.current, x: drag.current.panX + dx, y: drag.current.panY + dy };
    }
    const { wx, wy } = screenToWorld(e);
    hoverRef.current = hitTest(wx, wy, S.current.layout);
    canvasRef.current.style.cursor = hoverRef.current ? 'pointer' : (drag.current ? 'grabbing' : 'grab');
  }, []);

  const onMouseUp = useCallback((e) => {
    if (!drag.current) return;
    const wasDrag = drag.current.moved;
    drag.current = null;
    if (wasDrag) return;
    const { wx, wy } = screenToWorld(e);
    const hit = hitTest(wx, wy, S.current.layout);
    if (!hit) { setSelected(null); S.current.selectedId = null; return; }
    if (hit.type === 'sub') { setFocusSub(hit.id); }
    else if (hit.type === 'rxn') {
      const rxn = S.current.modelRef?.reactions?.[hit.id];
      S.current.selectedId = hit.id;
      setSelected({ type: 'rxn', id: hit.id, rxn, flux: S.current.smooth[hit.id] ?? 0 });
    }
  }, []);

  const onMouseLeave = useCallback(() => { drag.current = null; hoverRef.current = null; }, []);

  // ── Animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let alive = true;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.offsetWidth, H = canvas.offsetHeight;
      sizeRef.current = { W, H };
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rebuildLayout();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.style.cursor = 'grab';

    function frame(ts) {
      if (!alive) return;
      const dt = Math.min(32, ts - (S.current.lastTs || ts));
      S.current.lastTs = ts;
      const { W, H } = sizeRef.current;
      const sc = S.current;

      // Exponential smoothing toward target fluxes
      const k = 1 - Math.exp(-dt / 350);
      [...new Set([...Object.keys(sc.fluxes), ...Object.keys(sc.smooth)])].forEach(id => {
        sc.smooth[id] = (sc.smooth[id] || 0) + ((sc.fluxes[id] || 0) - (sc.smooth[id] || 0)) * k;
      });

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);

      const layout = sc.layout;
      if (layout) {
        ctx.save();
        ctx.translate(T.current.x, T.current.y);
        ctx.scale(T.current.scale, T.current.scale);
        if (layout.mode === 'atomic') {
          drawAtomic(ctx, layout, sc.smooth, sc.maxFlux, sc.modelRef?.reactions || {}, sc, dt, ts, W, H);
        } else {
          drawSubsystem(ctx, layout, sc.smooth, sc.modelRef?.reactions || {}, sc, dt, ts, W, H);
        }
        ctx.restore();
        // Screen-space overlay
        drawTooltip(ctx, layout, sc.smooth, sc.modelRef, W, H);
      }
      drawHUD(ctx, W, H, layout);
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      alive = false; cancelAnimationFrame(rafRef.current); ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [rebuildLayout, onWheel, onMouseDown, onMouseMove, onMouseUp, onMouseLeave]);

  // ── drawAtomic — Escher-style rendering ──────────────────────────────────
  function drawAtomic(ctx, layout, fluxes, maxF, reactions, sc, dt, ts, W, H) {
    const { rxnPos, metPos, edges, zones } = layout;
    const selId = sc.selectedId;
    const term  = sc.searchTerm;
    const scale = T.current.scale;
    const FWD   = '#2563eb'; // forward flux — blue
    const REV   = '#dc2626'; // reverse flux — red
    const INACT = '#d1d5db'; // inactive — gray

    // ── Zone backgrounds: very subtle tint only ──────────────────────────
    if (zones) {
      Object.values(zones).forEach(z => {
        const { stroke, bg } = subsysColors(z.sub);
        ctx.fillStyle = bg;
        ctx.globalAlpha = 0.18;
        rrect(ctx, z.x, z.y, z.w, z.h, 6); ctx.fill();
        ctx.globalAlpha = 1;
        if (scale > 0.18) {
          ctx.fillStyle = stroke;
          ctx.globalAlpha = 0.45;
          ctx.font = `600 ${Math.min(10, 8 / scale)}px system-ui,sans-serif`;
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          const lbl = z.sub.length > 24 ? z.sub.slice(0, 23) + '…' : z.sub;
          ctx.fillText(lbl, z.x + 5, z.y + 3);
          ctx.globalAlpha = 1;
        }
      });
    }

    // ── Pre-compute bezier control points (consistent per edge) ──────────
    const edgeCPs = new Map();
    edges.forEach(e => {
      const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len; // perpendicular unit vector
      // Deterministic bend direction from edge key hash
      let h = 0;
      for (let i = 0; i < e.key.length; i++) h = (h * 31 + e.key.charCodeAt(i)) >>> 0;
      const sign = (h & 1) ? 1 : -1;
      const bend = Math.min(38, len * 0.24) * sign;
      edgeCPs.set(e.key, {
        cpx: (e.x1 + e.x2) / 2 + nx * bend,
        cpy: (e.y1 + e.y2) / 2 + ny * bend,
      });
    });

    // ── Edges: bezier curves, flux-width encoded ─────────────────────────
    edges.forEach(e => {
      const f   = fluxes[e.rxnId] ?? 0, af = Math.abs(f);
      const norm = Math.min(1, af / maxF);
      const active = af > 0.005;
      const highlight = selId && (e.rxnId === selId || e.metId === selId);
      const { cpx, cpy } = edgeCPs.get(e.key);

      const edgeColor = highlight ? '#111827' : (active ? (f >= 0 ? FWD : REV) : INACT);
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth   = highlight ? 3.5 : (active ? 1.5 + norm * 7 : 0.8);
      ctx.globalAlpha = highlight ? 0.95 : (active ? 0.5 + norm * 0.45 : 0.22);
      ctx.setLineDash(active ? [] : [4, 5]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.quadraticCurveTo(cpx, cpy, e.x2, e.y2);
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;

      // Arrowhead at endpoint along bezier tangent (t=1 tangent = 2*(P1-CP))
      if (active && af > 0.05) {
        const tx2 = 2 * (e.x2 - cpx), ty2 = 2 * (e.y2 - cpy);
        const angle = Math.atan2(ty2, tx2);
        const as = 5 + norm * 3.5;
        ctx.fillStyle = edgeColor;
        ctx.globalAlpha = 0.88;
        ctx.beginPath();
        ctx.moveTo(e.x2, e.y2);
        ctx.lineTo(e.x2 - as * Math.cos(angle - 0.45), e.y2 - as * Math.sin(angle - 0.45));
        ctx.lineTo(e.x2 - as * Math.cos(angle + 0.45), e.y2 - as * Math.sin(angle + 0.45));
        ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      }

      // Particles travel along bezier curve
      if (!active) { delete sc.particles[e.key]; return; }
      const speed = (0.0005 + norm * 0.003) * sc.speedMult;
      if (!sc.particles[e.key]) sc.particles[e.key] = [];
      const pool = sc.particles[e.key];
      for (let i = pool.length - 1; i >= 0; i--) { pool[i].t += speed * dt; if (pool[i].t > 1) pool.splice(i, 1); }
      const tgt = Math.max(1, Math.round(norm * 6));
      while (pool.length < tgt) pool.push({ t: Math.random(), reverse: f < 0 });

      pool.forEach(p => {
        const tt = p.reverse ? 1 - p.t : p.t;
        const u = 1 - tt;
        const px = u * u * e.x1 + 2 * u * tt * cpx + tt * tt * e.x2;
        const py = u * u * e.y1 + 2 * u * tt * cpy + tt * tt * e.y2;
        ctx.fillStyle = f >= 0 ? FWD : REV;
        ctx.globalAlpha = 0.88;
        ctx.beginPath(); ctx.arc(px, py, 2.5 + norm * 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      });
    });

    // ── Metabolite nodes — large, Escher-prominent circles ───────────────
    Object.entries(metPos).forEach(([mId, mp]) => {
      let totF = 0;
      Object.entries(reactions).forEach(([rId, rxn]) => {
        const coef = rxn.metabolites?.[mId];
        if (coef !== undefined) totF += Math.abs((fluxes[rId] || 0) * Math.abs(coef));
      });
      const norm   = Math.min(1, totF / (maxF * 3));
      const active = norm > 0.02;
      const isSel  = selId === mId;
      const isHov  = hoverRef.current?.id === mId;
      const r      = (isSel || isHov ? 9 : 5.5) + norm * 4.5;
      const compColor = { c: '#2563eb', e: '#d97706', p: '#059669', m: '#7c3aed', default: '#6b7280' };
      const col = compColor[mp.comp] || compColor.default;

      // Glow for high-flux metabolites
      if (active && norm > 0.25) {
        ctx.fillStyle = col; ctx.globalAlpha = 0.1;
        ctx.beginPath(); ctx.arc(mp.x, mp.y, r + 5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle   = active ? col + '1a' : '#f3f4f6'; // very light tint fill
      ctx.strokeStyle = isSel ? '#111827' : (isHov ? col : (active ? col : '#9ca3af'));
      ctx.lineWidth   = isSel ? 2.5 : (active ? 2 + norm * 1 : 0.8);
      ctx.globalAlpha = active ? 1 : 0.45;
      ctx.beginPath(); ctx.arc(mp.x, mp.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;

      // Labels: always visible at scale >= 0.25 (Escher default)
      if (scale > 0.25 || isHov || isSel) {
        const met = sc.modelRef?.metabolites?.[mId];
        const lbl = ((met?.name || mId).replace(/_[cepmxn]$/, '')).slice(0, 14);
        const fs = Math.min(10, 8 / scale);
        ctx.font = `${isSel || isHov ? 'bold ' : ''}${fs}px system-ui,sans-serif`;
        const tw = ctx.measureText(lbl).width;
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.fillRect(mp.x - tw / 2 - 1, mp.y + r + 2, tw + 2, fs + 1);
        ctx.fillStyle = active ? '#1f2937' : '#9ca3af';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(lbl, mp.x, mp.y + r + 2);
      }
    });

    // ── Reaction nodes — small circles (Escher style) ────────────────────
    Object.entries(rxnPos).forEach(([rId, rp]) => {
      const f    = fluxes[rId] ?? 0, af = Math.abs(f);
      const norm = Math.min(1, af / maxF);
      const active  = norm > 0.002;
      const isSel   = selId === rId;
      const isHov   = hoverRef.current?.id === rId;
      const isSearch = term && rId.toLowerCase().includes(term);
      const R = ESCHER_RXN_R;
      const nodeColor = active ? (f >= 0 ? FWD : REV) : '#9ca3af';

      // Outer selection ring
      if (isSel) {
        ctx.strokeStyle = '#111827'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.arc(rp.x, rp.y, R + 6, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Node: white fill + colored stroke (canonical Escher look)
      ctx.fillStyle   = active ? (f >= 0 ? '#eff6ff' : '#fef2f2') : '#f9fafb';
      ctx.strokeStyle = isSearch ? '#dc2626' : (isSel ? '#111827' : nodeColor);
      ctx.lineWidth   = isSearch ? 3 : (isSel ? 2.5 : (active ? 2 + norm * 1.5 : 1));
      ctx.globalAlpha = active ? 1 : 0.48;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;

      // Reaction ID label above node (always shown, white bg for legibility)
      if (scale > 0.28 || isSel || isHov) {
        const label = rId.length > 11 ? rId.slice(0, 10) + '…' : rId;
        const fs = Math.min(9, 7.5 / scale);
        ctx.font = `${isSel || isHov ? 'bold ' : ''}${fs}px system-ui,sans-serif`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(rp.x - tw / 2 - 1, rp.y - R - fs - 3, tw + 2, fs + 1);
        ctx.fillStyle = active ? '#111827' : '#9ca3af';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(label, rp.x, rp.y - R - 1);
      }

      // Flux value inside node at higher zoom
      if (scale > 0.55 && active) {
        const disp = af >= 100 ? af.toFixed(0) : af >= 10 ? af.toFixed(1) : af.toFixed(2);
        ctx.font = `bold ${Math.min(7, 5.5 / scale)}px ui-monospace,monospace`;
        ctx.fillStyle = f >= 0 ? '#1d4ed8' : '#b91c1c';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(disp, rp.x, rp.y);
      }
    });

    // ── Legend: forward / reverse / inactive ─────────────────────────────
    const lx = 12, ly = H - 48;
    [
      { color: FWD,   label: 'Forward flux' },
      { color: REV,   label: 'Reverse flux' },
      { color: INACT, label: 'Inactive' },
    ].forEach(({ color, label }, i) => {
      const y = ly + i * 14;
      ctx.fillStyle = color; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(lx + 5, y + 5, 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#6b7280'; ctx.font = '9px system-ui,sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 14, y + 5);
    });
  }

  // ── drawSubsystem — chord-diagram style ──────────────────────────────────
  function drawSubsystem(ctx, layout, fluxes, reactions, sc, dt, ts, W, H) {
    const { subsPos, edges, cx = W / 2, cy = H / 2 } = layout;

    // Aggregate flux per subsystem
    const subFlux = {};
    Object.entries(reactions || {}).forEach(([rId, rxn]) => {
      const sub = rxn.subsystem || 'Other';
      subFlux[sub] = (subFlux[sub] || 0) + Math.abs(fluxes[rId] || 0);
    });
    const maxSF = Math.max(1, ...Object.values(subFlux));

    // ── Chord edges: curve through circle center (chord diagram style) ───
    edges.forEach(e => {
      const fa = (subFlux[e.sa] || 0) / maxSF;
      const fb = (subFlux[e.sb] || 0) / maxSF;
      const norm = Math.min(1, (fa + fb) / 2);
      // Only draw if both ends have meaningful flux activity
      if (norm < 0.02) return;

      const colA = subsysColors(e.sa).stroke;
      // Control point: slightly inside the circle center (chord pulls inward)
      const cpx = cx * 0.85 + (e.x1 + e.x2) / 2 * 0.15;
      const cpy = cy * 0.85 + (e.y1 + e.y2) / 2 * 0.15;

      ctx.strokeStyle = colA;
      ctx.lineWidth   = 0.8 + norm * 2.5;
      ctx.globalAlpha = 0.15 + norm * 0.45;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.quadraticCurveTo(cpx, cpy, e.x2, e.y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // ── Subsystem nodes ──────────────────────────────────────────────────
    Object.values(subsPos).forEach(sp => {
      const norm   = Math.min(1, (subFlux[sp.sub] || 0) / maxSF);
      const active = norm > 0.01;
      const isHov  = hoverRef.current?.id === sp.sub;
      const { stroke, bg } = subsysColors(sp.sub);
      const r = sp.nodeR + norm * 8;

      // Node circle
      ctx.fillStyle   = active ? bg : '#f9fafb';
      ctx.strokeStyle = isHov ? '#111827' : (active ? stroke : '#d1d5db');
      ctx.lineWidth   = isHov ? 2.5 : (active ? 1.5 + norm * 2 : 0.8);
      ctx.globalAlpha = active ? 1 : 0.4;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;

      // Flux arc (fills clockwise proportional to flux)
      if (active && norm > 0.06) {
        ctx.fillStyle = stroke; ctx.globalAlpha = 0.18 + norm * 0.22;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.arc(sp.x, sp.y, r, -Math.PI / 2, -Math.PI / 2 + norm * Math.PI * 2);
        ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      }

      // Label: inside node, truncated cleanly
      const fontSize = Math.max(7, Math.min(10, r * 0.52));
      ctx.font = `${active ? 'bold ' : ''}${fontSize}px system-ui,sans-serif`;
      ctx.fillStyle = active ? '#111827' : '#9ca3af';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lbl = sp.sub.length > 14 ? sp.sub.slice(0, 13) + '…' : sp.sub;
      ctx.fillText(lbl, sp.x, sp.y);

      // Hover hint only (no noisy Σ labels on every node)
      if (isHov) {
        ctx.fillStyle = '#2563eb'; ctx.font = '8px system-ui,sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText('click to explore →', sp.x, sp.y + r + 4);
      }
    });
  }

  // ── drawTooltip (screen-space) ────────────────────────────────────────────
  function drawTooltip(ctx, layout, fluxes, model, W, H) {
    const hov = hoverRef.current; if (!hov) return;
    const tr = T.current;
    let wx, wy, lines = [];
    const reactions = model?.reactions || {};

    if (hov.type === 'rxn') {
      const pos = layout.rxnPos?.[hov.id]; if (!pos) return;
      wx = pos.x * tr.scale + tr.x; wy = pos.y * tr.scale + tr.y;
      const rxn = reactions[hov.id], f = fluxes[hov.id] ?? 0;
      lines = [
        { text: hov.id, bold: true, color: '#111827' },
        { text: rxn?.name && rxn.name !== hov.id ? rxn.name : '', color: '#6b7280' },
        { text: `Flux:  ${f >= 0 ? '+' : ''}${f.toFixed(5)} mmol·gDW⁻¹·h⁻¹`, color: f > 0.01 ? '#059669' : f < -0.01 ? '#d97706' : '#6b7280', mono: true },
        { text: `Bnds:  [${rxn?.lower_bound ?? '−1000'}, ${rxn?.upper_bound ?? '1000'}]`, color: '#6b7280', mono: true },
        { text: rxn?.subsystem ? `Sub:   ${rxn.subsystem}` : '', color: subsysColors(rxn?.subsystem).stroke },
        { text: (rxn?.gpr || rxn?.gene_reaction_rule) ? `GPR:   ${(rxn.gpr || rxn.gene_reaction_rule).slice(0, 36)}` : '', color: '#7c3aed', mono: true },
      ].filter(l => l.text);
    } else if (hov.type === 'met') {
      const pos = layout.metPos?.[hov.id]; if (!pos) return;
      wx = pos.x * tr.scale + tr.x; wy = pos.y * tr.scale + tr.y;
      const met = model?.metabolites?.[hov.id];
      lines = [
        { text: hov.id, bold: true, color: '#111827' },
        { text: met?.name || '', color: '#6b7280' },
        { text: met?.formula ? `Formula: ${met.formula}` : '', color: '#374151', mono: true },
        { text: `Compartment: ${hov.id.split('_').pop()}`, color: '#2563eb' },
      ].filter(l => l.text);
    } else if (hov.type === 'sub') {
      const pos = layout.subsPos?.[hov.id]; if (!pos) return;
      wx = pos.x * tr.scale + tr.x; wy = pos.y * tr.scale + tr.y;
      const sf = Object.entries(reactions).filter(([,r]) => (r.subsystem||'Other') === hov.id)
        .reduce((s,[id]) => s + Math.abs(fluxes[id]||0), 0);
      lines = [
        { text: hov.id, bold: true, color: '#111827' },
        { text: `${pos.count} reactions`, color: '#6b7280' },
        { text: `Total |flux|: ${sf.toFixed(3)} mmol·gDW⁻¹·h⁻¹`, color: '#059669', mono: true },
        { text: 'Click to explore reactions →', color: '#2563eb' },
      ];
    } else return;

    const PAD = 10, LH = 16, TW = 248, TH = PAD*2 + lines.length*LH;
    let tx = wx + 18, ty = wy - TH/2;
    if (tx + TW > W - 4) tx = wx - TW - 18;
    ty = Math.max(4, Math.min(H - TH - 4, ty));

    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1;
    rrect(ctx, tx, ty, TW, TH, 5); ctx.fill(); ctx.stroke();

    // Subsystem color accent strip at top
    if (hov.type === 'rxn' || hov.type === 'sub') {
      const sub = hov.type === 'rxn' ? reactions[hov.id]?.subsystem : hov.id;
      ctx.fillStyle = subsysColors(sub).stroke;
      rrect(ctx, tx, ty, TW, 3, 5); ctx.fill();
    }

    lines.forEach((l, i) => {
      ctx.font = l.bold ? 'bold 10px system-ui,sans-serif'
        : l.mono ? '9px ui-monospace,monospace' : '9.5px system-ui,sans-serif';
      ctx.fillStyle = l.color; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(l.text.slice(0, 36), tx + PAD, ty + PAD + i * LH + 2);
    });
  }

  // ── drawHUD ───────────────────────────────────────────────────────────────
  function drawHUD(ctx, W, H, layout) {
    if (!layout) return;
    const mode = layout.mode;
    const count = mode === 'atomic' ? Object.keys(layout.rxnPos||{}).length : Object.keys(layout.subsPos||{}).length;
    const hint  = mode === 'subsystem' ? `${count} subsystems · click to drill in · scroll to zoom` : `${count} reactions · scroll to zoom · drag to pan · click to select`;
    ctx.font = '9px system-ui,sans-serif'; ctx.fillStyle = 'rgba(107,114,128,0.75)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(hint, 10, 8);
    ctx.textAlign = 'right'; ctx.fillText(`${T.current.scale.toFixed(2)}×`, W - 10, 8);
  }

  const rxns = currentModel?.reactions || {};
  const hasGlc = ['EX_glc__D_e','EX_glc_D_e','EX_glc_e'].some(id => rxns[id]);
  const hasO2  = ['EX_o2_e','EX_o2(e)'].some(id => rxns[id]);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#ffffff', overflow:'hidden' }}>

      {/* Top bar */}
      <div style={{ flexShrink:0, display:'flex', alignItems:'center', gap:8, padding:'6px 12px', background:'#ffffff', borderBottom:'1px solid #e5e7eb', zIndex:10 }}>
        {focusSub ? (
          <button onClick={() => { setFocusSub(null); }}
            style={{ display:'flex', alignItems:'center', gap:3, padding:'2px 8px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:3, color:'#2563eb', cursor:'pointer', fontSize:9 }}>
            <ChevronLeft style={{ width:11, height:11 }} />All subsystems
          </button>
        ) : (
          <span style={{ fontSize:11, fontWeight:600, color:'#374151' }}>Live Flux Animation</span>
        )}
        {focusSub && <span style={{ fontSize:10, color:'#6b7280' }}>→ {focusSub}</span>}

        {/* Status */}
        <div style={{ display:'flex', alignItems:'center', gap:5, marginLeft:4 }}>
          {status==='running' && <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:9, color:'#d97706' }}><span style={{ width:6,height:6,borderRadius:'50%',border:'1.5px solid #d97706',borderTopColor:'transparent',animation:'spin 0.8s linear infinite',display:'inline-block'}} />Solving…</span>}
          {status==='done' && mu!=null && <span style={{ fontSize:9, color:'#059669' }}>μ = {mu.toFixed(4)} h⁻¹ · {tier||'wasm'}</span>}
          {status==='error' && <span style={{ fontSize:9, color:'#dc2626' }}>Infeasible</span>}
        </div>

        <div style={{ flex:1 }} />

        {/* Search */}
        <div style={{ display:'flex', alignItems:'center', gap:4, padding:'2px 8px', background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:4 }}>
          <Search style={{ width:11, height:11, color:'#9ca3af' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find reaction…"
            style={{ width:110, fontSize:9, border:'none', background:'transparent', outline:'none', color:'#374151' }} />
        </div>

        {/* Speed */}
        <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:9, color:'#6b7280' }}>
          Speed
          <input type="range" min={0.3} max={4} step={0.1} value={speedMult}
            onChange={e => setSpeedMult(Number(e.target.value))}
            style={{ width:55, accentColor:'#2563eb' }} />
          <span style={{ fontSize:9, color:'#374151', minWidth:22 }}>{speedMult.toFixed(1)}×</span>
        </label>

        <button onClick={() => runFBA(currentModel, glcLb, o2Lb)} disabled={status==='running'||!currentModel}
          style={{ display:'flex', alignItems:'center', gap:3, padding:'3px 8px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:3, color:'#2563eb', cursor:'pointer', fontSize:9, opacity:status==='running'?0.5:1 }}>
          <RefreshCw style={{ width:11, height:11 }} />Re-solve
        </button>
        <button onClick={onClose} style={{ padding:'3px 5px', background:'transparent', border:'none', color:'#9ca3af', cursor:'pointer' }}>
          <X style={{ width:14, height:14 }} />
        </button>
      </div>

      {/* Main: canvas + side panel */}
      <div style={{ flex:1, display:'flex', minHeight:0 }}>
        <canvas ref={canvasRef} style={{ flex:1, display:'block', width:'100%', height:'100%' }} />

        {/* Side panel */}
        {selected?.type === 'rxn' && selected.rxn && (
          <div style={{ width:230, flexShrink:0, background:'#ffffff', borderLeft:'1px solid #e5e7eb', overflowY:'auto', padding:'12px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <span style={{ fontSize:10, fontWeight:600, color:'#374151' }}>Reaction Detail</span>
              <button onClick={()=>{setSelected(null);S.current.selectedId=null;}} style={{ background:'none', border:'none', color:'#9ca3af', cursor:'pointer' }}><X style={{ width:12,height:12 }} /></button>
            </div>
            <div style={{ height:3, borderRadius:2, background:subsysColors(selected.rxn.subsystem).stroke, marginBottom:10 }} />
            <p style={{ fontSize:11, fontWeight:700, color:'#111827', fontFamily:'ui-monospace,monospace', wordBreak:'break-all', marginBottom:4 }}>{selected.id}</p>
            {selected.rxn.name && selected.rxn.name !== selected.id && <p style={{ fontSize:9, color:'#6b7280', marginBottom:8 }}>{selected.rxn.name}</p>}

            <SideStat label="Flux" mono value={`${(S.current.smooth[selected.id]??0) >= 0?'+':''}${(S.current.smooth[selected.id]??0).toFixed(6)}`} unit="mmol·gDW⁻¹·h⁻¹"
              color={(S.current.smooth[selected.id]??0)>0.01?'#059669':(S.current.smooth[selected.id]??0)<-0.01?'#d97706':'#6b7280'} />
            <SideStat label="Bounds" mono value={`[${selected.rxn.lower_bound??'−1000'}, ${selected.rxn.upper_bound??'1000'}]`} />
            {selected.rxn.subsystem && <SideStat label="Subsystem" value={selected.rxn.subsystem} color={subsysColors(selected.rxn.subsystem).stroke} />}
            {(selected.rxn.gpr||selected.rxn.gene_reaction_rule) && (
              <div style={{ marginTop:8 }}>
                <p style={{ fontSize:8, color:'#9ca3af', textTransform:'uppercase', marginBottom:3 }}>GPR Rule</p>
                <p style={{ fontSize:9, color:'#7c3aed', fontFamily:'ui-monospace,monospace', wordBreak:'break-all', lineHeight:1.5 }}>
                  {(selected.rxn.gpr||selected.rxn.gene_reaction_rule).slice(0,120)}
                </p>
              </div>
            )}
            {Object.keys(selected.rxn.metabolites||{}).length > 0 && (
              <div style={{ marginTop:8 }}>
                <p style={{ fontSize:8, color:'#9ca3af', textTransform:'uppercase', marginBottom:4 }}>Stoichiometry</p>
                {Object.entries(selected.rxn.metabolites).map(([mId,coef]) => (
                  <div key={mId} style={{ display:'flex', gap:4, marginBottom:2 }}>
                    <span style={{ fontSize:9, fontFamily:'ui-monospace,monospace', color:coef<0?'#d97706':'#059669', minWidth:28 }}>{coef>0?`+${coef}`:coef}</span>
                    <span style={{ fontSize:9, fontFamily:'ui-monospace,monospace', color:'#374151', wordBreak:'break-all' }}>{mId}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Exchange sliders */}
      {currentModel && (hasGlc||hasO2) && (
        <div style={{ flexShrink:0, display:'flex', gap:24, padding:'8px 20px', background:'#ffffff', borderTop:'1px solid #e5e7eb', alignItems:'center', justifyContent:'center' }}>
          {hasGlc && <SliderCtrl label="Glucose uptake" value={glcLb} min={-20} max={-0.5} step={0.5} onChange={setGlcLb} unit="mmol·gDW⁻¹·h⁻¹" color="#E69F00" />}
          {hasO2  && <SliderCtrl label="O₂ uptake"      value={o2Lb}  min={-20} max={0}    step={0.5} onChange={setO2Lb}  unit={o2Lb===0?'Anaerobic':'mmol·gDW⁻¹·h⁻¹'} color="#009E73" />}
        </div>
      )}

      {!currentModel && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
          <span style={{ fontSize:12, color:'#9ca3af' }}>Load a model to activate live flux animation</span>
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function SideStat({ label, value, unit, color='#374151', mono }) {
  return (
    <div style={{ marginBottom:8 }}>
      <p style={{ fontSize:8, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>{label}</p>
      <p style={{ fontSize:10, color, fontFamily: mono?'ui-monospace,monospace':'system-ui,sans-serif', wordBreak:'break-all' }}>
        {value}{unit&&<span style={{ fontSize:8, color:'#9ca3af', marginLeft:4 }}>{unit}</span>}
      </p>
    </div>
  );
}

function SliderCtrl({ label, value, min, max, step, onChange, unit, color }) {
  return (
    <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:9, color:'#6b7280' }}>
      {label}
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width:100, accentColor: color }} />
      <span style={{ fontSize:10, color, fontFamily:'ui-monospace,monospace', minWidth:50 }}>
        {value} <span style={{ fontSize:8, color:'#9ca3af' }}>{unit}</span>
      </span>
    </label>
  );
}
