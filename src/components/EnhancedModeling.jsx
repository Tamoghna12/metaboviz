import React, { useState, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useModel } from '../contexts/ModelContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { computeManager } from '../lib/ComputeWorker';

/**
 * FBASolver - Real LP-based Flux Balance Analysis
 *
 * Uses HiGHS WASM solver via ComputeWorker for actual LP solving.
 * Routes to Web Worker to prevent UI blocking.
 * NO fallback/fake solvers - requires a loaded model.
 *
 * The solver performs ACTUAL linear programming:
 *   maximize: c·v
 *   subject to: S·v = 0 (steady-state)
 *               lb ≤ v ≤ ub (flux bounds)
 *
 * References:
 * - Orth et al. (2010) "What is flux balance analysis?" Nature Biotechnology
 * - Varma & Palsson (1994) "Stoichiometric flux balance models..."
 */
export const FBASolver = {
  /**
   * Solve FBA using real LP solver
   * @param {Object} model - Parsed metabolic model (REQUIRED)
   * @param {Object} constraints - Flux constraints { rxnId: { lb, ub } }
   * @param {string[]} knockouts - Gene IDs to knock out
   * @param {string} objective - Objective reaction ID (auto-detected if null)
   * @returns {Promise<Object>} - { status, growthRate, fluxes, ... }
   */
  solveFBA: async (model, constraints = {}, knockouts = [], objective = null) => {
    // Require a real model - no fake fallbacks
    if (!model || !model.reactions || Object.keys(model.reactions).length === 0) {
      return {
        status: 'no_model',
        error: 'No metabolic model loaded. Please load an SBML or JSON model first.',
        growthRate: 0,
        yield: 0,
        fluxes: {},
        blocked: [],
        phenotype: 'no_model',
        isRealSolver: false
      };
    }

    try {
      // Solve using ComputeWorker (routes to HiGHS Web Worker)
      const result = await computeManager.solve('fba', model, {
        constraints,
        knockouts,
        objective
      });

      // Calculate yield and additional metrics
      const glucoseUptake = Math.abs(constraints.EX_glc?.lb || result.fluxes['EX_glc_e'] || result.fluxes['EX_glc'] || 10);
      const acetateFlux = result.fluxes['EX_ac_e'] || result.fluxes['ACt2r'] || 0;
      const co2Flux = result.fluxes['EX_co2_e'] || result.fluxes['EX_co2'] || 0;

      return {
        status: result.status.toLowerCase(),
        growthRate: result.objectiveValue || 0,
        yield: glucoseUptake > 0 ? (result.objectiveValue || 0) / glucoseUptake : 0,
        fluxes: result.fluxes || {},
        blocked: result.knockedOutGenes || knockouts,
        phenotype: FBASolver._determinePhenotype(result),
        acetate: Math.max(0, acetateFlux),
        co2: Math.abs(co2Flux),
        solverInfo: result.solverInfo,
        isRealSolver: true
      };
    } catch (error) {
      console.error('FBA solver error:', error);
      return {
        status: 'error',
        error: error.message,
        growthRate: 0,
        yield: 0,
        fluxes: {},
        blocked: knockouts,
        phenotype: 'error',
        isRealSolver: false
      };
    }
  },

  /**
   * Parsimonious FBA - minimize total flux while maintaining optimal growth
   */
  solvePFBA: async (model, constraints = {}, knockouts = [], objective = null) => {
    if (!model || !model.reactions) {
      return FBASolver._noModelError();
    }

    try {
      // Solve pFBA using ComputeWorker (routes to HiGHS Web Worker)
      const result = await computeManager.solve('pfba', model, {
        constraints,
        knockouts,
        objective
      });

      const glucoseUptake = Math.abs(constraints.EX_glc?.lb || 10);

      return {
        status: result.status?.toLowerCase() || 'optimal',
        growthRate: result.objectiveValue || 0,
        yield: glucoseUptake > 0 ? (result.objectiveValue || 0) / glucoseUptake : 0,
        fluxes: result.fluxes || {},
        blocked: knockouts,
        phenotype: FBASolver._determinePhenotype(result),
        totalFlux: result.totalFlux,
        isRealSolver: true
      };
    } catch (error) {
      console.error('pFBA solver error:', error);
      return {
        status: 'error',
        error: error.message,
        growthRate: 0,
        fluxes: {},
        phenotype: 'error'
      };
    }
  },

  /**
   * MOMA - Minimization of Metabolic Adjustment
   */
  solveMOMA: async (model, constraints = {}, knockouts = [], referenceFluxes = null) => {
    if (!model || !model.reactions) {
      return FBASolver._noModelError();
    }

    try {
      // Solve MOMA using ComputeWorker
      const result = await computeManager.solve('moma', model, {
        constraints,
        knockouts,
        referenceFluxes
      });

      return {
        status: result.status?.toLowerCase() || 'optimal',
        growthRate: result.objectiveValue || 0,
        fluxes: result.fluxes || {},
        distance: result.distance,
        blocked: knockouts,
        phenotype: FBASolver._determinePhenotype(result),
        isRealSolver: true
      };
    } catch (error) {
      console.error('MOMA solver error:', error);
      return {
        status: 'error',
        error: error.message,
        growthRate: 0,
        fluxes: {},
        phenotype: 'error'
      };
    }
  },

  /**
   * FVA - Flux Variability Analysis
   */
  solveFVA: async (model, constraints = {}, knockouts = [], options = {}) => {
    if (!model || !model.reactions) {
      return FBASolver._noModelError();
    }

    try {
      // Solve FVA using ComputeWorker
      const result = await computeManager.solve('fva', model, {
        constraints,
        knockouts,
        fractionOfOptimum: options.fractionOfOptimum || 0.9
      });

      return {
        status: result.status?.toLowerCase() || 'optimal',
        fluxRanges: result.fluxRanges || {},
        optimalObjective: result.optimalObjective,
        isRealSolver: true
      };
    } catch (error) {
      console.error('FVA solver error:', error);
      return {
        status: 'error',
        error: error.message,
        fluxRanges: {}
      };
    }
  },

  /**
   * Gene essentiality analysis - test single gene knockouts
   */
  solveGeneEssentiality: async (model, options = {}) => {
    if (!model || !model.reactions) {
      return { status: 'no_model', error: 'No model loaded', essentiality: {} };
    }

    try {
      const result = await computeManager.solve('essentiality', model, {
        threshold: options.threshold || 0.01
      });

      return {
        status: result.status?.toLowerCase() || 'complete',
        wildTypeGrowth: result.wildTypeGrowth,
        essentiality: result.essentiality || {},
        essentialGenes: Object.entries(result.essentiality || {})
          .filter(([, data]) => data.essential)
          .map(([gene]) => gene),
        isRealSolver: true
      };
    } catch (error) {
      console.error('Gene essentiality error:', error);
      return { status: 'error', error: error.message, essentiality: {} };
    }
  },

  /**
   * Determine phenotype from flux distribution
   */
  _determinePhenotype: (result) => {
    if (!result || result.status !== 'OPTIMAL') return 'lethal';

    const fluxes = result.fluxes || {};
    const growth = result.objectiveValue || 0;

    if (growth < 0.001) return 'lethal';

    // Check for overflow metabolism (acetate production)
    const acetateFlux = fluxes['EX_ac_e'] || fluxes['EX_ac'] || fluxes['ACt2r'] || 0;
    if (acetateFlux > 0.5) return 'overflow';

    // Check respiration vs fermentation
    const o2Flux = Math.abs(fluxes['EX_o2_e'] || fluxes['EX_o2'] || 0);
    if (o2Flux > 0.5) return 'respiration';

    return 'fermentation';
  },

  /**
   * Error result when no model is loaded
   */
  _noModelError: () => ({
    status: 'no_model',
    error: 'No metabolic model loaded. Load an SBML/JSON model to run simulations.',
    growthRate: 0,
    yield: 0,
    fluxes: {},
    blocked: [],
    phenotype: 'no_model',
    acetate: 0,
    co2: 0,
    isRealSolver: false
  }),

  /**
   * Error result for solver failures
   */
  _errorResult: (error) => ({
    status: 'error',
    error: error.message || 'Solver error',
    growthRate: 0,
    yield: 0,
    fluxes: {},
    blocked: [],
    phenotype: 'error',
    acetate: 0,
    co2: 0,
    isRealSolver: false
  })
};

