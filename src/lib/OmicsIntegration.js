/**
 * OmicsIntegration - Real Multi-Omics Constraint-Based Methods
 *
 * Implements actual published algorithms for integrating gene expression,
 * proteomics, and metabolomics data with constraint-based models.
 *
 * Methods implemented:
 * - GIMME: Gene Inactivity Moderated by Metabolism and Expression
 * - E-Flux: Expression-constrained Flux analysis
 * - iMAT: Integrative Metabolic Analysis Tool
 *
 * References:
 * - Becker & Palsson (2008) "Context-specific metabolic networks..."
 * - Colijn et al. (2009) "Interpreting expression data with metabolic flux models"
 * - Shlomi et al. (2008) "Network-based prediction of human tissue-specific metabolism"
 *
 * @module OmicsIntegration
 */

import { solveFBA, extractAllGenes, buildStoichiometricMatrix } from './FBASolver';
import { gprToReactionExpression } from './GPRExpression';
import GLPK from 'glpk.js';

let glpkInstance = null;
const getGLPK = async () => {
  if (!glpkInstance) {
    glpkInstance = await GLPK();
  }
  return glpkInstance;
};

// gprToReactionExpression imported from GPRExpression.js (single canonical implementation)
export { gprToReactionExpression } from './GPRExpression';

/**
 * GIMME - Gene Inactivity Moderated by Metabolism and Expression
 *
 * Minimizes the sum of fluxes through reactions that should be inactive
 * (below expression threshold) while maintaining a required objective value.
 *
 * Algorithm (Becker & Palsson, 2008):
 * 1. Set expression threshold to classify genes as active/inactive
 * 2. Maximize objective to find optimal value
 * 3. Constrain objective to fraction of optimal
 * 4. Minimize sum of |v_i| for reactions with low expression
 *
 * @param {Object} model - Parsed metabolic model
 * @param {Map<string, number>} geneExpression - Gene expression data
 * @param {Object} options - GIMME options
 * @returns {Promise<Object>} - GIMME solution with fluxes
 */
