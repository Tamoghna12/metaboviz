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
import { Layers, Zap, FlaskConical, Dna, Download, BarChart2, FileText, Map as MapIcon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useModel } from '../contexts/ModelContext';
import NetworkCanvas from './NetworkCanvas';
import EscherMapView from './EscherMapView';

const TABS = [
  { id: 'pathways',    label: 'Pathways',    Icon: Layers      },
  { id: 'reactions',   label: 'Reactions',   Icon: Zap         },
  { id: 'metabolites', label: 'Metabolites', Icon: FlaskConical },
  { id: 'genes',       label: 'Genes',       Icon: Dna         },
  { id: 'maps',        label: 'Maps',        Icon: MapIcon     },
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

const SubsystemView = ({ fluxes = {}, phenotype = null, width = 1000, height = 700, onReactionSelect }) => {
  const { isDark, accessibleColors } = useTheme();
  const { currentModel, updateReactions } = useModel();
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

  // Semantic color per category name (not flux-dependent)
  const CATEGORY_PALETTE = {
    'Carbohydrate Metabolism':    { bg: '#f97316', light: '#fff7ed', border: '#fb923c' },
    'Amino Acid Metabolism':      { bg: '#22c55e', light: '#f0fdf4', border: '#4ade80' },
    'Energy Metabolism':          { bg: '#eab308', light: '#fefce8', border: '#facc15' },
    'Lipid Metabolism':           { bg: '#a855f7', light: '#faf5ff', border: '#c084fc' },
    'Nucleotide Metabolism':      { bg: '#3b82f6', light: '#eff6ff', border: '#60a5fa' },
    'Cofactor & Vitamin Metabolism': { bg: '#14b8a6', light: '#f0fdfa', border: '#2dd4bf' },
    'Cell Envelope':              { bg: '#f43f5e', light: '#fff1f2', border: '#fb7185' },
    'Transport':                  { bg: '#6366f1', light: '#eef2ff', border: '#818cf8' },
    'Other':                      { bg: '#6b7280', light: '#f9fafb', border: '#9ca3af' },
  };

  const CATEGORY_ICONS = {
    'Carbohydrate Metabolism': '🍬',
    'Amino Acid Metabolism': '🧬',
    'Energy Metabolism': '⚡',
    'Lipid Metabolism': '💧',
    'Nucleotide Metabolism': '🔵',
    'Cofactor & Vitamin Metabolism': '💊',
    'Cell Envelope': '🛡️',
    'Transport': '🔄',
    'Other': '📦',
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
    const withGPR = rxnList.filter(r => r.gene_reaction_rule).length;
    const exchange = rxnList.filter(r => r.id?.startsWith('EX_') || r.subsystem?.toLowerCase().includes('exchange')).length;
    const blocked = rxnList.filter(r => r.lower_bound === 0 && r.upper_bound === 0).length;

    const metList = Object.values(metabolites);
    const compartments = [...new Set(metList.map(m => m.compartment || (m.id || '').split('_').pop()).filter(Boolean))];

    const pctRev = rxnList.length ? Math.round((reversible / rxnList.length) * 100) : 0;
    const pctGPR = rxnList.length ? Math.round((withGPR / rxnList.length) * 100) : 0;

    const statCards = [
      { label: 'Reactions', value: rxnList.length.toLocaleString(), sub: `${pctRev}% reversible`, color: '#3b82f6', icon: '⚡' },
      { label: 'Metabolites', value: metList.length.toLocaleString(), sub: `${compartments.length} compartments`, color: '#10b981', icon: '🧪' },
      { label: 'Genes', value: Object.keys(genes).length.toLocaleString(), sub: `${pctGPR}% rxn coverage`, color: '#8b5cf6', icon: '🧬' },
      { label: 'Subsystems', value: subsystems.size.toLocaleString(), sub: `${categoryHierarchy.size} categories`, color: '#f59e0b', icon: '🗂️' },
      { label: 'Exchange rxns', value: exchange.toLocaleString(), sub: 'boundary reactions', color: '#6366f1', icon: '🔄' },
      { label: 'Blocked rxns', value: blocked.toLocaleString(), sub: 'lb=ub=0', color: blocked > 0 ? '#ef4444' : '#94a3b8', icon: '🚫' },
    ];

    // Category bar chart data
    const categoryList = Array.from(categoryHierarchy.entries())
      .sort((a, b) => b[1].totalReactions - a[1].totalReactions);
    const maxCatRxns = categoryList[0]?.[1].totalReactions || 1;

    return (
      <div className="px-4 pt-2 pb-0 space-y-4">
        {/* Stat cards */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {statCards.map(s => (
            <div key={s.label} className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-lg">{s.icon}</span>
                <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">{s.label}</span>
              </div>
              <span className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</span>
              <span className="text-[10px] text-[var(--text-muted)]">{s.sub}</span>
            </div>
          ))}
        </div>

        {/* Horizontal category breakdown bar */}
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">Reaction distribution by category</p>
          <div className="space-y-2">
            {categoryList.map(([cat, data]) => {
              const palette = getCategoryPalette(cat);
              const pct = Math.round((data.totalReactions / (rxnList.length || 1)) * 100);
              return (
                <div key={cat} className="flex items-center gap-3 cursor-pointer group"
                  onClick={() => navigateToCategory(cat)}>
                  <span className="text-xs text-[var(--text-secondary)] w-44 truncate group-hover:text-[var(--primary)] transition-colors" title={cat}>{cat}</span>
                  <div className="flex-1 h-4 rounded-full bg-[var(--bg-primary)] overflow-hidden relative">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${(data.totalReactions / maxCatRxns) * 100}%`, backgroundColor: palette.bg, opacity: 0.8 }} />
                  </div>
                  <span className="text-xs font-mono text-[var(--text-muted)] w-24 text-right">{data.totalReactions.toLocaleString()} rxns ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

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
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
              Subsystem Treemap — click any block to navigate
            </p>
            <button
              onClick={downloadTreemapSVG}
              className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors"
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

  // Render category cards (top level)
  const renderCategoryCards = () => {
    const categoryList = Array.from(categoryHierarchy.entries())
      .sort((a, b) => b[1].totalReactions - a[1].totalReactions);
    const totalRxns = categoryList.reduce((s, [, d]) => s + d.totalReactions, 0) || 1;

    return (
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {categoryList.map(([category, data]) => {
            const palette = getCategoryPalette(category);
            const icon = CATEGORY_ICONS[category] || '📦';
            const pct = Math.round((data.totalReactions / totalRxns) * 100);
            return (
              <button
                key={category}
                onClick={() => navigateToCategory(category)}
                className="group text-left rounded-xl border-2 overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5"
                style={{ borderColor: isDark ? '#374151' : palette.border }}
              >
                {/* Colored header strip */}
                <div className="px-4 pt-4 pb-3" style={{ backgroundColor: isDark ? '#1f2937' : palette.light }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">{icon}</span>
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: palette.bg }}
                    >
                      {data.subsystems.length} subsystem{data.subsystems.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <h4 className="font-semibold text-sm text-[var(--text-primary)] leading-tight group-hover:underline">
                    {category}
                  </h4>
                </div>
                {/* Stats section */}
                <div className="px-4 py-3 bg-[var(--card-bg)]">
                  <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1.5">
                    <span>{data.totalReactions.toLocaleString()} reactions</span>
                    <span className="font-medium" style={{ color: palette.bg }}>{pct}%</span>
                  </div>
                  {/* Proportional bar */}
                  <div className="w-full h-1.5 rounded-full bg-[var(--bg-primary)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: palette.bg }}
                    />
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-2">
                    {data.totalMetabolites.size.toLocaleString()} metabolites
                  </p>
                </div>
              </button>
            );
          })}
        </div>
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
        rxn.gene_reaction_rule || '', rxn.subsystem || '', `${r} → ${p}`].map(esc).join(',');
    });
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${currentModel?.id || 'model'}_reactions.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [currentModel]);

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
        rev: (rxn.lower_bound ?? -1000) < 0, hasGPR: !!rxn.gene_reaction_rule,
        lb: rxn.lower_bound ?? -1000, ub: rxn.upper_bound ?? 1000,
        gpr: rxn.gene_reaction_rule || '', subsystem: rxn.subsystem || '' };
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
            <thead className="bg-[var(--bg-secondary)]">
              <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <th className="px-3 py-2 font-medium w-36">ID</th>
                <th className="px-3 py-2 font-medium">Stoichiometry</th>
                <th className="px-3 py-2 font-medium w-40">Subsystem</th>
                <th className="px-3 py-2 font-medium w-24">Bounds</th>
                <th className="px-3 py-2 font-medium w-48">GPR</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id}
                  onClick={() => onReactionSelect?.(row.id)}
                  className="border-b border-[var(--border-color)] cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs font-medium text-[var(--text-primary)]">{row.id}</div>
                    {row.name && row.name !== row.id && <div className="text-xs text-[var(--text-muted)] truncate max-w-[130px]" title={row.name}>{row.name}</div>}
                    <div className="flex gap-1 mt-0.5">
                      {row.rev && <span className="px-1 text-[10px] rounded bg-amber-100 text-amber-700">rev</span>}
                      {row.hasGPR && <span className="px-1 text-[10px] rounded bg-blue-100 text-blue-700">gpr</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--text-secondary)]">
                    <span className="text-red-500">{row.reactants.slice(0,3).join(' + ')}{row.reactants.length > 3 ? ` +${row.reactants.length-3}` : ''}</span>
                    <span className="mx-1 text-[var(--text-muted)]">{row.rev ? '⇌' : '→'}</span>
                    <span className="text-green-600">{row.products.slice(0,3).join(' + ')}{row.products.length > 3 ? ` +${row.products.length-3}` : ''}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)] truncate max-w-[150px]" title={row.subsystem}>{row.subsystem || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--text-muted)]">[{row.lb}, {row.ub}]</td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--text-muted)] break-all" style={{lineHeight:1.3}}>{row.gpr || '—'}</td>
                </tr>
              ))}
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
      if (!rxn.gene_reaction_rule) return;
      const genes = rxn.gene_reaction_rule.replace(/[()]/g, '').split(/\s+(?:and|or)\s+/i).map(g => g.trim()).filter(Boolean);
      genes.forEach(g => { if (!geneRxns[g]) geneRxns[g] = []; geneRxns[g].push(rxnId); });
    });
    const rows = Object.entries(allGenes).map(([id, gene]) => ({
      id, name: gene.name || '', rxns: geneRxns[id] || []
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
        icon: '{}',
        title: 'Model JSON (COBRApy format)',
        desc: `Saves all ${rxnCount} reactions including any bounds or GPR edits made via CSV import. Compatible with COBRApy, BIGG, and other tools.`,
        action: exportModelJSON,
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
      {activeTab === 'maps'        && (
        <div className="flex-1 flex flex-col overflow-hidden" style={{ height: height - 48 }}>
          <EscherMapView fluxes={fluxes} phenotype={phenotype} />
        </div>
      )}
      {activeTab === 'export'      && renderExportTab()}
    </div>
  );
};

export default SubsystemView;
