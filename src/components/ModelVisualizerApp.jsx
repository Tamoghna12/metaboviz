import React, { useState, useCallback, useRef } from 'react';
import { Upload, X, Database, GitBranch, FlaskConical, Dna, Sun, Moon, Eye, Download, Zap, Layers, BarChart2, ArrowRight, ArrowLeftRight, Globe } from 'lucide-react';
import { useModel } from '../contexts/ModelContext';
import { useTheme } from '../contexts/ThemeContext';
import SubsystemView from './SubsystemView';
import FBAPanel from './FBAPanel';
import CompareView from './CompareView';

// ── Stat Pill ─────────────────────────────────────────────────────────────────
function StatPill({ icon: Icon, value, label, colorVar }) {
  return (
    <div
      className="stat-pill"
      style={{
        background: `color-mix(in srgb, var(${colorVar}) 12%, transparent)`,
        color: `var(${colorVar})`,
        border: `1px solid color-mix(in srgb, var(${colorVar}) 28%, transparent)`,
      }}
    >
      <Icon style={{ width: 10, height: 10 }} />
      <span>{value}</span>
      <span style={{ opacity: 0.65 }}>{label}</span>
    </div>
  );
}

// ── Reaction side panel ───────────────────────────────────────────────────────
function ReactionPanel({ reactionId, onClose }) {
  const { currentModel } = useModel();
  if (!reactionId || !currentModel?.reactions) return null;
  const rxn = currentModel.reactions[reactionId];
  if (!rxn) return null;
  const mets = currentModel.metabolites || {};

  const formatStoichiometry = () => {
    const reactants = [], products = [];
    Object.entries(rxn.metabolites || {}).forEach(([metId, coef]) => {
      const name = mets[metId]?.name || metId;
      if (coef < 0) reactants.push(`${Math.abs(coef) !== 1 ? Math.abs(coef) + ' ' : ''}${name}`);
      else products.push(`${coef !== 1 ? coef + ' ' : ''}${name}`);
    });
    const arrow = rxn.lower_bound < 0 ? '⇌' : '→';
    return `${reactants.join(' + ')} ${arrow} ${products.join(' + ')}`;
  };

  return (
    <div className="w-72 flex-shrink-0 flex flex-col overflow-hidden"
      style={{ background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)' }}>
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--border-color)' }}>
        <h3 className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{reactionId}</h3>
        <button onClick={onClose} className="p-1 rounded-lg transition-colors hover:bg-[var(--bg-primary)]"
          style={{ color: 'var(--text-muted)' }}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto flex-1 p-4 space-y-4 text-sm scrollbar-thin">
        {rxn.name && rxn.name !== reactionId && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Name</p>
            <p style={{ color: 'var(--text-primary)' }}>{rxn.name}</p>
          </div>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Stoichiometry</p>
          <p className="text-xs leading-relaxed break-words" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{formatStoichiometry()}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[['Lower bound', rxn.lower_bound ?? '-1000'], ['Upper bound', rxn.upper_bound ?? '1000']].map(([lbl, val]) => (
            <div key={lbl}>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>{lbl}</p>
              <p style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{val}</p>
            </div>
          ))}
        </div>
        {rxn.subsystem && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Subsystem</p>
            <p style={{ color: 'var(--text-primary)' }}>{rxn.subsystem}</p>
          </div>
        )}
        {rxn.gene_reaction_rule && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>GPR Rule</p>
            <p className="text-xs break-words" style={{ color: 'var(--gene-color)', fontFamily: 'var(--font-mono)' }}>{rxn.gene_reaction_rule}</p>
          </div>
        )}
        {Object.keys(rxn.metabolites || {}).length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Metabolites</p>
            <div className="space-y-1">
              {Object.entries(rxn.metabolites).map(([metId, coef]) => (
                <div key={metId} className="flex items-center gap-2">
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{
                    background: coef < 0 ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : 'color-mix(in srgb, var(--success) 12%, transparent)',
                    color: coef < 0 ? 'var(--danger)' : 'var(--success)',
                  }}>
                    {coef > 0 ? '+' : ''}{coef}
                  </span>
                  <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }} title={mets[metId]?.name}>
                    {mets[metId]?.name || metId}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Animated hero network SVG ─────────────────────────────────────────────────
function NetworkHeroSVG({ isDark }) {
  const bg       = isDark ? '#0d1520' : '#f6f7f4';
  const rxnFill  = isDark ? '#111b2a' : '#eeeef0';
  const rxnStroke = isDark ? '#1e2c40' : '#c4ccd6';
  const textFill = isDark ? '#4e6278' : '#7a8898';
  const edgeClr  = isDark ? '#1e2c40' : '#c8d2dc';

  const mets = [
    { x: 90,  y: 90,  r: 22, color: '#00d4aa', label: 'Glc',  delay: '0s'    },
    { x: 310, y: 60,  r: 18, color: '#10b981', label: 'G6P',  delay: '0.6s'  },
    { x: 510, y: 90,  r: 18, color: '#f59e0b', label: 'F6P',  delay: '1.2s'  },
    { x: 680, y: 60,  r: 14, color: '#a855f7', label: 'ATP',  delay: '0.3s'  },
    { x: 680, y: 150, r: 14, color: '#f43f5e', label: 'ADP',  delay: '0.9s'  },
    { x: 600, y: 230, r: 20, color: '#10b981', label: 'FBP',  delay: '1.5s'  },
    { x: 370, y: 270, r: 16, color: '#60a5fa', label: 'DHAP', delay: '0.45s' },
    { x: 560, y: 340, r: 16, color: '#6366f1', label: 'G3P',  delay: '1.1s'  },
    { x: 160, y: 230, r: 18, color: '#f59e0b', label: 'Pyr',  delay: '0.75s' },
    { x: 90,  y: 330, r: 14, color: '#f43f5e', label: 'CO₂',  delay: '1.35s' },
    { x: 240, y: 350, r: 16, color: '#14b8a6', label: 'AcCoA',delay: '0.2s'  },
    { x: 440, y: 380, r: 14, color: '#f97316', label: 'NAD⁺', delay: '0.8s'  },
  ];
  const rxns = [
    { x: 200, y: 72,  label: 'HEX1' },
    { x: 415, y: 72,  label: 'PGI'  },
    { x: 595, y: 130, label: 'PFK'  },
    { x: 495, y: 265, label: 'FBA'  },
    { x: 270, y: 148, label: 'ENO'  },
    { x: 160, y: 295, label: 'PYK'  },
    { x: 390, y: 325, label: 'GAPD' },
  ];
  const edgeList = [
    { x1: mets[0].x,  y1: mets[0].y,  x2: rxns[0].x, y2: rxns[0].y },
    { x1: rxns[0].x,  y1: rxns[0].y,  x2: mets[1].x, y2: mets[1].y },
    { x1: mets[1].x,  y1: mets[1].y,  x2: rxns[1].x, y2: rxns[1].y },
    { x1: rxns[1].x,  y1: rxns[1].y,  x2: mets[2].x, y2: mets[2].y },
    { x1: mets[2].x,  y1: mets[2].y,  x2: rxns[2].x, y2: rxns[2].y },
    { x1: mets[3].x,  y1: mets[3].y,  x2: rxns[2].x, y2: rxns[2].y },
    { x1: rxns[2].x,  y1: rxns[2].y,  x2: mets[4].x, y2: mets[4].y },
    { x1: rxns[2].x,  y1: rxns[2].y,  x2: mets[5].x, y2: mets[5].y },
    { x1: mets[5].x,  y1: mets[5].y,  x2: rxns[3].x, y2: rxns[3].y },
    { x1: rxns[3].x,  y1: rxns[3].y,  x2: mets[6].x, y2: mets[6].y },
    { x1: rxns[3].x,  y1: rxns[3].y,  x2: mets[7].x, y2: mets[7].y },
    { x1: mets[0].x,  y1: mets[0].y,  x2: rxns[4].x, y2: rxns[4].y },
    { x1: rxns[4].x,  y1: rxns[4].y,  x2: mets[8].x, y2: mets[8].y },
    { x1: mets[8].x,  y1: mets[8].y,  x2: rxns[5].x, y2: rxns[5].y },
    { x1: rxns[5].x,  y1: rxns[5].y,  x2: mets[9].x, y2: mets[9].y },
    { x1: rxns[5].x,  y1: rxns[5].y,  x2: mets[10].x,y2: mets[10].y },
    { x1: mets[6].x,  y1: mets[6].y,  x2: rxns[6].x, y2: rxns[6].y },
    { x1: rxns[6].x,  y1: rxns[6].y,  x2: mets[11].x,y2: mets[11].y },
    { x1: rxns[6].x,  y1: rxns[6].y,  x2: mets[7].x, y2: mets[7].y },
  ];

  return (
    <svg viewBox="0 0 780 420" className="w-full h-full" style={{ display: 'block' }}>
      <defs>
        <marker id="hero-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0,0 L0,5 L5,2.5 z" fill={edgeClr} />
        </marker>
        <style>{`
          @keyframes hero-node-pulse {
            0%, 100% { opacity: 0.65; }
            50% { opacity: 1; }
          }
          @keyframes hero-edge-flow {
            0% { stroke-dashoffset: 20; }
            100% { stroke-dashoffset: 0; }
          }
          .hero-met { animation: hero-node-pulse 2.8s ease-in-out infinite; }
          .hero-edge { animation: hero-edge-flow 3s linear infinite; stroke-dasharray: 6 3; }
        `}</style>
        <filter id="hero-glow">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect width="780" height="420" fill={bg} />
      {/* Dot grid */}
      <defs>
        <pattern id="hero-dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill={isDark ? 'rgba(0,212,170,0.06)' : 'rgba(10,122,104,0.06)'} />
        </pattern>
      </defs>
      <rect width="780" height="420" fill="url(#hero-dots)" />

      {/* Edges */}
      {edgeList.map((e, i) => (
        <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          className="hero-edge"
          stroke={edgeClr} strokeWidth={1.5}
          markerEnd="url(#hero-arrow)"
          style={{ animationDelay: `${(i * 0.18) % 2}s` }}
          opacity={0.6} />
      ))}

      {/* Reaction nodes */}
      {rxns.map((r, i) => (
        <g key={i}>
          <rect x={r.x - 26} y={r.y - 11} width={52} height={22} rx={5}
            fill={rxnFill} stroke={rxnStroke} strokeWidth={1.5} />
          <text x={r.x} y={r.y + 1} textAnchor="middle" dominantBaseline="middle"
            fontSize={9} fill={textFill} fontWeight="700" fontFamily="JetBrains Mono, monospace">{r.label}</text>
        </g>
      ))}

      {/* Metabolite nodes */}
      {mets.map((m, i) => (
        <g key={i} className="hero-met" filter="url(#hero-glow)" style={{ animationDelay: m.delay }}>
          <circle cx={m.x} cy={m.y} r={m.r + 4} fill={m.color} fillOpacity={isDark ? 0.06 : 0.04} />
          <circle cx={m.x} cy={m.y} r={m.r} fill={m.color} fillOpacity={isDark ? 0.2 : 0.12}
            stroke={m.color} strokeWidth={1.8} strokeOpacity={isDark ? 0.9 : 0.7} />
          <text x={m.x} y={m.y + m.r + 12} textAnchor="middle"
            fontSize={8.5} fill={textFill} fontWeight="600" fontFamily="JetBrains Mono, monospace">{m.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ── Feature definitions ────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: Layers, tag: 'Navigation', accent: 'metabolite',
    title: 'Hierarchical Pathway Browsing',
    desc: 'Drill from metabolic categories → subsystems → individual reactions in three levels. Solves the hairball problem for genome-scale models with 2000+ reactions.',
  },
  {
    icon: Zap, tag: 'Analysis', accent: 'reaction',
    title: 'In-Browser Flux Balance Analysis',
    desc: 'Run LP-based FBA via WASM-compiled GLPK. Gene knockouts, objective switching, and phenotype overlay — no server required.',
  },
  {
    icon: BarChart2, tag: 'Visualization', accent: 'gene',
    title: 'Treemap & Escher Maps',
    desc: 'Interactive treemap sized by reaction count, or import real Escher pathway maps with cubic Bézier routing from escher.github.io.',
  },
  {
    icon: Dna, tag: 'Biology', accent: 'metabolite',
    title: 'GPR Associations',
    desc: 'Full gene–protein–reaction rules with AND/OR boolean evaluation. Inspect stoichiometry, flux bounds, and gene identifiers per reaction.',
  },
  {
    icon: Globe, tag: 'Interoperability', accent: 'reaction',
    title: 'Multi-Format Import',
    desc: 'SBML Level 2/3 with FBC + Groups packages, BiGG JSON, and COBRApy model.to_json() exports — auto-detected, zero configuration.',
  },
  {
    icon: Download, tag: 'Export', accent: 'gene',
    title: 'Publication-Quality Output',
    desc: 'SVG treemap export for conference posters. Copy GPR rules, stoichiometry, and flux values directly into manuscripts.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Upload your model',
    desc: 'Drag & drop an SBML (.xml) or BiGG JSON (.json) file, or explore the built-in E. coli core example instantly.',
  },
  {
    n: '02',
    title: 'Navigate pathways',
    desc: 'Browse categories → subsystems → reactions. Run FBA with gene knockouts. Search any gene, metabolite, or reaction ID.',
  },
  {
    n: '03',
    title: 'Export & publish',
    desc: 'Download poster-quality SVG treemaps, inspect Escher pathway maps, or copy reaction details to your manuscript.',
  },
];

const DATABASES = ['BIGG Models', 'BioModels', 'MetaNetX', 'BioCyc', 'KEGG', 'COBRApy'];

// ── Landing page (before model loaded) ───────────────────────────────────────
function UploadLanding({ onActivate }) {
  const { loadModel, loading, error, selectModel, availableModels } = useModel();
  const { isDark } = useTheme();
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const uploadRef    = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (file) { await loadModel(file); onActivate?.(); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrag = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = async (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) { await loadModel(file); onActivate?.(); }
  };

  const scrollToUpload = () => uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ background: 'var(--bg-primary)' }}>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative px-6 pt-20 pb-16 overflow-hidden"
        style={{ borderBottom: '1px solid var(--border-color)' }}>
        {/* Dot grid */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'radial-gradient(circle, var(--dot-color) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }} />
        {/* Top glow */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'var(--hero-glow)' }} />
        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, var(--bg-primary))' }} />

        <div className="max-w-6xl mx-auto flex flex-col lg:flex-row items-center gap-14 relative z-10">

          {/* Left: copy */}
          <div className="flex-1 min-w-0">
            {/* Badge */}
            <div className="animate-entry-1 inline-flex items-center gap-2 px-3 py-1 mb-7 text-xs font-semibold rounded-full"
              style={{
                background: 'color-mix(in srgb, var(--metabolite-color) 10%, transparent)',
                color: 'var(--metabolite-color)',
                border: '1px solid color-mix(in srgb, var(--metabolite-color) 25%, transparent)',
              }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--metabolite-color)' }} />
              Genome-Scale · Browser-Native · Zero Install
            </div>

            <h1 className="display-heading animate-entry-2 text-5xl lg:text-6xl">
              Metabolic<br />
              Networks<br />
              <span style={{ color: 'var(--metabolite-color)' }}>Decoded</span>
            </h1>

            <p className="animate-entry-3 mt-5 text-lg leading-relaxed max-w-md"
              style={{ color: 'var(--text-secondary)' }}>
              Upload SBML or BiGG JSON. Navigate thousands of reactions hierarchically. Run FBA with gene knockouts — entirely in your browser.
            </p>

            <div className="animate-entry-4 mt-8 flex flex-wrap gap-3">
              <button
                onClick={scrollToUpload}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm text-white transition-all hover:opacity-90"
                style={{ background: 'var(--primary)', boxShadow: isDark ? 'var(--glow-primary)' : 'none' }}
              >
                <Upload className="w-4 h-4" />
                Load a Model
              </button>
              <button
                onClick={() => {
                  if (availableModels?.length > 0) { selectModel(availableModels[0].id); onActivate?.(); }
                }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all hover:border-[var(--metabolite-color)]"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              >
                <FlaskConical className="w-4 h-4" style={{ color: 'var(--metabolite-color)' }} />
                E. coli Demo
                <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {/* Format pills */}
            <div className="mt-8 flex flex-wrap gap-2">
              {['SBML L2/3', 'BiGG JSON', 'COBRApy', 'FBC pkg', 'Groups pkg'].map(fmt => (
                <span key={fmt} className="px-2.5 py-1 rounded-lg text-xs"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}>{fmt}</span>
              ))}
            </div>
          </div>

          {/* Right: animated network */}
          <div className="flex-shrink-0 w-full lg:w-[460px] rounded-2xl overflow-hidden"
            style={{ border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-md)' }}>
            <NetworkHeroSVG isDark={isDark} />
          </div>
        </div>
      </section>

      {/* ── COMPATIBLE WITH ─────────────────────────────────────────────── */}
      <section className="py-4 px-6" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-center gap-4 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Compatible with
          </span>
          {DATABASES.map(db => (
            <span key={db} className="px-3 py-1 rounded-lg text-sm font-medium"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
              }}>{db}</span>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--primary)' }}>Workflow</p>
          <h2 className="section-heading text-2xl">From file to insight in three steps</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 relative">
          {STEPS.map((step, i) => (
            <div key={step.n} className="relative p-6 rounded-2xl overflow-hidden"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              {/* Large background number */}
              <div className="absolute top-2 right-4 text-7xl font-black select-none leading-none"
                style={{ color: 'var(--border-subtle)', fontFamily: 'var(--font-display)', opacity: 0.6 }}>
                {step.n}
              </div>
              <div className="relative">
                <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--primary)' }}>
                  Step {step.n}
                </div>
                <h3 className="font-bold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────────────── */}
      <section className="px-6 py-14" style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--primary)' }}>Capabilities</p>
            <h2 className="section-heading text-2xl">Everything for metabolic network analysis</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, tag, accent, title, desc }) => {
              const colorVar = `--${accent}-color`;
              return (
                <div key={title} className={`feature-card accent-${accent}`}>
                  <div className="pl-4">
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                      style={{ color: `var(${colorVar})` }}>{tag}</p>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
                      style={{
                        background: `color-mix(in srgb, var(${colorVar}) 12%, transparent)`,
                      }}>
                      <Icon className="w-4 h-4" style={{ color: `var(${colorVar})` }} />
                    </div>
                    <h4 className="font-semibold text-sm mb-1.5" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>
                      {title}
                    </h4>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── UPLOAD ───────────────────────────────────────────────────────── */}
      <section ref={uploadRef} className="px-6 py-16 max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--primary)' }}>Get started</p>
          <h2 className="section-heading text-2xl">Load a Metabolic Model</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Upload an SBML (.xml) or BiGG JSON (.json) file, or explore a sample model.
          </p>
        </div>

        {/* Drop zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`drop-zone p-14 text-center ${dragActive ? 'drag-active' : ''}`}
          style={{ background: dragActive ? undefined : 'var(--bg-secondary)' }}
        >
          {dragActive && <div className="drop-zone-scan" />}
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 transition-all"
            style={{
              background: dragActive ? `color-mix(in srgb, var(--primary) 14%, transparent)` : 'var(--bg-primary)',
              border: `2px solid ${dragActive ? 'var(--primary)' : 'var(--border-color)'}`,
              boxShadow: dragActive ? 'var(--glow-primary)' : 'none',
            }}>
            <Upload className="w-7 h-7" style={{ color: dragActive ? 'var(--primary)' : 'var(--text-muted)' }} />
          </div>
          <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            {dragActive ? 'Release to load model' : 'Drop your model file here'}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>or click to browse files</p>
          <div className="mt-4 flex justify-center gap-2 flex-wrap">
            {['.xml / .sbml', '.json (BiGG)'].map(ext => (
              <span key={ext} className="px-2 py-0.5 text-xs rounded-md"
                style={{
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)',
                  background: 'var(--bg-primary)',
                  fontFamily: 'var(--font-mono)',
                }}>{ext}</span>
            ))}
          </div>
          <input ref={fileInputRef} type="file" accept=".xml,.sbml,.json" onChange={handleFileChange} className="hidden" />
        </div>

        {loading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
            Parsing model…
          </div>
        )}
        {error && (
          <div className="mt-4 p-3 rounded-xl text-sm" style={{ border: '1px solid var(--danger)', background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        {/* Sample models */}
        {availableModels?.length > 0 && (
          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
              Or load a sample model
            </p>
            <div className="space-y-2">
              {availableModels.map(m => (
                <button
                  key={m.id}
                  onClick={() => { selectModel(m.id); onActivate?.(); }}
                  className="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all group"
                  style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--card-border)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--card-border)'}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'color-mix(in srgb, var(--metabolite-color) 12%, transparent)' }}>
                    <FlaskConical className="w-5 h-5" style={{ color: 'var(--metabolite-color)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{m.name || m.id}</p>
                    {m.description && <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{m.description}</p>}
                  </div>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                    style={{ color: 'var(--text-muted)' }} />
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="py-6 px-6" style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, var(--metabolite-color), var(--gene-color))' }}>
              <GitBranch className="w-3 h-3 text-white" />
            </div>
            <span className="font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-secondary)', letterSpacing: '-0.02em' }}>
              MetaboViz
            </span>
          </div>
          <p>SBML L2/3 · BiGG JSON · COBRApy · FBC · Groups</p>
          <div className="flex items-center gap-3">
            <a href="https://bigg.ucsd.edu" target="_blank" rel="noopener noreferrer"
              className="hover:underline transition-colors" style={{ color: 'inherit' }}>BiGG</a>
            <span>·</span>
            <a href="https://www.ebi.ac.uk/biomodels" target="_blank" rel="noopener noreferrer"
              className="hover:underline transition-colors" style={{ color: 'inherit' }}>BioModels</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Main app shell ────────────────────────────────────────────────────────────
export default function ModelVisualizerApp() {
  const { currentModel, modelStats, isDefaultModel, loadModel } = useModel();
  const { isLight, toggleTheme, colorBlindMode, toggleColorBlindMode } = useTheme();
  const [selectedReaction, setSelectedReaction] = useState(null);
  const [modelActive, setModelActive]           = useState(false);
  const [showFBA, setShowFBA]                   = useState(false);
  const [fluxes, setFluxes]                     = useState({});
  const [phenotype, setPhenotype]               = useState(null);
  const [compareMode, setCompareMode]           = useState(false);
  const fileInputRef = useRef(null);

  const hasModel = modelActive || (currentModel && !isDefaultModel);

  const handleReactionSelect = useCallback((rxnId) => {
    setSelectedReaction(prev => prev === rxnId ? null : rxnId);
  }, []);

  const handleNewModel = async (e) => {
    const file = e.target.files?.[0];
    if (file) await loadModel(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const rxnCount  = modelStats?.reactions ?? 0;
  const metCount  = modelStats?.metabolites ?? 0;
  const geneCount = modelStats?.genes ?? 0;
  const modelName = currentModel?.name || currentModel?.id || 'Model';

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 h-14 flex items-center gap-3 px-4"
        style={{
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          backdropFilter: 'blur(12px)',
        }}>

        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--metabolite-color) 0%, var(--gene-color) 100%)' }}>
            <GitBranch className="w-3.5 h-3.5 text-white" />
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.025em', fontSize: '1rem', color: 'var(--text-primary)' }}>
            MetaboViz
          </span>
        </div>

        {hasModel && (
          <>
            <div className="h-5 w-px" style={{ background: 'var(--border-color)' }} />
            <span className="text-sm font-medium truncate max-w-[140px]" style={{ color: 'var(--text-primary)' }} title={modelName}>
              {modelName}
            </span>
            <div className="flex items-center gap-1.5">
              <StatPill icon={Database}    value={rxnCount}  label="rxns"  colorVar="--reaction-color"  />
              <StatPill icon={FlaskConical} value={metCount}  label="mets"  colorVar="--metabolite-color" />
              {geneCount > 0 && <StatPill icon={Dna} value={geneCount} label="genes" colorVar="--gene-color" />}
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {hasModel && (
            <>
              <button
                onClick={() => { setCompareMode(v => { if (!v) setShowFBA(false); return !v; }); }}
                title="Compare two GEMs side-by-side"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all"
                style={{
                  background: compareMode ? 'color-mix(in srgb, var(--gene-color) 12%, transparent)' : 'var(--bg-primary)',
                  borderColor: compareMode ? 'color-mix(in srgb, var(--gene-color) 40%, transparent)' : 'var(--border-color)',
                  color: compareMode ? 'var(--gene-color)' : 'var(--text-secondary)',
                }}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Compare
              </button>

              {!compareMode && (
                <button
                  onClick={() => setShowFBA(v => !v)}
                  title="Toggle FBA Analysis panel"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all"
                  style={{
                    background: showFBA ? 'color-mix(in srgb, var(--reaction-color) 12%, transparent)' : 'var(--bg-primary)',
                    borderColor: showFBA ? 'color-mix(in srgb, var(--reaction-color) 40%, transparent)' : 'var(--border-color)',
                    color: showFBA ? 'var(--reaction-color)' : 'var(--text-secondary)',
                  }}
                >
                  <Zap className="w-3.5 h-3.5" />
                  FBA
                </button>
              )}

              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all"
                style={{
                  background: 'var(--bg-primary)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-secondary)',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                <Upload className="w-3.5 h-3.5" />
                Load model
              </button>
              <input ref={fileInputRef} type="file" accept=".xml,.sbml,.json" onChange={handleNewModel} className="hidden" />
            </>
          )}

          <button
            onClick={toggleColorBlindMode}
            title="Toggle colorblind mode"
            className="p-2 rounded-lg border transition-all"
            style={{
              background: colorBlindMode ? 'color-mix(in srgb, var(--info) 12%, transparent)' : 'var(--bg-primary)',
              borderColor: colorBlindMode ? 'color-mix(in srgb, var(--info) 40%, transparent)' : 'var(--border-color)',
              color: colorBlindMode ? 'var(--info)' : 'var(--text-muted)',
            }}
          >
            <Eye className="w-4 h-4" />
          </button>

          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="p-2 rounded-lg border transition-all"
            style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* ── BODY ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!hasModel ? (
          <UploadLanding onActivate={() => setModelActive(true)} />
        ) : compareMode ? (
          <CompareView onClose={() => setCompareMode(false)} />
        ) : (
          <>
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 overflow-hidden">
                <SubsystemView
                  width={selectedReaction ? window.innerWidth - 288 : window.innerWidth}
                  height={showFBA ? window.innerHeight - 56 - 148 : window.innerHeight - 56}
                  onReactionSelect={handleReactionSelect}
                  fluxes={fluxes}
                  phenotype={phenotype}
                />
              </div>
              {selectedReaction && (
                <ReactionPanel
                  reactionId={selectedReaction}
                  onClose={() => setSelectedReaction(null)}
                />
              )}
            </div>
            {showFBA && (
              <FBAPanel
                onFluxUpdate={setFluxes}
                onPhenotypeUpdate={p => { setPhenotype(p); }}
                onClose={() => { setShowFBA(false); setFluxes({}); setPhenotype(null); }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