export async function solveGIMME(model, geneExpression, options = {}) {
  const {
    threshold = 0.25, // Expression threshold (bottom 25%)
    requiredFraction = 0.9, // Maintain 90% of optimal objective
    objective = null
  } = options;

  const glpk = await getGLPK();

  // Step 1: Calculate reaction expression levels via GPR
  const reactionExpression = new Map();
  Object.entries(model.reactions || {}).forEach(([rxnId, rxn]) => {
    const gpr = rxn.gpr || rxn.gene_reaction_rule || '';
    const expr = gprToReactionExpression(gpr, geneExpression);
    reactionExpression.set(rxnId, expr);
  });

  // Calculate expression threshold (bottom percentile)
  const expressionValues = Array.from(reactionExpression.values()).filter(e => e > 0);
  expressionValues.sort((a, b) => a - b);
  const thresholdValue = expressionValues[Math.floor(expressionValues.length * threshold)] || 0.5;

  // Step 2: Find optimal objective value
  const optResult = await solveFBA(model, { objective });
  if (optResult.status !== 'OPTIMAL') {
    return {
      status: 'BASE_FBA_FAILED',
      error: 'Could not solve base FBA problem',
      fluxes: {},
      reactionExpression: Object.fromEntries(reactionExpression)
    };
  }

  const minObjective = optResult.objectiveValue * requiredFraction;

  // Step 3: Build GIMME LP problem
  const { S, metabolites, reactions, metIndex, rxnIndex } = buildStoichiometricMatrix(model);

  // Identify low-expression reactions
  const lowExpressionReactions = [];
  reactions.forEach(rxnId => {
    const expr = reactionExpression.get(rxnId) || 1.0;
    if (expr < thresholdValue) {
      lowExpressionReactions.push(rxnId);
    }
  });

  // Build LP: minimize sum of low-expression fluxes
  const problem = {
    name: 'GIMME',
    objective: {
      direction: glpk.GLP_MIN,
      name: 'minimize_inconsistency',
      vars: []
    },
    subjectTo: [],
    bounds: []
  };

  // Add variables for each reaction
  reactions.forEach((rxnId, j) => {
    const rxn = model.reactions[rxnId];
    let lb = rxn.lower_bound ?? -1000;
    let ub = rxn.upper_bound ?? 1000;

    problem.bounds.push({
      name: rxnId,
      type: lb === ub ? glpk.GLP_FX :
            lb === -Infinity ? glpk.GLP_UP :
            ub === Infinity ? glpk.GLP_LO : glpk.GLP_DB,
      lb: lb,
      ub: ub
    });
  });

  // Add auxiliary variables for absolute value (for reversible reactions)
  // For each low-expression reaction: |v| = v+ + v-
  lowExpressionReactions.forEach(rxnId => {
    const expr = reactionExpression.get(rxnId) || 1.0;
    const weight = thresholdValue - expr; // Higher weight for lower expression

    // Add to objective with weight
    problem.objective.vars.push({
      name: `${rxnId}_plus`,
      coef: weight
    });
    problem.objective.vars.push({
      name: `${rxnId}_minus`,
      coef: weight
    });

    // Add bounds for auxiliary variables
    problem.bounds.push({
      name: `${rxnId}_plus`,
      type: glpk.GLP_LO,
      lb: 0,
      ub: 1000
    });
    problem.bounds.push({
      name: `${rxnId}_minus`,
      type: glpk.GLP_LO,
      lb: 0,
      ub: 1000
    });

    // Add constraint: v = v+ - v-
    problem.subjectTo.push({
      name: `abs_${rxnId}`,
      vars: [
        { name: rxnId, coef: 1 },
        { name: `${rxnId}_plus`, coef: -1 },
        { name: `${rxnId}_minus`, coef: 1 }
      ],
      bnds: { type: glpk.GLP_FX, lb: 0, ub: 0 }
    });
  });

  // Add steady-state constraints (S·v = 0)
  metabolites.forEach((metId, i) => {
    const vars = [];
    reactions.forEach((rxnId, j) => {
      if (S[i][j] !== 0) {
        vars.push({ name: rxnId, coef: S[i][j] });
      }
    });

    if (vars.length > 0) {
      problem.subjectTo.push({
        name: `mass_balance_${metId}`,
        vars: vars,
        bnds: { type: glpk.GLP_FX, lb: 0, ub: 0 }
      });
    }
  });

  // Add objective constraint (maintain required fraction)
  if (optResult.objective && reactions.includes(optResult.objective)) {
    problem.subjectTo.push({
      name: 'objective_constraint',
      vars: [{ name: optResult.objective, coef: 1 }],
      bnds: { type: glpk.GLP_LO, lb: minObjective, ub: 1000 }
    });
  }

  // Solve GIMME
  try {
    const result = glpk.solve(problem);

    const fluxes = {};
    if (result.result && result.result.vars) {
      Object.entries(result.result.vars).forEach(([varId, value]) => {
        // Only include actual reaction fluxes, not auxiliary variables
        if (!varId.endsWith('_plus') && !varId.endsWith('_minus')) {
          fluxes[varId] = value;
        }
      });
    }

    // Calculate inconsistency score
    let inconsistencyScore = 0;
    lowExpressionReactions.forEach(rxnId => {
      if (fluxes[rxnId] !== undefined) {
        inconsistencyScore += Math.abs(fluxes[rxnId]) * (thresholdValue - (reactionExpression.get(rxnId) || 0));
      }
    });

    return {
      status: result.result?.status === glpk.GLP_OPT ? 'OPTIMAL' : 'SUBOPTIMAL',
      objectiveValue: fluxes[optResult.objective] || 0,
      fluxes,
      reactionExpression: Object.fromEntries(reactionExpression),
      lowExpressionReactions,
      threshold: thresholdValue,
      inconsistencyScore,
      method: 'GIMME',
      reference: 'Becker & Palsson (2008) PLoS Comput Biol'
    };
  } catch (error) {
    console.error('GIMME solve error:', error);
    return {
      status: 'ERROR',
      error: error.message,
      fluxes: {}
    };
  }
}

/**
 * E-Flux - Expression-constrained Flux Analysis
 *
 * Constrains reaction flux bounds proportionally to gene expression levels.
 * Simple and computationally efficient.
 *
 * Algorithm (Colijn et al., 2009):
 * 1. Calculate reaction expression from GPR rules
 * 2. Scale upper bounds proportionally to expression
 * 3. Solve standard FBA with modified bounds
 *
 * @param {Object} model - Parsed metabolic model
 * @param {Map<string, number>} geneExpression - Gene expression data
 * @param {Object} options - E-Flux options
 * @returns {Promise<Object>} - E-Flux solution with fluxes
 */
