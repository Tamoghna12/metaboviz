/**
 * SubsystemView - Hierarchical Pathway Navigation for Large Models
 *
 * Provides a multi-level hierarchical view for genome-scale models:
 * 1. Category Level: Groups of related pathways (e.g., "Amino Acid Metabolism")
 * 2. Subsystem Level: Individual pathways (e.g., "Alanine and Aspartate Metabolism")
 * 3. Reaction Level: Full reaction network within a subsystem
 *
 * Features:
 * - Semantic zoom: Detail level changes automatically with zoom
 * - Breadcrumb navigation for easy backtracking
 * - Search/filter across all hierarchy levels
 * - Keyboard navigation (arrow keys, Enter, Escape)
 *
 * This solves the "hairball" problem where 2000+ reactions
 * become impossible to visualize on a single canvas.
 *
 * References:
 * - Thiele & Palsson (2010) "A protocol for generating a GEM"
 * - King et al. (2016) "BiGG Models: A platform for integrating, standardizing
 *   and sharing genome-scale models" - Nucleic Acids Research
 *
 * @module SubsystemView
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Layers, Zap, FlaskConical, Dna, Download, BarChart2, FileText, Pencil, Trash2, Check, X as XIcon, Activity } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useModel } from '../contexts/ModelContext';
import { downloadJSON, downloadSBML } from '../lib/ModelExporter';
import { compute } from '../lib/ComputeWorker';
import NetworkCanvas from './NetworkCanvas';

const TABS = [
  { id: 'pathways',    label: 'Overview',    Icon: Layers      },
  { id: 'reactions',   label: 'Reactions',   Icon: Zap         },
  { id: 'metabolites', label: 'Metabolites', Icon: FlaskConical },
  { id: 'genes',       label: 'Genes',       Icon: Dna         },
  { id: 'fba',         label: 'FBA',         Icon: Activity    },
  { id: 'export',      label: 'Export',      Icon: Download    },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function _detectObj(model) {
  const rxns = Object.entries(model?.reactions || {});
  for (const [id, r] of rxns) if (r.objective_coefficient) return id;
  for (const [id, r] of rxns) for (const p of [/biomass/i, /growth/i, /^BIOMASS/i]) if (p.test(id) || p.test(r.name || '')) return id;
  return rxns[0]?.[0] ?? null;
}

function _fmtEq(rxn, mets) {
  const lhs = [], rhs = [];
  Object.entries(rxn.metabolites || {}).forEach(([mId, coef]) => {
    const name = mets?.[mId]?.name || mId;
    const abs = Math.abs(coef);
    const s = abs === 1 ? name : `${abs} ${name}`;
    (coef < 0 ? lhs : rhs).push(s);
  });
  const arrow = (rxn.lower_bound ?? -1000) < 0 ? '⇌' : '→';
  return `${lhs.join(' + ')} ${arrow} ${rhs.join(' + ')}`;
}

function _parseEq(str) {
  const m = str.match(/(<->|<=>|<-->|-->?|→|⇌)/);
  if (!m) return null;
  const isRev = m[1].startsWith('<') || m[1] === '⇌';
  const [lhs, rhs] = str.split(m[1]);
  const side = (s, sign) => {
    const out = {};
    s.trim().split(/\s*\+\s*/).forEach(p => {
      const pm = p.trim().match(/^([\d.]+)?\s*(.+)$/);
      if (pm) out[pm[2].trim()] = (pm[1] ? parseFloat(pm[1]) : 1) * sign;
    });
    return out;
  };
  return { metabolites: { ...side(lhs, -1), ...side(rhs, 1) }, reversible: isRev };
}

