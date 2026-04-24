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
import { Layers, Zap, FlaskConical, Dna, Download, BarChart2, FileText, Pencil, Trash2, Check, X as XIcon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useModel } from '../contexts/ModelContext';
import { downloadJSON, downloadSBML } from '../lib/ModelExporter';
import NetworkCanvas from './NetworkCanvas';

const TABS = [
  { id: 'pathways',    label: 'Overview',    Icon: Layers      },
  { id: 'reactions',   label: 'Reactions',   Icon: Zap         },
  { id: 'metabolites', label: 'Metabolites', Icon: FlaskConical },
  { id: 'genes',       label: 'Genes',       Icon: Dna         },
  { id: 'export',      label: 'Export',      Icon: Download    },
];

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

const SubsystemView = ({ fluxes = {}, phenotype = null, width = 1000, height = 700, onReactionSelect }) => {
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
      { label: 'Genes',         value: Object.keys(genes).length.toLocaleString(), sub: `${pctGPR}% rxn coverage`   },
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

  const renderTreemap = () => {
    const { rects, TW, TH, PAD } = buildTreemapRects();
    // Category legend
    const categories = Array.from(categoryHierarchy.entries())
      .sort((a, b) => b[1].totalReactions - a[1].totalReactions);

    return (
      <div className="px-4 pb-4">
        <div className="p-4" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 3 }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              Subsystem treemap — click to navigate
            </p>
            <button
              onClick={downloadTreemapSVG}
              className="flex items-center gap-1.5 px-3 py-1 text-xs transition-colors"
              style={{ border: '1px solid var(--border-color)', borderRadius: 2, color: 'var(--text-secondary)', background: 'transparent' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export SVG
            </button>
          </div>

          <svg
            ref={treemapRef}
            width="100%"
            viewBox={`0 0 ${TW} ${TH}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ display: 'block', cursor: 'pointer' }}
          >
            <rect width={TW} height={TH} fill={isDark ? '#111827' : '#f8fafc'} />
            {rects.map((r, i) => {
              const showLabel = r.w > 50 && r.h > 16;
              const fontSize = Math.min(14, Math.max(8, r.h * 0.3));
              // Width-aware truncation: ~0.58 char width/font-size ratio
              const maxChars = Math.max(3, Math.floor((r.w - PAD * 4) / (fontSize * 0.58)));
              const label = r.subsystem.length > maxChars
                ? r.subsystem.substring(0, maxChars - 1) + '…'
                : r.subsystem;
              const showCount = r.h > 28 && r.w > 40;
              return (
                <g key={i} onClick={() => navigateToSubsystem(r.subsystem, r.category)}>
                  <title>{r.subsystem} — {r.reactions} reactions ({r.category})</title>
                  <rect
                    x={r.x + PAD} y={r.y + PAD}
                    width={Math.max(0, r.w - PAD * 2)} height={Math.max(0, r.h - PAD * 2)}
                    fill={r.color} fillOpacity={isDark ? 0.75 : 0.82} rx={3}
                  />
                  {showLabel && (
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 + (showCount ? -fontSize * 0.4 : 0)}
                      textAnchor="middle" dominantBaseline="middle"
                      fill="white" fontSize={fontSize} fontWeight="600"
                      style={{ pointerEvents: 'none' }}
                    >
                      {label}
                    </text>
                  )}
                  {showCount && (
                    <text
                      x={r.x + r.w / 2} y={r.y + r.h / 2 + fontSize * 0.7}
                      textAnchor="middle" dominantBaseline="middle"
                      fill="white" fontSize={Math.max(7, fontSize * 0.72)} opacity={0.85}
                      style={{ pointerEvents: 'none' }}
                    >
                      {r.reactions}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Category legend */}
          <div className="flex flex-wrap gap-3 mt-3">
            {categories.map(([cat]) => {
              const palette = getCategoryPalette(cat);
              const icon = CATEGORY_ICONS[cat] || '📦';
              return (
                <button
                  key={cat}
                  onClick={() => navigateToCategory(cat)}
                  className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: palette.bg }} />
                  <span>{icon} {cat}</span>
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
    const [q, setQ] = [reactionsQuery, setReactionsQuery];
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

    return (
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <input value={reactionsQuery} onChange={e => setReactionsQuery(e.target.value)}
            placeholder="Search by ID, name, metabolite, GPR, subsystem…"
            className="flex-1 min-w-64 px-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]" />
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text-secondary)]">{filtered.length}</span> / {rows.length} reactions
            <span className="text-amber-600 ml-2">{rows.filter(r => r.rev).length} reversible</span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <button onClick={exportAllReactionsCSV}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors">
              <Download className="w-3 h-3" /> Export CSV
            </button>
            <button onClick={() => csvImportRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors">
              <FileText className="w-3 h-3" /> Import CSV
            </button>
            <input ref={csvImportRef} type="file" accept=".csv" onChange={handleCSVImport} className="hidden" />
          </div>
        </div>
        {csvImportMsg && (
          <div className={`px-4 py-2 text-xs font-medium ${csvImportMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {csvImportMsg.ok ? '✓' : '✗'} {csvImportMsg.text}
          </div>
        )}
        <div className="overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-[var(--bg-secondary)] sticky top-0 z-10">
              <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <th className="px-3 py-2 font-medium w-36">ID</th>
                <th className="px-3 py-2 font-medium">Stoichiometry</th>
                <th className="px-3 py-2 font-medium w-36">Subsystem</th>
                <th className="px-3 py-2 font-medium w-28">Bounds [lb, ub]</th>
                <th className="px-3 py-2 font-medium w-44">GPR</th>
                <th className="px-3 py-2 font-medium w-16 text-center">Edit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => {
                const isEditing = editingRxnId === row.id;
                const confirming = confirmDeleteId === row.id;
                const inCls = 'w-full text-[10px] px-1.5 py-0.5 border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--primary)]';
                return (
                  <tr key={row.id}
                    className={`group border-b border-[var(--border-color)] transition-colors ${isEditing ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-[var(--bg-secondary)] cursor-pointer'}`}
                    onClick={!isEditing ? () => onReactionSelect?.(row.id) : undefined}>
                    <td className="px-3 py-2" onClick={e => isEditing && e.stopPropagation()}>
                      <div className="font-mono text-xs font-medium text-[var(--text-primary)]">{row.id}</div>
                      {isEditing ? (
                        <input value={editDraft.name} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                          className={inCls} placeholder="Display name" onClick={e => e.stopPropagation()} />
                      ) : (
                        <>
                          {row.name && row.name !== row.id && <div className="text-xs text-[var(--text-muted)] truncate max-w-[130px]" title={row.name}>{row.name}</div>}
                          <div className="flex gap-1 mt-0.5">
                            {row.rev    && <span className="px-1 text-[10px] rounded bg-amber-100 text-amber-700">rev</span>}
                            {row.hasGPR && <span className="px-1 text-[10px] rounded bg-blue-100 text-blue-700">gpr</span>}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--text-secondary)]">
                      <span className="text-red-500">{row.reactants.slice(0,3).join(' + ')}{row.reactants.length > 3 ? ` +${row.reactants.length-3}` : ''}</span>
                      <span className="mx-1 text-[var(--text-muted)]">{row.rev ? '⇌' : '→'}</span>
                      <span className="text-green-600">{row.products.slice(0,3).join(' + ')}{row.products.length > 3 ? ` +${row.products.length-3}` : ''}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]" onClick={e => isEditing && e.stopPropagation()}>
                      {isEditing ? (
                        <input value={editDraft.subsystem} onChange={e => setEditDraft(d => ({ ...d, subsystem: e.target.value }))}
                          className={inCls} placeholder="Subsystem" onClick={e => e.stopPropagation()} />
                      ) : (
                        <span className="truncate block max-w-[130px]" title={row.subsystem}>{row.subsystem || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" onClick={e => isEditing && e.stopPropagation()}>
                      {isEditing ? (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <input type="number" value={editDraft.lb} onChange={e => setEditDraft(d => ({ ...d, lb: e.target.value }))}
                            className="w-16 text-[10px] px-1 py-0.5 border border-[var(--border-color)] bg-[var(--bg-primary)] font-mono focus:outline-none" title="Lower bound" />
                          <span className="text-[var(--text-muted)]">→</span>
                          <input type="number" value={editDraft.ub} onChange={e => setEditDraft(d => ({ ...d, ub: e.target.value }))}
                            className="w-16 text-[10px] px-1 py-0.5 border border-[var(--border-color)] bg-[var(--bg-primary)] font-mono focus:outline-none" title="Upper bound" />
                        </div>
                      ) : (
                        <span className="text-[var(--text-muted)]">[{row.lb}, {row.ub}]</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--text-muted)]" onClick={e => isEditing && e.stopPropagation()}>
                      {isEditing ? (
                        <input value={editDraft.gpr} onChange={e => setEditDraft(d => ({ ...d, gpr: e.target.value }))}
                          className={inCls} placeholder="gene1 and gene2" onClick={e => e.stopPropagation()} />
                      ) : (
                        <span className="break-all" style={{ lineHeight: 1.3 }}>{row.gpr || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={saveEdit} title="Save changes"
                            className="p-1 rounded bg-green-600 text-white hover:bg-green-700 transition-colors">
                            <Check className="w-3 h-3" />
                          </button>
                          <button onClick={cancelEdit} title="Cancel"
                            className="p-1 rounded bg-[var(--bg-primary)] text-[var(--text-muted)] border border-[var(--border-color)] hover:text-red-500 transition-colors">
                            <XIcon className="w-3 h-3" />
                          </button>
                        </div>
                      ) : confirming ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => { deleteReaction(row.id); setConfirmDeleteId(null); }}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-red-600 text-white font-bold hover:bg-red-700">del</button>
                          <button onClick={() => setConfirmDeleteId(null)}
                            className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-muted)]">no</button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEdit(row)} title="Edit reaction"
                            className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button onClick={() => setConfirmDeleteId(row.id)} title="Delete reaction"
                            className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-red-500 transition-colors">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-12 text-[var(--text-muted)] text-sm">No reactions match "{reactionsQuery}"</div>}
        </div>
      </div>
    );
  };

  // ── Metabolites tab ──────────────────────────────────────────────────────
  const renderMetabolitesTab = () => {
    const allMets = currentModel?.metabolites || {};
    const allRxns = currentModel?.reactions || {};
    const metReactionCount = useMemo ? null : null; // computed inline
    const qlo = metQuery.toLowerCase();
    const rows = Object.entries(allMets).map(([id, met]) => {
      const rxnCount = Object.values(allRxns).filter(r => id in (r.metabolites || {})).length;
      return { id, name: met.name || '', formula: met.formula || '', compartment: met.compartment || '', rxnCount };
    });
    const filtered = qlo ? rows.filter(r =>
      r.id.toLowerCase().includes(qlo) || r.name.toLowerCase().includes(qlo) ||
      r.formula.toLowerCase().includes(qlo) || r.compartment.toLowerCase().includes(qlo)
    ) : rows;
    const COMP_COLOR = { c:'#3b82f6', e:'#f59e0b', p:'#10b981', m:'#8b5cf6', x:'#ef4444', n:'#6366f1' };

    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <input value={metQuery} onChange={e => setMetQuery(e.target.value)}
            placeholder="Search by ID, name, formula, compartment…"
            className="flex-1 min-w-64 px-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]" />
          <span className="text-xs text-[var(--text-muted)]">{filtered.length} / {rows.length} metabolites</span>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-[var(--bg-secondary)]">
              <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <th className="px-3 py-2 font-medium w-44">ID</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium w-32">Formula</th>
                <th className="px-3 py-2 font-medium w-28">Compartment</th>
                <th className="px-3 py-2 font-medium w-24">Reactions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)]">{row.id}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{row.name || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--text-muted)]">{row.formula || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.compartment ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ background: COMP_COLOR[row.compartment] || '#94a3b8' }} />
                        <span className="text-[var(--text-secondary)]">{row.compartment}</span>
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{row.rxnCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-12 text-[var(--text-muted)] text-sm">No metabolites match "{metQuery}"</div>}
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

    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <input value={geneQuery} onChange={e => setGeneQuery(e.target.value)}
            placeholder="Search by gene ID or name…"
            className="flex-1 min-w-64 px-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]" />
          <span className="text-xs text-[var(--text-muted)]">{filtered.length} / {rows.length} genes</span>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-[var(--bg-secondary)]">
              <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <th className="px-3 py-2 font-medium w-36">Gene ID</th>
                <th className="px-3 py-2 font-medium w-40">Name</th>
                <th className="px-3 py-2 font-medium w-20">Rxns</th>
                <th className="px-3 py-2 font-medium">Associated Reactions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors">
                  <td className="px-3 py-2 font-mono text-xs font-medium text-[var(--text-primary)]">{row.id}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{row.name || '—'}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{row.rxns.length}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                    <div className="flex flex-wrap gap-1">
                      {row.rxns.slice(0, 8).map(r => (
                        <span key={r} className="px-1.5 py-0.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded font-mono text-[10px]">{r}</span>
                      ))}
                      {row.rxns.length > 8 && <span className="text-[var(--text-muted)] text-[10px]">+{row.rxns.length - 8} more</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-12 text-[var(--text-muted)] text-sm">No genes match "{geneQuery}"</div>}
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
          {viewLevel === 'categories' && renderTreemap()}
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
    </div>
  );
};

export default SubsystemView;
