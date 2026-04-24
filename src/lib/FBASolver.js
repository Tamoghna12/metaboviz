/**
 * FBASolver - Real Flux Balance Analysis using GLPK.js
 *
 * This module provides actual Linear Programming-based FBA solving,
 * not heuristic/hardcoded approximations.
 *
 * The core FBA problem:
 *   maximize: c · v (objective function, typically biomass)
 *   subject to: S · v = 0 (steady-state constraint)
 *               lb ≤ v ≤ ub (flux bounds)
 *
 * References:
 * - Orth et al. (2010) "What is flux balance analysis?" Nature Biotechnology
 * - Varma & Palsson (1994) "Stoichiometric flux balance models..." Appl Environ Microbiol
 *
 * @module FBASolver
 */

import GLPK from 'glpk.js';
import { evaluateGPR } from './GPRExpression.js';

// Re-export all GPR functions from GPRExpression.js for backward compatibility
export { evaluateGPR, extractGenesFromGPR as extractGenes } from './GPRExpression.js';

// Initialize GLPK (returns a promise)
let glpkInstance = null;
const getGLPK = async () => {
  if (!glpkInstance) {
    glpkInstance = await GLPK();
  }
  return glpkInstance;
};

// GPR functions are now in GPRExpression.js and re-exported above

/**
 * Extract all genes from a model
 */
export function extractAllGenes(model) {
  const genes = new Set();

  if (model.genes) {
    Object.keys(model.genes).forEach(g => genes.add(g));
  }

  if (model.reactions) {
    Object.values(model.reactions).forEach(rxn => {
      if (rxn.genes) {
        rxn.genes.forEach(g => genes.add(g));
      }
      if (rxn.gpr) {
        // Extract gene IDs from GPR string
        const gprGenes = rxn.gpr.match(/[a-zA-Z][a-zA-Z0-9_.-]*/g) || [];
        gprGenes.filter(g => !['and', 'or', 'AND', 'OR'].includes(g))
          .forEach(g => genes.add(g));
      }
    });
  }

  return genes;
}

/**
 * Build stoichiometric matrix from model
 *
 * @param {Object} model - Parsed model with reactions and metabolites
 * @returns {Object} - { S: number[][], metabolites: string[], reactions: string[] }
 */
export function buildStoichiometricMatrix(model) {
  const reactions = Object.keys(model.reactions || {});
  const metaboliteSet = new Set();

  // Collect all metabolites
  reactions.forEach(rxnId => {
    const rxn = model.reactions[rxnId];
    if (rxn.metabolites) {
      Object.keys(rxn.metabolites).forEach(m => metaboliteSet.add(m));
    }
  });

  const metabolites = Array.from(metaboliteSet);
  const metIndex = new Map(metabolites.map((m, i) => [m, i]));
  const rxnIndex = new Map(reactions.map((r, i) => [r, i]));

  // Build S matrix (metabolites x reactions)
  const S = Array(metabolites.length).fill(null)
    .map(() => Array(reactions.length).fill(0));

  reactions.forEach((rxnId, j) => {
    const rxn = model.reactions[rxnId];
    if (rxn.metabolites) {
      Object.entries(rxn.metabolites).forEach(([metId, coeff]) => {
        const i = metIndex.get(metId);
        if (i !== undefined) {
          S[i][j] = coeff;
        }
      });
    }
  });

  return { S, metabolites, reactions, metIndex, rxnIndex };
}

/**
 * Solve FBA problem using GLPK
 *
 * @param {Object} model - Parsed model
 * @param {Object} options - FBA options
 * @param {string} options.objective - Objective reaction ID (default: first biomass-like reaction)
 * @param {string} options.direction - 'max' or 'min'
 * @param {Set<string>} options.knockoutGenes - Genes to knock out
 * @param {Object} options.constraints - Additional flux constraints { rxnId: { lb, ub } }
 * @returns {Promise<Object>} - { status, objectiveValue, fluxes, shadowPrices }
 */
