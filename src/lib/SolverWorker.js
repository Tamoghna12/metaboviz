/**
 * SolverWorker - Web Worker for Background LP/MILP Solving
 *
 * Runs HiGHS WASM solver in a background thread to prevent blocking the UI.
 * HiGHS provides true MILP support for iMAT and other mixed-integer methods.
 *
 * Message Protocol:
 * - Input: { jobId, method, model, options }
 * - Output: { jobId, type: 'result'|'progress'|'error', result?, error?, progress? }
 *
 * Supported Methods:
 * - fba: Flux Balance Analysis
 * - pfba: Parsimonious FBA
 * - fva: Flux Variability Analysis
 * - moma: Minimization of Metabolic Adjustment
 * - gimme: GIMME (LP formulation)
 * - imat: iMAT (true MILP)
 * - eflux: E-Flux
 *
 * @module SolverWorker
 */

import { evaluateGPR as evaluateGPRBoolean, gprToReactionExpression, extractGenesFromGPR } from './GPRExpression.js';

/* =============================================================================
 * NUMERICAL TOLERANCE CONSTANTS
 *
 * These tolerances are chosen based on solver precision capabilities and
 * biological significance. They form a hierarchy from solver-level precision
 * to biological thresholds.
 *
 * References:
 * - Ebrahim et al. (2013) Bioinformatics 29(8):1021-1028
 * - Baba et al. (2006) Mol Syst Biol 2:2006.0008
 * - HiGHS solver documentation
 * ============================================================================= */

/**
 * Solver-level numerical tolerance.
 * HiGHS uses ~1e-9 for primal/dual feasibility.
 * Values below this are indistinguishable from zero at solver precision.
 */
export const SOLVER_TOLERANCE = 1e-9;

/**
 * Objective value comparison tolerance.
 * For comparing FBA objective values between solvers.
 * 1e-6 allows for floating-point accumulation while catching real differences.
 */
export const OBJECTIVE_TOLERANCE = 1e-6;

/**
 * Flux value comparison tolerance.
 * For comparing individual flux values between solutions.
 * 1e-6 is appropriate for fluxes in mmol/gDW/h range.
 */
export const FLUX_TOLERANCE = 1e-6;

/**
 * iMAT activity threshold (epsilon).
 * Minimum absolute flux to consider a reaction "active".
 * 1e-3 mmol/gDW/h is biologically reasonable for most reactions.
 */
export const IMAT_EPSILON = 1e-3;

// HiGHS solver instance
let solver = null;
let solverReady = false;

/**
 * Initialize the HiGHS solver
 */
async function initializeSolver() {
  try {
    // Import HiGHS WASM - handle various module formats (CJS/ESM)
    const highsImport = await import('highs');
    let highsFactory = highsImport;
    if (typeof highsFactory !== 'function') {
      highsFactory = highsImport.default;
    }
    if (typeof highsFactory !== 'function' && highsFactory?.default) {
      highsFactory = highsFactory.default;
    }

    // Pass locateFile to ensure WASM is loaded from public folder
    const highsModule = await highsFactory({
      locateFile: (file) => file.endsWith('.wasm') ? '/highs.wasm' : file
    });

    // Create solver wrapper
    solver = {
      highs: highsModule,

      solve(lpString, options = {}) {
        return highsModule.solve(lpString, options);
      },

      // Build LP format from problem structure
      buildLPFormat(problem) {
        const lines = [];

        // Objective
        lines.push(problem.sense === 'min' ? 'Minimize' : 'Maximize');
        lines.push(' obj: ' + formatExpression(problem.objective));

        // Constraints
        lines.push('Subject To');
        problem.constraints.forEach((c, i) => {
          const name = c.name || `c${i}`;
          const expr = formatExpression(c.lhs);

          if (c.type === 'eq') {
            lines.push(` ${name}: ${expr} = ${c.rhs}`);
          } else if (c.type === 'le') {
            lines.push(` ${name}: ${expr} <= ${c.rhs}`);
          } else if (c.type === 'ge') {
            lines.push(` ${name}: ${expr} >= ${c.rhs}`);
          }
        });

        // Bounds
        lines.push('Bounds');
        problem.variables.forEach(v => {
          const lb = v.lb ?? 0;
          const ub = v.ub ?? 1e10;

          if (lb === -Infinity && ub === Infinity) {
            lines.push(` ${v.name} free`);
          } else if (lb === -Infinity) {
            lines.push(` -inf <= ${v.name} <= ${ub}`);
          } else if (ub === Infinity) {
            lines.push(` ${v.name} >= ${lb}`);
          } else {
            lines.push(` ${lb} <= ${v.name} <= ${ub}`);
          }
        });

        // Binary variables
        const binaries = problem.variables.filter(v => v.type === 'binary');
        if (binaries.length > 0) {
          lines.push('Binary');
          binaries.forEach(v => lines.push(` ${v.name}`));
        }

        // Integer variables
        const integers = problem.variables.filter(v => v.type === 'integer');
        if (integers.length > 0) {
          lines.push('General');
          integers.forEach(v => lines.push(` ${v.name}`));
        }

        lines.push('End');
        return lines.join('\n');
      },
    };

    solverReady = true;
    return true;
  } catch (error) {
    console.error('Failed to initialize HiGHS:', error);
    solverReady = false;
    return false;
  }
}