// ── FBA Studio Tab ─────────────────────────────────────────────────────────────
function FBAStudioTab({ onFluxUpdate }) {
  const { currentModel, updateReactions } = useModel();
  const { isDark } = useTheme();
  const [objective, setObjective]     = useState(null);
  const [method, setMethod]           = useState('fba');
  const [running, setRunning]         = useState(false);
  const [result, setResult]           = useState(null);
  const [solveError, setSolveError]   = useState(null);
  const [fluxes, setFluxes]           = useState({});
  const [pending, setPending]         = useState({});
  const [editing, setEditing]         = useState(null);
  const [editVal, setEditVal]         = useState('');
  const [filter, setFilter]           = useState('');
  const [sortCol, setSortCol]         = useState('flux');
  const [sortDir, setSortDir]         = useState(-1);
  const [writeMsg, setWriteMsg]       = useState('');
  const [density, setDensity]         = useState('normal');
  const [visibleCols, setVisibleCols] = useState({ eq: true, lb: true, ub: true, gpr: true, sub: true });
  const [showColMenu, setShowColMenu] = useState(false);
  const editRef    = useRef(null);
  const colMenuRef = useRef(null);

  useEffect(() => { if (currentModel) setObjective(_detectObj(currentModel)); }, [currentModel]);
  useEffect(() => { if (editRef.current) editRef.current.focus(); }, [editing]);
  useEffect(() => {
    if (!showColMenu) return;
    const h = e => { if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setShowColMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showColMenu]);

  const mets = currentModel?.metabolites || {};
  const rxns = currentModel?.reactions   || {};

  const rows = useMemo(() => {
    const q = filter.toLowerCase();
    return Object.entries(rxns)
      .filter(([id, r]) => !q || id.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q) || (r.subsystem || '').toLowerCase().includes(q))
      .map(([id, rxn]) => ({
        id, rxn,
        lb:  pending[id]?.lb  ?? rxn.lower_bound  ?? -1000,
        ub:  pending[id]?.ub  ?? rxn.upper_bound  ?? 1000,
        gpr: pending[id]?.gpr ?? rxn.gpr ?? rxn.gene_reaction_rule ?? '',
        sub: pending[id]?.subsystem ?? rxn.subsystem ?? '',
        eq:  _fmtEq(pending[id]?.rxnPatch ? { ...rxn, ...pending[id].rxnPatch } : rxn, mets),
        flux: fluxes[id] ?? 0,
        dirty: !!pending[id],
      }))
      .sort((a, b) => {
        if (sortCol === 'flux') return sortDir * (Math.abs(b.flux) - Math.abs(a.flux));
        if (sortCol === 'id')   return sortDir * a.id.localeCompare(b.id);
        if (sortCol === 'lb')   return sortDir * (a.lb - b.lb);
        if (sortCol === 'ub')   return sortDir * (a.ub - b.ub);
        return 0;
      });
  }, [rxns, mets, pending, fluxes, filter, sortCol, sortDir]);

  const runFBA = async () => {
    if (!currentModel || !objective) return;
    setRunning(true); setSolveError(null);
    try {
      const res = await compute(method, currentModel, { objective });
      setResult(res);
      const f = res.fluxes ?? {};
      setFluxes(f);
      onFluxUpdate?.(f);
    } catch (e) { setSolveError(e.message); }
    setRunning(false);
  };

  const startEdit  = (rxnId, col, val) => { setEditing({ rxnId, col }); setEditVal(String(val)); };
  const cancelEdit = () => { setEditing(null); setEditVal(''); };

  const commitEdit = () => {
    if (!editing) return;
    const { rxnId, col } = editing;
    const v = editVal.trim();
    setPending(prev => {
      const e = { ...prev[rxnId] };
      if      (col === 'lb')  { const n = parseFloat(v); if (!isNaN(n)) e.lb = n; }
      else if (col === 'ub')  { const n = parseFloat(v); if (!isNaN(n)) e.ub = n; }
      else if (col === 'gpr') e.gpr = v;
      else if (col === 'sub') e.subsystem = v;
      else if (col === 'eq')  { const p = _parseEq(v); if (p) e.rxnPatch = p; }
      return Object.keys(e).length ? { ...prev, [rxnId]: e } : (({ [rxnId]: _, ...rest }) => rest)(prev);
    });
    cancelEdit();
  };

  const writeToModel = () => {
    const dirty = Object.keys(pending);
    if (!dirty.length) return;
    const updates = {};
    dirty.forEach(id => {
      const e = pending[id];
      updates[id] = { ...rxns[id] };
      if (e.lb !== undefined) updates[id].lower_bound = e.lb;
      if (e.ub !== undefined) updates[id].upper_bound = e.ub;
      if (e.gpr !== undefined) { updates[id].gpr = e.gpr; updates[id].gene_reaction_rule = e.gpr; }
      if (e.subsystem !== undefined) updates[id].subsystem = e.subsystem;
      if (e.rxnPatch) {
        updates[id].metabolites = e.rxnPatch.metabolites;
        updates[id].lower_bound = e.rxnPatch.reversible
          ? Math.min(updates[id].lower_bound ?? -1000, 0)
          : Math.max(updates[id].lower_bound ?? 0, 0);
      }
    });
    updateReactions(updates);
    setPending({});
    setWriteMsg(`✓ ${dirty.length} reaction(s) written`);
    setTimeout(() => setWriteMsg(''), 3000);
  };

  const FLUX_TOL = 1e-6;
  const maxFlux  = useMemo(() => Math.max(1, ...Object.values(fluxes).map(Math.abs)), [fluxes]);
  const dirtyN   = Object.keys(pending).length;
  const isOpt    = result?.status?.toLowerCase() === 'optimal';
  const ROW_H    = density === 'compact' ? 24 : density === 'relaxed' ? 40 : 32;

  const S = {
    bg1: 'var(--bg-primary)', bg2: 'var(--bg-secondary)',
    border: 'var(--border-color)', muted: 'var(--text-muted)',
    primary: 'var(--primary)', mono: 'var(--font-mono)',
  };

  // Per-column accent + header tint
  const C = {
    id:   { accent: '#22c55e', hdr: isDark ? '#052e16' : '#f0fdf4', txt: isDark ? '#4ade80' : '#166534' },
    eq:   { accent: '#3b82f6', hdr: isDark ? '#0c1a3a' : '#eff6ff', txt: isDark ? '#93c5fd' : '#1e40af' },
    lb:   { accent: '#eab308', hdr: isDark ? '#2d1b00' : '#fefce8', txt: isDark ? '#fde68a' : '#854d0e' },
    ub:   { accent: '#eab308', hdr: isDark ? '#2d1b00' : '#fefce8', txt: isDark ? '#fde68a' : '#854d0e' },
    gpr:  { accent: '#a855f7', hdr: isDark ? '#1e0a3c' : '#faf5ff', txt: isDark ? '#d8b4fe' : '#6b21a8' },
    sub:  { accent: '#f97316', hdr: isDark ? '#2c0a00' : '#fff7ed', txt: isDark ? '#fdba74' : '#9a3412' },
    flux: { accent: '#6366f1', hdr: isDark ? '#0f172a' : '#eef2ff', txt: isDark ? '#a5b4fc' : '#4338ca' },
  };

  // Shared header cell style factory
  const hdrBase = (col, sortable, active) => ({
    padding: '5px 8px',
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.09em',
    background: active ? C[col].accent + '28' : C[col].hdr,
    color: active ? C[col].accent : C[col].txt,
    borderRight: `1.5px solid ${C[col].accent}44`,
    borderBottom: `2.5px solid ${active ? C[col].accent : C[col].accent + '66'}`,
    cursor: sortable ? 'pointer' : 'default',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
    flexShrink: 0,
  });

  const ColHdr = ({ col, label, w, flex, right, sortable }) => {
    const active = sortCol === col;
    const onClick = sortable
      ? () => { setSortDir(sortCol === col ? -sortDir : -1); setSortCol(col); }
      : undefined;
    return (
      <div onClick={onClick}
        style={{ ...hdrBase(col, sortable, active), ...(flex ? { flex: 1, flexShrink: 1 } : { width: w }), justifyContent: right ? 'flex-end' : 'flex-start' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: C[col].accent, flexShrink: 0, opacity: active ? 1 : 0.55 }} />
        {label}
        {sortable && active && <span style={{ fontSize: 7, marginLeft: 1 }}>{sortDir > 0 ? '▲' : '▼'}</span>}
      </div>
    );
  };

  const EditCell = ({ id: rxnId, col, val, w, mono, right, number, flex }) => {
    const isEditing = editing?.rxnId === rxnId && editing?.col === col;
    const cc = C[col] || { accent: S.border };
    const base = {
      ...(flex ? { flex: 1, minWidth: 0 } : { width: w, flexShrink: 0 }),
      borderRight: `1.5px solid ${cc.accent}2a`,
      padding: isEditing ? 1 : '0 8px',
      fontSize: 9,
      fontFamily: mono ? S.mono : 'system-ui, sans-serif',
      textAlign: right ? 'right' : 'left',
      cursor: 'text',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      color: 'var(--text-secondary)',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: right ? 'flex-end' : 'flex-start',
      height: ROW_H,
    };
    if (isEditing) return (
      <div style={base}>
        <input ref={editRef} type={number ? 'number' : 'text'} value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
          style={{ width: '100%', fontSize: 9, padding: '2px 6px', border: `1.5px solid ${cc.accent}`, outline: 'none', fontFamily: mono ? S.mono : 'inherit', background: isDark ? '#1e293b' : '#fff', color: isDark ? '#f1f5f9' : '#111', boxSizing: 'border-box', height: ROW_H - 4 }}
        />
      </div>
    );
    return (
      <div onClick={() => startEdit(rxnId, col, val)} style={base} title={String(val)}>
        {String(val) || <span style={{ opacity: 0.28, fontStyle: 'italic' }}>—</span>}
      </div>
    );
  };

  const FluxCell = ({ flux }) => {
    const af  = Math.abs(flux);
    const act = af > FLUX_TOL;
    const pct = Math.min(100, (af / maxFlux) * 100);
    let gradient = 'transparent';
    if (act && pct > 0.5) {
      gradient = flux > 0
        ? `linear-gradient(90deg, ${isDark ? '#1d4ed866' : '#bfdbfe'} ${pct.toFixed(1)}%, transparent ${pct.toFixed(1)}%)`
        : `linear-gradient(270deg, ${isDark ? '#991b1b66' : '#fecaca'} ${pct.toFixed(1)}%, transparent ${pct.toFixed(1)}%)`;
    }
    return (
      <div style={{
        width: 120, flexShrink: 0, height: ROW_H,
        padding: '0 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        background: gradient,
        fontSize: 9, fontFamily: S.mono,
        color: act
          ? (flux >= 0 ? (isDark ? '#60a5fa' : '#1d4ed8') : (isDark ? '#f87171' : '#b91c1c'))
          : S.muted,
        fontWeight: act ? 600 : 400,
        borderRight: `1.5px solid ${C.flux.accent}2a`,
      }}>
        {act ? (flux >= 0 ? '+' : '') + flux.toFixed(4) : <span style={{ opacity: 0.3 }}>0.0000</span>}
      </div>
    );
  };

  const rowBg = (i, dirty) => {
    if (dirty) return isDark ? '#422006' : '#fffbeb';
    return i % 2 === 0
      ? (isDark ? '#0f172a' : '#ffffff')
      : (isDark ? '#1e293b' : '#f8fafc');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: S.bg1, overflow: 'hidden' }}>

      {/* ── Action toolbar ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', flexShrink: 0, background: S.bg2, borderBottom: `1px solid ${S.border}` }}>
        <div style={{ display: 'flex', border: `1px solid ${S.border}`, borderRadius: 2, overflow: 'hidden' }}>
          {[['fba','FBA'],['pfba','pFBA'],['fva','FVA']].map(([id, l], i, a) => (
            <button key={id} onClick={() => setMethod(id)}
              style={{ fontSize: 9, padding: '3px 9px', background: method === id ? S.primary : 'transparent', color: method === id ? '#fff' : S.muted, borderRight: i < a.length-1 ? `1px solid ${S.border}` : 'none', cursor: 'pointer', border: 'none' }}>
              {l}
            </button>
          ))}
        </div>

        <select value={objective || ''} onChange={e => setObjective(e.target.value)}
          style={{ fontSize: 9, padding: '3px 6px', border: `1px solid ${S.border}`, borderRadius: 2, background: S.bg1, color: 'var(--text-secondary)', fontFamily: S.mono, maxWidth: 200 }}>
          {!objective && <option value="">— select objective —</option>}
          {Object.keys(rxns).map(id => <option key={id} value={id}>{id}</option>)}
        </select>

        <button onClick={runFBA} disabled={running || !objective}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 14px', background: running ? '#6b7280' : S.primary, color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 2, cursor: 'pointer', border: 'none', opacity: !objective ? 0.45 : 1, fontFamily: 'system-ui' }}>
          {running ? '⏳ Solving…' : `▶ Run ${method.toUpperCase()}`}
        </button>

        {isOpt && result?.objectiveValue != null && (
          <span style={{ fontSize: 10, fontWeight: 700, color: S.primary }}>
            obj = {result.objectiveValue.toFixed(6)}
            <span style={{ fontWeight: 400, color: S.muted, marginLeft: 8, fontSize: 9 }}>
              {Object.values(fluxes).filter(v => Math.abs(v) > FLUX_TOL).length} active &middot; {result._tier ?? 'js'}
            </span>
          </span>
        )}
        {solveError && <span style={{ fontSize: 9, color: '#ef4444', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{solveError}</span>}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {dirtyN > 0 && <>
            <span style={{ fontSize: 9, color: '#d97706', fontFamily: 'system-ui' }}>{dirtyN} unsaved</span>
            <button onClick={writeToModel} style={{ fontSize: 9, padding: '3px 10px', background: '#16a34a', color: '#fff', borderRadius: 2, border: 'none', cursor: 'pointer', fontWeight: 700, fontFamily: 'system-ui' }}>Write to model</button>
            <button onClick={() => setPending({})} style={{ fontSize: 9, padding: '3px 8px', border: `1px solid ${S.border}`, borderRadius: 2, color: S.muted, background: 'transparent', cursor: 'pointer', fontFamily: 'system-ui' }}>Discard</button>
          </>}
          {writeMsg && <span style={{ fontSize: 9, color: '#16a34a', fontFamily: 'system-ui' }}>{writeMsg}</span>}
        </div>
      </div>

      {/* ── Format bar ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', flexShrink: 0, background: isDark ? '#0d1726' : '#f1f5f9', borderBottom: `1px solid ${S.border}` }}>

        {/* Columns picker */}
        <div ref={colMenuRef} style={{ position: 'relative' }}>
          <button onClick={() => setShowColMenu(v => !v)}
            style={{ fontSize: 9, padding: '2px 8px', border: `1px solid ${S.border}`, borderRadius: 2, background: showColMenu ? S.primary : (isDark ? '#1e293b' : '#fff'), color: showColMenu ? '#fff' : S.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'system-ui' }}>
            Columns <span style={{ fontSize: 7 }}>▾</span>
          </button>
          {showColMenu && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 200, background: isDark ? '#1e293b' : '#fff', border: `1px solid ${S.border}`, borderRadius: 4, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160, boxShadow: '0 6px 16px rgba(0,0,0,0.18)' }}>
              {[['eq','Equation','eq'],['lb','Lower Bound','lb'],['ub','Upper Bound','ub'],['gpr','GPR','gpr'],['sub','Subsystem','sub']].map(([k, l, col]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, cursor: 'pointer', color: 'var(--text-secondary)', userSelect: 'none', fontFamily: 'system-ui' }}>
                  <input type="checkbox" checked={visibleCols[k]} onChange={() => setVisibleCols(p => ({ ...p, [k]: !p[k] }))} style={{ accentColor: C[col].accent, cursor: 'pointer' }} />
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: C[col].accent, flexShrink: 0 }} />
                  {l}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Row density */}
        <div style={{ display: 'flex', border: `1px solid ${S.border}`, borderRadius: 2, overflow: 'hidden' }}>
          {[['compact','≡ Compact'],['normal','☰ Normal'],['relaxed','⊟ Relaxed']].map(([d, label], i, a) => (
            <button key={d} onClick={() => setDensity(d)}
              style={{ padding: '2px 9px', fontSize: 9, background: density === d ? '#475569' : (isDark ? '#1e293b' : '#fff'), color: density === d ? '#fff' : S.muted, border: 'none', borderRight: i < a.length-1 ? `1px solid ${S.border}` : 'none', cursor: 'pointer', fontFamily: 'system-ui' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Column legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 4 }}>
          {[['ID','id'],['Eq','eq'],['LB/UB','lb'],['GPR','gpr'],['Sub','sub'],['Flux','flux']].map(([l, col]) => (
            <span key={col} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8.5, color: S.muted, fontFamily: 'system-ui' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C[col].accent, flexShrink: 0 }} />
              {l}
            </span>
          ))}
        </div>

        {/* Filter */}
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter reactions…"
          style={{ marginLeft: 'auto', fontSize: 9, padding: '3px 8px', border: `1px solid ${S.border}`, borderRadius: 2, background: isDark ? '#1e293b' : '#fff', color: 'var(--text-secondary)', width: 170, fontFamily: 'system-ui' }} />
      </div>

      {/* ── Column headers ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexShrink: 0 }}>
        <ColHdr col="id"   label="Reaction ID"          w={130}      sortable />
        {visibleCols.eq  && <ColHdr col="eq"   label="Equation (click to edit)" flex         />}
        {visibleCols.lb  && <ColHdr col="lb"   label="LB"                       w={70}  right sortable />}
        {visibleCols.ub  && <ColHdr col="ub"   label="UB"                       w={70}  right sortable />}
        {visibleCols.gpr && <ColHdr col="gpr"  label="GPR"                      w={190}      />}
        {visibleCols.sub && <ColHdr col="sub"  label="Subsystem"                 w={150}      />}
        <ColHdr col="flux" label="Flux"                 w={120} right sortable />
      </div>

      {/* ── Rows ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rows.map((row, i) => {
          const { id, lb, ub, gpr, sub, eq, flux, dirty } = row;
          return (
            <div key={id} style={{
              display: 'flex', alignItems: 'stretch',
              background: rowBg(i, dirty),
              borderBottom: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`,
              borderLeft: dirty ? '3px solid #d97706' : '3px solid transparent',
              minHeight: ROW_H,
            }}>
              <div style={{
                width: 127, flexShrink: 0, padding: '0 8px', height: ROW_H,
                fontSize: 9, fontFamily: S.mono,
                borderRight: `1.5px solid ${C.id.accent}2a`,
                color: dirty ? '#d97706' : C.id.accent,
                fontWeight: dirty ? 700 : 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center',
              }} title={id}>{id}</div>
              {visibleCols.eq  && <EditCell id={id} col="eq"  val={eq}  flex  mono />}
              {visibleCols.lb  && <EditCell id={id} col="lb"  val={lb}  w={70}  right number mono />}
              {visibleCols.ub  && <EditCell id={id} col="ub"  val={ub}  w={70}  right number mono />}
              {visibleCols.gpr && <EditCell id={id} col="gpr" val={gpr} w={190} mono />}
              {visibleCols.sub && <EditCell id={id} col="sub" val={sub} w={150} />}
              <FluxCell flux={flux} />
            </div>
          );
        })}
      </div>

      {/* ── Status bar ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '3px 12px', flexShrink: 0, background: S.bg2, borderTop: `1px solid ${S.border}`, fontSize: 9, color: S.muted, fontFamily: 'system-ui' }}>
        <span>{rows.length} reactions</span>
        {filter && <span>of {Object.keys(rxns).length} total</span>}
        {dirtyN > 0 && <span style={{ color: '#d97706' }}>● {dirtyN} unsaved edits</span>}
        {isOpt && <span style={{ color: '#16a34a' }}>✓ {method.toUpperCase()} solved &middot; obj = {result.objectiveValue?.toFixed(6)}</span>}
        <span style={{ marginLeft: 'auto', opacity: 0.55 }}>Click any cell to edit &middot; Enter = confirm &middot; Esc = cancel</span>
      </div>
    </div>
  );
}

/**
 * Hierarchical pathway categories based on BiGG/KEGG classification
 * Maps subsystem prefixes to parent categories for grouping
 */
const PATHWAY_CATEGORIES = {
  'Amino Acid Metabolism': [
    'alanine', 'arginine', 'asparagine', 'aspartate', 'cysteine', 'glutamate',
    'glutamine', 'glycine', 'histidine', 'isoleucine', 'leucine', 'lysine',
    'methionine', 'phenylalanine', 'proline', 'serine', 'threonine', 'tryptophan',
    'tyrosine', 'valine', 'amino acid'
  ],
  'Carbohydrate Metabolism': [
    'glycolysis', 'gluconeogenesis', 'pentose', 'tca', 'citric', 'krebs',
    'pyruvate', 'glucose', 'fructose', 'galactose', 'starch', 'sucrose',
    'mannose', 'sugar', 'carbohydrate'
  ],
  'Lipid Metabolism': [
    'fatty acid', 'lipid', 'sterol', 'phospholipid', 'sphingolipid',
    'glycerolipid', 'cholesterol', 'triglyceride', 'beta-oxidation'
  ],
  'Nucleotide Metabolism': [
    'purine', 'pyrimidine', 'nucleotide', 'dna', 'rna', 'adenine',
    'guanine', 'cytosine', 'thymine', 'uracil'
  ],
  'Energy Metabolism': [
    'oxidative', 'electron', 'atp', 'respiratory', 'photosynthesis',
    'fermentation', 'anaerobic'
  ],
  'Cofactor & Vitamin Metabolism': [
    'vitamin', 'cofactor', 'nad', 'fad', 'coenzyme', 'biotin', 'folate',
    'thiamine', 'riboflavin', 'pantothenate'
  ],
  'Cell Envelope': [
    'cell wall', 'membrane', 'peptidoglycan', 'lipopolysaccharide', 'envelope'
  ],
  'Transport': [
    'transport', 'exchange', 'import', 'export', 'secretion', 'uptake'
  ],
  'Other': []  // Fallback category
};

// ── DonutChart — pure SVG, no library ────────────────────────────────────────
function DonutChart({ data, total, size = 108, centerValue, centerLabel }) {
  const r = 34, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let cum = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-subtle)" strokeWidth={13} />
      {data.map((d, i) => {
        const pct = d.value / total;
        const dash = pct * circ;
        const offset = -(cum / total) * circ;
        cum += d.value;
        return (
          <circle key={i} cx={cx} cy={cy} r={r}
            fill="none" stroke={d.color} strokeWidth={13}
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={offset}
            strokeLinecap="butt"
            style={{ transform: `rotate(-90deg)`, transformOrigin: `${cx}px ${cy}px` }}
          />
        );
      })}
      {centerValue !== undefined && <>
        <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="middle"
          fontSize={15} fontWeight="600" fill="var(--text-primary)" fontFamily="var(--font-mono)">
          {centerValue}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle"
          fontSize={8} fill="var(--text-muted)">
          {centerLabel}
        </text>
      </>}
    </svg>
  );
}