const ProductionEnvelope = ({ knockouts = [], objective }) => {
  const { currentModel } = useModel();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generateEnvelope = useCallback(async () => {
    if (!currentModel || !currentModel.reactions) {
      setError('No model loaded');
      return;
    }

    setLoading(true);
    setError(null);
    const points = [];
    const glcRange = [5, 10, 15, 20];
    const o2Range = [5, 10, 15, 20, 25];

    try {
      // Use sequential processing to avoid overwhelming the solver
      for (const glc of glcRange) {
        for (const o2 of o2Range) {
          const constraints = { EX_glc: { lb: -glc }, EX_o2: { lb: -o2 } };
          const result = await FBASolver.solveFBA(currentModel, constraints, knockouts, objective);
          points.push({
            glucose: glc,
            oxygen: o2,
            growth: result.growthRate || 0,
            yield: (result.yield || 0) * 100,
            acetate: result.acetate || 0,
            phenotype: result.phenotype || 'unknown'
          });
        }
      }
      setData(points);
    } catch (err) {
      console.error('Production envelope error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentModel, knockouts, objective]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-[var(--text-primary)]">Production Envelope Analysis</h4>
        <button onClick={generateEnvelope} disabled={loading || !currentModel}
          className="px-3 py-1.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 text-white rounded text-xs font-medium transition-colors"
        >
          {loading ? 'Calculating...' : 'Generate Plot'}
        </button>
      </div>
      {error && (
        <div className="p-3 bg-[var(--danger-bg)] border border-[var(--danger)] rounded text-sm text-[var(--danger-text)]">
          {error}
        </div>
      )}
      {!currentModel && (
        <p className="text-sm text-[var(--text-secondary)]">Load a model to generate production envelope.</p>
      )}
      {data.length > 0 && (
        <div className="h-64 bg-[var(--card-bg)] border border-[var(--card-border)] rounded">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis
                dataKey="glucose"
                stroke="var(--chart-axis)"
                label={{ value: 'Glucose (mmol/gDW/h)', fill: 'var(--text-secondary)', position: 'insideBottom', offset: -5, style: { fontSize: 11 } }}
              />
              <YAxis
                stroke="var(--chart-axis)"
                label={{ value: 'Growth Rate (h⁻¹)', fill: 'var(--text-secondary)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
              />
              <Tooltip contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: '4px' }} itemStyle={{ color: 'var(--chart-tooltip-text)' }} />
              <Line type="monotone" dataKey="growth" stroke="var(--primary)" strokeWidth={2} name="Growth Rate" dot={{ fill: 'var(--primary)', r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

const FluxComparison = ({ wildType, mutant }) => {
  const { accessibleColors } = useTheme();

  // Early return if no data
  if (!wildType?.fluxes || !mutant?.fluxes) {
    return (
      <p className="text-sm text-[var(--text-secondary)] text-center py-4">
        Run simulation with knockouts to compare fluxes
      </p>
    );
  }

  // Key reactions to compare (central carbon metabolism)
  const keyReactions = [
    'EX_glc_e', 'EX_glc', 'GLCpts', 'PGI', 'PFK', 'FBA', 'GAPD',
    'PYK', 'PDH', 'CS', 'ATPS4r', 'ACKr', 'LDH', 'EX_ac_e', 'EX_o2_e'
  ];

  const comparisonData = keyReactions
    .filter(rxn => wildType.fluxes[rxn] !== undefined || mutant.fluxes[rxn] !== undefined)
    .map(rxn => ({
      reaction: rxn.replace('_e', ''),
      wildType: wildType.fluxes[rxn] || 0,
      mutant: mutant.fluxes[rxn] || 0
    }))
    .filter(d => Math.abs(d.wildType) > 0.01 || Math.abs(d.mutant) > 0.01)
    .slice(0, 12); // Limit to 12 for readability

  if (comparisonData.length === 0) {
    return (
      <p className="text-sm text-[var(--text-secondary)] text-center py-4">
        No significant flux differences detected
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-[var(--text-primary)]">Flux Comparison</h4>
      <div className="h-64 bg-[var(--card-bg)] border border-[var(--card-border)] rounded">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={comparisonData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis type="number" stroke="var(--chart-axis)" />
            <YAxis dataKey="reaction" type="category" stroke="var(--chart-axis)" width={60} tick={{ fontSize: 10, style: { fill: 'var(--text-secondary)' } }} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: '4px' }} itemStyle={{ color: 'var(--chart-tooltip-text)' }} />
            <Bar dataKey="wildType" fill={accessibleColors.info} name="Wild Type" />
            <Bar dataKey="mutant" fill={accessibleColors.danger} name="Mutant" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const EnhancedResultsPanel = ({ result, wildTypeResult, fvaResult, isSimulating = false }) => {
  if (isSimulating) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full mb-3" />
        <p className="text-[var(--text-secondary)] text-sm">Running LP solver...</p>
      </div>
    );
  }

  if (!result) {
    return <p className="text-[var(--text-secondary)] text-center py-8">Run simulation to see results</p>;
  }

  // Handle no model case
  if (result.status === 'no_model' || result.phenotype === 'no_model') {
    return (
      <div className="p-4 bg-[var(--warning-bg)] border border-[var(--warning)] rounded-lg text-center">
        <p className="text-lg mb-2">📂</p>
        <p className="text-sm font-medium text-[var(--warning-text)]">No Model Loaded</p>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Load an SBML or JSON model in the Model tab to run FBA simulations.
        </p>
      </div>
    );
  }

  // Handle error case
  if (result.status === 'error') {
    return (
      <div className="p-4 bg-[var(--danger-bg)] border border-[var(--danger)] rounded-lg">
        <p className="text-sm font-medium text-[var(--danger-text)]">Solver Error</p>
        <p className="text-xs text-[var(--text-secondary)] mt-1">{result.error || 'Unknown error'}</p>
      </div>
    );
  }
  
  const colors = {
    respiration: 'success',
    overflow: 'warning',
    fermentation: 'warning',
    lethal: 'danger'
  };
  const c = colors[result.phenotype] || 'neutral';
  
  // Helper to get variable class name
  const getVarClass = (type, variant) => {
    if (type === 'neutral') return variant === 'bg' ? 'bg-[var(--card-bg)]' : variant === 'border' ? 'border-[var(--border-color)]' : 'text-[var(--text-secondary)]';
    return variant === 'bg' ? `bg-[var(--${type}-bg)]` : variant === 'border' ? `border-[var(--${type})]` : `text-[var(--${type}-text)]`;
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className={`p-4 rounded-lg border ${getVarClass(c, 'bg')} ${getVarClass(c, 'border')}`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{result.phenotype === 'respiration' ? '🌬️' : result.phenotype === 'overflow' ? '⚡' : result.phenotype === 'fermentation' ? '🔥' : '💀'}</span>
          <div>
            <p className={`font-medium capitalize ${getVarClass(c, 'text')}`}>{result.phenotype}</p>
            <p className="text-[var(--text-secondary)] text-xs">{result.status}</p>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div className={`p-3 rounded border ${getVarClass(c, 'bg')} ${getVarClass(c, 'border')}`}>
          <p className={`text-xs font-medium ${getVarClass(c, 'text')}`}>Growth Rate (μ)</p>
          <p className={`text-xl font-bold font-mono ${getVarClass(c, 'text')}`}>{result.growthRate.toFixed(4)}</p>
          <p className={`text-xs ${getVarClass(c, 'text')}`}>h⁻¹</p>
        </div>
        <div className="p-3 bg-[var(--info-bg)] border border-[var(--info)] rounded">
          <p className="text-[var(--info-text)] text-xs font-medium">Biomass Yield</p>
          <p className="text-xl font-bold text-[var(--info-text)] font-mono">{(result.yield * 100).toFixed(1)}%</p>
        </div>
        <div className="p-3 bg-[var(--warning-bg)] border border-[var(--warning)] rounded">
          <p className="text-[var(--warning-text)] text-xs font-medium">Acetate Production</p>
          <p className="text-xl font-bold text-[var(--warning-text)] font-mono">{result.acetate.toFixed(2)}</p>
        </div>
        <div className="p-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded">
          <p className="text-[var(--text-primary)] text-xs font-medium">CO₂ Production</p>
          <p className="text-xl font-bold text-[var(--text-primary)] font-mono">{result.co2.toFixed(2)}</p>
        </div>
      </div>
      
      {result.fluxReductionPercent && (
        <div className="p-3 bg-[var(--success-bg)] border border-[var(--success)] rounded">
          <p className="text-[var(--success-text)] text-sm font-medium">pFBA Flux Reduction: {result.fluxReductionPercent}%</p>
        </div>
      )}
      
      {result.metabolicAdjustment && (
        <div className="p-3 bg-[var(--warning-bg)] border border-[var(--warning)] rounded">
          <p className="text-[var(--warning-text)] text-sm font-medium">MOMA Metabolic Adjustment: {result.adjustmentPercent}%</p>
        </div>
      )}
      
      {fvaResult && fvaResult.flexibleReactions && (
        <div className="p-3 bg-[var(--info-bg)] border border-[var(--info)] rounded">
          <p className="text-[var(--info-text)] text-sm font-medium">Flexible Reactions: {fvaResult.flexibleReactions.length}</p>
        </div>
      )}
      
      {result.blocked.length > 0 && (
        <div className="p-3 bg-[var(--danger-bg)] border border-[var(--danger)] rounded">
          <p className="text-[var(--danger-text)] text-sm font-medium">Blocked Reactions: {result.blocked.join(', ')}</p>
        </div>
      )}
      
      <div className="pt-2">
        <p className="text-[var(--text-secondary)] text-xs font-medium mb-2">Key Fluxes (mmol/gDW/h)</p>
        <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin bg-[var(--card-bg)] border border-[var(--card-border)] rounded p-2">
          {Object.entries(result.fluxes).filter(([,v]) => Math.abs(v) > 0.1).sort((a,b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0,10).map(([id, flux]) => {
            const variability = fvaResult?.variability?.[id];
            return (
              <div className="flex justify-between text-sm py-1 border-b border-[var(--border-color)] last:border-0">
                <span className="font-mono text-[var(--primary)]">{id}</span>
                <div className="flex items-center gap-2">
                  {variability && (
                    <span className="text-[var(--info-text)] text-xs bg-[var(--info-bg)] px-1.5 rounded font-mono">[{variability.min.toFixed(1)}, {variability.max.toFixed(1)}]</span>
                  )}
                  <span className={`font-mono ${flux > 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{flux.toFixed(2)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {wildTypeResult && (
        <div className="pt-2 border-t border-[var(--border-color)]">
          <p className="text-[var(--text-secondary)] text-xs">Growth Change vs Wild-Type: {((result.growthRate - wildTypeResult.growthRate) / wildTypeResult.growthRate * 100).toFixed(1)}%</p>
        </div>
      )}
    </div>
  );
};

const SolverSelector = ({ method, onChange }) => {
  const options = [
    { id: 'standard', label: 'FBA', desc: 'Standard linear programming' },
    { id: 'pfba', label: 'pFBA', desc: 'Minimize total flux' },
    { id: 'moma', label: 'lMOMA', desc: 'Linear MOMA (knockout adaptation)' },
    { id: 'fva', label: 'FVA', desc: 'Flux variability' }
  ];

  return (
    <div className="space-y-2" role="radiogroup" aria-label="Simulation method selection">
      <h4 className="text-sm font-medium text-[var(--text-primary)]">Simulation Method</h4>
      <div className="grid grid-cols-2 gap-2">
        {options.map(opt => {
          const isSelected = method === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onChange(opt.id)}
              role="radio"
              aria-checked={isSelected}
              className={`p-3 rounded-lg text-left border transition-all focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 ${
                isSelected
                  ? 'bg-[var(--primary)] border-[var(--primary)]'
                  : 'bg-[var(--card-bg)] border-[var(--card-border)] hover:border-[var(--primary)] hover:bg-[var(--bg-primary)]'
              }`}
            >
              <p className={`text-xs font-medium ${isSelected ? 'text-white' : 'text-[var(--text-primary)]'}`}>
                {opt.label}
              </p>
              <p className={`text-xs ${isSelected ? 'text-white/80' : 'text-[var(--text-secondary)]'}`}>
                {opt.desc}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export { ProductionEnvelope, FluxComparison, EnhancedResultsPanel, SolverSelector };