/**
 * Format linear expression as string
 */
function formatExpression(terms) {
  if (!terms || terms.length === 0) return '0';

  return terms.map((term, i) => {
    const coef = term.coef ?? 1;
    const name = term.name;
    const sign = coef >= 0 ? (i > 0 ? ' + ' : '') : ' - ';
    const absCoef = Math.abs(coef);

    if (absCoef === 0) return '';
    if (absCoef === 1) return `${sign}${name}`;
    return `${sign}${absCoef} ${name}`;
  }).filter(s => s).join('') || '0';
}

/**
 * Build metabolic LP problem
 */
function buildMetabolicProblem(model, constraints = {}, knockouts = []) {
  const reactions = Object.entries(model.reactions || {});
  const metabolites = Object.entries(model.metabolites || {});

  const problem = {
    sense: 'max',
    objective: [],
    constraints: [],
    variables: [],
  };

  const rxnVars = [];

  // Create split variables: v = v_pos - v_neg (for absolute value handling)
  reactions.forEach(([rxnId, rxn]) => {
    rxnVars.push(rxnId);

    let lb = rxn.lower_bound ?? -1000;
    let ub = rxn.upper_bound ?? 1000;

    // Apply constraints
    if (constraints[rxnId]) {
      if (constraints[rxnId].lb !== undefined) lb = constraints[rxnId].lb;
      if (constraints[rxnId].ub !== undefined) ub = constraints[rxnId].ub;
    }

    // Apply knockouts via proper Boolean GPR evaluation
    // Uses recursive descent parser from GPRExpression.js (Orth et al. 2010)
    // For OR (isozyme) logic: knockout of one gene does NOT disable reaction
    // For AND (complex) logic: knockout of any subunit disables reaction
    if (knockouts.length > 0 && (rxn.gpr || rxn.gene_reaction_rule)) {
      const gprString = rxn.gpr || rxn.gene_reaction_rule;
      const knockoutSet = new Set(knockouts.map(g => g.toLowerCase()));
      // Extract genes from GPR and build active gene set (all minus knocked-out)
      const gprGenes = extractGenesFromGPR(gprString);
      const activeGenes = new Set(
        gprGenes.filter(g => !knockoutSet.has(g.toLowerCase()))
      );
      const isActive = evaluateGPRBoolean(gprString, activeGenes);
      if (!isActive) {
        lb = 0;
        ub = 0;
      }
    }

    // v_pos (positive flux)
    problem.variables.push({
      name: `v_${rxnId}_pos`,
      lb: Math.max(0, lb),
      ub: Math.max(0, ub),
      type: 'continuous',
    });

    // v_neg (negative flux)
    problem.variables.push({
      name: `v_${rxnId}_neg`,
      lb: Math.max(0, -ub),
      ub: Math.max(0, -lb),
      type: 'continuous',
    });

    // Objective
    if (rxn.objective_coefficient) {
      problem.objective.push({ name: `v_${rxnId}_pos`, coef: rxn.objective_coefficient });
      problem.objective.push({ name: `v_${rxnId}_neg`, coef: -rxn.objective_coefficient });
    }
  });

  // Default objective: biomass
  if (problem.objective.length === 0) {
    const biomass = reactions.find(([id]) => id.toLowerCase().includes('biomass'));
    if (biomass) {
      problem.objective.push({ name: `v_${biomass[0]}_pos`, coef: 1 });
      problem.objective.push({ name: `v_${biomass[0]}_neg`, coef: -1 });
    }
  }

  // Mass balance: Sv = 0
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
      problem.constraints.push({
        name: `mb_${metId}`,
        lhs: terms,
        type: 'eq',
        rhs: 0,
      });
    }
  });

  return { problem, rxnVars };
}