const SubsystemView = ({ fluxes = {}, phenotype = null, width = 1000, height = 700, onReactionSelect, onFluxUpdate }) => {
  const { isDark, accessibleColors } = useTheme();
  const { currentModel, updateReactions, deleteReaction } = useModel();
  const searchInputRef = useRef(null);
  const treemapRef = useRef(null);
  const csvImportRef = useRef(null);

  const [activeTab, setActiveTab] = useState('pathways');
  const [reactionsQuery, setReactionsQuery] = useState('');
  const [metQuery, setMetQuery] = useState('');
  const [geneQuery, setGeneQuery] = useState('');

  // Hierarchical view state: 'categories' -> 'subsystems' -> 'reactions'
  const [viewLevel, setViewLevel] = useState('categories');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSubsystem, setSelectedSubsystem] = useState(null);
  const [navigationPath, setNavigationPath] = useState([]);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);

  const [subsystemReactions, setSubsystemReactions] = useState({});


  // Classify subsystem into category
  const classifySubsystem = useCallback((subsystemName) => {
    const lowerName = subsystemName.toLowerCase();
    for (const [category, keywords] of Object.entries(PATHWAY_CATEGORIES)) {
      if (category === 'Other') continue;
      for (const keyword of keywords) {
        if (lowerName.includes(keyword)) {
          return category;
        }
      }
    }
    return 'Other';
  }, []);

  // Extract subsystems from model with category classification
  const subsystems = useMemo(() => {
    if (!currentModel?.reactions) return new Map();

    const subs = new Map();
    Object.entries(currentModel.reactions).forEach(([rxnId, rxn]) => {
      const subsystem = rxn.subsystem || 'Unclassified';
      if (!subs.has(subsystem)) {
        subs.set(subsystem, {
          reactions: [],
          metabolites: new Set(),
          category: classifySubsystem(subsystem)
        });
      }
      subs.get(subsystem).reactions.push(rxnId);

      // Collect metabolites
      if (rxn.metabolites) {
        Object.keys(rxn.metabolites).forEach(m => {
          subs.get(subsystem).metabolites.add(m);
        });
      }
    });

    return subs;
  }, [currentModel, classifySubsystem]);

  // Build category hierarchy
  const categoryHierarchy = useMemo(() => {
    const categories = new Map();

    for (const [subsystemName, data] of subsystems.entries()) {
      const category = data.category;
      if (!categories.has(category)) {
        categories.set(category, {
          subsystems: [],
          totalReactions: 0,
          totalMetabolites: new Set()
        });
      }
      const cat = categories.get(category);
      cat.subsystems.push(subsystemName);
      cat.totalReactions += data.reactions.length;
      data.metabolites.forEach(m => cat.totalMetabolites.add(m));
    }

    return categories;
  }, [subsystems]);

  // Search handler
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    const query = searchQuery.toLowerCase();
    const results = {
      categories: [],
      subsystems: [],
      reactions: []
    };

    // Search categories
    for (const category of categoryHierarchy.keys()) {
      if (category.toLowerCase().includes(query)) {
        results.categories.push(category);
      }
    }

    // Search subsystems
    for (const subsystemName of subsystems.keys()) {
      if (subsystemName.toLowerCase().includes(query)) {
        results.subsystems.push(subsystemName);
      }
    }

    // Search reactions
    if (currentModel?.reactions) {
      for (const [rxnId, rxn] of Object.entries(currentModel.reactions)) {
        if (rxnId.toLowerCase().includes(query) ||
            rxn.name?.toLowerCase().includes(query)) {
          results.reactions.push({ id: rxnId, name: rxn.name, subsystem: rxn.subsystem });
          if (results.reactions.length >= 20) break; // Limit results
        }
      }
    }

    setSearchResults(results);
  }, [searchQuery, categoryHierarchy, subsystems, currentModel]);

  // Navigation handlers
  const navigateToCategory = useCallback((category) => {
    setSelectedCategory(category);
    setViewLevel('subsystems');
    setNavigationPath([{ type: 'category', name: category }]);
    setSearchQuery('');
    setSearchResults(null);
  }, []);

  const navigateToSubsystem = useCallback((subsystem, fromCategory = null) => {
    setSelectedSubsystem(subsystem);
    setViewLevel('reactions');

    const subsystemData = subsystems.get(subsystem);
    const category = fromCategory || subsystemData?.category || 'Other';

    setNavigationPath([
      { type: 'category', name: category },
      { type: 'subsystem', name: subsystem }
    ]);
    setSearchQuery('');
    setSearchResults(null);

    // Extract reactions belonging to this subsystem for NetworkCanvas
    const allReactions = currentModel?.reactions || {};
    const filtered = Object.fromEntries(
      Object.entries(allReactions).filter(([, rxn]) =>
        (rxn.subsystem || 'Unclassified') === subsystem
      )
    );
    setSubsystemReactions(filtered);
  }, [subsystems, currentModel]);

  const navigateBack = useCallback((toLevel) => {
    if (toLevel === 'categories') {
      setViewLevel('categories');
      setSelectedCategory(null);
      setSelectedSubsystem(null);
      setNavigationPath([]);
    } else if (toLevel === 'subsystems') {
      setViewLevel('subsystems');
      setSelectedSubsystem(null);
      setNavigationPath(prev => prev.slice(0, 1));
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (searchQuery) {
          setSearchQuery('');
          setSearchResults(null);
        } else if (viewLevel === 'reactions') {
          navigateBack('subsystems');
        } else if (viewLevel === 'subsystems') {
          navigateBack('categories');
        }
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, viewLevel, navigateBack]);


  // Get subsystem statistics
  const getSubsystemStats = useCallback((subsystemId) => {
    const data = subsystems.get(subsystemId);
    if (!data) return { reactions: 0, metabolites: 0, avgFlux: 0 };

    // Calculate average absolute flux for subsystem
    let totalFlux = 0;
    let fluxCount = 0;
    data.reactions.forEach(rxnId => {
      if (fluxes[rxnId] !== undefined) {
        totalFlux += Math.abs(fluxes[rxnId]);
        fluxCount++;
      }
    });

    return {
      reactions: data.reactions.length,
      metabolites: data.metabolites.size,
      avgFlux: fluxCount > 0 ? totalFlux / fluxCount : 0
    };
  }, [subsystems, fluxes]);

  // Muted, professional palette — distinct but not distracting
  const CATEGORY_PALETTE = {
    'Carbohydrate Metabolism':        { bg: '#3d7a5a', light: '#f0fdf8', border: '#5a9e78' },
    'Amino Acid Metabolism':          { bg: '#2d6a8a', light: '#f0f8fd', border: '#4a8aaa' },
    'Energy Metabolism':              { bg: '#7a6230', light: '#fdf8f0', border: '#9a8250' },
    'Lipid Metabolism':               { bg: '#5a4a7a', light: '#f8f0fd', border: '#7a6a9a' },
    'Nucleotide Metabolism':          { bg: '#1e3a6e', light: '#f0f4fd', border: '#3a5a8e' },
    'Cofactor & Vitamin Metabolism':  { bg: '#2a6a6a', light: '#f0fdfd', border: '#4a8a8a' },
    'Cell Envelope':                  { bg: '#6a3a4a', light: '#fdf0f4', border: '#8a5a6a' },
    'Transport':                      { bg: '#3a4a6a', light: '#f0f2fd', border: '#5a6a8a' },
    'Other':                          { bg: '#4a5260', light: '#f8f9fa', border: '#6a7280' },
  };

  const CATEGORY_ICONS = {
    'Carbohydrate Metabolism':        'CHO',
    'Amino Acid Metabolism':          'AA',
    'Energy Metabolism':              'E',
    'Lipid Metabolism':               'FA',
    'Nucleotide Metabolism':          'NT',
    'Cofactor & Vitamin Metabolism':  'COF',
    'Cell Envelope':                  'CE',
    'Transport':                      'TR',
    'Other':                          '—',
  };

  const getCategoryPalette = useCallback((name) =>
    CATEGORY_PALETTE[name] || CATEGORY_PALETTE['Other'], []);

  // Get color for subsystem based on flux activity
  const getSubsystemColor = useCallback((subsystemId) => {
    const stats = getSubsystemStats(subsystemId);
    if (stats.avgFlux === 0) return isDark ? '#4b5563' : '#9ca3af';
    if (stats.avgFlux > 5) return accessibleColors.success;
    if (stats.avgFlux > 1) return accessibleColors.info;
    return accessibleColors.warning;
  }, [getSubsystemStats, isDark, accessibleColors]);

  // Get category color (based on aggregate flux activity)
  const getCategoryColor = useCallback((categoryName) => {
    const catData = categoryHierarchy.get(categoryName);
    if (!catData) return isDark ? '#4b5563' : '#9ca3af';

    // Calculate average flux across all reactions in category
    let totalFlux = 0;
    let fluxCount = 0;

    catData.subsystems.forEach(subName => {
      const subData = subsystems.get(subName);
      if (subData) {
        subData.reactions.forEach(rxnId => {
          if (fluxes[rxnId] !== undefined) {
            totalFlux += Math.abs(fluxes[rxnId]);
            fluxCount++;
          }
        });
      }
    });

    const avgFlux = fluxCount > 0 ? totalFlux / fluxCount : 0;
    if (avgFlux === 0) return isDark ? '#4b5563' : '#9ca3af';
    if (avgFlux > 5) return accessibleColors.success;
    if (avgFlux > 1) return accessibleColors.info;
    return accessibleColors.warning;
  }, [categoryHierarchy, subsystems, fluxes, isDark, accessibleColors]);

  // Render breadcrumb navigation
  const renderBreadcrumbs = () => (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
      <button
        onClick={() => navigateBack('categories')}
        className={`px-2 py-1 rounded hover:bg-[var(--bg-secondary)] ${
          viewLevel === 'categories' ? 'font-semibold text-[var(--primary)]' : 'text-[var(--text-secondary)]'
        }`}
      >
        All Pathways
      </button>

      {navigationPath.map((item, index) => (
        <React.Fragment key={`${item.type}-${item.name}`}>
          <span className="text-[var(--text-muted)]">/</span>
          <button
            onClick={() => {
              if (item.type === 'category') navigateBack('subsystems');
            }}
            className={`px-2 py-1 rounded hover:bg-[var(--bg-secondary)] truncate max-w-[200px] ${
              index === navigationPath.length - 1
                ? 'font-semibold text-[var(--primary)]'
                : 'text-[var(--text-secondary)]'
            }`}
            title={item.name}
          >
            {item.name.length > 25 ? item.name.substring(0, 23) + '...' : item.name}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );

  // Render search results dropdown
  const renderSearchResults = () => {
    if (!searchResults) return null;

    const hasResults = searchResults.categories.length > 0 ||
                       searchResults.subsystems.length > 0 ||
                       searchResults.reactions.length > 0;

    if (!hasResults) {
      return (
        <div className="absolute top-full left-0 right-0 mt-1 p-3 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-lg z-10">
          <p className="text-sm text-[var(--text-muted)]">No results for "{searchQuery}"</p>
        </div>
      );
    }

    return (
      <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
        {searchResults.categories.length > 0 && (
          <div className="p-2 border-b border-[var(--card-border)]">
            <p className="text-xs font-medium text-[var(--text-muted)] mb-1">Categories</p>
            {searchResults.categories.map(cat => (
              <button
                key={cat}
                onClick={() => navigateToCategory(cat)}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-[var(--bg-secondary)] rounded"
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {searchResults.subsystems.length > 0 && (
          <div className="p-2 border-b border-[var(--card-border)]">
            <p className="text-xs font-medium text-[var(--text-muted)] mb-1">Subsystems</p>
            {searchResults.subsystems.slice(0, 10).map(sub => (
              <button
                key={sub}
                onClick={() => navigateToSubsystem(sub)}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-[var(--bg-secondary)] rounded truncate"
              >
                {sub}
              </button>
            ))}
          </div>
        )}

        {searchResults.reactions.length > 0 && (
          <div className="p-2">
            <p className="text-xs font-medium text-[var(--text-muted)] mb-1">Reactions</p>
            {searchResults.reactions.map(rxn => (
              <button
                key={rxn.id}
                onClick={() => {
                  if (rxn.subsystem) navigateToSubsystem(rxn.subsystem);
                  onReactionSelect?.(rxn.id);
                }}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-[var(--bg-secondary)] rounded"
              >
                <span className="font-mono">{rxn.id}</span>
                {rxn.name && <span className="text-[var(--text-muted)] ml-2">- {rxn.name}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Model overview dashboard (shown above category cards)
  const renderModelDashboard = () => {
    const reactions = currentModel?.reactions || {};
    const metabolites = currentModel?.metabolites || {};
    const genes = currentModel?.genes || {};

    const rxnList = Object.values(reactions);
    const reversible = rxnList.filter(r => (r.lower_bound ?? -1000) < 0).length;
    // GPR coverage: try gene_reaction_rule strings first; fall back to gene→reaction associations
    const rxnsWithGenes = new Set();
    Object.values(genes).forEach(g => (g.reactions || []).forEach(rid => rxnsWithGenes.add(rid)));
    const withGPR = rxnList.filter(r =>
      (r.gene_reaction_rule && r.gene_reaction_rule.trim()) ||
      (r.gpr && r.gpr.trim()) ||
      rxnsWithGenes.has(r.id)
    ).length;
    const exchange = rxnList.filter(r => r.id?.startsWith('EX_') || r.subsystem?.toLowerCase().includes('exchange')).length;
    const blocked = rxnList.filter(r => r.lower_bound === 0 && r.upper_bound === 0).length;

    const metList = Object.values(metabolites);
    const compartments = [...new Set(metList.map(m => m.compartment || (m.id || '').split('_').pop()).filter(Boolean))];

    const pctRev = rxnList.length ? Math.round((reversible / rxnList.length) * 100) : 0;
    const pctGPR = rxnList.length ? Math.round((withGPR / rxnList.length) * 100) : 0;

    const statCards = [
      { label: 'Reactions',     value: rxnList.length.toLocaleString(),        sub: `${pctRev}% reversible`         },
      { label: 'Metabolites',   value: metList.length.toLocaleString(),        sub: `${compartments.length} compartments` },
      { label: 'Genes',         value: Object.keys(genes).length.toLocaleString(), sub: `unique genes · ${pctGPR}% rxn coverage`   },
      { label: 'Subsystems',    value: subsystems.size.toLocaleString(),       sub: `${categoryHierarchy.size} categories` },
      { label: 'Exchange',      value: exchange.toLocaleString(),              sub: 'boundary reactions'            },
      { label: 'Blocked',       value: blocked.toLocaleString(),               sub: 'lb = ub = 0'                  },
    ];

    return (
      <div className="px-4 pt-3 pb-0 space-y-3">
        {/* Stat row — flat, monochrome, information-dense */}
        <div className="grid grid-cols-3 md:grid-cols-6" style={{ border: '1px solid var(--border-color)', borderRadius: 3, overflow: 'hidden' }}>
          {statCards.map((s, i) => (
            <div key={s.label} className="p-3 flex flex-col gap-0.5"
              style={{
                background: 'var(--bg-secondary)',
                borderRight: i < statCards.length - 1 ? '1px solid var(--border-color)' : 'none',
              }}>
              <span className="text-[10px] font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
              <span className="text-xl font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>{s.value}</span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{s.sub}</span>
            </div>
          ))}
        </div>

        {/* 3-panel chart row: GPR donut | Compartments bar | Directionality donut */}
        {(() => {
          const rxns = Object.values(currentModel?.reactions || {});
          const modelGenes = currentModel?.genes || {};
          const total = rxns.length || 1;
          const geneRxnSet = new Set();
          Object.values(modelGenes).forEach(g => (g.reactions || []).forEach(rid => geneRxnSet.add(rid)));
          const withGPR = rxns.filter(r =>
            (r.gene_reaction_rule && r.gene_reaction_rule.trim()) ||
            (r.gpr && r.gpr.trim()) ||
            geneRxnSet.has(r.id)
          ).length;
          const exchangeCount = rxns.filter(r => r.id?.startsWith('EX_') || (r.lower_bound < 0 && Object.keys(r.metabolites || {}).length === 1)).length;
          const spontaneous = rxns.filter(r => {
            const hasGPR = (r.gene_reaction_rule && r.gene_reaction_rule.trim()) || (r.gpr && r.gpr.trim()) || geneRxnSet.has(r.id);
            return !hasGPR && !(r.id?.startsWith('EX_'));
          }).length;

          // Directionality
          const reversible = rxns.filter(r => (r.lower_bound ?? -1000) < 0 && (r.upper_bound ?? 1000) > 0).length;
          const irreversible = total - reversible;

          // Compartment breakdown
          const compartmentCounts = {};
          Object.keys(currentModel?.metabolites || {}).forEach(mid => {
            const parts = mid.split('_');
            const comp = parts[parts.length - 1] || '?';
            compartmentCounts[comp] = (compartmentCounts[comp] || 0) + 1;
          });
          const compList = Object.entries(compartmentCounts).sort((a, b) => b[1] - a[1]);
          const totalMets = compList.reduce((s, [, v]) => s + v, 0) || 1;
          const COMP_COLORS = { c: '#3b82f6', e: '#10b981', p: '#f59e0b', m: '#8b5cf6', x: '#ef4444', n: '#ec4899' };
          const COMP_NAMES  = { c: 'Cytoplasm', e: 'Extracellular', p: 'Periplasm', m: 'Mitochondria', x: 'Peroxisome', n: 'Nucleus' };
          const compColors  = compList.map(([comp], i) => COMP_COLORS[comp] || `hsl(${(i * 53) % 360},38%,52%)`);

          // GPR donut data
          const gprData = [
            { label: 'Gene-associated',      value: withGPR,       color: 'var(--primary)' },
            { label: 'Spontaneous/transport', value: spontaneous,   color: 'var(--border-color)' },
            { label: 'Exchange/demand',       value: exchangeCount, color: '#94a3b8' },
          ].filter(d => d.value > 0);

          // Directionality donut data
          const dirData = [
            { label: 'Reversible',   value: reversible,   color: '#3b82f6' },
            { label: 'Irreversible', value: irreversible, color: '#64748b' },
          ].filter(d => d.value > 0);

          const panelStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 3 };

          return (
            <div className="grid grid-cols-3 gap-3">
              {/* Panel 1 — GPR Coverage donut */}
              <div className="p-4 flex flex-col" style={panelStyle}>
                <p className="text-[10px] font-medium uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>GPR Coverage</p>
                <div className="flex items-center gap-4">
                  <DonutChart data={gprData} total={total} size={108} centerValue={`${Math.round((withGPR/total)*100)}%`} centerLabel="GPR" />
                  <div className="flex flex-col gap-2 min-w-0">
                    {gprData.map(d => (
                      <div key={d.label} className="flex items-center gap-1.5 min-w-0">
                        <span style={{ width: 8, height: 8, borderRadius: 1, background: d.color, flexShrink: 0, display: 'inline-block' }} />
                        <span className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>{d.label}</span>
                        <span className="text-[10px] ml-auto pl-1 font-mono" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Panel 2 — Compartment proportional bar */}
              <div className="p-4 flex flex-col" style={panelStyle}>
                <p className="text-[10px] font-medium uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Metabolite Compartments</p>
                {/* Stacked bar */}
                <div className="flex h-5 overflow-hidden mb-3" style={{ borderRadius: 2 }}>
                  {compList.map(([comp, count], i) => (
                    <div key={comp} style={{ width: `${(count / totalMets) * 100}%`, background: compColors[i], flexShrink: 0 }} title={`${COMP_NAMES[comp] || comp}: ${count}`} />
                  ))}
                </div>
                <div className="space-y-1.5 flex-1">
                  {compList.map(([comp, count], i) => (
                    <div key={comp} className="flex items-center gap-1.5">
                      <span style={{ width: 8, height: 8, borderRadius: 1, background: compColors[i], flexShrink: 0, display: 'inline-block' }} />
                      <code className="text-[10px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>[{comp}]</code>
                      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{COMP_NAMES[comp] || comp.toUpperCase()}</span>
                      <span className="text-[10px] ml-auto font-mono" style={{ color: 'var(--text-muted)' }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Panel 3 — Reaction Directionality donut */}
              <div className="p-4 flex flex-col" style={panelStyle}>
                <p className="text-[10px] font-medium uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Reaction Directionality</p>
                <div className="flex items-center gap-4">
                  <DonutChart data={dirData} total={total} size={108} centerValue={`${Math.round((reversible/total)*100)}%`} centerLabel="rev." />
                  <div className="flex flex-col gap-2 min-w-0">
                    {dirData.map(d => (
                      <div key={d.label} className="flex items-center gap-1.5 min-w-0">
                        <span style={{ width: 8, height: 8, borderRadius: 1, background: d.color, flexShrink: 0, display: 'inline-block' }} />
                        <span className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>{d.label}</span>
                        <span className="text-[10px] ml-auto pl-1 font-mono" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{d.value}</span>
                      </div>
                    ))}
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                      lb &lt; 0 &amp;&amp; ub &gt; 0 → reversible
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  const renderDashboardFooter = () => (
    <footer className="mx-4 mt-2 mb-3 pt-4" style={{ borderTop: '1px solid var(--border-color)' }}>
      <div className="grid grid-cols-3 gap-6 mb-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Supported Formats</p>
          <ul className="space-y-1">
            {['SBML Level 2 / Level 3', 'SBML FBC v2 (flux bounds, GPR)', 'SBML Groups (subsystems)', 'SBML Layout (coordinates)', 'JSON — CobraPy / BIGG Models'].map(f => (
              <li key={f} className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{f}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Model Databases</p>
          <ul className="space-y-1">
            {['BIGG Models (bigg.ucsd.edu)', 'BioModels (ebi.ac.uk/biomodels)', 'MetaNetX (metanetx.org)', 'BioCyc / EcoCyc (biocyc.org)', 'KEGG (genome.jp/kegg)'].map(d => (
              <li key={d} className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{d}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Analysis Methods</p>
          <ul className="space-y-1">
            {['FBA — Flux Balance Analysis', 'pFBA — Parsimonious FBA', 'FVA — Flux Variability Analysis', 'MOMA — Minimization of Metabolic Adjustment', 'Gene Knockout Simulation'].map(a => (
              <li key={a} className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{a}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          MetaboViz v0.1.0 — browser-native constraint-based modelling
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          © 2026 MetaboViz. For research and educational use.
        </span>
      </div>
    </footer>
  );

  // Squarified treemap helpers
  const buildTreemapRects = useCallback(() => {
    const TW = 1200, TH = 420;
    const PAD = 3;
    const categories = Array.from(categoryHierarchy.entries())
      .sort((a, b) => b[1].totalReactions - a[1].totalReactions);
    const total = categories.reduce((s, [, d]) => s + d.totalReactions, 0) || 1;

    const rects = [];
    let curY = 0;

    for (const [catName, catData] of categories) {
      const catH = (catData.totalReactions / total) * TH;
      const palette = getCategoryPalette(catName);
      const subs = catData.subsystems
        .map(s => ({ name: s, reactions: subsystems.get(s)?.reactions.length || 0 }))
        .sort((a, b) => b.reactions - a.reactions);
      const catTotal = subs.reduce((s, sub) => s + sub.reactions, 0) || 1;

      let curX = 0;
      for (const sub of subs) {
        const w = (sub.reactions / catTotal) * TW;
        rects.push({ x: curX, y: curY, w, h: catH, category: catName, subsystem: sub.name, reactions: sub.reactions, color: palette.bg });
        curX += w;
      }
      curY += catH;
    }
    return { rects, TW, TH, PAD };
  }, [categoryHierarchy, subsystems, getCategoryPalette]);

  const downloadTreemapSVG = useCallback(() => {
    if (!treemapRef.current) return;
    const clone = treemapRef.current.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(clone);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentModel?.id || 'model'}-treemap.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [currentModel?.id]);

  const renderCategoryBar = () => {
    const categories = Array.from(categoryHierarchy.entries())
      .sort((a, b) => b[1].totalReactions - a[1].totalReactions);
    const total = categories.reduce((s, [, d]) => s + d.totalReactions, 0) || 1;

    return (
      <div className="px-4 pb-2">
        <div className="p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 3 }}>
          <p className="text-[10px] font-medium uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            Pathway distribution — click to navigate
          </p>

          {/* Stacked proportion bar */}
          <div className="flex h-6 overflow-hidden mb-3" style={{ borderRadius: 2 }}>
            {categories.map(([cat, data]) => {
              const palette = getCategoryPalette(cat);
              const pct = (data.totalReactions / total) * 100;
              if (pct < 0.5) return null;
              return (
                <button
                  key={cat}
                  onClick={() => navigateToCategory(cat)}
                  title={`${cat}: ${data.totalReactions} rxns (${pct.toFixed(1)}%)`}
                  style={{ width: `${pct}%`, background: palette.bg, flexShrink: 0, minWidth: 2 }}
                />
              );
            })}
          </div>

          {/* Legend — compact inline chips */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {categories.map(([cat, data]) => {
              const palette = getCategoryPalette(cat);
              const pct = ((data.totalReactions / total) * 100).toFixed(1);
              return (
                <button
                  key={cat}
                  onClick={() => navigateToCategory(cat)}
                  className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
                >
                  <span style={{ width: 8, height: 8, borderRadius: 1, background: palette.bg, flexShrink: 0, display: 'inline-block' }} />
                  <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{cat}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{pct}%</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // Render compact category table (top level)
  const renderCategoryCards = () => {
    const categoryList = Array.from(categoryHierarchy.entries())
      .sort((a, b) => b[1].totalReactions - a[1].totalReactions);
    const totalRxns = categoryList.reduce((s, [, d]) => s + d.totalReactions, 0) || 1;
    const maxRxns   = categoryList[0]?.[1].totalReactions || 1;

    const thCls = 'px-3 py-2 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest text-left select-none bg-[var(--bg-secondary)] border-b border-[var(--border-color)]';

    return (
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${thCls} w-8`}>#</th>
              <th className={thCls}>Category</th>
              <th className={`${thCls} text-right w-20`}>Reactions</th>
              <th className={`${thCls} w-52`}>Distribution</th>
              <th className={`${thCls} text-right w-12`}>%</th>
              <th className={`${thCls} text-right w-20`}>Metabolites</th>
              <th className={`${thCls} text-right w-24`}>Subsystems</th>
            </tr>
          </thead>
          <tbody>
            {categoryList.map(([category, data], idx) => {
              const palette = getCategoryPalette(category);
              const icon    = CATEGORY_ICONS[category] || '📦';
              const pct     = Math.round((data.totalReactions / totalRxns) * 100);
              const barW    = Math.round((data.totalReactions / maxRxns) * 100);
              return (
                <tr key={category}
                  onClick={() => navigateToCategory(category)}
                  className="border-b border-[var(--border-color)] hover:bg-[var(--bg-primary)] cursor-pointer group transition-colors">
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)] font-mono text-center">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: palette.bg }} />
                      <span className="text-base leading-none">{icon}</span>
                      <span className="font-medium text-[var(--text-primary)] group-hover:underline text-sm">{category}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-[var(--text-secondary)]">
                    {data.totalReactions.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${barW}%`, backgroundColor: palette.bg, opacity: 0.75 }} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-mono font-bold" style={{ color: palette.bg }}>{pct}%</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-[var(--text-muted)]">
                    {data.totalMetabolites.size.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded text-white" style={{ backgroundColor: palette.bg }}>
                      {data.subsystems.length}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // Render subsystem list for a category
  const renderSubsystemList = () => {
    const catData = categoryHierarchy.get(selectedCategory);
    if (!catData) return null;
    const palette = getCategoryPalette(selectedCategory);

    const sortedSubsystems = catData.subsystems
      .map(name => ({ name, subData: subsystems.get(name) }))
      .sort((a, b) => (b.subData?.reactions.length || 0) - (a.subData?.reactions.length || 0));

    const maxRxns = Math.max(...sortedSubsystems.map(s => s.subData?.reactions.length || 0), 1);

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
        {sortedSubsystems.map(({ name, subData }) => {
          const stats = getSubsystemStats(name);
          const barPct = Math.round(((subData?.reactions.length || 0) / maxRxns) * 100);
          return (
            <button
              key={name}
              onClick={() => navigateToSubsystem(name, selectedCategory)}
              className="p-3 text-left bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg hover:shadow-md transition-all hover:-translate-y-0.5"
              style={{ borderLeft: `3px solid ${palette.bg}` }}
            >
              <h5 className="font-medium text-[var(--text-primary)] mb-1 truncate text-sm" title={name}>
                {name}
              </h5>
              <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] mb-2">
                <span>{stats.reactions} reactions</span>
                <span>·</span>
                <span>{stats.metabolites} metabolites</span>
              </div>
              <div className="w-full h-1 rounded-full bg-[var(--bg-primary)] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${barPct}%`, backgroundColor: palette.bg, opacity: 0.7 }}
                />
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  // ── CSV helpers (for full-model Reactions tab) ──────────────────────────
  const exportAllReactionsCSV = useCallback(() => {
    const mets = currentModel?.metabolites || {};
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'id,name,lower_bound,upper_bound,gene_reaction_rule,subsystem,stoichiometry_info';
    const lines = Object.entries(currentModel?.reactions || {}).map(([id, rxn]) => {
      const r = Object.entries(rxn.metabolites || {}).filter(([,c]) => c < 0).map(([m]) => mets[m]?.name || m).join(' + ');
      const p = Object.entries(rxn.metabolites || {}).filter(([,c]) => c > 0).map(([m]) => mets[m]?.name || m).join(' + ');
      return [id, rxn.name || '', rxn.lower_bound ?? -1000, rxn.upper_bound ?? 1000,
        rxn.gpr || rxn.gene_reaction_rule || '', rxn.subsystem || '', `${r} → ${p}`].map(esc).join(',');
    });
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${currentModel?.id || 'model'}_reactions.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [currentModel]);

  const exportMetabolitesCSV = useCallback(() => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'id,name,formula,compartment,charge';
    const lines = Object.entries(currentModel?.metabolites || {}).map(([id, met]) =>
      [id, met.name || '', met.formula || '', met.compartment || '', met.charge ?? ''].map(esc).join(',')
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${currentModel?.id || 'model'}_metabolites.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [currentModel]);

  const exportGenesCSV = useCallback(() => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const geneRxnMap = {};
    Object.entries(currentModel?.reactions || {}).forEach(([rxnId, rxn]) => {
      const rule = rxn.gpr || rxn.gene_reaction_rule || '';
      if (!rule) return;
      rule.replace(/[()]/g, '').split(/\s+(?:and|or)\s+/i).map(g => g.trim()).filter(Boolean)
        .forEach(g => { if (!geneRxnMap[g]) geneRxnMap[g] = { rxns: [], rule }; geneRxnMap[g].rxns.push(rxnId); });
    });
    const header = 'id,name,reaction_count,associated_reactions,example_gpr';
    const lines = Object.entries(currentModel?.genes || {}).map(([id, gene]) => {
      const info = geneRxnMap[id] || { rxns: [], rule: '' };
      return [id, gene.product || gene.name || '', info.rxns.length, info.rxns.join(';'), info.rule].map(esc).join(',');
    });
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${currentModel?.id || 'model'}_genes.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [currentModel]);

  const exportSmatrixCSV = useCallback(() => {
    const rxns = currentModel?.reactions || {};
    const mets = currentModel?.metabolites || {};
    const rxnIds = Object.keys(rxns);
    const metIds = Object.keys(mets);
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [esc('metabolite_id'), ...rxnIds.map(esc)].join(',');
    const lines = metIds.map(metId => {
      const coeffs = rxnIds.map(rxnId => rxns[rxnId]?.metabolites?.[metId] ?? 0);
      return [esc(metId), ...coeffs].join(',');
    });
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${currentModel?.id || 'model'}_smatrix.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [currentModel]);

  const exportFluxCSV = useCallback(() => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rxns = currentModel?.reactions || {};
    const FLUX_TOL = 1e-6;
    const header = 'reaction_id,flux,lower_bound,upper_bound,subsystem,gpr,active';
    const lines = Object.entries(rxns).map(([id, rxn]) => {
      const f = fluxes[id] ?? 0;
      return [id, f.toFixed(8), rxn.lower_bound ?? -1000, rxn.upper_bound ?? 1000,
        rxn.subsystem || '', rxn.gpr || rxn.gene_reaction_rule || '',
        Math.abs(f) > FLUX_TOL ? 'yes' : 'no'].map(esc).join(',');
    });
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${currentModel?.id || 'model'}_flux_results.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [currentModel, fluxes]);

  // Inline reaction editing state
  const [editingRxnId, setEditingRxnId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const startEdit = (row) => {
    setEditingRxnId(row.id);
    setEditDraft({ name: row.name, lb: row.lb, ub: row.ub, gpr: row.gpr, subsystem: row.subsystem });
  };
  const cancelEdit = () => { setEditingRxnId(null); setEditDraft({}); };
  const saveEdit = () => {
    if (!editingRxnId) return;
    updateReactions({ [editingRxnId]: {
      name: editDraft.name,
      lower_bound: parseFloat(editDraft.lb) || 0,
      upper_bound: parseFloat(editDraft.ub) || 0,
      gene_reaction_rule: editDraft.gpr,
      subsystem: editDraft.subsystem,
    }});
    cancelEdit();
  };

  const [csvImportMsg, setCsvImportMsg] = useState(null);
  const handleCSVImport = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
      const idx = k => headers.indexOf(k);
      if (idx('id') === -1) throw new Error('CSV must have an "id" column');
      const updates = {};
      for (let i = 1; i < lines.length; i++) {
        const cols = []; let cur = '', inQ = false;
        for (const ch of lines[i] + ',') {
          if (ch === '"') { inQ = !inQ; } else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; } else cur += ch;
        }
        const id = cols[idx('id')]?.trim(); if (!id) continue;
        const u = {};
        if (idx('lower_bound') !== -1 && cols[idx('lower_bound')] !== undefined) u.lower_bound = parseFloat(cols[idx('lower_bound')]) || 0;
        if (idx('upper_bound') !== -1 && cols[idx('upper_bound')] !== undefined) u.upper_bound = parseFloat(cols[idx('upper_bound')]) || 0;
        if (idx('gene_reaction_rule') !== -1) u.gene_reaction_rule = (cols[idx('gene_reaction_rule')] || '').trim();
        if (idx('subsystem') !== -1) u.subsystem = (cols[idx('subsystem')] || '').trim();
        if (idx('name') !== -1) u.name = (cols[idx('name')] || '').trim();
        updates[id] = u;
      }
      const count = Object.keys(updates).length;
      if (!count) throw new Error('No valid rows found');
      updateReactions(updates);
      setCsvImportMsg({ ok: true, text: `Updated ${count} reactions` });
    } catch (err) { setCsvImportMsg({ ok: false, text: err.message }); }
    if (csvImportRef.current) csvImportRef.current.value = '';
    setTimeout(() => setCsvImportMsg(null), 4000);
  }, [updateReactions]);

  // ── JSON model export ────────────────────────────────────────────────────
  const exportModelJSON = useCallback(() => {
    const m = currentModel;
    const json = {
      id: m.id, name: m.name,
      reactions: Object.entries(m.reactions || {}).map(([id, r]) => ({
        id, name: r.name, metabolites: r.metabolites,
        lower_bound: r.lower_bound, upper_bound: r.upper_bound,
        gene_reaction_rule: r.gene_reaction_rule, subsystem: r.subsystem,
      })),
      metabolites: Object.entries(m.metabolites || {}).map(([id, met]) => ({
        id, name: met.name, formula: met.formula, compartment: met.compartment,
        charge: met.charge,
      })),
      genes: Object.entries(m.genes || {}).map(([id, g]) => ({ id, name: g.name })),
    };
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${m.id || 'model'}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [currentModel]);

  // ── Reactions tab ────────────────────────────────────────────────────────
  const renderReactionsTab = () => {
    const allRxns = currentModel?.reactions || {};
    const mets = currentModel?.metabolites || {};
    const rows = Object.entries(allRxns).map(([id, rxn]) => {
      const r = Object.entries(rxn.metabolites || {}).filter(([,c]) => c < 0).map(([m]) => mets[m]?.name || m);
      const p = Object.entries(rxn.metabolites || {}).filter(([,c]) => c > 0).map(([m]) => mets[m]?.name || m);
      return { id, name: rxn.name || '', reactants: r, products: p,
        rev: (rxn.lower_bound ?? -1000) < 0, hasGPR: !!(rxn.gpr || rxn.gene_reaction_rule),
        lb: rxn.lower_bound ?? -1000, ub: rxn.upper_bound ?? 1000,
        gpr: rxn.gpr || rxn.gene_reaction_rule || '', subsystem: rxn.subsystem || '' };
    });
    const qlo = reactionsQuery.toLowerCase();
    const filtered = qlo ? rows.filter(r =>
      r.id.toLowerCase().includes(qlo) || r.name.toLowerCase().includes(qlo) ||
      r.reactants.some(m => m.toLowerCase().includes(qlo)) ||
      r.products.some(m => m.toLowerCase().includes(qlo)) ||
      r.gpr.toLowerCase().includes(qlo) || r.subsystem.toLowerCase().includes(qlo)
    ) : rows;

    // column accent palette
    const RC = {
      id:   { accent: '#22c55e', hdr: isDark ? '#052e16' : '#f0fdf4', txt: isDark ? '#4ade80' : '#166534' },
      eq:   { accent: '#3b82f6', hdr: isDark ? '#0c1a3a' : '#eff6ff', txt: isDark ? '#93c5fd' : '#1e40af' },
      sub:  { accent: '#f97316', hdr: isDark ? '#2c0a00' : '#fff7ed', txt: isDark ? '#fdba74' : '#9a3412' },
      bnd:  { accent: '#eab308', hdr: isDark ? '#2d1b00' : '#fefce8', txt: isDark ? '#fde68a' : '#854d0e' },
      gpr:  { accent: '#a855f7', hdr: isDark ? '#1e0a3c' : '#faf5ff', txt: isDark ? '#d8b4fe' : '#6b21a8' },
      edit: { accent: '#64748b', hdr: isDark ? '#1e293b' : '#f1f5f9', txt: isDark ? '#94a3b8' : '#475569' },
    };
    const th = (col, label, extra = {}) => (
      <th style={{ padding: '5px 8px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', background: RC[col].hdr, color: RC[col].txt, borderRight: `1.5px solid ${RC[col].accent}44`, borderBottom: `2.5px solid ${RC[col].accent}99`, whiteSpace: 'nowrap', userSelect: 'none', textAlign: extra.center ? 'center' : 'left', ...extra }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: RC[col].accent, opacity: 0.7, flexShrink: 0, display: 'inline-block' }} />
          {label}
        </span>
      </th>
    );
    const rowBg = (i, editing) => editing ? (isDark ? '#1e3a5f' : '#eff6ff') : i % 2 === 0 ? (isDark ? '#0f172a' : '#ffffff') : (isDark ? '#1e293b' : '#f8fafc');
    const tdBorder = col => ({ borderRight: `1.5px solid ${RC[col].accent}22` });
    const inCls = 'w-full text-[10px] px-1.5 py-0.5 border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--primary)]';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* toolbar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '6px 12px', flexShrink: 0, background: isDark ? '#0d1726' : '#f1f5f9', borderBottom: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'system-ui', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Reactions</span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'system-ui' }}>
            <b style={{ color: 'var(--text-secondary)' }}>{filtered.length}</b> / {rows.length}
            &nbsp;&middot;&nbsp;
            <span style={{ color: '#d97706' }}>{rows.filter(r => r.rev).length} reversible</span>
          </span>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
            <button onClick={exportAllReactionsCSV}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 9, border: '1px solid var(--border-color)', borderRadius: 2, color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer', fontFamily: 'system-ui' }}>
              <Download className="w-3 h-3" /> Export CSV
            </button>
            <button onClick={() => csvImportRef.current?.click()}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 9, border: '1px solid var(--border-color)', borderRadius: 2, color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer', fontFamily: 'system-ui' }}>
              <FileText className="w-3 h-3" /> Import CSV
            </button>
            <input ref={csvImportRef} type="file" accept=".csv" onChange={handleCSVImport} style={{ display: 'none' }} />
            <input value={reactionsQuery} onChange={e => setReactionsQuery(e.target.value)}
              placeholder="Filter…"
              style={{ fontSize: 9, padding: '3px 8px', border: '1px solid var(--border-color)', borderRadius: 2, background: isDark ? '#1e293b' : '#fff', color: 'var(--text-secondary)', width: 170, fontFamily: 'system-ui' }} />
          </div>
        </div>
        {csvImportMsg && (
          <div style={{ padding: '4px 12px', fontSize: 9, fontFamily: 'system-ui', background: csvImportMsg.ok ? (isDark ? '#052e16' : '#f0fdf4') : (isDark ? '#450a0a' : '#fef2f2'), color: csvImportMsg.ok ? '#16a34a' : '#dc2626' }}>
            {csvImportMsg.ok ? '✓' : '✗'} {csvImportMsg.text}
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 140 }} /><col /><col style={{ width: 140 }} />
              <col style={{ width: 110 }} /><col style={{ width: 176 }} /><col style={{ width: 64 }} />
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr>
                {th('id',  'ID')}
                {th('eq',  'Stoichiometry')}
                {th('sub', 'Subsystem')}
                {th('bnd', 'Bounds [lb, ub]')}
                {th('gpr', 'GPR')}
                {th('edit','Edit', { textAlign: 'center' })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const isEditing = editingRxnId === row.id;
                const confirming = confirmDeleteId === row.id;
                return (
                  <tr key={row.id}
                    style={{ background: rowBg(i, isEditing), borderBottom: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`, cursor: isEditing ? 'default' : 'pointer' }}
                    onClick={!isEditing ? () => onReactionSelect?.(row.id) : undefined}>
                    <td style={{ padding: '5px 8px', fontSize: 9, fontFamily: 'var(--font-mono)', ...tdBorder('id') }} onClick={e => isEditing && e.stopPropagation()}>
                      <div style={{ fontWeight: 600, color: RC.id.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.id}</div>
                      {isEditing ? (
                        <input value={editDraft.name} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                          className={inCls} placeholder="Display name" onClick={e => e.stopPropagation()} />
                      ) : (
                        <>
                          {row.name && row.name !== row.id && <div style={{ fontSize: 8.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.name}>{row.name}</div>}
                          <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                            {row.rev    && <span style={{ padding: '0 4px', fontSize: 8, borderRadius: 2, background: isDark ? '#451a03' : '#fef3c7', color: '#d97706' }}>rev</span>}
                            {row.hasGPR && <span style={{ padding: '0 4px', fontSize: 8, borderRadius: 2, background: isDark ? '#1e3a5f' : '#dbeafe', color: RC.gpr.accent }}>gpr</span>}
                          </div>
                        </>
                      )}
                    </td>
                    <td style={{ padding: '5px 8px', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', ...tdBorder('eq') }}>
                      <span style={{ color: isDark ? '#f87171' : '#dc2626' }}>{row.reactants.slice(0,3).join(' + ')}{row.reactants.length > 3 ? ` +${row.reactants.length-3}` : ''}</span>
                      <span style={{ margin: '0 4px', color: 'var(--text-muted)' }}>{row.rev ? '⇌' : '→'}</span>
                      <span style={{ color: isDark ? '#4ade80' : '#16a34a' }}>{row.products.slice(0,3).join(' + ')}{row.products.length > 3 ? ` +${row.products.length-3}` : ''}</span>
                    </td>
                    <td style={{ padding: '5px 8px', fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...tdBorder('sub') }} onClick={e => isEditing && e.stopPropagation()}>
                      {isEditing ? (
                        <input value={editDraft.subsystem} onChange={e => setEditDraft(d => ({ ...d, subsystem: e.target.value }))}
                          className={inCls} placeholder="Subsystem" onClick={e => e.stopPropagation()} />
                      ) : (
                        <span title={row.subsystem}>{row.subsystem || '—'}</span>
                      )}
                    </td>
                    <td style={{ padding: '5px 8px', fontSize: 9, fontFamily: 'var(--font-mono)', color: RC.bnd.accent, ...tdBorder('bnd') }} onClick={e => isEditing && e.stopPropagation()}>
                      {isEditing ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
                          <input type="number" value={editDraft.lb} onChange={e => setEditDraft(d => ({ ...d, lb: e.target.value }))}
                            className="w-16 text-[10px] px-1 py-0.5 border border-[var(--border-color)] bg-[var(--bg-primary)] font-mono focus:outline-none" title="Lower bound" />
                          <span style={{ color: 'var(--text-muted)' }}>→</span>
                          <input type="number" value={editDraft.ub} onChange={e => setEditDraft(d => ({ ...d, ub: e.target.value }))}
                            className="w-16 text-[10px] px-1 py-0.5 border border-[var(--border-color)] bg-[var(--bg-primary)] font-mono focus:outline-none" title="Upper bound" />
                        </div>
                      ) : (
                        <span>[{row.lb}, {row.ub}]</span>
                      )}
                    </td>
                    <td style={{ padding: '5px 8px', fontSize: 8.5, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...tdBorder('gpr') }} onClick={e => isEditing && e.stopPropagation()}>
                      {isEditing ? (
                        <input value={editDraft.gpr} onChange={e => setEditDraft(d => ({ ...d, gpr: e.target.value }))}
                          className={inCls} placeholder="gene1 and gene2" onClick={e => e.stopPropagation()} />
                      ) : (
                        <span title={row.gpr}>{row.gpr || '—'}</span>
                      )}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      {isEditing ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <button onClick={saveEdit} title="Save" style={{ padding: 3, borderRadius: 3, background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer' }}><Check className="w-3 h-3" /></button>
                          <button onClick={cancelEdit} title="Cancel" style={{ padding: 3, borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', cursor: 'pointer' }}><XIcon className="w-3 h-3" /></button>
                        </div>
                      ) : confirming ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <button onClick={() => { deleteReaction(row.id); setConfirmDeleteId(null); }} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: '#dc2626', color: '#fff', fontWeight: 700, border: 'none', cursor: 'pointer' }}>del</button>
                          <button onClick={() => setConfirmDeleteId(null)} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, border: '1px solid var(--border-color)', color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer' }}>no</button>
                        </div>
                      ) : (
                        <div className="group-hover-visible" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, opacity: 0 }} onMouseEnter={e => e.currentTarget.style.opacity=1} onMouseLeave={e => e.currentTarget.style.opacity=0}>
                          <button onClick={() => startEdit(row)} title="Edit" style={{ padding: 3, borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}><Pencil className="w-3 h-3" /></button>
                          <button onClick={() => setConfirmDeleteId(row.id)} title="Delete" style={{ padding: 3, borderRadius: 3, background: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}><Trash2 className="w-3 h-3" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'system-ui' }}>No reactions match &ldquo;{reactionsQuery}&rdquo;</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '3px 12px', flexShrink: 0, background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'system-ui' }}>
          <span>{filtered.length} reactions shown</span>
          <span style={{ marginLeft: 'auto', opacity: 0.55 }}>Click row to inspect &middot; hover for edit/delete</span>
        </div>
      </div>
    );
  };

  // ── Metabolites tab ──────────────────────────────────────────────────────
  const renderMetabolitesTab = () => {
    const allMets = currentModel?.metabolites || {};
    const allRxns = currentModel?.reactions || {};
    const qlo = metQuery.toLowerCase();
    const rows = Object.entries(allMets).map(([id, met]) => {
      const rxnCount = Object.values(allRxns).filter(r => id in (r.metabolites || {})).length;
      return { id, name: met.name || '', formula: met.formula || '', compartment: met.compartment || '', rxnCount };
    });
    const filtered = qlo ? rows.filter(r =>
      r.id.toLowerCase().includes(qlo) || r.name.toLowerCase().includes(qlo) ||
      r.formula.toLowerCase().includes(qlo) || r.compartment.toLowerCase().includes(qlo)
    ) : rows;
    const maxRxnCount = Math.max(1, ...rows.map(r => r.rxnCount));
    const COMP_COLOR = { c:'#3b82f6', e:'#f59e0b', p:'#10b981', m:'#8b5cf6', x:'#ef4444', n:'#6366f1' };

    const MC = {
      id:   { accent: '#22c55e', hdr: isDark ? '#052e16' : '#f0fdf4', txt: isDark ? '#4ade80' : '#166534' },
      name: { accent: '#3b82f6', hdr: isDark ? '#0c1a3a' : '#eff6ff', txt: isDark ? '#93c5fd' : '#1e40af' },
      fml:  { accent: '#a855f7', hdr: isDark ? '#1e0a3c' : '#faf5ff', txt: isDark ? '#d8b4fe' : '#6b21a8' },
      cmp:  { accent: '#f97316', hdr: isDark ? '#2c0a00' : '#fff7ed', txt: isDark ? '#fdba74' : '#9a3412' },
      rxn:  { accent: '#6366f1', hdr: isDark ? '#0f172a' : '#eef2ff', txt: isDark ? '#a5b4fc' : '#4338ca' },
    };
    const th = (col, label) => (
      <th style={{ padding: '5px 8px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', background: MC[col].hdr, color: MC[col].txt, borderRight: `1.5px solid ${MC[col].accent}44`, borderBottom: `2.5px solid ${MC[col].accent}99`, whiteSpace: 'nowrap', userSelect: 'none', textAlign: 'left' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: MC[col].accent, opacity: 0.7, flexShrink: 0, display: 'inline-block' }} />
          {label}
        </span>
      </th>
    );
    const rowBg = i => i % 2 === 0 ? (isDark ? '#0f172a' : '#ffffff') : (isDark ? '#1e293b' : '#f8fafc');
    const tdB = col => ({ borderRight: `1.5px solid ${MC[col].accent}22` });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', flexShrink: 0, background: isDark ? '#0d1726' : '#f1f5f9', borderBottom: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'system-ui', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Metabolites</span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'system-ui' }}><b style={{ color: 'var(--text-secondary)' }}>{filtered.length}</b> / {rows.length}</span>
          <input value={metQuery} onChange={e => setMetQuery(e.target.value)} placeholder="Filter by ID, name, formula, compartment…"
            style={{ marginLeft: 'auto', fontSize: 9, padding: '3px 8px', border: '1px solid var(--border-color)', borderRadius: 2, background: isDark ? '#1e293b' : '#fff', color: 'var(--text-secondary)', width: 240, fontFamily: 'system-ui' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 160 }} /><col /><col style={{ width: 120 }} />
              <col style={{ width: 110 }} /><col style={{ width: 130 }} />
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr>
                {th('id',   'Metabolite ID')}
                {th('name', 'Name')}
                {th('fml',  'Formula')}
                {th('cmp',  'Compartment')}
                {th('rxn',  'Reactions')}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={row.id} style={{ background: rowBg(i), borderBottom: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}` }}>
                  <td style={{ padding: '5px 8px', fontSize: 9, fontFamily: 'var(--font-mono)', color: MC.id.accent, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...tdB('id') }}>{row.id}</td>
                  <td style={{ padding: '5px 8px', fontSize: 9, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...tdB('name') }}>{row.name || '—'}</td>
                  <td style={{ padding: '5px 8px', fontSize: 9, fontFamily: 'var(--font-mono)', color: MC.fml.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...tdB('fml') }}>{row.formula || '—'}</td>
                  <td style={{ padding: '5px 8px', fontSize: 9, ...tdB('cmp') }}>
                    {row.compartment ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: COMP_COLOR[row.compartment] || '#94a3b8', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 9 }}>{row.compartment}</span>
                      </span>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '5px 8px', fontSize: 9, ...tdB('rxn') }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: Math.round((row.rxnCount / maxRxnCount) * 56), height: 4, background: `linear-gradient(90deg, ${MC.rxn.accent}cc, ${MC.rxn.accent}44)`, borderRadius: 2, flexShrink: 0 }} />
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: MC.rxn.txt, minWidth: 20 }}>{row.rxnCount}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'system-ui' }}>No metabolites match &ldquo;{metQuery}&rdquo;</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '3px 12px', flexShrink: 0, background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'system-ui' }}>
          <span>{filtered.length} metabolites shown</span>
          <span style={{ marginLeft: 'auto', opacity: 0.55 }}>Bar width = reaction participation count</span>
        </div>
      </div>
    );
  };

  // ── Genes tab ────────────────────────────────────────────────────────────
  const renderGenesTab = () => {
    const allGenes = currentModel?.genes || {};
    const allRxns = currentModel?.reactions || {};
    const qlo = geneQuery.toLowerCase();
    const geneRxns = {};
    Object.entries(allRxns).forEach(([rxnId, rxn]) => {
      const rule = rxn.gpr || rxn.gene_reaction_rule;
      if (!rule) return;
      const genes = rule.replace(/[()]/g, '').split(/\s+(?:and|or)\s+/i).map(g => g.trim()).filter(Boolean);
      genes.forEach(g => { if (!geneRxns[g]) geneRxns[g] = []; geneRxns[g].push(rxnId); });
    });
    const rows = Object.entries(allGenes).map(([id, gene]) => ({
      id, name: gene.product || gene.name || id, rxns: geneRxns[id] || []
    }));
    const filtered = qlo ? rows.filter(r =>
      r.id.toLowerCase().includes(qlo) || r.name.toLowerCase().includes(qlo)
    ) : rows;
    const maxRxns = Math.max(1, ...rows.map(r => r.rxns.length));

    const GC = {
      id:   { accent: '#22c55e', hdr: isDark ? '#052e16' : '#f0fdf4', txt: isDark ? '#4ade80' : '#166534' },
      name: { accent: '#3b82f6', hdr: isDark ? '#0c1a3a' : '#eff6ff', txt: isDark ? '#93c5fd' : '#1e40af' },
      cnt:  { accent: '#eab308', hdr: isDark ? '#2d1b00' : '#fefce8', txt: isDark ? '#fde68a' : '#854d0e' },
      rxns: { accent: '#6366f1', hdr: isDark ? '#0f172a' : '#eef2ff', txt: isDark ? '#a5b4fc' : '#4338ca' },
    };
    const th = (col, label) => (
      <th style={{ padding: '5px 8px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', background: GC[col].hdr, color: GC[col].txt, borderRight: `1.5px solid ${GC[col].accent}44`, borderBottom: `2.5px solid ${GC[col].accent}99`, whiteSpace: 'nowrap', userSelect: 'none', textAlign: 'left' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: GC[col].accent, opacity: 0.7, flexShrink: 0, display: 'inline-block' }} />
          {label}
        </span>
      </th>
    );
    const rowBg = i => i % 2 === 0 ? (isDark ? '#0f172a' : '#ffffff') : (isDark ? '#1e293b' : '#f8fafc');
    const tdB = col => ({ borderRight: `1.5px solid ${GC[col].accent}22` });

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', flexShrink: 0, background: isDark ? '#0d1726' : '#f1f5f9', borderBottom: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'system-ui', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Genes</span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'system-ui' }}><b style={{ color: 'var(--text-secondary)' }}>{filtered.length}</b> / {rows.length}</span>
          <input value={geneQuery} onChange={e => setGeneQuery(e.target.value)} placeholder="Filter by gene ID or name…"
            style={{ marginLeft: 'auto', fontSize: 9, padding: '3px 8px', border: '1px solid var(--border-color)', borderRadius: 2, background: isDark ? '#1e293b' : '#fff', color: 'var(--text-secondary)', width: 200, fontFamily: 'system-ui' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 140 }} /><col style={{ width: 160 }} /><col style={{ width: 110 }} /><col />
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr>
                {th('id',   'Gene ID')}
                {th('name', 'Product / Name')}
                {th('cnt',  'Rxn count')}
                {th('rxns', 'Associated Reactions')}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={row.id} style={{ background: rowBg(i), borderBottom: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}` }}>
                  <td style={{ padding: '5px 8px', fontSize: 9, fontFamily: 'var(--font-mono)', color: GC.id.accent, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...tdB('id') }}>{row.id}</td>
                  <td style={{ padding: '5px 8px', fontSize: 9, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...tdB('name') }}>{row.name !== row.id ? row.name : '—'}</td>
                  <td style={{ padding: '5px 8px', fontSize: 9, ...tdB('cnt') }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: Math.max(2, Math.round((row.rxns.length / maxRxns) * 52)), height: 4, background: `linear-gradient(90deg, ${GC.cnt.accent}cc, ${GC.cnt.accent}44)`, borderRadius: 2, flexShrink: 0 }} />
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: GC.cnt.txt }}>{row.rxns.length}</span>
                    </div>
                  </td>
                  <td style={{ padding: '5px 8px', fontSize: 9, ...tdB('rxns') }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {row.rxns.slice(0, 8).map(r => (
                        <span key={r} style={{ padding: '1px 5px', background: isDark ? '#1e293b' : '#f1f5f9', border: `1px solid ${GC.rxns.accent}44`, borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 8.5, color: GC.rxns.txt }}>{r}</span>
                      ))}
                      {row.rxns.length > 8 && <span style={{ fontSize: 8.5, color: 'var(--text-muted)' }}>+{row.rxns.length - 8} more</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'system-ui' }}>No genes match &ldquo;{geneQuery}&rdquo;</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '3px 12px', flexShrink: 0, background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'system-ui' }}>
          <span>{filtered.length} genes shown</span>
          <span style={{ marginLeft: 'auto', opacity: 0.55 }}>Bar width = reaction associations &middot; Indigo tags = linked reactions</span>
        </div>
      </div>
    );
  };

  // ── Export tab ───────────────────────────────────────────────────────────
  const renderExportTab = () => {
    const m = currentModel;
    const rxnCount = Object.keys(m?.reactions || {}).length;
    const metCount = Object.keys(m?.metabolites || {}).length;
    const EXPORTS = [
      {
        icon: '</>',
        title: 'SBML Level 3 + FBC v2',
        desc: `Exports ${rxnCount} reactions and ${metCount} metabolites as valid SBML (Level 3, FBC package). Stoichiometry, bounds, GPR associations, and subsystem annotations are preserved. Round-trips through COBRApy and libSBML.`,
        action: () => downloadSBML(currentModel),
        btnLabel: 'Download .xml',
        note: 'Inline edits (bounds, GPR, subsystem) made in the Reactions tab are reflected in the export.',
        color: '#8b5cf6',
      },
      {
        icon: '{}',
        title: 'Model JSON (COBRApy format)',
        desc: `Saves all ${rxnCount} reactions including any bounds or GPR edits. Compatible with COBRApy, BIGG, and other tools. Use model.to_json() / load_json_model() in COBRApy.`,
        action: () => downloadJSON(currentModel),
        btnLabel: 'Download .json',
        note: null,
        color: '#3b82f6',
      },
      {
        icon: '⬛',
        title: 'Reactions CSV',
        desc: `Exports all ${rxnCount} reactions as a spreadsheet-friendly CSV. Edit bounds, GPR rules, or subsystem assignments in Excel, then re-import below.`,
        action: exportAllReactionsCSV,
        btnLabel: 'Download .csv',
        note: 'After editing in Excel: go to the Reactions tab and use "Import CSV" to apply your changes.',
        color: '#10b981',
      },
      {
        icon: '◼',
        title: 'Subsystem Treemap (SVG)',
        desc: `Downloads the subsystem treemap as a vector SVG — resolution-independent and perfect for conference posters and publications.`,
        action: downloadTreemapSVG,
        btnLabel: 'Download .svg',
        note: null,
        color: '#8b5cf6',
      },
      {
        icon: '⬡',
        title: 'Metabolites CSV',
        desc: `Exports all ${metCount} metabolites with ID, name, molecular formula, compartment, and charge. Use for metabolite annotation curation in Excel or Python/pandas.`,
        action: exportMetabolitesCSV,
        btnLabel: 'Download .csv',
        note: null,
        color: '#a855f7',
      },
      {
        icon: 'ψ',
        title: 'Genes / GPR Table CSV',
        desc: `Exports all ${Object.keys(m?.genes || {}).length} genes with product name, reaction count, full list of associated reaction IDs, and an example GPR rule. Useful for GPR curation before re-import.`,
        action: exportGenesCSV,
        btnLabel: 'Download .csv',
        note: null,
        color: '#22c55e',
      },
      {
        icon: 'S',
        title: 'Stoichiometric Matrix CSV',
        desc: `Exports the full S-matrix (${metCount} metabolites × ${rxnCount} reactions). Rows = metabolites, columns = reactions, values = stoichiometric coefficients. Required by MATLAB COBRA Toolbox and Python-based solvers.`,
        action: exportSmatrixCSV,
        btnLabel: 'Download .csv',
        note: `Warning: file will be ~${Math.round(metCount * rxnCount * 2 / 1024)}KB. Large models may take a few seconds to generate.`,
        color: '#f97316',
      },
      {
        icon: 'f',
        title: 'FBA Flux Results CSV',
        desc: `Exports the current flux vector — reaction ID, flux value, bounds, subsystem, GPR, and active flag — for all ${rxnCount} reactions. Run FBA in the FBA tab first to populate values.`,
        action: exportFluxCSV,
        btnLabel: 'Download .csv',
        note: Object.keys(fluxes).length === 0 ? 'No FBA results yet — go to the FBA tab and run a solve first.' : `${Object.values(fluxes).filter(v => Math.abs(v) > 1e-6).length} active fluxes ready for export.`,
        color: '#6366f1',
      },
    ];

    return (
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Export Options</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            All exports reflect the current in-memory model state, including any edits made via CSV import.
          </p>
        </div>
        <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800 flex gap-2">
          <span>⚠️</span>
          <span><strong>CSV import is in-memory only.</strong> Edits are lost on page reload unless you download the updated model as JSON below.</span>
        </div>
        {EXPORTS.map(e => (
          <div key={e.title} className="p-5 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] flex gap-4 items-start">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0 font-mono font-bold text-white"
              style={{ backgroundColor: e.color }}>{e.icon.slice(0,2)}</div>
            <div className="flex-1">
              <h4 className="font-semibold text-sm text-[var(--text-primary)] mb-1">{e.title}</h4>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-2">{e.desc}</p>
              {e.note && <p className="text-xs text-[var(--text-muted)] italic mb-2">{e.note}</p>}
              <button onClick={e.action}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white transition-all hover:opacity-90"
                style={{ backgroundColor: e.color }}>
                <Download className="w-3 h-3" /> {e.btnLabel}
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // No model state
  if (!currentModel?.reactions || Object.keys(currentModel.reactions).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg text-center">
        <p className="text-lg font-medium text-[var(--text-primary)] mb-2">No Model Loaded</p>
        <p className="text-sm text-[var(--text-secondary)]">
          Load an SBML or JSON model to visualize the metabolic network.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto" style={{ height }}>
      {/* ── TAB NAV ─────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 sticky top-0 z-20">
        <div className="flex">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === id
                  ? 'border-[var(--primary)] text-[var(--primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-color)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Right side: breadcrumbs + search (pathways tab only) */}
        {activeTab === 'pathways' && (
          <div className="ml-auto flex items-center gap-3 pr-3">
            {renderBreadcrumbs()}
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search pathways… (press /)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-56 px-3 py-1.5 text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg focus:outline-none focus:border-[var(--primary)]"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setSearchResults(null); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">×</button>
              )}
              {renderSearchResults()}
            </div>
          </div>
        )}

        {/* Stats pill */}
        <div className={`flex items-center gap-3 text-xs text-[var(--text-muted)] px-3 ${activeTab === 'pathways' ? '' : 'ml-auto'}`}>
          <span>{Object.keys(currentModel?.reactions || {}).length} rxns</span>
          <span>•</span>
          <span>{Object.keys(currentModel?.metabolites || {}).length} mets</span>
        </div>
      </div>

      {/* ── PATHWAYS TAB ────────────────────────────────────────── */}
      {activeTab === 'pathways' && (
        <div className="space-y-4 pt-4">
          {/* Stats bar */}
          <div className="flex items-center gap-4 px-3 py-2 mx-4 bg-[var(--bg-primary)] rounded-lg text-xs text-[var(--text-muted)]">
            <span>{categoryHierarchy.size} categories</span>
            <span>•</span>
            <span>{subsystems.size} subsystems</span>
            <span>•</span>
            <span>{Object.keys(currentModel?.reactions || {}).length} reactions</span>
            <span>•</span>
            <span>{Object.keys(currentModel?.metabolites || {}).length} metabolites</span>
            <span className="ml-auto">
              Press <kbd className="px-1 py-0.5 bg-[var(--card-bg)] rounded text-xs">Esc</kbd> to go back
            </span>
          </div>

          {viewLevel === 'categories' && renderModelDashboard()}
          {viewLevel === 'categories' && renderCategoryBar()}
          {viewLevel === 'categories' && renderCategoryCards()}
          {viewLevel === 'categories' && renderDashboardFooter()}
          {viewLevel === 'subsystems' && renderSubsystemList()}

          {viewLevel === 'reactions' && (
            <div className="mx-4 relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg overflow-hidden"
              style={{ height: height - 140 }}>
              <NetworkCanvas
                reactions={subsystemReactions}
                metabolites={currentModel?.metabolites}
                isDark={isDark}
                fluxes={fluxes}
                phenotype={phenotype}
                onSelect={(item) => { if (item?.type === 'reaction') onReactionSelect?.(item.id); }}
              />
            </div>
          )}

          {viewLevel === 'reactions' && (
            <div className="flex items-center gap-2 p-3 mx-4 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg overflow-x-auto">
              <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">Other subsystems in {selectedCategory}:</span>
              {categoryHierarchy.get(selectedCategory)?.subsystems
                .filter(s => s !== selectedSubsystem).slice(0, 8)
                .map(sub => (
                  <button key={sub} onClick={() => navigateToSubsystem(sub, selectedCategory)}
                    className="px-2 py-1 text-xs bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)] rounded whitespace-nowrap">
                    {sub.length > 20 ? sub.substring(0, 18) + '…' : sub}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ── OTHER TABS ──────────────────────────────────────────── */}
      {activeTab === 'reactions'   && renderReactionsTab()}
      {activeTab === 'metabolites' && renderMetabolitesTab()}
      {activeTab === 'genes'       && renderGenesTab()}
      {activeTab === 'export'      && renderExportTab()}
      {activeTab === 'fba'         && <FBAStudioTab onFluxUpdate={onFluxUpdate} />}
    </div>
  );
};

export default SubsystemView;