export async function solveFBA(model, options = {}) {
  const glpk = await getGLPK();

  const {
    objective = findObjectiveReaction(model),
    direction = 'max',
    knockoutGenes = new Set(),
    constraints = {}
  } = options;

  // Build stoichiometric matrix
  const { S, metabolites, reactions, rxnIndex } = buildStoichiometricMatrix(model);

  if (reactions.length === 0) {
    return { status: 'NO_REACTIONS', objectiveValue: 0, fluxes: {} };
  }

  // Determine active genes — case-insensitive knockout matching
  const allGenes = extractAllGenes(model);
  const knockoutLower = new Set([...knockoutGenes].map(g => g.toLowerCase()));
  const activeGenes = new Set([...allGenes].filter(g => !knockoutLower.has(g.toLowerCase())));

  // Build LP problem
  const problem = {
    name: 'FBA',
    objective: {
      direction: direction === 'max' ? glpk.GLP_MAX : glpk.GLP_MIN,
      name: 'objective',
      vars: []
    },
    subjectTo: [],
    bounds: []
  };

  // Add variables (reactions) with bounds
  reactions.forEach((rxnId, j) => {
    const rxn = model.reactions[rxnId];
    let lb = rxn.lower_bound ?? -1000;
    let ub = rxn.upper_bound ?? 1000;

    // Apply additional constraints first
    if (constraints[rxnId]) {
      if (constraints[rxnId].lb !== undefined) lb = constraints[rxnId].lb;
      if (constraints[rxnId].ub !== undefined) ub = constraints[rxnId].ub;
    }

    // Apply knockouts AFTER constraints (knockouts are definitive biological
    // events that override any user-supplied bound constraints)
    if (rxn.gpr || rxn.gene_reaction_rule) {
      const gprString = rxn.gpr || rxn.gene_reaction_rule;
      const isActive = evaluateGPR(gprString, activeGenes);
      if (!isActive) {
        lb = 0;
        ub = 0;
      }
    }

    // Add to objective if this is the objective reaction
    if (rxnId === objective) {
      problem.objective.vars.push({ name: rxnId, coef: 1 });
    }

    // Add bounds
    problem.bounds.push({
      name: rxnId,
      type: lb === ub ? glpk.GLP_FX :
            lb === -Infinity ? glpk.GLP_UP :
            ub === Infinity ? glpk.GLP_LO : glpk.GLP_DB,
      lb: lb,
      ub: ub
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

  // Solve
  try {
    const result = glpk.solve(problem);

    // Extract fluxes
    const fluxes = {};
    if (result.result && result.result.vars) {
      Object.entries(result.result.vars).forEach(([rxnId, value]) => {
        fluxes[rxnId] = value;
      });
    }

    // Map status
    let status = 'UNKNOWN';
    if (result.result) {
      switch (result.result.status) {
        case glpk.GLP_OPT:
          status = 'OPTIMAL';
          break;
        case glpk.GLP_FEAS:
          status = 'FEASIBLE';
          break;
        case glpk.GLP_INFEAS:
          status = 'INFEASIBLE';
          break;
        case glpk.GLP_NOFEAS:
          status = 'NO_FEASIBLE';
          break;
        case glpk.GLP_UNBND:
          status = 'UNBOUNDED';
          break;
        case glpk.GLP_UNDEF:
          status = 'UNDEFINED';
          break;
      }
    }

    // Extract shadow prices (dual variables for mass-balance constraints)
    // Shadow price of metabolite i = ∂Z/∂b_i: marginal value of relaxing S_i·v=0
    const shadowPrices = {};
    if (result.result?.dual) {
      Object.entries(result.result.dual).forEach(([constraintName, dualValue]) => {
        if (constraintName.startsWith('mass_balance_')) {
          const metId = constraintName.slice('mass_balance_'.length);
          shadowPrices[metId] = dualValue;
        }
      });
    }

    return {
      status,
      objectiveValue: result.result?.z ?? 0,
      fluxes,
      shadowPrices,
      objective,
      knockedOutGenes: Array.from(knockoutGenes),
      solverInfo: {
        variables: reactions.length,
        constraints: metabolites.length,
        solver: 'GLPK'
      }
    };
  } catch (error) {
    console.error('FBA solve error:', error);
    return {
      status: 'ERROR',
      error: error.message,
      objectiveValue: 0,
      fluxes: {}
    };
  }
}

/**
 * Find objective reaction (biomass or similar)
 */
function findObjectiveReaction(model) {
  const reactions = Object.keys(model.reactions || {});

  // Priority 1: Check for explicit objective_coefficient (from FBC package)
  for (const rxnId of reactions) {
    const rxn = model.reactions[rxnId];
    if (rxn.objective_coefficient && rxn.objective_coefficient !== 0) {
      return rxnId;
    }
  }

  // Priority 2: Look for common biomass reaction patterns
  const biomassPatterns = [
    /biomass/i,
    /growth/i,
    /^bm$/i,
    /objective/i
  ];

  for (const rxnId of reactions) {
    for (const pattern of biomassPatterns) {
      if (pattern.test(rxnId)) return rxnId;
    }
    const rxn = model.reactions[rxnId];
    if (rxn.name) {
      for (const pattern of biomassPatterns) {
        if (pattern.test(rxn.name)) return rxnId;
      }
    }
  }

  // No objective found — return null instead of arbitrary first reaction
  // Caller must handle null (Orth et al. 2010: objective must be explicit)
  console.warn('No objective reaction found. Specify one explicitly.');
  return null;
}

/**
 * Perform Flux Variability Analysis (FVA)
 *
 * For each reaction, finds the minimum and maximum flux while
 * maintaining at least a fraction of the optimal objective.
 *
 * @param {Object} model - Parsed model
 * @param {Object} options - FVA options
 * @param {number} options.fraction - Fraction of optimal objective to maintain (default: 1.0)
 * @param {string[]} options.reactions - Reactions to analyze (default: all)
 * @returns {Promise<Object>} - { rxnId: { min, max } }
 */
export async function solveFVA(model, options = {}) {
  const {
    fraction = 1.0,
    reactions: targetReactions = null,
    knockoutGenes = new Set()
  } = options;

  // First, solve for optimal objective
  const optResult = await solveFBA(model, { knockoutGenes });
  if (optResult.status !== 'OPTIMAL') {
    return { status: optResult.status, variability: {} };
  }

  const optValue = optResult.objectiveValue;
  const minObjective = optValue * fraction;

  // Get reactions to analyze
  const reactions = targetReactions || Object.keys(model.reactions || {});
  const variability = {};

  // For each reaction, find min and max flux
  for (const rxnId of reactions) {
    // Minimize
    const minResult = await solveFBA(model, {
      objective: rxnId,
      direction: 'min',
      knockoutGenes,
      constraints: {
        [optResult.objective]: { lb: minObjective }
      }
    });

    // Maximize
    const maxResult = await solveFBA(model, {
      objective: rxnId,
      direction: 'max',
      knockoutGenes,
      constraints: {
        [optResult.objective]: { lb: minObjective }
      }
    });

    variability[rxnId] = {
      min: minResult.status === 'OPTIMAL' ? minResult.objectiveValue : null,
      max: maxResult.status === 'OPTIMAL' ? maxResult.objectiveValue : null
    };
  }

  return {
    status: 'COMPLETE',
    optimalObjective: optValue,
    variability
  };
}

/**
 * Perform gene essentiality analysis
 *
 * Tests each gene knockout individually to find essential genes.
 *
 * @param {Object} model - Parsed model
 * @param {Object} options - Options
 * @param {number} options.threshold - Growth threshold for essentiality (default: 0.01)
 * @returns {Promise<Object>} - { gene: { growth, essential } }
 */
export async function geneEssentiality(model, options = {}) {
  const { threshold = 0.01 } = options;

  // Wild-type growth
  const wtResult = await solveFBA(model);
  if (wtResult.status !== 'OPTIMAL' || wtResult.objectiveValue === 0) {
    return { status: 'WT_FAILED', essentiality: {} };
  }

  const wtGrowth = wtResult.objectiveValue;
  const allGenes = extractAllGenes(model);
  const essentiality = {};

  for (const gene of allGenes) {
    const koResult = await solveFBA(model, {
      knockoutGenes: new Set([gene])
    });

    const growth = koResult.status === 'OPTIMAL' ? koResult.objectiveValue : 0;
    const ratio = growth / wtGrowth;

    essentiality[gene] = {
      growth,
      ratio,
      essential: ratio < threshold
    };
  }

  return {
    status: 'COMPLETE',
    wildTypeGrowth: wtGrowth,
    essentiality
  };
}

export default {
  solveFBA,
  solveFVA,
  geneEssentiality,
  evaluateGPR,
  extractAllGenes,
  buildStoichiometricMatrix
};