/**
 * Find objective reaction
 */
function findObjectiveReaction(model) {
  for (const [id, rxn] of Object.entries(model.reactions || {})) {
    if (rxn.objective_coefficient && rxn.objective_coefficient !== 0) {
      return id;
    }
  }
  return Object.keys(model.reactions || {}).find(id => id.toLowerCase().includes('biomass'));
}

/**
 * Evaluate GPR expression to get reaction expression level.
 * Delegates to the canonical recursive descent parser in GPRExpression.js.
 *
 * AND → min (enzyme complex: Liebig's law of the minimum)
 * OR  → max (isozymes: highest expressed dominates)
 *
 * @param {string} gpr - GPR rule string
 * @param {Map|Object} expressionData - Gene expression levels
 * @returns {number} Reaction expression level
 */
function evaluateGPR(gpr, expressionData) {
  if (!gpr || !gpr.trim()) return 1.0;

  // Normalize to Map for GPRExpression.js
  let exprMap;
  if (expressionData instanceof Map) {
    exprMap = expressionData;
  } else {
    exprMap = new Map(Object.entries(expressionData || {}));
  }

  return gprToReactionExpression(gpr, exprMap);
}

/**
 * Default viability threshold as fraction of typical bacterial growth rate.
 * Organisms with growth rate below this threshold are classified as "lethal".
 *
 * Default: 0.001 h⁻¹ (~0.1% of typical E. coli growth of ~0.7 h⁻¹)
 * This is more conservative than the 5% threshold used by Baba et al. (2006)
 * but appropriate for distinguishing numerical zero from true slow growth.
 *
 * Reference: Baba et al. (2006) "Construction of Escherichia coli K-12
 * in-frame, single-gene knockout mutants: the Keio collection"
 * Mol Syst Biol 2:2006.0008
 */
export const DEFAULT_VIABILITY_THRESHOLD = 0.001;

/**
 * Format result to standard output
 *
 * @param {Object} result - Raw solver result
 * @param {Array} rxnVars - Reaction variable names
 * @param {Object} model - Metabolic model
 * @param {string} method - Solving method name
 * @param {Object} options - Optional settings including viabilityThreshold
 */
function formatResult(result, rxnVars, model, method = 'fba', options = {}) {
  if (result.Status !== 'Optimal') {
    return {
      status: result.Status?.toLowerCase() || 'error',
      objectiveValue: 0,
      growthRate: 0,
      fluxes: {},
      method,
      solver: 'highs-wasm',
      phenotype: 'infeasible',
    };
  }

  // Reconstruct fluxes with numerical noise filtering
  const fluxes = {};
  const cols = result.Columns || {};

  rxnVars.forEach(rxnId => {
    const pos = cols[`v_${rxnId}_pos`]?.Primal || 0;
    const neg = cols[`v_${rxnId}_neg`]?.Primal || 0;
    let netFlux = pos - neg;

    // Filter numerical noise: values below SOLVER_TOLERANCE are treated as zero
    // This prevents false directionality from solver precision artifacts
    if (Math.abs(netFlux) < SOLVER_TOLERANCE) {
      netFlux = 0;
    }

    fluxes[rxnId] = netFlux;
  });

  // Growth rate
  let growthRate = 0;
  const objRxn = findObjectiveReaction(model);
  if (objRxn) growthRate = fluxes[objRxn] || 0;

  // Viability classification with configurable threshold
  // Can be overridden via options or model metadata
  const viabilityThreshold = options.viabilityThreshold
    ?? model.viabilityThreshold
    ?? DEFAULT_VIABILITY_THRESHOLD;

  return {
    status: 'optimal',
    objectiveValue: result.ObjectiveValue,
    growthRate,
    fluxes,
    method,
    solver: 'highs-wasm',
    phenotype: growthRate > viabilityThreshold ? 'viable' : 'lethal',
    viabilityThreshold, // Include for transparency
  };
}

