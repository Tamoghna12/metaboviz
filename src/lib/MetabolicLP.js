/**
 * MetabolicLP - Shared LP building utilities for metabolic models
 *
 * Single source of truth for LP problem construction, result formatting,
 * and knockout logic. Consumed by both SolverWorker.js and HiGHSSolver.js.
 *
 * @module MetabolicLP
 */

import {
  evaluateGPR as evaluateGPRBoolean,
  gprToReactionExpression,
  extractGenesFromGPR,
} from './GPRExpression.js';

// ── Numerical constants ───────────────────────────────────────────────────────

/** Solver primal/dual feasibility tolerance — values below this are numerical zero */
export const SOLVER_TOLERANCE = 1e-9;
export const OBJECTIVE_TOLERANCE = 1e-6;
export const FLUX_TOLERANCE = 1e-6;
export const IMAT_EPSILON = 1e-3;

/**
 * Default viability threshold: 0.001 h⁻¹ (~0.1% of typical E. coli growth).
 * Reference: Baba et al. (2006) Mol Syst Biol 2:2006.0008
 */
export const DEFAULT_VIABILITY_THRESHOLD = 0.001;

// ── Model utilities ───────────────────────────────────────────────────────────

/**
 * Find objective reaction.
 * Priority: explicit objective_coefficient > 'biomass' name pattern.
 * Returns null if none found (Orth et al. 2010: objective must be explicit).
 */
export function findObjectiveReaction(model) {
  for (const [id, rxn] of Object.entries(model.reactions || {})) {
    if (rxn.objective_coefficient && rxn.objective_coefficient !== 0) return id;
  }
  return (
    Object.keys(model.reactions || {}).find(id =>
      id.toLowerCase().includes('biomass'),
    ) ?? null
  );
}

/**
 * Case-insensitive knockout application.
 * Evaluates GPR boolean logic with knocked-out genes removed from active set.
 * Matches COBRApy convention: AND=all required, OR=one sufficient.
 *
 * @param {Object} rxn - Reaction object
 * @param {number} lb - Original lower bound
 * @param {number} ub - Original upper bound
 * @param {string[]} knockouts - Gene IDs to knock out (case-insensitive)
 * @returns {{ lb: number, ub: number }}
 */
export function applyKnockouts(rxn, lb, ub, knockouts) {
  if (!knockouts.length) return { lb, ub };
  const gprString = rxn.gpr || rxn.gene_reaction_rule;
  if (!gprString) return { lb, ub };

  const knockoutSet = new Set(knockouts.map(g => g.toLowerCase()));
  const gprGenes = extractGenesFromGPR(gprString);
  const activeGenes = new Set(gprGenes.filter(g => !knockoutSet.has(g.toLowerCase())));
  return evaluateGPRBoolean(gprString, activeGenes) ? { lb, ub } : { lb: 0, ub: 0 };
}

/**
 * Quantitative GPR evaluation for omics integration.
 * AND → min (Liebig's law of the minimum), OR → max (isozyme dominance).
 * Reference: Colijn et al. (2009) Mol Syst Biol; Shlomi et al. (2008) Nat Biotechnol.
 *
 * @param {string} gpr - GPR rule string
 * @param {Map|Object} expressionData - Gene → expression level
 * @returns {number} Reaction expression level
 */
export function evaluateGPRQuantitative(gpr, expressionData) {
  if (!gpr || !gpr.trim()) return 1.0;
  const exprMap =
    expressionData instanceof Map
      ? expressionData
      : new Map(Object.entries(expressionData || {}));
  return gprToReactionExpression(gpr, exprMap);
}

// ── LP format utilities ───────────────────────────────────────────────────────

export function formatExpression(terms) {
  if (!terms || terms.length === 0) return '0';
  return (
    terms
      .map((term, i) => {
        const coef = term.coef ?? 1;
        const name = term.name;
        const sign = coef >= 0 ? (i > 0 ? ' + ' : '') : ' - ';
        const absCoef = Math.abs(coef);
        if (absCoef === 0) return '';
        if (absCoef === 1) return `${sign}${name}`;
        return `${sign}${absCoef} ${name}`;
      })
      .filter(Boolean)
      .join('') || '0'
  );
}

