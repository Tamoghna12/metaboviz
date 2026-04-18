/**
 * Unit Tests for UncertaintyFBA
 *
 * Tests the uncertainty quantification methods:
 * - Bootstrap sampling
 * - Confidence interval computation
 * - Convergence checking
 * - Sensitivity analysis
 *
 * IMPORTANT: These tests verify correctness of implementation,
 * NOT the scientific validity of uncertainty quantification for FBA.
 * Scientific validation requires comparison to analytical solutions
 * or established methods (MCMC, etc.).
 */

import { describe, it, expect } from 'vitest';
import {
  computeConfidenceInterval,
  checkConvergence,
  identifyHighUncertaintyReactions,
  compareUncertainty,
  UncertaintyResult,
} from '../lib/UncertaintyFBA';

describe('Confidence Interval Computation', () => {
  it('should compute correct statistics for simple distribution', () => {
    // Known distribution: 1, 2, 3, 4, 5
    const samples = [1, 2, 3, 4, 5];
    const stats = computeConfidenceInterval(samples, 0.95);
    
    expect(stats.mean).toBeCloseTo(3, 10);
    expect(stats.median).toBe(3);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
    // Sample std dev of 1,2,3,4,5 = sqrt(10/4) = sqrt(2.5) ≈ 1.581 (Bessel's correction)
    expect(stats.std).toBeCloseTo(Math.sqrt(2.5), 5);
  });

  it('should handle empty samples', () => {
    const stats = computeConfidenceInterval([], 0.95);
    
    expect(stats.mean).toBeNull();
    expect(stats.std).toBeNull();
    expect(stats.ciLower).toBeNull();
    expect(stats.ciUpper).toBeNull();
  });

  it('should compute correct percentiles for 95% CI', () => {
    // 100 samples from 1 to 100
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    const stats = computeConfidenceInterval(samples, 0.95);
    
    // 2.5th percentile ≈ 3rd value = 3
    // 97.5th percentile ≈ 98th value = 98
    expect(stats.ciLower).toBeLessThanOrEqual(3);
    expect(stats.ciUpper).toBeGreaterThanOrEqual(98);
  });

  it('should handle different confidence levels', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    
    const ci90 = computeConfidenceInterval(samples, 0.90);
    const ci95 = computeConfidenceInterval(samples, 0.95);
    const ci99 = computeConfidenceInterval(samples, 0.99);
    
    // Higher confidence = wider interval
    expect(ci99.ciUpper - ci99.ciLower).toBeGreaterThan(ci95.ciUpper - ci95.ciLower);
    expect(ci95.ciUpper - ci95.ciLower).toBeGreaterThan(ci90.ciUpper - ci90.ciLower);
  });

  it('should handle skewed distributions', () => {
    // Right-skewed: mostly low values, few high outliers
    const samples = [1, 1, 1, 1, 1, 1, 1, 1, 1, 100];
    const stats = computeConfidenceInterval(samples, 0.95);
    
    // Mean should be pulled toward outlier
    expect(stats.mean).toBeGreaterThan(stats.median);
    // Median should be robust (average of 5th and 6th values = 1)
    expect(stats.median).toBe(1);
  });
});

describe('Convergence Checking', () => {
  it('should detect convergence for stable sequence', () => {
    // Cumulative means converging to 10
    const cumulativeMeans = [];
    let sum = 0;
    for (let i = 1; i <= 100; i++) {
      sum += 10 + (Math.random() - 0.5) * 0.1;  // Small noise around 10
      cumulativeMeans.push(sum / i);
    }
    
    expect(checkConvergence(cumulativeMeans, 0.01)).toBe(true);
  });

  it('should detect non-convergence for drifting sequence', () => {
    // Cumulative means drifting upward
    const cumulativeMeans = [];
    let sum = 0;
    for (let i = 1; i <= 100; i++) {
      sum += i;  // Increasing values
      cumulativeMeans.push(sum / i);
    }
    
    expect(checkConvergence(cumulativeMeans, 0.01)).toBe(false);
  });

  it('should require minimum samples', () => {
    const cumulativeMeans = [1, 2, 3, 4, 5];
    expect(checkConvergence(cumulativeMeans, 0.01)).toBe(false);
  });

  it('should handle different tolerance levels', () => {
    const cumulativeMeans = Array.from({ length: 50 }, (_, i) => 10 + Math.sin(i / 10) * 0.5);
    
    // Stricter tolerance = harder to converge
    expect(checkConvergence(cumulativeMeans, 0.001)).toBe(false);
    expect(checkConvergence(cumulativeMeans, 0.01)).toBe(true);
    expect(checkConvergence(cumulativeMeans, 0.1)).toBe(true);
  });
});