/**
 * Solve FBA
 */
async function solveFBA(model, options = {}) {
  const { problem, rxnVars } = buildMetabolicProblem(model, options.constraints, options.knockouts);
  const lpString = solver.buildLPFormat(problem);
  const result = solver.solve(lpString, { log_to_console: false });
  return formatResult(result, rxnVars, model, 'fba', options);
}

/**
 * Solve pFBA (Parsimonious FBA)
 *
 * Two-stage optimization per Lewis et al. (2010) Mol Syst Biol 6:390:
 * 1. Maximize objective (standard FBA)
 * 2. Fix objective at optimal value, minimize total flux
 *
 * @param {Object} model - Metabolic model
 * @param {Object} options - Options including fractionOfOptimum (default 1.0)
 */
async function solvePFBA(model, options = {}) {
  // Stage 1: FBA — get optimal biomass objective
  const fbaResult = await solveFBA(model, options);
  if (fbaResult.status !== 'optimal') return fbaResult;

  // Store biomass objective from Stage 1
  // CRITICAL: Stage 2 minimizes total flux, but we must return biomass
  // as the objective value (matching COBRApy convention)
  const biomassObjective = fbaResult.objectiveValue;

  // Stage 2: Minimize flux with fixed objective
  // fractionOfOptimum defaults to 1.0 per Lewis et al. (2010) and COBRApy standard
  const fractionOfOptimum = options.fractionOfOptimum ?? 1.0;
  const { problem, rxnVars } = buildMetabolicProblem(model, options.constraints, options.knockouts);

  const objRxn = findObjectiveReaction(model);
  if (objRxn) {
    problem.constraints.push({
      name: 'fix_obj',
      lhs: [{ name: `v_${objRxn}_pos`, coef: 1 }, { name: `v_${objRxn}_neg`, coef: -1 }],
      type: 'ge',
      rhs: biomassObjective * fractionOfOptimum,
    });
  }

  // Minimize total flux
  problem.objective = [];
  problem.sense = 'min';
  rxnVars.forEach(id => {
    problem.objective.push({ name: `v_${id}_pos`, coef: 1 });
    problem.objective.push({ name: `v_${id}_neg`, coef: 1 });
  });

  const lpString = solver.buildLPFormat(problem);
  const result = solver.solve(lpString, { log_to_console: false });
  const formatted = formatResult(result, rxnVars, model, 'pfba', options);

  // CRITICAL FIX: Override objectiveValue with biomass from Stage 1
  // result.ObjectiveValue is the minimized total flux, NOT biomass
  formatted.objectiveValue = biomassObjective;
  return formatted;
}

/**
 * Solve linear MOMA (Minimization of Metabolic Adjustment)
 *
 * Finds the flux distribution closest to wild-type after a perturbation.
 * Uses L1-norm linearization: min Σ|v_i - v_wt_i|
 *
 * References:
 * - Segrè et al. (2002) PNAS 99(23):15112-15117
 * - Becker et al. (2007) BMC Syst Biol 1:2 (linear MOMA)
 *
 * @param {Object} model - Metabolic model
 * @param {Object} options - Options including knockouts
 */