export function buildLPFormat(problem) {
  const lines = [];
  lines.push(problem.sense === 'min' ? 'Minimize' : 'Maximize');
  lines.push(' obj: ' + formatExpression(problem.objective));

  lines.push('Subject To');
  problem.constraints.forEach((c, i) => {
    const name = c.name || `c${i}`;
    const expr = formatExpression(c.lhs);
    if (c.type === 'eq') lines.push(` ${name}: ${expr} = ${c.rhs}`);
    else if (c.type === 'le') lines.push(` ${name}: ${expr} <= ${c.rhs}`);
    else if (c.type === 'ge') lines.push(` ${name}: ${expr} >= ${c.rhs}`);
  });

  lines.push('Bounds');
  problem.variables.forEach(v => {
    const lb = v.lb ?? 0;
    const ub = v.ub ?? Infinity;
    if (lb === -Infinity && ub === Infinity) lines.push(` ${v.name} free`);
    else if (lb === -Infinity) lines.push(` -inf <= ${v.name} <= ${ub}`);
    else if (ub === Infinity) lines.push(` ${v.name} >= ${lb}`);
    else lines.push(` ${lb} <= ${v.name} <= ${ub}`);
  });

  const binaries = problem.variables.filter(v => v.type === 'binary');
  if (binaries.length) {
    lines.push('Binary');
    binaries.forEach(v => lines.push(` ${v.name}`));
  }
  const integers = problem.variables.filter(v => v.type === 'integer');
  if (integers.length) {
    lines.push('General');
    integers.forEach(v => lines.push(` ${v.name}`));
  }

  lines.push('End');
  return lines.join('\n');
}

// ── Problem builders ──────────────────────────────────────────────────────────

/**
 * Build standard FBA/FVA problem using DIRECT variables (no split).
 *
 * Uses v_rxnId with lb/ub bounds directly — exactly half the LP variables
 * vs split-variable formulation. This IS the canonical FBA formulation:
 *   maximize c·v s.t. Sv=0, lb≤v≤ub
 * Reference: Orth et al. (2010) Nat Biotechnol; Varma & Palsson (1994).
 *
 * Only valid when |v| is NOT needed in objective or constraints.
 * Use buildSplitVarProblem for pFBA, MOMA, GIMME, iMAT.
 *
 * @param {Object} model - Metabolic model
 * @param {Object} constraints - Additional flux constraints { rxnId: { lb?, ub? } }
 * @param {string[]} knockouts - Gene IDs to knock out (case-insensitive)
 * @param {string|null} objectiveOverride - Override objective reaction ID
 * @returns {{ problem, rxnVars: string[] }}
 */
export function buildDirectFBAProblem(
  model,
  constraints = {},
  knockouts = [],
  objectiveOverride = null,
) {
  const reactions = Object.entries(model.reactions || {});
  const metabolites = Object.entries(model.metabolites || {});

  const problem = { sense: 'max', objective: [], constraints: [], variables: [] };
  const rxnVars = [];

  reactions.forEach(([rxnId, rxn]) => {
    rxnVars.push(rxnId);

    let lb = rxn.lower_bound ?? -1000;
    let ub = rxn.upper_bound ?? 1000;

    if (constraints[rxnId]) {
      if (constraints[rxnId].lb !== undefined) lb = constraints[rxnId].lb;
      if (constraints[rxnId].ub !== undefined) ub = constraints[rxnId].ub;
    }

    if (knockouts.length > 0) {
      ({ lb, ub } = applyKnockouts(rxn, lb, ub, knockouts));
    }

    problem.variables.push({ name: `v_${rxnId}`, lb, ub, type: 'continuous' });

    const isObjective = objectiveOverride
      ? rxnId === objectiveOverride
      : rxn.objective_coefficient && rxn.objective_coefficient !== 0;

    if (isObjective) {
      problem.objective.push({
        name: `v_${rxnId}`,
        coef: objectiveOverride ? 1 : rxn.objective_coefficient,
      });
    }
  });

  if (problem.objective.length === 0 && !objectiveOverride) {
    const biomass = reactions.find(([id]) => id.toLowerCase().includes('biomass'));
    if (biomass) problem.objective.push({ name: `v_${biomass[0]}`, coef: 1 });
  }

  metabolites.forEach(([metId]) => {
    const terms = [];
    reactions.forEach(([rxnId, rxn]) => {
      const coef = rxn.metabolites?.[metId];
      if (coef) terms.push({ name: `v_${rxnId}`, coef });
    });
    if (terms.length > 0) {
      problem.constraints.push({ name: `mb_${metId}`, lhs: terms, type: 'eq', rhs: 0 });
    }
  });

  return { problem, rxnVars };
}