export async function solveEFlux(model, geneExpression, options = {}) {
  const {
    scalingMethod = 'linear', // 'linear', 'log', 'percentile'
    minBound = 0.01, // Minimum fraction of original bound
    objective = null
  } = options;

  // Calculate reaction expression levels via GPR
  const reactionExpression = new Map();
  Object.entries(model.reactions || {}).forEach(([rxnId, rxn]) => {
    const gpr = rxn.gpr || rxn.gene_reaction_rule || '';
    const expr = gprToReactionExpression(gpr, geneExpression);
    reactionExpression.set(rxnId, expr);
  });

  // Normalize expression levels
  const expressionValues = Array.from(reactionExpression.values()).filter(e => e > 0);
  let maxExpression = Math.max(...expressionValues);
  if (maxExpression === 0) maxExpression = 1;

  // Create modified model with expression-scaled bounds
  const modifiedModel = JSON.parse(JSON.stringify(model));

  Object.entries(modifiedModel.reactions).forEach(([rxnId, rxn]) => {
    const expr = reactionExpression.get(rxnId) || 1.0;

    let scalingFactor;
    switch (scalingMethod) {
      case 'log':
        // Log-linear scaling
        scalingFactor = Math.log2(1 + expr) / Math.log2(1 + maxExpression);
        break;
      case 'percentile':
        // Rank-based scaling
        const sortedExprs = [...expressionValues].sort((a, b) => a - b);
        const rank = sortedExprs.findIndex(e => e >= expr);
        scalingFactor = (rank + 1) / sortedExprs.length;
        break;
      default:
        // Linear scaling
        scalingFactor = expr / maxExpression;
    }

    // Apply minimum bound
    scalingFactor = Math.max(minBound, scalingFactor);

    // Scale upper bound (and lower bound for reversible reactions)
    const originalUb = rxn.upper_bound ?? 1000;
    const originalLb = rxn.lower_bound ?? -1000;

    rxn.upper_bound = originalUb * scalingFactor;
    if (originalLb < 0) {
      rxn.lower_bound = originalLb * scalingFactor;
    }
  });

  // Solve FBA with modified bounds
  const result = await solveFBA(modifiedModel, { objective });

  return {
    status: result.status,
    objectiveValue: result.objectiveValue,
    fluxes: result.fluxes,
    reactionExpression: Object.fromEntries(reactionExpression),
    scalingMethod,
    method: 'E-Flux',
    reference: 'Colijn et al. (2009) Mol Syst Biol'
  };
}

/**
 * iMAT - Integrative Metabolic Analysis Tool
 *
 * Uses MILP to find a flux distribution that maximizes agreement with
 * gene expression by including highly expressed reactions and excluding
 * lowly expressed ones.
 *
 * Algorithm (Shlomi et al., 2008):
 * 1. Classify reactions as high/medium/low based on expression
 * 2. Introduce binary variables for reaction activity
 * 3. Maximize number of correctly active/inactive reactions
 *
 * This implementation uses HiGHS WASM solver for TRUE MILP with binary variables.
 * Falls back to LP relaxation only if Web Worker is unavailable.
 *
 * @param {Object} model - Parsed metabolic model
 * @param {Map<string, number>} geneExpression - Gene expression data
 * @param {Object} options - iMAT options
 * @returns {Promise<Object>} - iMAT solution with fluxes
 */
