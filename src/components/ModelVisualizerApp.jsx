import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, X, Database, GitBranch, FlaskConical, Dna, Sun, Moon, Eye, Download, Zap, Layers, BarChart2, ArrowRight, ArrowLeftRight, Globe, Terminal } from 'lucide-react';
import { useModel } from '../contexts/ModelContext';
import { useTheme } from '../contexts/ThemeContext';
import SubsystemView from './SubsystemView';
import FBAPanel from './FBAPanel';
import CompareView from './CompareView';
import KernelPanel, { useKernelCells } from './KernelPanel';
import { KernelStatus } from '../lib/KernelSolver';
import { computeManager } from '../lib/ComputeWorker';

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
        {(rxn.gpr || rxn.gene_reaction_rule) && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>GPR Rule</p>
            <p className="text-xs break-words" style={{ color: 'var(--gene-color)', fontFamily: 'var(--font-mono)' }}>{rxn.gpr || rxn.gene_reaction_rule}</p>
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

// ── Model data preview panel ──────────────────────────────────────────────────
function ModelDataPanel() {
  const rows = [
    ['id',          'iML1515'],
    ['reactions',   '2,712'],
    ['metabolites', '1,877'],
    ['genes',       '1,516'],
    ['compartments','3'],
    ['format',      'SBML L3 / FBC v2'],
  ];
  const fluxes = [
    ['BIOMASS_Ec_iML1515_core_75p37M', '0.8769', true],
    ['EX_glc__D_e',  '−10.000', false],
    ['EX_o2_e',      '−17.531', false],
    ['EX_co2_e',     '22.810',  true],
    ['EX_h2o_e',     '47.331',  true],
  ];

  return (
    <div className="flex-shrink-0 w-full lg:w-[420px]" style={{
      border: '1px solid var(--border-color)',
      borderRadius: 4,
      background: 'var(--bg-secondary)',
      overflow: 'hidden',
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
    }}>
      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 py-2.5" style={{
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
      }}>
        <div className="flex gap-1.5">
          {['var(--border-color)', 'var(--border-color)', 'var(--border-color)'].map((c, i) => (
            <div key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
          ))}
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>iML1515.json — model summary</span>
      </div>

      <div className="p-4">
        {/* Model fields */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '5px 12px 5px 0', color: 'var(--text-muted)', width: '40%' }}>{k}</td>
                <td style={{ padding: '5px 0', color: 'var(--text-primary)' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* FBA result */}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ color: 'var(--text-muted)', marginBottom: 8 }}># FBA · Biomass maximisation · status: <span style={{ color: 'var(--primary)' }}>optimal</span></div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '3px 12px 3px 0', color: 'var(--text-muted)', fontWeight: 400, textAlign: 'left' }}>reaction</th>
                <th style={{ padding: '3px 0', color: 'var(--text-muted)', fontWeight: 400, textAlign: 'right' }}>flux</th>
              </tr>
            </thead>
            <tbody>
              {fluxes.map(([rxn, val, pos]) => (
                <tr key={rxn} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '4px 12px 4px 0', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{rxn}</td>
                  <td style={{ padding: '4px 0', color: pos ? 'var(--primary)' : 'var(--danger)', textAlign: 'right' }}>{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ color: 'var(--text-muted)', marginTop: 8 }}>solver: HiGHS-WASM · tier: wasm</div>
        </div>
      </div>
    </div>
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
      <section className="px-8 pt-14 pb-12" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <div className="max-w-6xl mx-auto flex flex-col lg:flex-row items-start gap-14">

          {/* Left: copy */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest mb-6"
              style={{ color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
              Constraint-Based Metabolic Modelling
            </p>

            <h1 className="text-4xl font-semibold leading-tight mb-4"
              style={{ color: 'var(--text-primary)', letterSpacing: '-0.025em', fontFamily: 'var(--font-display)' }}>
              Metabolic Network<br />Analysis Platform
            </h1>

            <p className="text-sm leading-relaxed mb-8 max-w-lg" style={{ color: 'var(--text-secondary)' }}>
              Load genome-scale models in SBML or BiGG JSON. Navigate reaction networks hierarchically,
              run FBA with gene knockouts, and compare models — entirely in the browser with no installation.
            </p>

            <div className="flex items-center gap-3 mb-10">
              <button
                onClick={scrollToUpload}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
                style={{ background: 'var(--primary)', borderRadius: 3 }}
              >
                <Upload className="w-3.5 h-3.5" />
                Load Model
              </button>
              <button
                onClick={() => {
                  if (availableModels?.length > 0) { selectModel(availableModels[0].id); onActivate?.(); }
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors"
                style={{ border: '1px solid var(--border-color)', color: 'var(--text-secondary)', background: 'transparent', borderRadius: 3 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-muted)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                E. coli Demo
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Accepted formats */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Accepts</span>
              {['SBML L2/3', 'FBC v2', 'Groups', 'BiGG JSON', 'COBRApy'].map(fmt => (
                <code key={fmt} className="text-xs px-1.5 py-0.5"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-muted)',
                    borderRadius: 2,
                  }}>{fmt}</code>
              ))}
            </div>
          </div>

          {/* Right: static model data panel */}
          <ModelDataPanel />
        </div>
      </section>

      {/* ── DATABASES ────────────────────────────────────────────────────── */}
      <section className="py-3 px-8" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
        <div className="max-w-6xl mx-auto flex items-center gap-6 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Compatible databases</span>
          {DATABASES.map(db => (
            <span key={db} className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{db}</span>
          ))}
        </div>
      </section>

      {/* ── CAPABILITIES ─────────────────────────────────────────────────── */}
      <section className="px-8 py-12" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-medium uppercase tracking-widest mb-6"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.1em' }}>Capabilities</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            style={{ border: '1px solid var(--border-color)', borderRadius: 3, overflow: 'hidden' }}>
            {FEATURES.map(({ icon: Icon, tag, title, desc }, i) => (
              <div key={title} className="p-5"
                style={{
                  background: 'var(--bg-secondary)',
                  borderRight: (i + 1) % 3 !== 0 ? '1px solid var(--border-color)' : 'none',
                  borderBottom: i < FEATURES.length - 3 ? '1px solid var(--border-color)' : 'none',
                }}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{tag}</span>
                </div>
                <p className="text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>{title}</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── UPLOAD ───────────────────────────────────────────────────────── */}
      <section ref={uploadRef} className="px-8 py-12">
        <div className="max-w-xl mx-auto">
          <p className="text-xs font-medium uppercase tracking-widest mb-6"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.1em' }}>Load a model</p>

          {/* Drop zone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer p-10 text-center transition-colors"
            style={{
              border: `1.5px dashed ${dragActive ? 'var(--primary)' : 'var(--border-color)'}`,
              borderRadius: 3,
              background: dragActive ? 'color-mix(in srgb, var(--primary) 4%, transparent)' : 'var(--bg-secondary)',
            }}
          >
            <Upload className="w-5 h-5 mx-auto mb-3" style={{ color: dragActive ? 'var(--primary)' : 'var(--text-muted)' }} />
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              {dragActive ? 'Drop to load' : 'Drop file or click to browse'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              .xml · .sbml · .json (BiGG / COBRApy)
            </p>
            <input ref={fileInputRef} type="file" accept=".xml,.sbml,.json" onChange={handleFileChange} className="hidden" />
          </div>

          {loading && (
            <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <div className="w-4 h-4 rounded-full border-2 animate-spin"
                style={{ borderColor: 'var(--border-color)', borderTopColor: 'var(--primary)' }} />
              Parsing model…
            </div>
          )}
          {error && (
            <div className="mt-4 p-3 text-sm" style={{ border: '1px solid var(--danger)', borderRadius: 3, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          {/* Sample models */}
          {availableModels?.length > 0 && (
            <div className="mt-8">
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Sample models</p>
              <div className="space-y-1">
                {availableModels.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { selectModel(m.id); onActivate?.(); }}
                    className="w-full flex items-center justify-between px-4 py-3 text-left text-sm transition-colors"
                    style={{ border: '1px solid var(--border-color)', borderRadius: 3, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-muted)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                  >
                    <div>
                      <span className="font-medium">{m.name || m.id}</span>
                      {m.description && (
                        <span className="ml-3 text-xs" style={{ color: 'var(--text-muted)' }}>{m.description}</span>
                      )}
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="py-5 px-8" style={{ borderTop: '1px solid var(--border-color)' }}>
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>MetaboViz</span>
          <span>SBML L2/3 · BiGG JSON · COBRApy · FBC · Groups</span>
          <div className="flex items-center gap-3">
            <a href="https://bigg.ucsd.edu" target="_blank" rel="noopener noreferrer"
              className="hover:underline" style={{ color: 'inherit' }}>BiGG</a>
            <span>·</span>
            <a href="https://www.ebi.ac.uk/biomodels" target="_blank" rel="noopener noreferrer"
              className="hover:underline" style={{ color: 'inherit' }}>BioModels</a>
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
  const [showKernel, setShowKernel]             = useState(false);
  const [kernelStatus, setKernelStatus]         = useState(KernelStatus.DISCONNECTED);
  const [fluxes, setFluxes]                     = useState({});
  const [phenotype, setPhenotype]               = useState(null);
  const [compareMode, setCompareMode]           = useState(false);
  const fileInputRef = useRef(null);
  const { cells: kernelCells, onCellAdded } = useKernelCells();

  useEffect(() => {
    const unsub = computeManager.kernelSolver.onStatusChange(s => setKernelStatus(s));
    return unsub;
  }, []);

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
      <header className="flex-shrink-0 h-12 flex items-center gap-3 px-4"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>

        {/* Wordmark */}
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', letterSpacing: '-0.01em', flexShrink: 0 }}>
          MetaboViz
        </span>

        {hasModel && (
          <>
            <div className="h-4 w-px flex-shrink-0" style={{ background: 'var(--border-color)' }} />
            <span className="text-xs truncate max-w-[160px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }} title={modelName}>
              {modelName}
            </span>
            <div className="flex items-center gap-1">
              <StatPill icon={Database}     value={rxnCount}  label="rxns"  colorVar="--reaction-color"  />
              <StatPill icon={FlaskConical}  value={metCount}  label="mets"  colorVar="--metabolite-color" />
              {geneCount > 0 && <StatPill icon={Dna} value={geneCount} label="genes" colorVar="--gene-color" />}
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          {hasModel && (
            <>
              {[
                {
                  label: 'Compare', icon: <ArrowLeftRight className="w-3.5 h-3.5" />,
                  active: compareMode,
                  onClick: () => { setCompareMode(v => { if (!v) setShowFBA(false); return !v; }); },
                },
                ...(!compareMode ? [
                  { label: 'FBA', icon: <Zap className="w-3.5 h-3.5" />, active: showFBA, onClick: () => setShowFBA(v => !v) },
                  { label: 'Kernel', active: showKernel, onClick: () => setShowKernel(v => !v),
                    icon: <><Terminal className="w-3.5 h-3.5" />{kernelStatus === KernelStatus.CONNECTED && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--success)' }} />}</> },
                ] : []),
              ].map(({ label, icon, active, onClick }) => (
                <button key={label} onClick={onClick}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 3,
                    background: active ? 'var(--bg-tertiary)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = active ? 'var(--text-primary)' : 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                >
                  {icon}{label}
                </button>
              ))}

              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ border: '1px solid var(--border-color)', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
              >
                <Upload className="w-3.5 h-3.5" />
                Load model
              </button>
              <input ref={fileInputRef} type="file" accept=".xml,.sbml,.json" onChange={handleNewModel} className="hidden" />
            </>
          )}

          <button onClick={toggleColorBlindMode} title="Colorblind mode"
            className="p-1.5 transition-colors"
            style={{ border: '1px solid var(--border-color)', borderRadius: 3, background: 'transparent', color: colorBlindMode ? 'var(--primary)' : 'var(--text-muted)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = colorBlindMode ? 'var(--primary)' : 'var(--text-muted)'}
          >
            <Eye className="w-3.5 h-3.5" />
          </button>

          <button onClick={toggleTheme} title="Toggle theme"
            className="p-1.5 transition-colors"
            style={{ border: '1px solid var(--border-color)', borderRadius: 3, background: 'transparent', color: 'var(--text-muted)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
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
              {showKernel && (
                <KernelPanel
                  cells={kernelCells}
                  onClose={() => setShowKernel(false)}
                />
              )}
            </div>
            {showFBA && (
              <FBAPanel
                onFluxUpdate={setFluxes}
                onPhenotypeUpdate={p => { setPhenotype(p); }}
                onClose={() => { setShowFBA(false); setFluxes({}); setPhenotype(null); }}
                onCellAdded={onCellAdded}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