async function solveMOMA(model, options = {}) {
  // Step 1: Wild-type FBA (no knockouts)
  const wtOptions = { ...options, knockouts: [] };
  const wtResult = await solveFBA(model, wtOptions);
  if (wtResult.status !== 'optimal') {
    return { ...wtResult, method: 'lmoma' };
  }

  const wtFluxes = wtResult.fluxes;

  // Step 2: Build knockout problem with L1-distance objective
  const { problem, rxnVars } = buildMetabolicProblem(model, options.constraints, options.knockouts);

  problem.objective = [];
  problem.sense = 'min';

  rxnVars.forEach(rxnId => {
    const wtFlux = wtFluxes[rxnId] || 0;
    const dPosName = `d_${rxnId}_pos`;
    const dNegName = `d_${rxnId}_neg`;

    problem.variables.push(
      { name: dPosName, lb: 0, ub: Infinity, type: 'continuous' },
      { name: dNegName, lb: 0, ub: Infinity, type: 'continuous' },
    );

    problem.objective.push(
      { name: dPosName, coef: 1 },
      { name: dNegName, coef: 1 },
    );

    // (v_pos - v_neg) - v_wt = d_pos - d_neg
    problem.constraints.push({
      name: `moma_dev_${rxnId}`,
      lhs: [
        { name: `v_${rxnId}_pos`, coef: 1 },
        { name: `v_${rxnId}_neg`, coef: -1 },
        { name: dPosName, coef: -1 },
        { name: dNegName, coef: 1 },
      ],
      type: 'eq',
      rhs: wtFlux,
    });
  });

  const lpString = solver.buildLPFormat(problem);
  const result = solver.solve(lpString, { log_to_console: false });
  const formatted = formatResult(result, rxnVars, model, 'lmoma', options);
  formatted.wildTypeObjective = wtResult.objectiveValue;
  formatted.totalDeviation = result.ObjectiveValue;
  return formatted;
}

/**
 * Solve FVA (Flux Variability Analysis)
 *
 * Determines flux ranges while maintaining objective above a threshold.
 * Default fractionOfOptimum=0.9 matches COBRApy standard.
 *
 * @param {Object} model - Metabolic model
 * @param {Object} options - Options including fractionOfOptimum (default 0.9)
 */
async function solveFVA(model, options = {}) {
  const fbaResult = await solveFBA(model, options);
  if (fbaResult.status !== 'optimal') {
    return { status: fbaResult.status, ranges: {} };
  }

  // fractionOfOptimum defaults to 0.9 per COBRApy standard for FVA
  const fractionOfOptimum = options.fractionOfOptimum ?? 0.9;
  const requiredObj = fbaResult.objectiveValue * fractionOfOptimum;
  const reactions = options.reactions || Object.keys(model.reactions || {});
  const ranges = {};

  for (let i = 0; i < reactions.length; i++) {
    const rxnId = reactions[i];

    // Progress
    if (options.jobId) {
      self.postMessage({
        jobId: options.jobId,
        type: 'progress',
        progress: (i + 1) / reactions.length,
      });
    }

    const { problem, rxnVars } = buildMetabolicProblem(model, options.constraints, options.knockouts);

    // Constrain objective
    const objRxn = findObjectiveReaction(model);
    if (objRxn) {
      problem.constraints.push({
        name: 'min_obj',
        lhs: [{ name: `v_${objRxn}_pos`, coef: 1 }, { name: `v_${objRxn}_neg`, coef: -1 }],
        type: 'ge',
        rhs: requiredObj,
      });
    }

    // Target reaction objective
    problem.objective = [
      { name: `v_${rxnId}_pos`, coef: 1 },
      { name: `v_${rxnId}_neg`, coef: -1 },
    ];

    // Min
    problem.sense = 'min';
    let lp = solver.buildLPFormat(problem);
    let minRes = solver.solve(lp, { log_to_console: false });

    // Max
    problem.sense = 'max';
    lp = solver.buildLPFormat(problem);
    let maxRes = solver.solve(lp, { log_to_console: false });

    ranges[rxnId] = {
      min: minRes.Status === 'Optimal'
        ? (minRes.Columns[`v_${rxnId}_pos`]?.Primal || 0) - (minRes.Columns[`v_${rxnId}_neg`]?.Primal || 0)
        : -Infinity,
      max: maxRes.Status === 'Optimal'
        ? (maxRes.Columns[`v_${rxnId}_pos`]?.Primal || 0) - (maxRes.Columns[`v_${rxnId}_neg`]?.Primal || 0)
        : Infinity,
    };
  }

  return {
    status: 'optimal',
    objectiveValue: fbaResult.objectiveValue,
    ranges,
    solver: 'highs-wasm',
  };
}

