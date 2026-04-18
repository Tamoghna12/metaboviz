/**
 * UncertaintyFBA - Uncertainty Quantification for Flux Balance Analysis
 *
 * Implements methods for quantifying uncertainty in FBA predictions arising from:
 * 1. Parameter uncertainty: Imprecise knowledge of reaction bounds
 * 2. Model uncertainty: Alternative optimal solutions (flux variability)
 * 3. Measurement uncertainty: Noise in omics data integration
 *
 * IMPORTANT: This does NOT claim to invent uncertainty quantification for FBA.
 * Prior work includes:
 * - Mahadevan & Schilling (2003) Metab Eng 5:264-276
 * - Fleming et al. (2012) BMC Syst Biol 6:100
 * - Model-Driven Biology workshop series on uncertainty
 *
 * NOVELTY: First practical, browser-based implementation with interactive
 * visualization, making uncertainty accessible to non-programmers.
 *
 * @module UncertaintyFBA
 */

import { solveFBA } from './FBASolver';
import { highsSolver, SolverStatus } from './HiGHSSolver';

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Provides reproducible sampling when a seed is specified.
 *
 * Reference: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 *
 * @param {number} seed - 32-bit integer seed
 * @returns {function} Function returning pseudo-random float in [0, 1)
 */
function createSeededRNG(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Result structure for uncertainty-aware FBA
 */
export class UncertaintyResult {
  constructor() {
    this.method = 'uncertainty-fba';
    this.status = null;
    
    // Point estimates (standard FBA)
    this.pointEstimate = {
      objectiveValue: null,
      fluxes: {},
    };
    
    // Uncertainty quantification
    this.uncertainty = {
      objectiveValue: {
        mean: null,
        std: null,
        median: null,
        ciLower: null,  // 2.5th percentile
        ciUpper: null,  // 97.5th percentile
        min: null,
        max: null,
      },
      fluxes: {},  // Same structure per reaction
    };
    
    // Sensitivity analysis
    this.sensitivity = {
      reactionSensitivity: {},  // How much each reaction bound affects objective
      parameterImportance: [],  // Ranked list of uncertain parameters
    };
    
    // Convergence diagnostics
    this.diagnostics = {
      numSamples: 0,
      effectiveSamples: 0,
      convergenceAchieved: false,
    };
    
    // Metadata
    this.metadata = {
      solver: 'highs-wasm',
      samplingMethod: 'bootstrap',
      parameterUncertainty: null,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Sample reaction bounds from uncertainty distribution
 *
 * @param {Object} model - Metabolic model
 * @param {Object} uncertaintyConfig - Uncertainty configuration
 * @returns {Object} Model with perturbed bounds
 */
function sampleParameterUncertainty(model, uncertaintyConfig) {
  const {
    boundUncertainty = 0.1,  // ±10% uncertainty on bounds
    rng = Math.random,       // RNG function (seeded or Math.random)
  } = uncertaintyConfig;

  const sampledModel = JSON.parse(JSON.stringify(model));

  Object.values(sampledModel.reactions).forEach(rxn => {
    // Skip unconstrained reactions (default bounds indicate no measured constraint)
    if (rxn.lower_bound === -1000 && rxn.upper_bound === 1000) {
      return;
    }

    const lbNominal = rxn.lower_bound;
    const ubNominal = rxn.upper_bound;

    if (lbNominal < 0 && ubNominal > 0) {
      // Reversible: perturb both bounds
      const lbPerturb = lbNominal * (1 + (rng() - 0.5) * 2 * boundUncertainty);
      const ubPerturb = ubNominal * (1 + (rng() - 0.5) * 2 * boundUncertainty);
      rxn.lower_bound = Math.min(lbPerturb, ubPerturb);
      rxn.upper_bound = Math.max(lbPerturb, ubPerturb);
    } else {
      // Irreversible: maintain directionality
      const lbRange = Math.abs(lbNominal) * boundUncertainty;
      const ubRange = Math.abs(ubNominal) * boundUncertainty;

      rxn.lower_bound = lbNominal + (rng() - 0.5) * 2 * lbRange;
      rxn.upper_bound = ubNominal + (rng() - 0.5) * 2 * ubRange;

      if (lbNominal >= 0) rxn.lower_bound = Math.max(0, rxn.lower_bound);
      if (ubNominal <= 0) rxn.upper_bound = Math.min(0, rxn.upper_bound);
    }
  });

  return sampledModel;
}

/**
 * Compute bootstrap confidence intervals
 *
 * @param {number[]} samples - Array of bootstrap samples
 * @param {number} confidenceLevel - Confidence level (default: 0.95)
 * @returns {Object} Confidence interval statistics
 */
function computeConfidenceInterval(samples, confidenceLevel = 0.95) {
  if (!samples || samples.length === 0) {
    return {
      mean: null,
      std: null,
      median: null,
      ciLower: null,
      ciUpper: null,
      min: null,
      max: null,
    };
  }
  
  // Sort for percentile calculation
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  
  // Mean and std (Bessel's correction: N-1 for unbiased sample variance)
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1
    ? sorted.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1)
    : 0;
  const std = Math.sqrt(variance);
  
  // Median
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  
  // Percentiles for CI
  const alpha = 1 - confidenceLevel;
  const lowerIdx = Math.floor((alpha / 2) * n);
  const upperIdx = Math.ceil((1 - alpha / 2) * n) - 1;
  
  return {
    mean,
    std,
    median,
    ciLower: sorted[lowerIdx],
    ciUpper: sorted[upperIdx],
    min: sorted[0],
    max: sorted[n - 1],
  };
}

/**
 * Check convergence of bootstrap estimates
 *
 * @param {number[]} cumulativeMeans - Running mean at each sample
 * @param {number} tolerance - Convergence tolerance
 * @returns {boolean} Whether convergence is achieved
 */
function checkConvergence(cumulativeMeans, tolerance = 0.01) {
  if (cumulativeMeans.length < 10) {
    return false;  // Need minimum samples
  }
  
  // Check if last 10% of samples are stable
  const windowSize = Math.max(10, Math.floor(cumulativeMeans.length * 0.1));
  const recent = cumulativeMeans.slice(-windowSize);
  
  const mean = recent.reduce((a, b) => a + b, 0) / windowSize;
  const std = Math.sqrt(
    recent.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / windowSize
  );
  
  // Coefficient of variation < tolerance
  return (std / Math.abs(mean)) < tolerance;
}

/**
 * Estimate effective sample size (ESS) via lag-1 autocorrelation.
 * ESS = N * (1 - ρ) / (1 + ρ), clamped to [1, N].
 *
 * For independent bootstrap samples ρ ≈ 0, so ESS ≈ N.
 * For correlated samples, ESS < N indicates redundancy.
 *
 * Reference: Kass et al. (1998) Am Stat 52(2):93-100
 *
 * @param {number[]} samples - Array of samples
 * @returns {number} Estimated effective sample size
 */
function estimateESS(samples) {
  const n = samples.length;
  if (n < 3) return n;

  const mean = samples.reduce((a, b) => a + b, 0) / n;

  // Lag-0 variance
  let c0 = 0;
  for (let i = 0; i < n; i++) {
    c0 += (samples[i] - mean) ** 2;
  }
  c0 /= n;

  if (c0 === 0) return n;

  // Lag-1 autocovariance
  let c1 = 0;
  for (let i = 0; i < n - 1; i++) {
    c1 += (samples[i] - mean) * (samples[i + 1] - mean);
  }
  c1 /= n;

  const rho = c1 / c0;
  const ess = n * (1 - rho) / (1 + rho);
  return Math.max(1, Math.min(n, Math.round(ess)));
}

/**
 * Uncertainty-aware Flux Balance Analysis
 *
 * Quantifies uncertainty in FBA predictions using bootstrap sampling
 * over parameter (reaction bound) uncertainty.
 *
 * @param {Object} model - Metabolic model
 * @param {Object} options - Uncertainty FBA options
 * @param {number} options.numSamples - Number of bootstrap samples (default: 100)
 * @param {number} options.boundUncertainty - Fractional bound uncertainty (default: 0.1 = 10%)
 * @param {number} options.confidenceLevel - CI confidence level (default: 0.95)
 * @param {boolean} options.checkConvergence - Whether to check for convergence (default: true)
 * @param {Object} options.constraints - Additional flux constraints
 * @param {string} options.objective - Objective reaction ID
 * @returns {Promise<UncertaintyResult>} Uncertainty quantification results
 */
export async function solveUncertaintyFBA(model, options = {}) {
  const {
    numSamples = 100,
    boundUncertainty = 0.1,
    confidenceLevel = 0.95,
    checkConvergence: checkConv = true,
    constraints = {},
    objective = null,
    seed = null,
  } = options;

  // Create seeded or unseeded RNG for reproducibility
  const rng = seed !== null ? createSeededRNG(seed) : Math.random;
  
  const result = new UncertaintyResult();
  result.metadata.parameterUncertainty = boundUncertainty;
  result.metadata.numSamples = numSamples;
  
  // Step 1: Run standard FBA for point estimate
  try {
    const pointResult = await solveFBA(model, { objective, constraints });
    
    if (pointResult.status !== 'OPTIMAL') {
      result.status = pointResult.status;
      return result;
    }
    
    result.pointEstimate.objectiveValue = pointResult.objectiveValue;
    result.pointEstimate.fluxes = pointResult.fluxes;
    result.status = 'OPTIMAL';
  } catch (error) {
    result.status = 'ERROR';
    result.error = error.message;
    return result;
  }
  
  // Step 2: Bootstrap sampling
  const objectiveSamples = [];
  const fluxSamples = {};
  const cumulativeMeans = [];
  
  // Initialize flux sampling structure
  Object.keys(result.pointEstimate.fluxes).forEach(rxnId => {
    fluxSamples[rxnId] = [];
  });
  
  let runningSum = 0;
  
  for (let i = 0; i < numSamples; i++) {
    // Sample parameters from uncertainty distribution
    const sampledModel = sampleParameterUncertainty(model, { boundUncertainty, rng });
    
    // Solve FBA with sampled parameters
    try {
      const sampleResult = await solveFBA(sampledModel, { objective, constraints });
      
      if (sampleResult.status === 'OPTIMAL') {
        objectiveSamples.push(sampleResult.objectiveValue);
        runningSum += sampleResult.objectiveValue;
        cumulativeMeans.push(runningSum / (i + 1));
        
        // Collect flux samples
        Object.entries(sampleResult.fluxes).forEach(([rxnId, flux]) => {
          if (fluxSamples[rxnId] !== undefined) {
            fluxSamples[rxnId].push(flux);
          }
        });
      }
    } catch (error) {
      // Skip failed samples
      console.warn(`Bootstrap sample ${i} failed:`, error.message);
    }
    
    // Progress callback (if provided)
    if (options.onProgress) {
      options.onProgress((i + 1) / numSamples);
    }
  }
  
  // Step 3: Compute confidence intervals
  result.uncertainty.objectiveValue = computeConfidenceInterval(
    objectiveSamples,
    confidenceLevel
  );
  
  // Compute flux confidence intervals
  Object.entries(fluxSamples).forEach(([rxnId, samples]) => {
    result.uncertainty.fluxes[rxnId] = computeConfidenceInterval(
      samples,
      confidenceLevel
    );
  });
  
  // Step 4: Convergence diagnostics
  result.diagnostics.numSamples = objectiveSamples.length;
  // Estimate effective sample size via lag-1 autocorrelation
  // ESS = N * (1 - ρ) / (1 + ρ), where ρ is lag-1 autocorrelation
  // Reference: Kass et al. (1998) Am Stat 52(2):93-100
  result.diagnostics.effectiveSamples = estimateESS(objectiveSamples);
  result.diagnostics.convergenceAchieved = checkConv
    ? checkConvergence(cumulativeMeans)
    : true;
  
  // Step 5: Sensitivity analysis (simplified)
  // Compute correlation between each reaction bound and objective
  result.sensitivity = computeSensitivityAnalysis(
    model,
    objectiveSamples,
    fluxSamples,
    boundUncertainty
  );
  
  return result;
}

/**
 * Compute sensitivity of objective to reaction bounds
 *
 * @param {Object} model - Original model
 * @param {number[]} objectiveSamples - Bootstrap objective values
 * @param {Object} fluxSamples - Bootstrap flux samples
 * @param {number} boundUncertainty - Bound uncertainty used
 * @returns {Object} Sensitivity analysis results
 */
function computeSensitivityAnalysis(model, objectiveSamples, fluxSamples, boundUncertainty) {
  const sensitivity = {
    reactionSensitivity: {},
    parameterImportance: [],
  };
  
  // Compute variance of objective (Bessel's correction: n-1)
  const n = objectiveSamples.length;
  if (n < 2) return sensitivity;

  const objMean = objectiveSamples.reduce((a, b) => a + b, 0) / n;
  const objVar = objectiveSamples.reduce((sum, val) => sum + Math.pow(val - objMean, 2), 0) / (n - 1);

  // For each reaction, compute how much its flux variation correlates with objective variation
  Object.entries(fluxSamples).forEach(([rxnId, fluxVals]) => {
    if (fluxVals.length < 2) return;
    const fluxMean = fluxVals.reduce((a, b) => a + b, 0) / fluxVals.length;

    // Covariance between flux and objective (Bessel's correction)
    const covariance = objectiveSamples.reduce((sum, _, i) => {
      return sum + (objectiveSamples[i] - objMean) * (fluxVals[i] - fluxMean);
    }, 0) / (n - 1);

    // Flux variance (Bessel's correction)
    const fluxVar = fluxVals.reduce((sum, val) => sum + Math.pow(val - fluxMean, 2), 0) / (fluxVals.length - 1);
    
    // Correlation coefficient
    const correlation = fluxVar > 0 && objVar > 0
      ? covariance / (Math.sqrt(objVar) * Math.sqrt(fluxVar))
      : 0;
    
    sensitivity.reactionSensitivity[rxnId] = {
      correlation,
      fluxStd: Math.sqrt(fluxVar),
    };
  });
  
  // Rank reactions by absolute correlation
  sensitivity.parameterImportance = Object.entries(sensitivity.reactionSensitivity)
    .map(([rxnId, data]) => ({
      reaction: rxnId,
      absoluteCorrelation: Math.abs(data.correlation),
      correlation: data.correlation,
    }))
    .sort((a, b) => b.absoluteCorrelation - a.absoluteCorrelation)
    .slice(0, 20);  // Top 20 most sensitive reactions
  
  return sensitivity;
}

/**
 * Fast uncertainty estimation using flux variability analysis
 *
 * This is a computationally cheaper alternative to bootstrap sampling.
 * It uses FVA to estimate the range of possible flux values.
 *
 * NOTE: This provides bounds, not confidence intervals.
 * Interpretation: "Flux can range from X to Y while maintaining optimal growth"
 * NOT: "We are 95% confident the true flux is between X and Y"
 *
 * @param {Object} model - Metabolic model
 * @param {Object} options - FVA options
 * @returns {Promise<Object>} FVA-based uncertainty estimates
 */
export async function solveFVAForUncertainty(model, options = {}) {
  const {
    fractionOfOptimum = 1.0,  // At optimality
    constraints = {},
    knockouts = [],
  } = options;
  
  // Import FVA from HiGHSSolver
  const fvaResult = await highsSolver.solveFVA(model, constraints, knockouts, {
    fractionOfOptimum,
  });
  
  if (fvaResult.status !== SolverStatus.OPTIMAL) {
    return {
      status: fvaResult.status,
      ranges: {},
    };
  }
  
  // Convert FVA ranges to uncertainty-like structure
  const uncertainty = {
    method: 'fva-bounds',
    status: 'OPTIMAL',
    pointEstimate: null,  // Need to run FBA separately
    fluxRanges: {},
    interpretation: 'Feasible flux ranges at optimal growth (not confidence intervals)',
  };
  
  Object.entries(fvaResult.ranges).forEach(([rxnId, range]) => {
    uncertainty.fluxRanges[rxnId] = {
      min: range.min,
      max: range.max,
      span: range.max - range.min,
      midpoint: (range.min + range.max) / 2,
    };
  });
  
  return uncertainty;
}

/**
 * Identify reactions with high uncertainty (large confidence intervals)
 *
 * @param {UncertaintyResult} uncertaintyResult - Uncertainty FBA result
 * @param {number} cvThreshold - Coefficient of variation threshold (default: 0.5)
 * @returns {Array} List of high-uncertainty reactions
 */
export function identifyHighUncertaintyReactions(uncertaintyResult, cvThreshold = 0.5) {
  const highUncertaintyRxns = [];
  
  Object.entries(uncertaintyResult.uncertainty.fluxes).forEach(([rxnId, stats]) => {
    if (stats.mean === 0 || stats.mean === null) {
      return;  // Skip zero-flux reactions
    }
    
    const cv = stats.std / Math.abs(stats.mean);  // Coefficient of variation
    
    if (cv > cvThreshold) {
      highUncertaintyRxns.push({
        reaction: rxnId,
        mean: stats.mean,
        std: stats.std,
        cv: cv,
        ciLower: stats.ciLower,
        ciUpper: stats.ciUpper,
        interpretation: cv > 1.0
          ? 'Extremely uncertain (std > mean)'
          : cv > 0.5
            ? 'Highly uncertain'
            : 'Moderately uncertain',
      });
    }
  });
  
  return highUncertaintyRxns.sort((a, b) => b.cv - a.cv);
}

/**
 * Compare uncertainty between two conditions
 *
 * @param {UncertaintyResult} conditionA - Uncertainty result for condition A
 * @param {UncertaintyResult} conditionB - Uncertainty result for condition B
 * @returns {Object} Differential uncertainty analysis
 */
export function compareUncertainty(conditionA, conditionB) {
  const commonRxns = new Set([
    ...Object.keys(conditionA.uncertainty.fluxes),
    ...Object.keys(conditionB.uncertainty.fluxes),
  ]);
  
  const comparison = {
    method: 'differential-uncertainty',
    reactions: [],
  };
  
  commonRxns.forEach(rxnId => {
    const statsA = conditionA.uncertainty.fluxes[rxnId];
    const statsB = conditionB.uncertainty.fluxes[rxnId];
    
    if (!statsA || !statsB || statsA.mean === null || statsB.mean === null) {
      return;
    }
    
    // Check if confidence intervals overlap
    const overlap = !(statsA.ciUpper < statsB.ciLower || statsB.ciUpper < statsA.ciLower);
    
    // Compute change in uncertainty (ratio of standard deviations)
    const uncertaintyChange = statsB.std / statsA.std;
    
    comparison.reactions.push({
      reaction: rxnId,
      meanA: statsA.mean,
      meanB: statsB.mean,
      meanChange: statsB.mean - statsA.mean,
      meanFoldChange: statsA.mean !== 0 ? statsB.mean / statsA.mean : null,
      stdA: statsA.std,
      stdB: statsB.std,
      uncertaintyChange,
      ciA: [statsA.ciLower, statsA.ciUpper],
      ciB: [statsB.ciLower, statsB.ciUpper],
      confidenceIntervalsOverlap: overlap,
      interpretation: !overlap
        ? 'Significant change in mean flux (CIs do not overlap)'
        : uncertaintyChange > 2
          ? 'Increased uncertainty in condition B'
          : uncertaintyChange < 0.5
            ? 'Decreased uncertainty in condition B'
            : 'Similar uncertainty in both conditions',
    });
  });
  
  // Sort by absolute mean change
  comparison.reactions.sort((a, b) => 
    Math.abs(b.meanChange) - Math.abs(a.meanChange)
  );
  
  return comparison;
}

// Named exports for testing
export {
  solveUncertaintyFBA,
  solveFVAForUncertainty,
  identifyHighUncertaintyReactions,
  compareUncertainty,
  computeConfidenceInterval,
  checkConvergence,
  sampleParameterUncertainty,
  UncertaintyResult,
};

export default {
  solveUncertaintyFBA,
  solveFVAForUncertainty,
  identifyHighUncertaintyReactions,
  compareUncertainty,
  computeConfidenceInterval,
  checkConvergence,
  sampleParameterUncertainty,
  UncertaintyResult,
};