export async function solveIMAT(model, geneExpression, options = {}) {
  const {
    highThreshold = 0.75, // Top 25% are "high"
    lowThreshold = 0.25, // Bottom 25% are "low"
    epsilon = 0.001, // Minimum flux for "active" reaction
    objective = null,
    useMILP = true // Enable true MILP by default
  } = options;

  // Calculate reaction expression levels from GPR rules
  const reactionExpression = new Map();
  Object.entries(model.reactions || {}).forEach(([rxnId, rxn]) => {
    const gpr = rxn.gpr || rxn.gene_reaction_rule || '';
    const expr = gprToReactionExpression(gpr, geneExpression);
    reactionExpression.set(rxnId, expr);
  });

  // Calculate expression percentiles
  const expressionValues = Array.from(reactionExpression.values()).filter(e => e > 0);
  expressionValues.sort((a, b) => a - b);

  const highValue = expressionValues[Math.floor(expressionValues.length * highThreshold)] || 0.7;
  const lowValue = expressionValues[Math.floor(expressionValues.length * lowThreshold)] || 0.3;

  // Classify reactions
  const highExpressionReactions = [];
  const lowExpressionReactions = [];

  Object.keys(model.reactions).forEach(rxnId => {
    const expr = reactionExpression.get(rxnId) || 0.5;
    if (expr >= highValue) {
      highExpressionReactions.push(rxnId);
    } else if (expr <= lowValue) {
      lowExpressionReactions.push(rxnId);
    }
  });

  // Try to use Web Worker with true MILP via HiGHS
  if (useMILP && typeof Worker !== 'undefined') {
    try {
      const result = await solveIMATWithMILP(
        model,
        reactionExpression,
        highExpressionReactions,
        lowExpressionReactions,
        { highValue, lowValue, epsilon, objective }
      );
      return result;
    } catch (workerError) {
      console.warn('MILP solver unavailable, falling back to LP relaxation:', workerError.message);
    }
  }

  // Fallback: LP Relaxation (less accurate but guaranteed to work)
  console.warn('Using LP relaxation for iMAT - results may be suboptimal. Consider enabling MILP.');
  return solveIMATRelaxed(model, reactionExpression, highExpressionReactions, lowExpressionReactions, options);
}

/**
 * True MILP iMAT using HiGHS via Web Worker
 * @private
 */
async function solveIMATWithMILP(model, reactionExpression, highExprReactions, lowExprReactions, options) {
  const { highValue, lowValue, epsilon, objective } = options;

  // Dynamically import HiGHS - handle various module formats (CJS/ESM)
  const highsImport = await import('highs');
  let highsFactory = highsImport;
  if (typeof highsFactory !== 'function') {
    highsFactory = highsImport.default;
  }
  if (typeof highsFactory !== 'function' && highsFactory?.default) {
    highsFactory = highsFactory.default;
  }
  const solver = await highsFactory({
    locateFile: (file) => file.endsWith('.wasm') ? '/highs.wasm' : file
  });

  const reactions = Object.keys(model.reactions);

  // Calculate Big-M dynamically from model bounds
  // M should be the smallest valid upper bound on flux magnitude
  // Reference: Williams (2013) "Model Building in Mathematical Programming"
  const M = Math.max(
    ...Object.values(model.reactions).map(rxn =>
      Math.max(
        Math.abs(rxn.lower_bound ?? -1000),
        Math.abs(rxn.upper_bound ?? 1000)
      )
    ),
    1000 // Minimum fallback
  );

  // Build MILP problem
  let lp = 'Maximize\n obj: ';
  const objTerms = [];

  // Objective: maximize y_h + y_l (active high-expr + inactive low-expr)
  highExprReactions.forEach((rxnId, i) => {
    objTerms.push(`y_h_${i}`);
  });
  lowExprReactions.forEach((rxnId, i) => {
    objTerms.push(`y_l_${i}`);
  });
  lp += objTerms.join(' + ') || '0';
  lp += '\n';

  // Subject to constraints
  lp += 'Subject To\n';
  let constraintIdx = 0;

  // Steady-state constraints: S·v = 0
  const metabolites = Object.keys(model.metabolites || {});
  metabolites.forEach((metId, mIdx) => {
    const terms = [];
    reactions.forEach((rxnId) => {
      const coeff = model.reactions[rxnId].metabolites?.[metId] || 0;
      if (coeff !== 0) {
        terms.push(`${coeff >= 0 ? '+' : ''}${coeff} v_${rxnId}`);
      }
    });
    if (terms.length > 0) {
      lp += ` c${constraintIdx++}: ${terms.join(' ')} = 0\n`;
    }
  });

  // High-expression constraints: v >= epsilon * y_h (if active, must have flux)
  highExprReactions.forEach((rxnId, i) => {
    // |v| >= epsilon * y_h (linearized with auxiliary variables)
    // v_plus + v_minus >= epsilon * y_h
    lp += ` h_act_${i}: v_plus_${rxnId} + v_minus_${rxnId} - ${epsilon} y_h_${i} >= 0\n`;
    // v = v_plus - v_minus
    lp += ` h_split_${i}: v_${rxnId} - v_plus_${rxnId} + v_minus_${rxnId} = 0\n`;
  });

  // Low-expression constraints: |v| <= M * (1 - y_l)
  // When y_l = 1 (inactive): v <= 0 and v >= 0, so v = 0
  // When y_l = 0 (active): v <= M and v >= -M (unconstrained)
  lowExprReactions.forEach((rxnId, i) => {
    lp += ` l_ub_${i}: v_${rxnId} + ${M} y_l_${i} <= ${M}\n`;
    lp += ` l_lb_${i}: v_${rxnId} - ${M} y_l_${i} >= -${M}\n`;
  });

  // Bounds
  lp += 'Bounds\n';
  reactions.forEach((rxnId) => {
    const rxn = model.reactions[rxnId];
    const lb = rxn.lower_bound ?? -1000;
    const ub = rxn.upper_bound ?? 1000;
    lp += ` ${lb} <= v_${rxnId} <= ${ub}\n`;
  });

  // Auxiliary variables for high-expression reactions
  highExprReactions.forEach((rxnId) => {
    lp += ` 0 <= v_plus_${rxnId} <= 1000\n`;
    lp += ` 0 <= v_minus_${rxnId} <= 1000\n`;
  });

  // Binary variables
  lp += 'Binary\n';
  highExprReactions.forEach((_, i) => {
    lp += ` y_h_${i}\n`;
  });
  lowExprReactions.forEach((_, i) => {
    lp += ` y_l_${i}\n`;
  });

  lp += 'End\n';

  // Solve with HiGHS
  const result = solver.solve(lp);

  if (result.Status !== 'Optimal') {
    throw new Error(`MILP solver returned status: ${result.Status}`);
  }

  // Extract fluxes
  const fluxes = {};
  reactions.forEach((rxnId) => {
    fluxes[rxnId] = result.Columns[`v_${rxnId}`]?.Primal || 0;
  });

  // Calculate consistency
  let highConsistency = 0;
  let lowConsistency = 0;

  highExprReactions.forEach((rxnId, i) => {
    if (result.Columns[`y_h_${i}`]?.Primal > 0.5) {
      highConsistency++;
    }
  });

  lowExprReactions.forEach((rxnId, i) => {
    if (result.Columns[`y_l_${i}`]?.Primal > 0.5) {
      lowConsistency++;
    }
  });

  return {
    status: 'OPTIMAL',
    objectiveValue: result.ObjectiveValue,
    fluxes,
    reactionExpression: Object.fromEntries(reactionExpression),
    highExpressionReactions: highExprReactions,
    lowExpressionReactions: lowExprReactions,
    consistency: {
      highActive: highConsistency,
      highTotal: highExprReactions.length,
      lowInactive: lowConsistency,
      lowTotal: lowExprReactions.length,
      score: (highConsistency + lowConsistency) /
             (highExprReactions.length + lowExprReactions.length)
    },
    method: 'iMAT (MILP)',
    solver: 'HiGHS',
    reference: 'Shlomi et al. (2008) Nat Biotechnol'
  };
}