/**
 * Solve iMAT (Integrative Metabolic Analysis Tool) - true MILP
 *
 * Uses binary variables to maximize consistency with gene expression data.
 * Reference: Shlomi et al. (2008) Nature Biotechnology 26:1003-1010
 *
 * @param {Object} model - Metabolic model
 * @param {Object} options - Options including thresholds and expression data
 */
async function solveIMAT(model, options = {}) {
  const highThreshold = options.highThreshold ?? 0.75;
  const lowThreshold = options.lowThreshold ?? 0.25;
  const epsilon = options.epsilon ?? IMAT_EPSILON;

  // Calculate Big-M dynamically from model bounds
  // M should be the smallest valid upper bound on flux magnitude
  // Too small: artificially constrains fluxes
  // Too large: causes numerical ill-conditioning
  // Reference: Williams (2013) "Model Building in Mathematical Programming"
  const maxFluxBound = Math.max(
    ...Object.values(model.reactions || {}).map(rxn =>
      Math.max(
        Math.abs(rxn.lower_bound ?? -1000),
        Math.abs(rxn.upper_bound ?? 1000)
      )
    ),
    1000 // Minimum fallback
  );
  const M = maxFluxBound;

  const expressionData = options.expressionData || {};
  const { problem, rxnVars } = buildMetabolicProblem(model, {}, []);

  // Classify reactions
  const highExpr = [];
  const lowExpr = [];

  rxnVars.forEach(rxnId => {
    const rxn = model.reactions[rxnId];
    if (rxn.gpr || rxn.gene_reaction_rule) {
      const expr = evaluateGPR(rxn.gpr || rxn.gene_reaction_rule, expressionData);
      if (expr >= highThreshold) highExpr.push(rxnId);
      else if (expr <= lowThreshold) lowExpr.push(rxnId);
    }
  });

  // Add binary variables for high-expression (y_h = 1 if active)
  highExpr.forEach(rxnId => {
    problem.variables.push({ name: `y_h_${rxnId}`, lb: 0, ub: 1, type: 'binary' });
    problem.constraints.push({
      name: `imat_h_${rxnId}`,
      lhs: [
        { name: `v_${rxnId}_pos`, coef: 1 },
        { name: `v_${rxnId}_neg`, coef: 1 },
        { name: `y_h_${rxnId}`, coef: -epsilon },
      ],
      type: 'ge',
      rhs: 0,
    });
    problem.objective.push({ name: `y_h_${rxnId}`, coef: 1 });
  });

  // Add binary variables for low-expression (y_l = 1 if inactive)
  lowExpr.forEach(rxnId => {
    problem.variables.push({ name: `y_l_${rxnId}`, lb: 0, ub: 1, type: 'binary' });
    problem.constraints.push({
      name: `imat_l_${rxnId}`,
      lhs: [
        { name: `v_${rxnId}_pos`, coef: 1 },
        { name: `v_${rxnId}_neg`, coef: 1 },
        { name: `y_l_${rxnId}`, coef: M },
      ],
      type: 'le',
      rhs: M,
    });
    problem.objective.push({ name: `y_l_${rxnId}`, coef: 1 });
  });

  problem.sense = 'max';

  const lpString = solver.buildLPFormat(problem);
  const result = solver.solve(lpString, {
    log_to_console: false,
    time_limit: 300,
    mip_rel_gap: 0.05,
  });

  return formatResult(result, rxnVars, model, 'imat', options);
}

/**
 * Solve GIMME
 */
