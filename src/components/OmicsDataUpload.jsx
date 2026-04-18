/**
 * OmicsDataUpload - Multi-omics Data Management Panel
 *
 * Provides UI for:
 * - Uploading transcriptomics, proteomics, metabolomics, fluxomics data
 * - Column mapping (ID column, value columns)
 * - Condition selection for multi-condition datasets
 * - Visualization settings (color scale, normalization)
 * - Data preview and statistics
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useOmics, OMICS_TYPES } from '../contexts/OmicsContext';
import { useTheme } from '../contexts/ThemeContext';
import { useModel } from '../contexts/ModelContext';
import * as OmicsIntegration from '../lib/OmicsIntegration';

// Omics type metadata
const OMICS_META = {
  [OMICS_TYPES.TRANSCRIPTOMICS]: {
    icon: '🧬',
    label: 'Transcriptomics',
    description: 'Gene expression (RNA-seq, microarray)',
    fileHint: 'Gene ID, log2FC or TPM values',
    color: 'var(--info)',
    example: 'gene_id, condition1_log2fc, condition2_log2fc'
  },
  [OMICS_TYPES.PROTEOMICS]: {
    icon: '🔬',
    label: 'Proteomics',
    description: 'Protein abundance',
    fileHint: 'Protein/Gene ID, abundance values',
    color: 'var(--success)',
    example: 'protein_id, sample1_abundance, sample2_abundance'
  },
  [OMICS_TYPES.METABOLOMICS]: {
    icon: '⚗️',
    label: 'Metabolomics',
    description: 'Metabolite concentrations',
    fileHint: 'Metabolite ID (BiGG/KEGG), concentration values',
    color: 'var(--warning)',
    example: 'metabolite_id, wt_conc, mutant_conc'
  },
  [OMICS_TYPES.FLUXOMICS]: {
    icon: '🌊',
    label: 'Fluxomics',
    description: 'Measured fluxes (13C-MFA)',
    fileHint: 'Reaction ID, flux values',
    color: 'var(--danger)',
    example: 'reaction_id, measured_flux, std_error'
  }
};

// Color scale options
const COLOR_SCALES = [
  { id: 'diverging', label: 'Diverging (up/down)', description: 'For log2FC or centered data' },
  { id: 'sequential', label: 'Sequential', description: 'For abundance/intensity data' },
  { id: 'categorical', label: 'Categorical', description: 'For discrete categories' }
];

// Normalization options
const NORMALIZATION_OPTIONS = [
  { id: 'none', label: 'None', description: 'Use raw values' },
  { id: 'zscore', label: 'Z-score', description: 'Standardize to mean=0, std=1' },
  { id: 'minmax', label: 'Min-Max', description: 'Scale to 0-1 range' },
  { id: 'log2', label: 'Log2', description: 'Log2 transform' },
  { id: 'log2fc', label: 'Log2 FC', description: 'Already log2 fold-change' }
];

// Integration methods
const INTEGRATION_METHODS = [
  {
    id: 'eflux',
    name: 'E-Flux',
    description: 'Expression-constrained flux bounds',
    reference: 'Colijn et al. (2009) Mol Syst Biol',
    complexity: 'Simple',
    requirements: ['transcriptomics']
  },
  {
    id: 'gimme',
    name: 'GIMME',
    description: 'Minimize inconsistent reaction fluxes',
    reference: 'Becker & Palsson (2008) PLoS Comput Biol',
    complexity: 'Medium',
    requirements: ['transcriptomics']
  },
  {
    id: 'imat',
    name: 'iMAT',
    description: 'Maximize expression consistency',
    reference: 'Shlomi et al. (2008) Nat Biotechnol',
    complexity: 'Complex',
    requirements: ['transcriptomics']
  },
  {
    id: 'made',
    name: 'Differential E-Flux',
    description: 'Comparative E-Flux between two conditions',
    reference: 'Colijn et al. (2009) Mol Syst Biol',
    complexity: 'Medium',
    requirements: ['transcriptomics'],
    needsComparison: true
  }
];

export const OmicsDataUpload = ({ compact = false, onIntegrationResult = null }) => {
  const {
    datasets,
    selectedCondition,
    visSettings,
    loading,
    error,
    summary,
    loadOmicsData,
    removeDataset,
    setSelectedCondition,
    updateVisSettings
  } = useOmics();

  useTheme(); // Theme context for consistent styling
  const { currentModel } = useModel();

  const [activeTab, setActiveTab] = useState(OMICS_TYPES.TRANSCRIPTOMICS);
  const [dragActive, setDragActive] = useState(false);

  // Integration state
  const [selectedMethod, setSelectedMethod] = useState('eflux');
  const [integrationRunning, setIntegrationRunning] = useState(false);
  const [integrationResult, setIntegrationResult] = useState(null);
  const [integrationError, setIntegrationError] = useState(null);
  const [comparisonCondition, setComparisonCondition] = useState(null);

  const fileInputRef = useRef(null);

  // Check if model is available for integration
  const canRunIntegration = useMemo(() => {
    const hasModel = currentModel && currentModel.reactions && Object.keys(currentModel.reactions).length > 0;
    const hasTranscriptomics = !!datasets[OMICS_TYPES.TRANSCRIPTOMICS];
    return hasModel && hasTranscriptomics;
  }, [currentModel, datasets]);

  // Convert omics data to Map for integration
  const getExpressionMap = useCallback((omicsType, condition) => {
    const dataset = datasets[omicsType];
    if (!dataset) return new Map();

    const expressionMap = new Map();
    const cond = condition || selectedCondition[omicsType] || dataset.conditions[0];

    Object.entries(dataset.data).forEach(([id, values]) => {
      const value = typeof values === 'object' ? (values[cond] ?? values) : values;
      if (typeof value === 'number' && !isNaN(value)) {
        // Normalize to 0-1 range for most methods
        const normalizedValue = Math.max(0, Math.min(1, (value - (dataset.stats?.min || 0)) / ((dataset.stats?.max || 1) - (dataset.stats?.min || 0))));
        expressionMap.set(id, normalizedValue);
      }
    });

    return expressionMap;
  }, [datasets, selectedCondition]);

  // Run integration analysis
  const runIntegration = useCallback(async () => {
    if (!canRunIntegration) return;

    setIntegrationRunning(true);
    setIntegrationError(null);

    try {
      const transcriptomicsData = getExpressionMap(OMICS_TYPES.TRANSCRIPTOMICS);
      const proteomicsData = datasets[OMICS_TYPES.PROTEOMICS]
        ? getExpressionMap(OMICS_TYPES.PROTEOMICS)
        : null;
      const metabolomicsData = datasets[OMICS_TYPES.METABOLOMICS]
        ? getExpressionMap(OMICS_TYPES.METABOLOMICS)
        : null;

      let result;

      switch (selectedMethod) {
        case 'eflux':
          result = await OmicsIntegration.solveEFlux(currentModel, transcriptomicsData, {
            scalingMethod: 'linear'
          });
          break;

        case 'gimme':
          result = await OmicsIntegration.solveGIMME(currentModel, transcriptomicsData, {
            threshold: 0.25,
            requiredFraction: 0.9
          });
          break;

        case 'imat':
          result = await OmicsIntegration.solveIMAT(currentModel, transcriptomicsData, {
            highThreshold: 0.75,
            lowThreshold: 0.25
          });
          break;

        case 'made': {
          if (!comparisonCondition) {
            throw new Error('Select a comparison condition for MADE analysis');
          }
          const controlData = getExpressionMap(OMICS_TYPES.TRANSCRIPTOMICS, selectedCondition[OMICS_TYPES.TRANSCRIPTOMICS]);
          const treatmentData = getExpressionMap(OMICS_TYPES.TRANSCRIPTOMICS, comparisonCondition);
          result = await OmicsIntegration.solveDifferentialEFlux(currentModel, controlData, treatmentData);
          break;
        }

        default:
          // Integrated analysis with all available omics
          result = await OmicsIntegration.integratedOmicsAnalysis(currentModel, {
            transcriptomics: transcriptomicsData,
            proteomics: proteomicsData,
            metabolomics: metabolomicsData,
            method: selectedMethod.toUpperCase()
          });
      }

      setIntegrationResult(result);

      // Callback to parent component if provided
      if (onIntegrationResult) {
        onIntegrationResult(result);
      }

    } catch (err) {
      console.error('Integration failed:', err);
      setIntegrationError(err.message);
    } finally {
      setIntegrationRunning(false);
    }
  }, [canRunIntegration, selectedMethod, currentModel, getExpressionMap, datasets, selectedCondition, comparisonCondition, onIntegrationResult]);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      try {
        await loadOmicsData(file, activeTab);
      } catch (err) {
        console.error('Failed to load omics data:', err);
      }
    }
  }, [activeTab, loadOmicsData]);

  const handleFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await loadOmicsData(file, activeTab);
      } catch (err) {
        console.error('Failed to load omics data:', err);
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [activeTab, loadOmicsData]);

  const meta = OMICS_META[activeTab];
  const dataset = datasets[activeTab];
  const settings = visSettings[activeTab];
  const condition = selectedCondition[activeTab];

  if (compact) {
    // Compact mode for sidebar
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-[var(--text-primary)]">Multi-Omics Data</h4>
          <span className="text-xs text-[var(--text-muted)]">{summary.length}/4 loaded</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {Object.values(OMICS_TYPES).map(type => {
            const typeMeta = OMICS_META[type];
            const typeDataset = datasets[type];
            const typeSettings = visSettings[type];

            return (
              <button
                key={type}
                onClick={() => setActiveTab(type)}
                className={`p-2 rounded-lg border text-left transition-all ${
                  typeDataset
                    ? 'bg-[var(--success-bg)] border-[var(--success)]'
                    : 'bg-[var(--card-bg)] border-[var(--card-border)] hover:border-[var(--primary)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{typeMeta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {typeMeta.label}
                    </p>
                    {typeDataset ? (
                      <p className="text-[10px] text-[var(--success-text)]">
                        {Object.keys(typeDataset.data).length} entries
                      </p>
                    ) : (
                      <p className="text-[10px] text-[var(--text-muted)]">Not loaded</p>
                    )}
                  </div>
                  {typeDataset && (
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={typeSettings.enabled}
                        onChange={(e) => updateVisSettings(type, { enabled: e.target.checked })}
                        className="w-3 h-3"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </label>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {summary.length > 0 && (
          <div className="text-xs text-[var(--text-muted)] p-2 bg-[var(--bg-primary)] rounded">
            Overlay: {summary.filter(s => visSettings[s.type].enabled).map(s => OMICS_META[s.type].icon).join(' ')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="section-header">
        <h3 className="section-title">Multi-Omics Data Integration</h3>
      </div>

      {/* Omics Type Tabs */}
      <div className="flex gap-1 p-1 bg-[var(--bg-primary)] rounded-lg">
        {Object.values(OMICS_TYPES).map(type => {
          const typeMeta = OMICS_META[type];
          const hasData = !!datasets[type];

          return (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                activeTab === type
                  ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>{typeMeta.icon}</span>
              <span className="hidden sm:inline">{typeMeta.label}</span>
              {hasData && (
                <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Upload Area or Data Preview */}
      {!dataset ? (
        <div
          className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragActive
              ? 'border-[var(--primary)] bg-[var(--info-bg)]'
              : 'border-[var(--border-color)] hover:border-[var(--primary)]'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.txt,.json,.xlsx"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="space-y-3">
            <div className="text-4xl">{meta.icon}</div>
            <div>
              <p className="text-sm text-[var(--text-primary)] font-medium">
                Upload {meta.label} Data
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                {meta.description}
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded text-sm font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Select File'}
            </button>
            <div className="text-xs text-[var(--text-muted)]">
              <p>Supported: CSV, TSV, JSON</p>
              <p className="font-mono mt-1">{meta.example}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Dataset Info */}
          <div className="p-4 bg-[var(--success-bg)] border border-[var(--success)] rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">{meta.icon}</span>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{dataset.fileName}</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {Object.keys(dataset.data).length} entries • {dataset.conditions.length} condition(s)
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) => updateVisSettings(activeTab, { enabled: e.target.checked })}
                  />
                  Show
                </label>
                <button
                  onClick={() => removeDataset(activeTab)}
                  className="px-2 py-1 text-xs text-[var(--danger-text)] hover:bg-[var(--danger-bg)] rounded"
                >
                  Remove
                </button>
              </div>
            </div>

            {/* Condition Selector */}
            {dataset.conditions.length > 1 && (
              <div className="mt-3">
                <label className="text-xs text-[var(--text-secondary)] font-medium">Select Condition:</label>
                <select
                  value={condition || ''}
                  onChange={(e) => setSelectedCondition(prev => ({ ...prev, [activeTab]: e.target.value }))}
                  className="mt-1 w-full p-2 text-sm bg-[var(--input-bg)] border border-[var(--input-border)] rounded"
                >
                  {dataset.conditions.map(cond => (
                    <option key={cond} value={cond}>{cond}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Statistics */}
            {dataset.stats && (
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">Min</p>
                  <p className="text-sm font-mono font-medium">{dataset.stats.min.toFixed(2)}</p>
                </div>
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">Max</p>
                  <p className="text-sm font-mono font-medium">{dataset.stats.max.toFixed(2)}</p>
                </div>
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">Mean</p>
                  <p className="text-sm font-mono font-medium">{dataset.stats.mean.toFixed(2)}</p>
                </div>
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">Std</p>
                  <p className="text-sm font-mono font-medium">{dataset.stats.std.toFixed(2)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Visualization Settings */}
          <details className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg">
            <summary className="p-3 cursor-pointer text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)]">
              Visualization Settings
            </summary>
            <div className="p-4 border-t border-[var(--border-color)] space-y-4">
              {/* Target */}
              <div>
                <label className="text-xs text-[var(--text-secondary)] font-medium">Apply to:</label>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => updateVisSettings(activeTab, { target: 'edge' })}
                    className={`px-3 py-1.5 text-xs rounded ${
                      settings.target === 'edge'
                        ? 'bg-[var(--primary)] text-white'
                        : 'bg-[var(--bg-primary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    Reactions (edges)
                  </button>
                  <button
                    onClick={() => updateVisSettings(activeTab, { target: 'node' })}
                    className={`px-3 py-1.5 text-xs rounded ${
                      settings.target === 'node'
                        ? 'bg-[var(--primary)] text-white'
                        : 'bg-[var(--bg-primary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    Metabolites (nodes)
                  </button>
                </div>
              </div>

              {/* Property */}
              <div>
                <label className="text-xs text-[var(--text-secondary)] font-medium">Visual property:</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {['color', 'width', 'size', 'opacity', 'animation'].map(prop => (
                    <button
                      key={prop}
                      onClick={() => updateVisSettings(activeTab, { property: prop })}
                      className={`px-3 py-1.5 text-xs rounded capitalize ${
                        settings.property === prop
                          ? 'bg-[var(--primary)] text-white'
                          : 'bg-[var(--bg-primary)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {prop}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Scale */}
              <div>
                <label className="text-xs text-[var(--text-secondary)] font-medium">Color scale:</label>
                <div className="flex gap-2 mt-1">
                  {COLOR_SCALES.map(scale => (
                    <button
                      key={scale.id}
                      onClick={() => updateVisSettings(activeTab, { colorScale: scale.id })}
                      className={`px-3 py-1.5 text-xs rounded ${
                        settings.colorScale === scale.id
                          ? 'bg-[var(--primary)] text-white'
                          : 'bg-[var(--bg-primary)] text-[var(--text-secondary)]'
                      }`}
                      title={scale.description}
                    >
                      {scale.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Log Transform */}
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={settings.logTransform}
                  onChange={(e) => updateVisSettings(activeTab, { logTransform: e.target.checked })}
                />
                Log2 transform values
              </label>

              {/* Value Range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--text-secondary)] font-medium">Min value:</label>
                  <input
                    type="number"
                    value={settings.minValue ?? ''}
                    onChange={(e) => updateVisSettings(activeTab, { minValue: e.target.value ? Number(e.target.value) : null })}
                    placeholder="Auto"
                    className="mt-1 w-full p-2 text-sm bg-[var(--input-bg)] border border-[var(--input-border)] rounded"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-secondary)] font-medium">Max value:</label>
                  <input
                    type="number"
                    value={settings.maxValue ?? ''}
                    onChange={(e) => updateVisSettings(activeTab, { maxValue: e.target.value ? Number(e.target.value) : null })}
                    placeholder="Auto"
                    className="mt-1 w-full p-2 text-sm bg-[var(--input-bg)] border border-[var(--input-border)] rounded"
                  />
                </div>
              </div>
            </div>
          </details>

          {/* Data Preview */}
          <details className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg">
            <summary className="p-3 cursor-pointer text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)]">
              Data Preview (first 10 rows)
            </summary>
            <div className="p-4 border-t border-[var(--border-color)] overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-color)]">
                    {dataset.headers.slice(0, 6).map(h => (
                      <th key={h} className="p-2 text-left text-[var(--text-secondary)] font-medium">
                        {h}
                      </th>
                    ))}
                    {dataset.headers.length > 6 && (
                      <th className="p-2 text-left text-[var(--text-muted)]">...</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {dataset.rawData.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-b border-[var(--border-color)]">
                      {dataset.headers.slice(0, 6).map(h => (
                        <td key={h} className="p-2 font-mono text-[var(--text-primary)]">
                          {typeof row[h] === 'number' ? row[h].toFixed(3) : row[h]}
                        </td>
                      ))}
                      {dataset.headers.length > 6 && (
                        <td className="p-2 text-[var(--text-muted)]">...</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-[var(--danger-bg)] border border-[var(--danger)] rounded-lg">
          <p className="text-sm text-[var(--danger-text)]">{error}</p>
        </div>
      )}

      {/* Constraint-Based Integration Methods */}
      <div className="p-4 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-[var(--text-primary)]">
              Constraint-Based Integration
            </h4>
            <p className="text-xs text-[var(--text-muted)]">
              Published algorithms for expression-constrained FBA
            </p>
          </div>
          {!canRunIntegration && (
            <span className="text-xs text-[var(--warning-text)] bg-[var(--warning-bg)] px-2 py-1 rounded">
              {!currentModel?.reactions ? 'Load model first' : 'Load transcriptomics data'}
            </span>
          )}
        </div>

        {/* Method Selection */}
        <div className="grid grid-cols-2 gap-2">
          {INTEGRATION_METHODS.map(method => (
            <button
              key={method.id}
              onClick={() => setSelectedMethod(method.id)}
              disabled={!canRunIntegration}
              className={`p-3 rounded-lg border text-left transition-all ${
                selectedMethod === method.id
                  ? 'bg-[var(--primary-bg)] border-[var(--primary)]'
                  : 'bg-[var(--bg-primary)] border-[var(--border-color)] hover:border-[var(--primary)]'
              } ${!canRunIntegration ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--text-primary)]">{method.name}</span>
                <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded">
                  {method.complexity}
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-1">{method.description}</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1 font-mono">{method.reference}</p>
            </button>
          ))}
        </div>

        {/* MADE comparison condition selector */}
        {selectedMethod === 'made' && datasets[OMICS_TYPES.TRANSCRIPTOMICS]?.conditions?.length > 1 && (
          <div className="p-3 bg-[var(--bg-primary)] rounded-lg">
            <label className="text-xs text-[var(--text-secondary)] font-medium">
              Compare conditions:
            </label>
            <div className="flex items-center gap-2 mt-2">
              <select
                value={selectedCondition[OMICS_TYPES.TRANSCRIPTOMICS] || ''}
                onChange={(e) => setSelectedCondition(prev => ({
                  ...prev,
                  [OMICS_TYPES.TRANSCRIPTOMICS]: e.target.value
                }))}
                className="flex-1 p-2 text-xs bg-[var(--input-bg)] border border-[var(--input-border)] rounded"
              >
                {datasets[OMICS_TYPES.TRANSCRIPTOMICS]?.conditions.map(c => (
                  <option key={c} value={c}>{c} (Control)</option>
                ))}
              </select>
              <span className="text-xs text-[var(--text-muted)]">vs</span>
              <select
                value={comparisonCondition || ''}
                onChange={(e) => setComparisonCondition(e.target.value)}
                className="flex-1 p-2 text-xs bg-[var(--input-bg)] border border-[var(--input-border)] rounded"
              >
                <option value="">Select treatment...</option>
                {datasets[OMICS_TYPES.TRANSCRIPTOMICS]?.conditions
                  .filter(c => c !== selectedCondition[OMICS_TYPES.TRANSCRIPTOMICS])
                  .map(c => (
                    <option key={c} value={c}>{c} (Treatment)</option>
                  ))}
              </select>
            </div>
          </div>
        )}

        {/* Run button */}
        <button
          onClick={runIntegration}
          disabled={!canRunIntegration || integrationRunning}
          className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            canRunIntegration && !integrationRunning
              ? 'bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white'
              : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] cursor-not-allowed'
          }`}
        >
          {integrationRunning ? (
            <>
              <span className="animate-spin">&#9696;</span>
              Running {INTEGRATION_METHODS.find(m => m.id === selectedMethod)?.name}...
            </>
          ) : (
            <>
              Run Integration Analysis
            </>
          )}
        </button>

        {/* Integration Error */}
        {integrationError && (
          <div className="p-3 bg-[var(--danger-bg)] border border-[var(--danger)] rounded-lg">
            <p className="text-sm text-[var(--danger-text)]">{integrationError}</p>
          </div>
        )}

        {/* Integration Results */}
        {integrationResult && (
          <div className="p-4 bg-[var(--success-bg)] border border-[var(--success)] rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--success-text)]">
                  {integrationResult.method} Analysis Complete
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Status: {integrationResult.status}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold font-mono text-[var(--text-primary)]">
                  {(integrationResult.objectiveValue || 0).toFixed(4)}
                </p>
                <p className="text-xs text-[var(--text-muted)]">Objective Value</p>
              </div>
            </div>

            {/* Method-specific results */}
            {integrationResult.method === 'GIMME' && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">Low Expr. Rxns</p>
                  <p className="text-sm font-mono font-medium">{integrationResult.lowExpressionReactions?.length || 0}</p>
                </div>
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">Threshold</p>
                  <p className="text-sm font-mono font-medium">{(integrationResult.threshold || 0).toFixed(3)}</p>
                </div>
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">Inconsistency</p>
                  <p className="text-sm font-mono font-medium">{(integrationResult.inconsistencyScore || 0).toFixed(2)}</p>
                </div>
              </div>
            )}

            {integrationResult.method === 'iMAT' && integrationResult.consistency && (
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">High Expr. Active</p>
                  <p className="text-sm font-mono font-medium">
                    {integrationResult.consistency.highActive}/{integrationResult.consistency.highTotal}
                  </p>
                </div>
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">Low Expr. Inactive</p>
                  <p className="text-sm font-mono font-medium">
                    {integrationResult.consistency.lowInactive}/{integrationResult.consistency.lowTotal}
                  </p>
                </div>
              </div>
            )}

            {integrationResult.method === 'MADE' && integrationResult.objectiveChange && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">Control</p>
                  <p className="text-sm font-mono font-medium">{integrationResult.objectiveChange.control.toFixed(3)}</p>
                </div>
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">Treatment</p>
                  <p className="text-sm font-mono font-medium">{integrationResult.objectiveChange.treatment.toFixed(3)}</p>
                </div>
                <div className="p-2 bg-[var(--card-bg)] rounded">
                  <p className="text-xs text-[var(--text-muted)]">% Change</p>
                  <p className={`text-sm font-mono font-medium ${
                    integrationResult.objectiveChange.percentChange > 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]'
                  }`}>
                    {integrationResult.objectiveChange.percentChange > 0 ? '+' : ''}
                    {integrationResult.objectiveChange.percentChange.toFixed(1)}%
                  </p>
                </div>
              </div>
            )}

            {/* Active fluxes count */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-secondary)]">
                Active reactions: {Object.values(integrationResult.fluxes || {}).filter(v => Math.abs(v) > 0.001).length}
              </span>
              <span className="text-[var(--text-muted)] font-mono">
                {integrationResult.reference}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Integration Guide */}
      <details className="text-xs text-[var(--text-secondary)]">
        <summary className="cursor-pointer hover:text-[var(--text-primary)] font-medium">
          Data Format Guide
        </summary>
        <div className="mt-2 p-3 bg-[var(--bg-primary)] rounded border border-[var(--border-color)] space-y-3">
          <div>
            <p className="font-medium text-[var(--text-primary)] mb-1">Expected Format:</p>
            <p>CSV/TSV with header row. First column should be identifiers (gene/protein/metabolite/reaction IDs).</p>
          </div>
          <div>
            <p className="font-medium text-[var(--text-primary)] mb-1">ID Matching:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-2">
              <li>Transcriptomics: Gene IDs matching model genes (e.g., b0001, ECK120001)</li>
              <li>Proteomics: Gene/protein IDs (UniProt, gene names)</li>
              <li>Metabolomics: BiGG IDs (e.g., glc__D_c) or KEGG IDs</li>
              <li>Fluxomics: Reaction IDs from model (e.g., PFK, GAPD)</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-[var(--text-primary)] mb-1">Example Sources:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-2">
              <li>DESeq2/edgeR output (RNA-seq differential expression)</li>
              <li>MaxQuant/Proteome Discoverer (proteomics)</li>
              <li>MetaboAnalyst export (metabolomics)</li>
              <li>13C-MFA results (fluxomics)</li>
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
};

export default OmicsDataUpload;
