import React, { useState, useCallback, useRef } from 'react';
import { Upload, X, ChevronRight, Database, GitBranch, FlaskConical, Dna, Sun, Moon, Eye, Download, Zap, Layers, BarChart2, Search, ArrowRight, ArrowLeftRight, BookOpen, Globe } from 'lucide-react';
import { useModel } from '../contexts/ModelContext';
import { useTheme } from '../contexts/ThemeContext';
import SubsystemView from './SubsystemView';
import FBAPanel from './FBAPanel';
import CompareView from './CompareView';

// Reaction detail side panel
function ReactionPanel({ reactionId, onClose }) {
  const { currentModel } = useModel();
  const { isDark } = useTheme();

  if (!reactionId || !currentModel?.reactions) return null;

  const rxn = currentModel.reactions[reactionId];
  if (!rxn) return null;

  const mets = currentModel.metabolites || {};

  const formatStoichiometry = () => {
    const reactants = [];
    const products = [];
    Object.entries(rxn.metabolites || {}).forEach(([metId, coef]) => {
      const name = mets[metId]?.name || metId;
      if (coef < 0) reactants.push(`${Math.abs(coef) !== 1 ? Math.abs(coef) + ' ' : ''}${name}`);
      else products.push(`${coef !== 1 ? coef + ' ' : ''}${name}`);
    });
    const arrow = rxn.lower_bound < 0 ? '⇌' : '→';
    return `${reactants.join(' + ')} ${arrow} ${products.join(' + ')}`;
  };

  return (
    <div className="w-72 flex-shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
        <h3 className="font-semibold text-[var(--text-primary)] text-sm truncate">{reactionId}</h3>
        <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-muted)]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto flex-1 p-4 space-y-4 text-sm">
        {rxn.name && rxn.name !== reactionId && (
          <div>
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">Name</p>
            <p className="text-[var(--text-primary)]">{rxn.name}</p>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">Stoichiometry</p>
          <p className="text-[var(--text-primary)] font-mono text-xs leading-relaxed break-words">{formatStoichiometry()}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">Lower bound</p>
            <p className="text-[var(--text-primary)] font-mono">{rxn.lower_bound ?? '-1000'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">Upper bound</p>
            <p className="text-[var(--text-primary)] font-mono">{rxn.upper_bound ?? '1000'}</p>
          </div>
        </div>

        {rxn.subsystem && (
          <div>
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">Subsystem</p>
            <p className="text-[var(--text-primary)]">{rxn.subsystem}</p>
          </div>
        )}

        {rxn.gene_reaction_rule && (
          <div>
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">GPR Rule</p>
            <p className="text-[var(--text-primary)] font-mono text-xs break-words">{rxn.gene_reaction_rule}</p>
          </div>
        )}

        {Object.keys(rxn.metabolites || {}).length > 0 && (
          <div>
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">Metabolites</p>
            <div className="space-y-1">
              {Object.entries(rxn.metabolites).map(([metId, coef]) => (
                <div key={metId} className="flex items-center gap-2">
                  <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                    coef < 0
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  }`}>
                    {coef > 0 ? '+' : ''}{coef}
                  </span>
                  <span className="text-[var(--text-secondary)] text-xs truncate" title={mets[metId]?.name}>
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

// Decorative metabolic network SVG for the hero
function NetworkHeroSVG({ isDark }) {
  const bg = isDark ? '#1e293b' : '#f8fafc';
  const rxnFill = isDark ? '#334155' : '#f1f5f9';
  const rxnStroke = isDark ? '#475569' : '#94a3b8';
  const textFill = isDark ? '#94a3b8' : '#64748b';
  const edgeColor = isDark ? '#334155' : '#cbd5e1';

  const mets = [
    { x: 90,  y: 90,  r: 22, color: '#3b82f6', label: 'Glc' },
    { x: 310, y: 60,  r: 18, color: '#10b981', label: 'G6P' },
    { x: 510, y: 90,  r: 18, color: '#f59e0b', label: 'F6P' },
    { x: 680, y: 60,  r: 14, color: '#8b5cf6', label: 'ATP' },
    { x: 680, y: 150, r: 14, color: '#ef4444', label: 'ADP' },
    { x: 600, y: 230, r: 20, color: '#10b981', label: 'FBP' },
    { x: 370, y: 270, r: 16, color: '#3b82f6', label: 'DHAP' },
    { x: 560, y: 340, r: 16, color: '#6366f1', label: 'G3P' },
    { x: 160, y: 230, r: 18, color: '#f59e0b', label: 'Pyr' },
    { x: 90,  y: 330, r: 14, color: '#ef4444', label: 'CO₂' },
    { x: 240, y: 350, r: 16, color: '#14b8a6', label: 'AcCoA' },
    { x: 440, y: 380, r: 14, color: '#f97316', label: 'NAD⁺' },
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
  const edges = [
    [0,0,1], [1,1,2], [2,2,0], // met→rxn→met chains (indices into mets/rxns)
  ];
  // Simple explicit edge list: [fromMet/rxnIdx, toMet/rxnIdx, isMet]
  const edgeList = [
    { x1: mets[0].x, y1: mets[0].y, x2: rxns[0].x, y2: rxns[0].y },
    { x1: rxns[0].x, y1: rxns[0].y, x2: mets[1].x, y2: mets[1].y },
    { x1: mets[1].x, y1: mets[1].y, x2: rxns[1].x, y2: rxns[1].y },
    { x1: rxns[1].x, y1: rxns[1].y, x2: mets[2].x, y2: mets[2].y },
    { x1: mets[2].x, y1: mets[2].y, x2: rxns[2].x, y2: rxns[2].y },
    { x1: mets[3].x, y1: mets[3].y, x2: rxns[2].x, y2: rxns[2].y },
    { x1: rxns[2].x, y1: rxns[2].y, x2: mets[4].x, y2: mets[4].y },
    { x1: rxns[2].x, y1: rxns[2].y, x2: mets[5].x, y2: mets[5].y },
    { x1: mets[5].x, y1: mets[5].y, x2: rxns[3].x, y2: rxns[3].y },
    { x1: rxns[3].x, y1: rxns[3].y, x2: mets[6].x, y2: mets[6].y },
    { x1: rxns[3].x, y1: rxns[3].y, x2: mets[7].x, y2: mets[7].y },
    { x1: mets[0].x, y1: mets[0].y, x2: rxns[4].x, y2: rxns[4].y },
    { x1: rxns[4].x, y1: rxns[4].y, x2: mets[8].x, y2: mets[8].y },
    { x1: mets[8].x, y1: mets[8].y, x2: rxns[5].x, y2: rxns[5].y },
    { x1: rxns[5].x, y1: rxns[5].y, x2: mets[9].x, y2: mets[9].y },
    { x1: rxns[5].x, y1: rxns[5].y, x2: mets[10].x, y2: mets[10].y },
    { x1: mets[6].x, y1: mets[6].y, x2: rxns[6].x, y2: rxns[6].y },
    { x1: rxns[6].x, y1: rxns[6].y, x2: mets[11].x, y2: mets[11].y },
    { x1: rxns[6].x, y1: rxns[6].y, x2: mets[7].x, y2: mets[7].y },
  ];

  return (
    <svg viewBox="0 0 780 420" className="w-full h-full" style={{ display: 'block' }}>
      <defs>
        <marker id="hero-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0,0 L0,5 L5,2.5 z" fill={edgeColor} />
        </marker>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect width="780" height="420" fill={bg} rx="12" />
      {edgeList.map((e, i) => (
        <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke={edgeColor} strokeWidth={1.5} markerEnd="url(#hero-arrow)" opacity={0.7} />
      ))}
      {rxns.map((r, i) => (
        <g key={i}>
          <rect x={r.x - 24} y={r.y - 10} width={48} height={20} rx={4}
            fill={rxnFill} stroke={rxnStroke} strokeWidth={1.5} />
          <text x={r.x} y={r.y + 1} textAnchor="middle" dominantBaseline="middle"
            fontSize={9} fill={textFill} fontWeight="700">{r.label}</text>
        </g>
      ))}
      {mets.map((m, i) => (
        <g key={i} filter="url(#glow)">
          <circle cx={m.x} cy={m.y} r={m.r} fill={m.color} fillOpacity={isDark ? 0.25 : 0.15} stroke={m.color} strokeWidth={2} />
          <text x={m.x} y={m.y + m.r + 11} textAnchor="middle" fontSize={9} fill={textFill} fontWeight="500">{m.label}</text>
        </g>
      ))}
    </svg>
  );
}

const FEATURES = [
  { icon: Layers, title: 'Hierarchical Navigation', desc: 'Drill from pathway categories down to individual reactions in three intuitive levels.' },
  { icon: BarChart2, title: 'Treemap Visualization', desc: 'See your entire model at a glance — subsystems sized by reaction count, color-coded by category.' },
  { icon: Zap, title: 'Instant Rendering', desc: 'Preset-position layout renders thousands of reactions without blocking the main thread.' },
  { icon: Download, title: 'SVG Poster Export', desc: 'Download vector-quality treemaps for publications and conference posters.' },
  { icon: Dna, title: 'GPR Associations', desc: 'Inspect gene–protein–reaction rules, bounds, and stoichiometry for every reaction.' },
  { icon: Globe, title: 'Multi-format Support', desc: 'Loads SBML Level 2/3 with FBC, BiGG JSON, and COBRApy exports with auto-detection.' },
];

const STEPS = [
  { n: '01', title: 'Upload your model', desc: 'Drag & drop an SBML (.xml) or BiGG JSON (.json) file, or start with the built-in E. coli example.' },
  { n: '02', title: 'Navigate pathways', desc: 'Browse metabolic categories → subsystems → reactions. Search any gene, metabolite, or reaction ID.' },
  { n: '03', title: 'Export & publish', desc: 'Download poster-quality SVG treemaps or copy reaction details directly to your manuscript.' },
];

const DATABASES = ['BIGG Models', 'BioModels', 'MetaNetX', 'BioCyc', 'KEGG', 'COBRApy'];

// Upload drop zone shown before a model is loaded
function UploadLanding({ onActivate }) {
  const { loadModel, loading, error, selectModel, availableModels } = useModel();
  const { isDark } = useTheme();
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const uploadRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (file) { await loadModel(file); onActivate?.(); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) { await loadModel(file); onActivate?.(); }
  };

  const scrollToUpload = () => uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg-primary)]">

      {/* ── HERO ─────────────────────────────────────────── */}
      <section className="relative px-6 pt-16 pb-12 overflow-hidden border-b border-[var(--border-color)]">
        {/* Background gradient orb */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: isDark
            ? 'radial-gradient(ellipse 90% 60% at 50% -10%, rgba(59,130,246,0.12) 0%, transparent 70%)'
            : 'radial-gradient(ellipse 90% 60% at 50% -10%, rgba(59,130,246,0.08) 0%, transparent 70%)'
        }} />

        <div className="max-w-6xl mx-auto flex flex-col lg:flex-row items-center gap-12">
          {/* Left: copy */}
          <div className="flex-1 min-w-0 z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-5 text-xs font-semibold rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Genome-Scale Metabolic Model Visualization
            </div>

            <h1 className="text-4xl lg:text-5xl font-extrabold text-[var(--text-primary)] leading-tight tracking-tight">
              Explore Metabolic<br />
              Networks{' '}
              <span style={{ color: 'var(--primary)' }}>Visually</span>
            </h1>

            <p className="mt-4 text-lg text-[var(--text-secondary)] max-w-lg leading-relaxed">
              Interactive pathway navigation for genome-scale models. Upload SBML or BiGG JSON — browse thousands of reactions instantly, export poster-quality diagrams.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={scrollToUpload}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm text-white transition-all hover:opacity-90 hover:shadow-lg"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                <Upload className="w-4 h-4" />
                Load a Model
              </button>
              <button
                onClick={() => { if (availableModels?.length > 0) { selectModel(availableModels[0].id); onActivate?.(); } }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm border border-[var(--border-color)] text-[var(--text-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-primary)] transition-colors"
              >
                <FlaskConical className="w-4 h-4" />
                Try E. coli Example
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />SBML Level 2/3</span>
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />BiGG JSON</span>
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-violet-400" />COBRApy exports</span>
              <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />FBC package</span>
            </div>
          </div>

          {/* Right: network illustration */}
          <div className="flex-shrink-0 w-full lg:w-[420px] xl:w-[480px] rounded-xl overflow-hidden border border-[var(--border-color)] shadow-xl">
            <NetworkHeroSVG isDark={isDark} />
          </div>
        </div>
      </section>

      {/* ── COMPATIBLE WITH ──────────────────────────────── */}
      <section className="border-b border-[var(--border-color)] py-4 px-6 bg-[var(--bg-secondary)]">
        <div className="max-w-6xl mx-auto flex items-center justify-center gap-6 flex-wrap">
          <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-widest">Compatible with</span>
          {DATABASES.map(db => (
            <span key={db} className="text-sm font-semibold text-[var(--text-secondary)] px-3 py-1 rounded-md border border-[var(--border-color)] bg-[var(--card-bg)]">{db}</span>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">Workflow</p>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">From file to insight in three steps</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* connector line */}
          <div className="hidden md:block absolute top-8 left-[calc(16.66%+1rem)] right-[calc(16.66%+1rem)] h-px bg-[var(--border-color)]" />
          {STEPS.map(step => (
            <div key={step.n} className="relative flex flex-col items-center text-center gap-3">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-xl z-10 border-2"
                style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--primary)', color: 'var(--primary)' }}>
                {step.n}
              </div>
              <h3 className="font-semibold text-[var(--text-primary)]">{step.title}</h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────── */}
      <section className="px-6 py-14 bg-[var(--bg-secondary)] border-y border-[var(--border-color)]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">Capabilities</p>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">Everything you need for metabolic network analysis</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-5 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] hover:border-[var(--primary)] hover:shadow-md transition-all group">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"
                  style={{ backgroundColor: 'var(--info-bg)', color: 'var(--primary)' }}>
                  <Icon className="w-4.5 h-4.5 w-5 h-5" />
                </div>
                <h4 className="font-semibold text-sm text-[var(--text-primary)] mb-1">{title}</h4>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── UPLOAD ───────────────────────────────────────── */}
      <section ref={uploadRef} className="px-6 py-16 max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2">Get started</p>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">Load a Metabolic Model</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Upload an SBML (.xml) or BiGG JSON (.json) file, or explore a sample model below.
          </p>
        </div>

        {/* Drop zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative rounded-2xl border-2 border-dashed p-12 text-center cursor-pointer transition-all ${
            dragActive
              ? 'border-[var(--primary)] bg-[var(--info-bg)] scale-[1.01]'
              : 'border-[var(--border-color)] hover:border-[var(--primary)] hover:bg-[var(--bg-secondary)]'
          }`}
        >
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 border-2"
            style={{ borderColor: dragActive ? 'var(--primary)' : 'var(--border-color)', color: dragActive ? 'var(--primary)' : 'var(--text-muted)' }}>
            <Upload className="w-6 h-6" />
          </div>
          <p className="font-semibold text-[var(--text-primary)] mb-1">
            {dragActive ? 'Release to upload' : 'Drop your model file here'}
          </p>
          <p className="text-sm text-[var(--text-muted)]">or click to browse your files</p>
          <div className="mt-4 flex justify-center gap-2 flex-wrap">
            {['.xml / .sbml', '.json (BiGG)'].map(ext => (
              <span key={ext} className="px-2 py-0.5 text-xs rounded-md border border-[var(--border-color)] text-[var(--text-muted)] bg-[var(--bg-secondary)]">{ext}</span>
            ))}
          </div>
          <input ref={fileInputRef} type="file" accept=".xml,.sbml,.json" onChange={handleFileChange} className="hidden" />
        </div>

        {loading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
            Parsing model…
          </div>
        )}
        {error && (
          <div className="mt-4 p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        {/* Sample models */}
        {availableModels?.length > 0 && (
          <div className="mt-8">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-3">Or load a sample model</p>
            <div className="space-y-2">
              {availableModels.map(m => (
                <button
                  key={m.id}
                  onClick={() => { selectModel(m.id); onActivate?.(); }}
                  className="w-full flex items-center gap-4 p-4 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl hover:border-[var(--primary)] hover:shadow-md text-left transition-all group"
                >
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'var(--info-bg)', color: 'var(--primary)' }}>
                    <FlaskConical className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[var(--text-primary)] text-sm">{m.name || m.id}</p>
                    {m.description && <p className="text-xs text-[var(--text-muted)] truncate">{m.description}</p>}
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--primary)] group-hover:translate-x-0.5 transition-all" />
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── FOOTER ───────────────────────────────────────── */}
      <footer className="border-t border-[var(--border-color)] py-6 px-6 bg-[var(--bg-secondary)]">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded flex items-center justify-center" style={{ backgroundColor: 'var(--primary)' }}>
              <GitBranch className="w-3 h-3 text-white" />
            </div>
            <span className="font-semibold text-[var(--text-secondary)]">GEM Visualizer</span>
          </div>
          <p>Supports SBML Level 2/3 • BiGG JSON • COBRApy exports • FBC package • Groups package</p>
          <div className="flex items-center gap-1">
            <BookOpen className="w-3 h-3" />
            <a href="https://bigg.ucsd.edu" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text-primary)] transition-colors">BiGG Database</a>
            <span className="mx-1">·</span>
            <a href="https://www.ebi.ac.uk/biomodels" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text-primary)] transition-colors">BioModels</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function ModelVisualizerApp() {
  const { currentModel, modelStats, isDefaultModel, loadModel } = useModel();
  const { isLight, toggleTheme, colorBlindMode, toggleColorBlindMode } = useTheme();
  const [selectedReaction, setSelectedReaction] = useState(null);
  const [modelActive, setModelActive] = useState(false);
  const [showFBA, setShowFBA] = useState(false);
  const [fluxes, setFluxes] = useState({});
  const [phenotype, setPhenotype] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const fileInputRef = useRef(null);

  // modelActive tracks explicit user choice (including the built-in E. coli example)
  const hasModel = modelActive || (currentModel && !isDefaultModel);

  const handleReactionSelect = useCallback((rxnId) => {
    setSelectedReaction(prev => prev === rxnId ? null : rxnId);
  }, []);

  const handleNewModel = async (e) => {
    const file = e.target.files?.[0];
    if (file) await loadModel(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const rxnCount = modelStats?.reactions ?? 0;
  const metCount = modelStats?.metabolites ?? 0;
  const geneCount = modelStats?.genes ?? 0;
  const modelName = currentModel?.name || currentModel?.id || 'Model';

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 h-14 flex items-center gap-4 px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2 font-bold text-[var(--text-primary)]">
          <div className="w-7 h-7 rounded bg-[var(--primary)] flex items-center justify-center">
            <GitBranch className="w-4 h-4 text-white" />
          </div>
          <span>GEM Visualizer</span>
        </div>

        {hasModel && (
          <>
            <div className="h-5 w-px bg-[var(--border-color)]" />
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium text-[var(--text-primary)] truncate max-w-[160px]" title={modelName}>
                {modelName}
              </span>
              <span className="flex items-center gap-1 text-[var(--text-muted)]">
                <Database className="w-3.5 h-3.5" />
                {rxnCount} rxns
              </span>
              <span className="flex items-center gap-1 text-[var(--text-muted)]">
                <FlaskConical className="w-3.5 h-3.5" />
                {metCount} mets
              </span>
              {geneCount > 0 && (
                <span className="flex items-center gap-1 text-[var(--text-muted)]">
                  <Dna className="w-3.5 h-3.5" />
                  {geneCount} genes
                </span>
              )}
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {hasModel && (
            <>
              <button
                onClick={() => { setCompareMode(v => { if (!v) setShowFBA(false); return !v; }); }}
                title="Compare two GEMs side-by-side"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  compareMode
                    ? 'bg-violet-50 border-violet-300 text-violet-700 dark:bg-violet-900/20 dark:border-violet-700 dark:text-violet-400'
                    : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]'
                }`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Compare
              </button>
              {!compareMode && (
                <button
                  onClick={() => setShowFBA(v => !v)}
                  title="Toggle FBA Analysis panel"
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    showFBA
                      ? 'bg-yellow-50 border-yellow-300 text-yellow-700 dark:bg-yellow-900/20 dark:border-yellow-700 dark:text-yellow-400'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  FBA
                </button>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors"
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
            className={`p-2 rounded-lg border transition-colors ${
              colorBlindMode
                ? 'bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info)]'
                : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]'
            }`}
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="p-2 rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors"
          >
            {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!hasModel ? (
          <UploadLanding onActivate={() => setModelActive(true)} />
        ) : compareMode ? (
          <CompareView onClose={() => setCompareMode(false)} />
        ) : (
          <>
            <div className="flex-1 flex min-h-0">
              {/* SubsystemView: overflow-hidden so internal sticky nav + content scroll works */}
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