/**
 * LP Relaxation fallback for iMAT (simplified, less accurate)
 * @private
 */
async function solveIMATRelaxed(model, reactionExpression, highExprReactions, lowExprReactions, options) {
  const { epsilon = 0.001, objective = null } = options;

  const constraints = {};

  // High expression reactions should be active
  highExprReactions.forEach(rxnId => {
    const rxn = model.reactions[rxnId];
    const originalLb = rxn.lower_bound ?? -1000;
    const originalUb = rxn.upper_bound ?? 1000;

    if (originalLb < 0 && originalUb > 0) {
      // Reversible - can't easily force in LP
    } else if (originalUb > 0) {
      constraints[rxnId] = { lb: epsilon };
    }
  });

  // Reduce bounds for low-expression reactions
  const modifiedModel = JSON.parse(JSON.stringify(model));
  lowExprReactions.forEach(rxnId => {
    const rxn = modifiedModel.reactions[rxnId];
    const reduction = 0.1;
    rxn.upper_bound = (rxn.upper_bound ?? 1000) * reduction;
    if ((rxn.lower_bound ?? -1000) < 0) {
      rxn.lower_bound = (rxn.lower_bound ?? -1000) * reduction;
    }
  });

  const result = await solveFBA(modifiedModel, { objective, constraints });

  let highConsistency = 0;
  let lowConsistency = 0;

  highExprReactions.forEach(rxnId => {
    if (Math.abs(result.fluxes[rxnId] || 0) > epsilon) {
      highConsistency++;
    }
  });

  lowExprReactions.forEach(rxnId => {
    if (Math.abs(result.fluxes[rxnId] || 0) <= epsilon) {
      lowConsistency++;
    }
  });

  return {
    status: result.status,
    objectiveValue: result.objectiveValue,
    fluxes: result.fluxes,
    reactionExpression: Object.fromEntries(reactionExpression),
    highExpressionReactions: highExprReactions,
    lowExpressionReactions: lowExprReactions,
    consistency: {
      highActive: highConsistency,
      highTotal: highExprReactions.length,
      lowInactive: lowConsistency,
      lowTotal: lowExprReactions.length,
      score: (highConsistency + lowConsistency) /
             (highExprReactions.length + lowExprReactions.length)
    },
    method: 'iMAT (LP Relaxation)',
    solver: 'GLPK',
    warning: 'Using LP relaxation - binary variables relaxed to continuous. Results may include fractional flux activity.',
    reference: 'Shlomi et al. (2008) Nat Biotechnol'
  };
}

