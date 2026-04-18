/**
 * UncertaintyAnalysisPanel - Interactive Uncertainty Visualization
 *
 * Provides UI for:
 * - Running uncertainty-aware FBA
 * - Visualizing confidence intervals
 * - Exploring high-uncertainty reactions
 * - Comparing conditions
 */

import React, { useState, useCallback } from 'react';
import { AlertCircle, CheckCircle, BarChart3, TrendingUp, Info } from 'lucide-react';
import { solveUncertaintyFBA, identifyHighUncertaintyReactions } from '../lib/UncertaintyFBA';

export default function UncertaintyAnalysisPanel({ model, constraints = {} }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  
  // Configuration
  const [numSamples, setNumSamples] = useState(100);
  const [boundUncertainty, setBoundUncertainty] = useState(0.1); // 10%
  const [confidenceLevel, setConfidenceLevel] = useState(0.95);
  
  // Run uncertainty FBA
  const runUncertaintyFBA = useCallback(async () => {
    if (!model) return;
    
    setRunning(true);
    setError(null);
    setResult(null);
    
    try {
      const uncertaintyResult = await solveUncertaintyFBA(model, {
        numSamples,
        boundUncertainty,
        confidenceLevel,
        constraints,
        onProgress: (progress) => {
          // Could add progress bar here
        },
      });
      
      setResult(uncertaintyResult);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }, [model, numSamples, boundUncertainty, confidenceLevel, constraints]);
  
  // Identify high-uncertainty reactions
  const highUncertaintyRxns = result
    ? identifyHighUncertaintyReactions(result, 0.5)
    : [];
  
  // Format interpretation
  const getInterpretation = () => {
    if (!result?.uncertainty?.objectiveValue) return null;
    
    const { pointEstimate, uncertainty } = result;
    const { ciLower, ciUpper, mean, std } = uncertainty.objectiveValue;
    const cv = std / Math.abs(mean);
    
    let interpretation = '';
    
    if (cv < 0.1) {
      interpretation = 'Low uncertainty: Predictions are robust to parameter variation';
    } else if (cv < 0.3) {
      interpretation = 'Moderate uncertainty: Some sensitivity to parameter choices';
    } else if (cv < 0.5) {
      interpretation = 'High uncertainty: Predictions strongly depend on parameter values';
    } else {
      interpretation = 'Very high uncertainty: Point estimate may be misleading';
    }
    
    return {
      cv,
      text: interpretation,
      ciWidth: ciUpper - ciLower,
      relativeCIWidth: (ciUpper - ciLower) / Math.abs(pointEstimate.objectiveValue) * 100,
    };
  };
  
  const interpretation = getInterpretation();
  
  return (
    <div className="space-y-4">
      <div className="section-header">
        <h3 className="section-title">Uncertainty-Aware FBA</h3>
        <p className="text-sm text-[var(--text-secondary)]">
          Quantify prediction uncertainty from parameter variation
        </p>
      </div>
      
      {/* Configuration */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-xs text-[var(--text-secondary)] font-medium">
            Bootstrap Samples
          </label>
          <select
            value={numSamples}
            onChange={(e) => setNumSamples(Number(e.target.value))}
            className="mt-1 w-full p-2 text-sm bg-[var(--input-bg)] border border-[var(--input-border)] rounded"
          >
            <option value={50}>50 (fast, approximate)</option>
            <option value={100}>100 (recommended)</option>
            <option value={500}>500 (accurate, slower)</option>
            <option value={1000}>1000 (publication-quality)</option>
          </select>
        </div>
        
        <div>
          <label className="text-xs text-[var(--text-secondary)] font-medium">
            Bound Uncertainty
          </label>
          <select
            value={boundUncertainty}
            onChange={(e) => setBoundUncertainty(Number(e.target.value))}
            className="mt-1 w-full p-2 text-sm bg-[var(--input-bg)] border border-[var(--input-border)] rounded"
          >
            <option value={0.05}>±5% (precise measurements)</option>
            <option value={0.1}>±10% (typical)</option>
            <option value={0.2}>±20% (uncertain)</option>
            <option value={0.5}>±50% (highly uncertain)</option>
          </select>
        </div>
        
        <div>
          <label className="text-xs text-[var(--text-secondary)] font-medium">
            Confidence Level
          </label>
          <select
            value={confidenceLevel}
            onChange={(e) => setConfidenceLevel(Number(e.target.value))}
            className="mt-1 w-full p-2 text-sm bg-[var(--input-bg)] border border-[var(--input-border)] rounded"
          >
            <option value={0.9}>90%</option>
            <option value={0.95}>95% (standard)</option>
            <option value={0.99}>99% (conservative)</option>
          </select>
        </div>
      </div>
      
      {/* Run Button */}
      <button
        onClick={runUncertaintyFBA}
        disabled={running || !model}
        className="w-full px-4 py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {running ? (
          <span className="flex items-center justify-center gap-2">
            <span className="animate-spin">⏳</span>
            Running {numSamples} bootstrap samples...
          </span>
        ) : (
          'Run Uncertainty FBA'
        )}
      </button>
      
      {/* Error */}
      {error && (
        <div className="p-4 bg-[var(--danger-bg)] border border-[var(--danger)] rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[var(--danger-text)] flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-[var(--danger-text)]">Analysis Failed</p>
              <p className="text-sm text-[var(--danger-text)] mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Results */}
      {result && interpretation && (
        <div className="space-y-6">
          {/* Summary */}
          <div className={`p-4 rounded-lg border ${
            interpretation.cv < 0.3
              ? 'bg-[var(--success-bg)] border-[var(--success)]'
              : interpretation.cv < 0.5
                ? 'bg-[var(--warning-bg)] border-[var(--warning)]'
                : 'bg-[var(--danger-bg)] border-[var(--danger)]'
          }`}>
            <div className="flex items-start gap-3">
              {interpretation.cv < 0.3 ? (
                <CheckCircle className="w-5 h-5 text-[var(--success-text)] flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-[var(--warning-text)] flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className={`font-medium ${
                  interpretation.cv < 0.3
                    ? 'text-[var(--success-text)]'
                    : interpretation.cv < 0.5
                      ? 'text-[var(--warning-text)]'
                      : 'text-[var(--danger-text)]'
                }`}>
                  {interpretation.text}
                </p>
                <div className="grid grid-cols-3 gap-4 mt-3 text-sm">
                  <div>
                    <p className="text-[var(--text-muted)]">Point Estimate</p>
                    <p className="font-mono font-medium">{result.pointEstimate.objectiveValue?.toFixed(4)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--text-muted)]">95% CI</p>
                    <p className="font-mono font-medium">
                      [{result.uncertainty.objectiveValue.ciLower?.toFixed(4)}, {result.uncertainty.objectiveValue.ciUpper?.toFixed(4)}]
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--text-muted)]">CV (σ/μ)</p>
                    <p className="font-mono font-medium">{interpretation.cv.toFixed(3)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Objective Distribution */}
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-4">
            <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">
              Objective Value Distribution
            </h4>
            <div className="h-48 flex items-end gap-1">
              {/* Histogram placeholder - would use Recharts in production */}
              <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm">
                Distribution histogram ({result.diagnostics.numSamples} samples)
              </div>
            </div>
            <div className="mt-3 flex justify-between text-xs text-[var(--text-muted)]">
              <span>Min: {result.uncertainty.objectiveValue.min?.toFixed(4)}</span>
              <span>Median: {result.uncertainty.objectiveValue.median?.toFixed(4)}</span>
              <span>Max: {result.uncertainty.objectiveValue.max?.toFixed(4)}</span>
            </div>
          </div>
          
          {/* High Uncertainty Reactions */}
          {highUncertaintyRxns.length > 0 && (
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-4">
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                High-Uncertainty Reactions (CV &gt; 0.5)
              </h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {highUncertaintyRxns.slice(0, 10).map((rxn, idx) => (
                  <div
                    key={rxn.reaction}
                    className="flex items-center justify-between p-2 bg-[var(--bg-primary)] rounded text-sm"
                  >
                    <div className="flex-1">
                      <p className="font-mono font-medium">{rxn.reaction}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        μ = {rxn.mean.toFixed(4)}, σ = {rxn.std.toFixed(4)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-medium ${
                        rxn.cv > 1.0
                          ? 'text-[var(--danger-text)]'
                          : rxn.cv > 0.5
                            ? 'text-[var(--warning-text)]'
                            : 'text-[var(--success-text)]'
                      }`}>
                        CV = {rxn.cv.toFixed(2)}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        [{rxn.ciLower?.toFixed(2)}, {rxn.ciUpper?.toFixed(2)}]
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {highUncertaintyRxns.length > 10 && (
                <p className="text-xs text-[var(--text-muted)] mt-2 text-center">
                  ...and {highUncertaintyRxns.length - 10} more reactions
                </p>
              )}
            </div>
          )}
          
          {/* Sensitivity Analysis */}
          {result.sensitivity?.parameterImportance?.length > 0 && (
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-4">
              <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Most Sensitive Reactions
              </h4>
              <p className="text-xs text-[var(--text-secondary)] mb-3">
                Reactions whose flux variation most correlates with objective variation
              </p>
              <div className="space-y-2">
                {result.sensitivity.parameterImportance.slice(0, 5).map((item, idx) => (
                  <div key={item.reaction} className="flex items-center gap-3">
                    <span className="text-xs text-[var(--text-muted)] w-4">{idx + 1}</span>
                    <span className="flex-1 font-mono text-sm">{item.reaction}</span>
                    <div className="w-32 bg-[var(--bg-primary)] rounded-full h-2">
                      <div
                        className="bg-[var(--primary)] h-2 rounded-full"
                        style={{ width: `${item.absoluteCorrelation * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono w-12 text-right">
                      r = {item.correlation.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Convergence Diagnostics */}
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-4">
            <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <Info className="w-4 h-4" />
              Convergence Diagnostics
            </h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-[var(--text-muted)]">Samples</p>
                <p className="font-mono font-medium">{result.diagnostics.numSamples}</p>
              </div>
              <div>
                <p className="text-[var(--text-muted)]">Converged</p>
                <p className={`font-medium ${
                  result.diagnostics.convergenceAchieved
                    ? 'text-[var(--success-text)]'
                    : 'text-[var(--warning-text)]'
                }`}>
                  {result.diagnostics.convergenceAchieved ? 'Yes' : 'No'}
                </p>
              </div>
              <div>
                <p className="text-[var(--text-muted)]">Method</p>
                <p className="font-mono font-medium">{result.metadata.samplingMethod}</p>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Help Text */}
      <div className="p-4 bg-[var(--info-bg)] border border-[var(--info)] rounded-lg">
        <h4 className="text-sm font-medium text-[var(--info-text)] mb-2">
          What does this tell me?
        </h4>
        <ul className="text-xs text-[var(--text-secondary)] space-y-1">
          <li>
            • <strong>Low CV (&lt;0.3)</strong>: Predictions are robust. The point estimate is reliable.
          </li>
          <li>
            • <strong>High CV (&gt;0.5)</strong>: Predictions are sensitive to parameter choices. 
              Interpret point estimates with caution.
          </li>
          <li>
            • <strong>Confidence intervals</strong>: Range containing 95% of bootstrap estimates. 
              Not the same as experimental confidence intervals.
          </li>
          <li>
            • <strong>High-uncertainty reactions</strong>: These reactions show large variation 
              across bootstrap samples. They may be key control points or poorly constrained.
          </li>
        </ul>
      </div>
    </div>
  );
}