async function solveGIMME(model, options = {}) {
  const threshold = options.threshold ?? 0.25;
  const requiredFraction = options.requiredFraction ?? 0.9;
  const expressionData = options.expressionData || {};

  // Get optimal objective
  const fbaResult = await solveFBA(model, {});
  if (fbaResult.status !== 'optimal') return fbaResult;

  const { problem, rxnVars } = buildMetabolicProblem(model, {}, []);

  // Constrain objective
  const objRxn = findObjectiveReaction(model);
  if (objRxn) {
    problem.constraints.push({
      name: 'min_obj',
      lhs: [{ name: `v_${objRxn}_pos`, coef: 1 }, { name: `v_${objRxn}_neg`, coef: -1 }],
      type: 'ge',
      rhs: fbaResult.objectiveValue * requiredFraction,
    });
  }

  // GIMME objective: minimize penalty for low-expression reactions
  problem.objective = [];
  problem.sense = 'min';

  rxnVars.forEach(rxnId => {
    const rxn = model.reactions[rxnId];
    let expr = 1.0;
    if (rxn.gpr || rxn.gene_reaction_rule) {
      expr = evaluateGPR(rxn.gpr || rxn.gene_reaction_rule, expressionData);
    }
    if (expr < threshold) {
      const penalty = threshold - expr;
      problem.objective.push({ name: `v_${rxnId}_pos`, coef: penalty });
      problem.objective.push({ name: `v_${rxnId}_neg`, coef: penalty });
    }
  });

  const lpString = solver.buildLPFormat(problem);
  const result = solver.solve(lpString, { log_to_console: false });
  return formatResult(result, rxnVars, model, 'gimme', options);
}

/**
 * Solve E-Flux
 */
async function solveEFlux(model, options = {}) {
  const expressionData = options.expressionData || {};
  // minBound prevents zero-flux bounds that could make the problem infeasible
  // Matches OmicsIntegration.js E-Flux implementation (Colijn et al. 2009)
  const minBound = options.minBound ?? 0.01;
  const scaledModel = JSON.parse(JSON.stringify(model));

  Object.entries(scaledModel.reactions).forEach(([rxnId, rxn]) => {
    if (rxn.gpr || rxn.gene_reaction_rule) {
      const expr = evaluateGPR(rxn.gpr || rxn.gene_reaction_rule, expressionData);
      const scalingFactor = Math.max(minBound, Math.min(1.0, expr));
      if (scalingFactor < 1.0) {
        if (rxn.upper_bound > 0) rxn.upper_bound *= scalingFactor;
        if (rxn.lower_bound < 0) rxn.lower_bound *= scalingFactor;
      }
    }
  });

  const result = await solveFBA(scaledModel, options);
  result.method = 'eflux';
  return result;
}

/**
 * Message handler
 */
self.onmessage = async function(event) {
  const { jobId, method, model, options = {} } = event.data;

  if (!solverReady) {
    self.postMessage({
      jobId,
      type: 'error',
      error: 'Solver not initialized',
    });
    return;
  }

  try {
    let result;

    switch (method) {
      case 'fba':
        result = await solveFBA(model, options);
        break;
      case 'pfba':
        result = await solvePFBA(model, options);
        break;
      case 'fva':
        result = await solveFVA(model, { ...options, jobId });
        break;
      case 'imat':
        result = await solveIMAT(model, options);
        break;
      case 'gimme':
        result = await solveGIMME(model, options);
        break;
      case 'eflux':
        result = await solveEFlux(model, options);
        break;
      case 'moma':
        result = await solveMOMA(model, options);
        break;
      default:
        throw new Error(`Unknown method: ${method}`);
    }

    self.postMessage({ jobId, type: 'result', result });
  } catch (error) {
    self.postMessage({ jobId, type: 'error', error: error.message });
  }
};

// Initialize and signal ready
initializeSolver().then(success => {
  self.postMessage({
    type: 'ready',
    solverReady: success,
    solver: 'highs-wasm',
    capabilities: success ? ['LP', 'MILP'] : [],
  });
});