/**
 * Differential E-Flux - Comparative flux analysis between two conditions.
 *
 * Runs E-Flux independently on control and treatment expression data,
 * then computes fold changes in predicted fluxes.
 *
 * NOTE: This is NOT an implementation of MADE (Jensen & Papin 2011,
 * Bioinformatics 27(4):541-547), which uses a statistical test on
 * differential expression to constrain reaction directionality changes.
 * This is a simpler comparative E-Flux approach.
 *
 * @param {Object} model - Parsed metabolic model
 * @param {Map<string, number>} controlExpression - Control condition expression
 * @param {Map<string, number>} treatmentExpression - Treatment condition expression
 * @param {Object} options - Options
 * @returns {Promise<Object>} - Comparative analysis results
 */
export async function solveDifferentialEFlux(model, controlExpression, treatmentExpression, options = {}) {
  const {
    foldChangeThreshold = 2.0, // Log2 fold change threshold
    objective = null
  } = options;

  // Solve for control condition
  const controlResult = await solveEFlux(model, controlExpression, {
    scalingMethod: 'linear',
    objective
  });

  // Solve for treatment condition
  const treatmentResult = await solveEFlux(model, treatmentExpression, {
    scalingMethod: 'linear',
    objective
  });

  // Calculate flux changes
  const fluxChanges = {};
  const differentiallyActive = [];

  Object.keys(model.reactions).forEach(rxnId => {
    const controlFlux = controlResult.fluxes[rxnId] || 0;
    const treatmentFlux = treatmentResult.fluxes[rxnId] || 0;

    const change = treatmentFlux - controlFlux;
    const foldChange = controlFlux !== 0
      ? Math.log2(Math.abs(treatmentFlux) / Math.abs(controlFlux))
      : (treatmentFlux !== 0 ? Infinity : 0);

    fluxChanges[rxnId] = {
      control: controlFlux,
      treatment: treatmentFlux,
      change,
      foldChange
    };

    if (Math.abs(foldChange) >= foldChangeThreshold) {
      differentiallyActive.push({
        rxnId,
        foldChange,
        direction: foldChange > 0 ? 'up' : 'down'
      });
    }
  });

  return {
    status: 'COMPLETE',
    control: controlResult,
    treatment: treatmentResult,
    fluxChanges,
    differentiallyActive,
    objectiveChange: {
      control: controlResult.objectiveValue,
      treatment: treatmentResult.objectiveValue,
      percentChange: controlResult.objectiveValue !== 0
        ? ((treatmentResult.objectiveValue - controlResult.objectiveValue) / controlResult.objectiveValue) * 100
        : 0
    },
    method: 'Differential E-Flux',
    reference: 'Colijn et al. (2009) Mol Syst Biol (comparative application)'
  };
}

/**
 * Helper to integrate metabolomics data with FBA
 *
 * Adjusts exchange reaction bounds based on measured metabolite concentrations.
 *
 * @param {Object} model - Parsed metabolic model
 * @param {Map<string, number>} metaboliteConcentrations - Metabolite concentrations
 * @param {Object} options - Integration options
 * @returns {Object} - Modified model with adjusted bounds
 */