/**
 * Build split-variable metabolic problem (v = v_pos - v_neg, both ≥ 0).
 *
 * Required for methods that need |v| in objective or constraints:
 *   pFBA: minimize Σ(v_pos + v_neg)
 *   MOMA: minimize Σ|v_i - v_wt_i| via deviation variables
 *   GIMME: minimize penalty * (v_pos + v_neg) for low-expression reactions
 *   iMAT: v_pos + v_neg >= epsilon * y (activity indicator)
 *
 * NOTE on iMAT constraint: the constraint v_pos + v_neg >= epsilon * y is an
 * approximation of |v| >= epsilon. In LP relaxation, complementarity
 * (v_pos * v_neg = 0) is not enforced, so v_pos = v_neg = epsilon/2 could
 * satisfy y=1 with net flux = 0. This is the standard approximation used
 * in practice (Shlomi et al. 2008); a full fix requires explicit
 * complementarity via Big-M binary variables, which doubles MILP size.
 *
 * @param {Object} model - Metabolic model
 * @param {Object} constraints - Additional flux constraints
 * @param {string[]} knockouts - Gene IDs to knock out (case-insensitive)
 * @returns {{ problem, rxnVars: string[] }}
 */
export function buildSplitVarProblem(model, constraints = {}, knockouts = []) {
  const reactions = Object.entries(model.reactions || {});
  const metabolites = Object.entries(model.metabolites || {});

  const problem = { sense: 'max', objective: [], constraints: [], variables: [] };
  const rxnVars = [];

  reactions.forEach(([rxnId, rxn]) => {
    rxnVars.push(rxnId);

    let lb = rxn.lower_bound ?? -1000;
    let ub = rxn.upper_bound ?? 1000;

    if (constraints[rxnId]) {
      if (constraints[rxnId].lb !== undefined) lb = constraints[rxnId].lb;
      if (constraints[rxnId].ub !== undefined) ub = constraints[rxnId].ub;
    }

    if (knockouts.length > 0) {
      ({ lb, ub } = applyKnockouts(rxn, lb, ub, knockouts));
    }

    problem.variables.push(
      { name: `v_${rxnId}_pos`, lb: Math.max(0, lb), ub: Math.max(0, ub), type: 'continuous' },
      { name: `v_${rxnId}_neg`, lb: Math.max(0, -ub), ub: Math.max(0, -lb), type: 'continuous' },
    );

    if (rxn.objective_coefficient && rxn.objective_coefficient !== 0) {
      problem.objective.push({ name: `v_${rxnId}_pos`, coef: rxn.objective_coefficient });
      problem.objective.push({ name: `v_${rxnId}_neg`, coef: -rxn.objective_coefficient });
    }
  });

  if (problem.objective.length === 0) {
    const biomass = reactions.find(([id]) => id.toLowerCase().includes('biomass'));
    if (biomass) {
      problem.objective.push({ name: `v_${biomass[0]}_pos`, coef: 1 });
      problem.objective.push({ name: `v_${biomass[0]}_neg`, coef: -1 });
    }
  }

  metabolites.forEach(([metId]) => {
    const terms = [];
    reactions.forEach(([rxnId, rxn]) => {
      const coef = rxn.metabolites?.[metId];
      if (coef) {
        terms.push({ name: `v_${rxnId}_pos`, coef });
        terms.push({ name: `v_${rxnId}_neg`, coef: -coef });
      }
    });
    if (terms.length > 0) {
      problem.constraints.push({ name: `mb_${metId}`, lhs: terms, type: 'eq', rhs: 0 });
    }
  });

  return { problem, rxnVars };
}