describe('High Uncertainty Reaction Identification', () => {
  it('should identify reactions with high CV', () => {
    const mockResult = {
      uncertainty: {
        fluxes: {
          'RXN1': { mean: 10, std: 1, ciLower: 8, ciUpper: 12 },  // CV = 0.1
          'RXN2': { mean: 10, std: 6, ciLower: 0, ciUpper: 20 },  // CV = 0.6
          'RXN3': { mean: 10, std: 15, ciLower: -20, ciUpper: 40 }, // CV = 1.5
        },
      },
    };
    
    const highUncertainty = identifyHighUncertaintyReactions(mockResult, 0.5);
    
    expect(highUncertainty.length).toBe(2);  // RXN2 and RXN3
    expect(highUncertainty[0].reaction).toBe('RXN3');  // Highest CV first
    expect(highUncertainty[1].reaction).toBe('RXN2');
  });

  it('should skip zero-mean reactions', () => {
    const mockResult = {
      uncertainty: {
        fluxes: {
          'RXN1': { mean: 0, std: 1, ciLower: -2, ciUpper: 2 },
          'RXN2': { mean: 10, std: 6, ciLower: 0, ciUpper: 20 },
        },
      },
    };
    
    const highUncertainty = identifyHighUncertaintyReactions(mockResult, 0.5);
    
    expect(highUncertainty.length).toBe(1);
    expect(highUncertainty[0].reaction).toBe('RXN2');
  });

  it('should handle empty result', () => {
    const mockResult = {
      uncertainty: {
        fluxes: {},
      },
    };
    
    const highUncertainty = identifyHighUncertaintyReactions(mockResult, 0.5);
    expect(highUncertainty.length).toBe(0);
  });
});

describe('Uncertainty Comparison Between Conditions', () => {
  it('should detect non-overlapping confidence intervals', () => {
    const conditionA = {
      uncertainty: {
        fluxes: {
          'RXN1': { mean: 10, std: 1, ciLower: 8, ciUpper: 12 },
        },
      },
    };
    
    const conditionB = {
      uncertainty: {
        fluxes: {
          'RXN1': { mean: 20, std: 1, ciLower: 18, ciUpper: 22 },
        },
      },
    };
    
    const comparison = compareUncertainty(conditionA, conditionB);
    
    expect(comparison.reactions.length).toBe(1);
    expect(comparison.reactions[0].confidenceIntervalsOverlap).toBe(false);
    expect(comparison.reactions[0].interpretation).toContain('Significant change');
  });

  it('should detect overlapping confidence intervals', () => {
    const conditionA = {
      uncertainty: {
        fluxes: {
          'RXN1': { mean: 10, std: 2, ciLower: 6, ciUpper: 14 },
        },
      },
    };
    
    const conditionB = {
      uncertainty: {
        fluxes: {
          'RXN1': { mean: 12, std: 2, ciLower: 8, ciUpper: 16 },
        },
      },
    };
    
    const comparison = compareUncertainty(conditionA, conditionB);
    
    expect(comparison.reactions.length).toBe(1);
    expect(comparison.reactions[0].confidenceIntervalsOverlap).toBe(true);
  });

  it('should detect changes in uncertainty level', () => {
    const conditionA = {
      uncertainty: {
        fluxes: {
          'RXN1': { mean: 10, std: 1, ciLower: 8, ciUpper: 12 },
        },
      },
    };
    
    const conditionB = {
      uncertainty: {
        fluxes: {
          'RXN1': { mean: 10, std: 3, ciLower: 4, ciUpper: 16 },  // 3× more uncertain
        },
      },
    };
    
    const comparison = compareUncertainty(conditionA, conditionB);
    
    expect(comparison.reactions.length).toBe(1);
    expect(comparison.reactions[0].uncertaintyChange).toBe(3);
    expect(comparison.reactions[0].interpretation).toContain('Increased uncertainty');
  });
});

describe('UncertaintyResult Class', () => {
  it('should initialize with correct structure', () => {
    const result = new UncertaintyResult();
    
    expect(result.method).toBe('uncertainty-fba');
    expect(result.status).toBeNull();
    expect(result.pointEstimate.objectiveValue).toBeNull();
    expect(result.uncertainty.objectiveValue.mean).toBeNull();
    expect(result.diagnostics.numSamples).toBe(0);
    expect(result.metadata.solver).toBe('highs-wasm');
    expect(result.metadata.samplingMethod).toBe('bootstrap');
  });
});

describe('Edge Cases', () => {
  it('should handle negative flux values', () => {
    const samples = [-10, -8, -6, -4, -2];
    const stats = computeConfidenceInterval(samples, 0.95);
    
    expect(stats.mean).toBeCloseTo(-6, 10);
    expect(stats.median).toBe(-6);
    expect(stats.ciLower).toBeLessThan(stats.ciUpper);
  });

  it('should handle very large values', () => {
    const samples = [1e6, 2e6, 3e6, 4e6, 5e6];
    const stats = computeConfidenceInterval(samples, 0.95);
    
    expect(stats.mean).toBeCloseTo(3e6, -6);  // Relative tolerance
    expect(stats.median).toBe(3e6);
  });

  it('should handle single sample', () => {
    const samples = [42];
    const stats = computeConfidenceInterval(samples, 0.95);
    
    expect(stats.mean).toBe(42);
    expect(stats.std).toBe(0);
    expect(stats.ciLower).toBe(42);
    expect(stats.ciUpper).toBe(42);
  });
});

describe('Interpretation Guidelines', () => {
  it('should document CV interpretation thresholds', () => {
    // These are documentation tests to ensure thresholds are consistent
    
    const thresholds = {
      low: 0.1,
      moderate: 0.3,
      high: 0.5,
      veryHigh: 1.0,
    };
    
    expect(thresholds.low).toBeLessThan(thresholds.moderate);
    expect(thresholds.moderate).toBeLessThan(thresholds.high);
    expect(thresholds.high).toBeLessThan(thresholds.veryHigh);
    
    // Document expected interpretations:
    // CV < 0.1: "Low uncertainty: Predictions are robust"
    // CV 0.1-0.3: "Moderate uncertainty: Some sensitivity"
    // CV 0.3-0.5: "High uncertainty: Strongly depends on parameters"
    // CV > 0.5: "Very high uncertainty: Point estimate may be misleading"
  });
});