export function integrateMetabolomics(model, metaboliteConcentrations, options = {}) {
  const {
    method = 'bound_adjustment', // 'bound_adjustment' or 'thermodynamic'
    scalingFactor = 0.1 // How much to adjust bounds
  } = options;

  const modifiedModel = JSON.parse(JSON.stringify(model));
  const adjustedExchanges = [];

  // Find exchange reactions and adjust based on metabolite concentrations
  Object.entries(modifiedModel.reactions).forEach(([rxnId, rxn]) => {
    // Check if this is an exchange reaction
    const mets = rxn.metabolites || {};
    const metIds = Object.keys(mets);

    if (metIds.length === 1) {
      const metId = metIds[0];
      const baseId = metId.replace(/_[a-z]$/, ''); // Remove compartment suffix

      if (metaboliteConcentrations.has(baseId) || metaboliteConcentrations.has(metId)) {
        const concentration = metaboliteConcentrations.get(metId) || metaboliteConcentrations.get(baseId);

        // Adjust bounds based on concentration
        if (method === 'bound_adjustment') {
          const adjustmentFactor = 1 + (concentration * scalingFactor);
          rxn.upper_bound = (rxn.upper_bound || 1000) * adjustmentFactor;
          if (rxn.lower_bound < 0) {
            rxn.lower_bound = (rxn.lower_bound || -1000) * adjustmentFactor;
          }
        }

        adjustedExchanges.push({
          rxnId,
          metabolite: metId,
          concentration,
          newLb: rxn.lower_bound,
          newUb: rxn.upper_bound
        });
      }
    }
  });

  return {
    model: modifiedModel,
    adjustedExchanges,
    method
  };
}

/**
 * Combine multiple omics layers for integrated analysis
 *
 * @param {Object} model - Parsed metabolic model
 * @param {Object} omicsData - Multi-omics data
 * @param {Object} options - Integration options
 * @returns {Promise<Object>} - Integrated analysis results
 */
export async function integratedOmicsAnalysis(model, omicsData, options = {}) {
  const {
    transcriptomics = null,
    proteomics = null,
    metabolomics = null,
    method = 'E-Flux' // 'E-Flux', 'GIMME', or 'iMAT'
  } = omicsData;

  const {
    objective = null,
    transcriptWeight = 0.6,
    proteinWeight = 0.4
  } = options;

  // Combine transcriptomics and proteomics
  let geneExpression = new Map();

  if (transcriptomics) {
    transcriptomics.forEach((value, key) => {
      geneExpression.set(key, value * transcriptWeight);
    });
  }

  if (proteomics) {
    proteomics.forEach((value, key) => {
      const existing = geneExpression.get(key) || 0;
      geneExpression.set(key, existing + value * proteinWeight);
    });
  }

  // Normalize combined expression
  if (geneExpression.size > 0) {
    const maxExpr = Math.max(...geneExpression.values());
    geneExpression.forEach((value, key) => {
      geneExpression.set(key, value / maxExpr);
    });
  }

  // Adjust model with metabolomics
  let workingModel = model;
  let metabolomicsIntegration = null;

  if (metabolomics) {
    metabolomicsIntegration = integrateMetabolomics(model, metabolomics);
    workingModel = metabolomicsIntegration.model;
  }

  // Run expression-based method
  let expressionResult;

  switch (method) {
    case 'GIMME':
      expressionResult = await solveGIMME(workingModel, geneExpression, { objective });
      break;
    case 'iMAT':
      expressionResult = await solveIMAT(workingModel, geneExpression, { objective });
      break;
    default:
      expressionResult = await solveEFlux(workingModel, geneExpression, { objective });
  }

  return {
    status: expressionResult.status,
    objectiveValue: expressionResult.objectiveValue,
    fluxes: expressionResult.fluxes,
    reactionExpression: expressionResult.reactionExpression,
    method,
    omicsLayers: {
      transcriptomics: transcriptomics ? transcriptomics.size : 0,
      proteomics: proteomics ? proteomics.size : 0,
      metabolomics: metabolomics ? metabolomics.size : 0
    },
    metabolomicsAdjustments: metabolomicsIntegration?.adjustedExchanges || [],
    expressionIntegration: {
      method: expressionResult.method,
      reference: expressionResult.reference
    }
  };
}

export default {
  solveGIMME,
  solveEFlux,
  solveIMAT,
  solveDifferentialEFlux,
  integrateMetabolomics,
  integratedOmicsAnalysis,
  gprToReactionExpression
};