// ── Result formatters ─────────────────────────────────────────────────────────

/**
 * Format result from a direct-variable HiGHS solve.
 * Works with raw HiGHS result: { Status, Columns, ObjectiveValue }.
 */
export function formatDirectResult(rawResult, rxnVars, model, method = 'fba', options = {}) {
  if (rawResult.Status !== 'Optimal') {
    return {
      status: rawResult.Status?.toLowerCase() || 'error',
      objectiveValue: 0,
      growthRate: 0,
      fluxes: {},
      method,
      solver: 'highs-wasm',
      phenotype: 'infeasible',
    };
  }

  const fluxes = {};
  const cols = rawResult.Columns || {};

  rxnVars.forEach(rxnId => {
    let v = cols[`v_${rxnId}`]?.Primal ?? 0;
    if (Math.abs(v) < SOLVER_TOLERANCE) v = 0;
    fluxes[rxnId] = v;
  });

  let growthRate = 0;
  const objRxn = findObjectiveReaction(model);
  if (objRxn) growthRate = fluxes[objRxn] ?? 0;

  const viabilityThreshold =
    options.viabilityThreshold ?? model.viabilityThreshold ?? DEFAULT_VIABILITY_THRESHOLD;

  return {
    status: 'optimal',
    objectiveValue: rawResult.ObjectiveValue,
    growthRate,
    fluxes,
    method,
    solver: 'highs-wasm',
    phenotype: growthRate > viabilityThreshold ? 'viable' : 'lethal',
    viabilityThreshold,
  };
}

/**
 * Format result from a split-variable HiGHS solve.
 * Works with raw HiGHS result: { Status, Columns, ObjectiveValue }.
 *
 * @param {number|null} biomassOverride - For pFBA: Stage 1 biomass (not Stage 2 total flux)
 */
export function formatSplitResult(
  rawResult,
  rxnVars,
  model,
  method = 'fba',
  options = {},
  biomassOverride = null,
) {
  if (rawResult.Status !== 'Optimal') {
    return {
      status: rawResult.Status?.toLowerCase() || 'error',
      objectiveValue: 0,
      growthRate: 0,
      fluxes: {},
      method,
      solver: 'highs-wasm',
      phenotype: 'infeasible',
    };
  }

  const fluxes = {};
  const cols = rawResult.Columns || {};

  rxnVars.forEach(rxnId => {
    const pos = cols[`v_${rxnId}_pos`]?.Primal ?? 0;
    const neg = cols[`v_${rxnId}_neg`]?.Primal ?? 0;
    let v = pos - neg;
    if (Math.abs(v) < SOLVER_TOLERANCE) v = 0;
    fluxes[rxnId] = v;
  });

  let growthRate = 0;
  const objRxn = findObjectiveReaction(model);
  if (objRxn) growthRate = fluxes[objRxn] ?? 0;

  // pFBA Stage 2 minimizes total flux; must return Stage 1 biomass as objective_value
  const objectiveValue =
    method === 'pfba'
      ? biomassOverride !== null ? biomassOverride : growthRate
      : rawResult.ObjectiveValue;

  const viabilityThreshold =
    options.viabilityThreshold ?? model.viabilityThreshold ?? DEFAULT_VIABILITY_THRESHOLD;

  return {
    status: 'optimal',
    objectiveValue,
    growthRate,
    fluxes,
    method,
    solver: 'highs-wasm',
    phenotype: growthRate > viabilityThreshold ? 'viable' : 'lethal',
    viabilityThreshold,
  };
}
