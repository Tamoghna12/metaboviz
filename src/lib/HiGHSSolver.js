/**
 * HiGHSSolver - High-Performance LP/MILP Solver for Browser
 *
 * Wrapper around HiGHS WASM for solving:
 * - Linear Programs (LP) - FBA, pFBA, E-Flux
 * - Mixed-Integer Linear Programs (MILP) - iMAT, GIMME (true formulation)
 *
 * HiGHS is currently the world's best open-source LP/MILP solver:
 * - Developed at University of Edinburgh
 * - Used by Google OR-Tools, SciPy, and Julia
 * - Outperforms GLPK by 10-100x on large problems
 *
 * Reference:
 * - Huangfu & Hall (2018) "Parallelizing the dual revised simplex method"
 *   Mathematical Programming Computation
 *
 * @module HiGHSSolver
 */

import {
  findObjectiveReaction as findObjRxn,
  evaluateGPRQuantitative,
  buildSplitVarProblem,
  formatSplitResult as formatSplitResultShared,
  SOLVER_TOLERANCE,
  DEFAULT_VIABILITY_THRESHOLD,
} from './MetabolicLP.js';

// Solver status codes
export const SolverStatus = {
  OPTIMAL: 'optimal',
  INFEASIBLE: 'infeasible',
  UNBOUNDED: 'unbounded',
  ERROR: 'error',
  TIMEOUT: 'timeout',
};

// HiGHS status mapping
const HIGHS_STATUS_MAP = {
  'Optimal': SolverStatus.OPTIMAL,
  'Infeasible': SolverStatus.INFEASIBLE,
  'Unbounded': SolverStatus.UNBOUNDED,
  'Error': SolverStatus.ERROR,
};

/**
 * HiGHS Solver class
 */
class HiGHSSolverClass {
  constructor() {
    this.highs = null;
    this.initialized = false;
    this.initPromise = null;
  }

  /**
   * Initialize the HiGHS WASM module
   */
  async initialize() {
    if (this.initialized) return this;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
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
        this.highs = await highsFactory({
          locateFile: (file) => file.endsWith('.wasm') ? '/highs.wasm' : file
        });
        this.initialized = true;
        console.log('HiGHS WASM initialized successfully');
        return this;
      } catch (error) {
        console.error('Failed to initialize HiGHS:', error);
        // Clear cached promise so subsequent attempts can retry
        this.initPromise = null;
        throw new Error(`HiGHS initialization failed: ${error.message}`);
      }
    })();

    return this.initPromise;
  }

  /**
   * Build LP/MILP problem in CPLEX LP format
   *
   * @param {Object} problem - Problem definition
   * @returns {string} CPLEX LP format string
   */
  buildLPFormat(problem) {
    const lines = [];

    // Objective
    lines.push(problem.sense === 'min' ? 'Minimize' : 'Maximize');
    lines.push(' obj: ' + this.formatExpression(problem.objective));

    // Constraints
    lines.push('Subject To');
    problem.constraints.forEach((constraint, i) => {
      const name = constraint.name || `c${i}`;
      const expr = this.formatExpression(constraint.lhs);

      if (constraint.type === 'eq') {
        lines.push(` ${name}: ${expr} = ${constraint.rhs}`);
      } else if (constraint.type === 'le') {
        lines.push(` ${name}: ${expr} <= ${constraint.rhs}`);
      } else if (constraint.type === 'ge') {
        lines.push(` ${name}: ${expr} >= ${constraint.rhs}`);
      } else if (constraint.type === 'range') {
        lines.push(` ${name}: ${constraint.lb} <= ${expr} <= ${constraint.ub}`);
      }
    });

    // Bounds
    lines.push('Bounds');
    problem.variables.forEach(v => {
      const lb = v.lb ?? 0;
      const ub = v.ub ?? Infinity;

      if (lb === -Infinity && ub === Infinity) {
        lines.push(` ${v.name} free`);
      } else if (lb === -Infinity) {
        lines.push(` -inf <= ${v.name} <= ${ub}`);
      } else if (ub === Infinity) {
        lines.push(` ${v.name} >= ${lb}`);
      } else if (lb === ub) {
        lines.push(` ${v.name} = ${lb}`);
      } else {
        lines.push(` ${lb} <= ${v.name} <= ${ub}`);
      }
    });

    // Integer/Binary variables
    const binaries = problem.variables.filter(v => v.type === 'binary');
    const integers = problem.variables.filter(v => v.type === 'integer');

    if (binaries.length > 0) {
      lines.push('Binary');
      binaries.forEach(v => lines.push(` ${v.name}`));
    }

    if (integers.length > 0) {
      lines.push('General');
      integers.forEach(v => lines.push(` ${v.name}`));
    }

    lines.push('End');

    return lines.join('\n');
  }

  /**
   * Format a linear expression as string
   */
  formatExpression(terms) {
    if (!terms || terms.length === 0) return '0';

    return terms.map((term, i) => {
      const coef = term.coef ?? term.coefficient ?? 1;
      const name = term.name ?? term.variable;
      const sign = coef >= 0 ? (i > 0 ? ' + ' : '') : ' - ';
      const absCoef = Math.abs(coef);

      if (absCoef === 1) {
        return `${sign}${name}`;
      } else {
        return `${sign}${absCoef} ${name}`;
      }
    }).join('');
  }

  /**
   * Solve an LP/MILP problem
   *
   * @param {Object} problem - Problem definition
   * @param {Object} options - Solver options
   * @returns {Object} Solution object
   */
  async solve(problem, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = performance.now();

    try {
      // Build LP format string
      const lpString = this.buildLPFormat(problem);

      // Set solver options
      const solverOptions = {
        time_limit: options.timeLimit ?? 300, // 5 minutes default
        mip_rel_gap: options.mipGap ?? 0.01,  // 1% gap tolerance
        threads: options.threads ?? 0,         // 0 = auto
        log_to_console: options.verbose ?? false,
      };

      // Solve
      const result = this.highs.solve(lpString, solverOptions);

      const solveTime = (performance.now() - startTime) / 1000;

      // Parse result
      const status = HIGHS_STATUS_MAP[result.Status] || SolverStatus.ERROR;

      if (status !== SolverStatus.OPTIMAL) {
        return {
          status,
          objectiveValue: null,
          variables: {},
          solveTime,
          solver: 'highs-wasm',
        };
      }

      // Extract variable values
      const variables = {};
      const columns = result.Columns || {};
      Object.entries(columns).forEach(([name, data]) => {
        variables[name] = data.Primal ?? 0;
      });

      return {
        status: SolverStatus.OPTIMAL,
        objectiveValue: result.ObjectiveValue,
        variables,
        solveTime,
        solver: 'highs-wasm',
        iterations: result.SimplexIterations,
        nodes: result.MipNodes,
      };
    } catch (error) {
      console.error('HiGHS solve error:', error);
      return {
        status: SolverStatus.ERROR,
        error: error.message,
        solveTime: (performance.now() - startTime) / 1000,
        solver: 'highs-wasm',
      };
    }
  }

  /**
   * Build and solve FBA problem
   */
  async solveFBA(model, constraints = {}, knockouts = []) {
    const { problem, rxnVars } = this.buildMetabolicProblem(model, constraints, knockouts);

    const result = await this.solve(problem);

    return this.formatFBAResult(result, rxnVars, model);
  }

  /**
   * Build and solve pFBA problem (two-stage)
   *
   * CRITICAL FIX (Bug #1):
   * Stage 2 minimizes sum of |v_i| (total flux), but we must return
   * the BIOMASS objective value, NOT the minimized total flux.
   *
   * COBRApy's pfba returns the biomass as objective_value, not total flux.
   * This was causing |Δobj| = 0.0363 because we were comparing 518 (total flux)
   * vs 0.87 (biomass).
   *
   * @param {Object} model - Metabolic model
   * @param {Object} constraints - Additional flux constraints
   * @param {Array} knockouts - Gene knockouts
   * @returns {Object} pFBA result with correct biomass objective value
   */
  async solvePFBA(model, constraints = {}, knockouts = [], options = {}) {
    // Stage 1: Standard FBA to get optimal biomass
    const fbaResult = await this.solveFBA(model, constraints, knockouts);

    if (fbaResult.status !== SolverStatus.OPTIMAL) {
      return fbaResult;
    }

    // Store the biomass objective value from Stage 1
    // This is what we MUST return, NOT the minimized total flux from Stage 2
    const biomassObjective = fbaResult.objectiveValue;

    // fractionOfOptimum defaults to 1.0 per Lewis et al. (2010) and COBRApy standard
    const fractionOfOptimum = options.fractionOfOptimum ?? 1.0;

    // Stage 2: Minimize total flux with fixed objective
    const { problem, rxnVars } = this.buildMetabolicProblem(model, constraints, knockouts);

    // Find and fix objective
    const objRxn = this.findObjectiveReaction(model);
    if (objRxn) {
      problem.constraints.push({
        name: 'fix_objective',
        lhs: [{ name: `v_${objRxn}_pos`, coef: 1 }, { name: `v_${objRxn}_neg`, coef: -1 }],
        type: 'ge',
        rhs: biomassObjective * fractionOfOptimum,
      });
    }

    // Change objective to minimize sum of absolute fluxes
    problem.objective = [];
    problem.sense = 'min';

    rxnVars.forEach(rxnId => {
      problem.objective.push({ name: `v_${rxnId}_pos`, coef: 1 });
      problem.objective.push({ name: `v_${rxnId}_neg`, coef: 1 });
    });

    const result = await this.solve(problem);

    // CRITICAL: Pass biomassObjective to formatFBAResult so it returns
    // the correct objective value (biomass, not total flux)
    return this.formatFBAResult(result, rxnVars, model, 'pfba', biomassObjective);
  }

  /**
   * Build and solve FVA problem
   *
   * CRITICAL FIX (Bug #2):
   * Ensure objective constraint is correctly applied and flux extraction
   * properly computes v = v_pos - v_neg.
   *
   * @param {Object} model - Metabolic model
   * @param {Object} constraints - Additional flux constraints
   * @param {Array} knockouts - Gene knockouts
   * @param {Object} options - FVA options
   * @returns {Object} FVA result with flux ranges
   */
  async solveFVA(model, constraints = {}, knockouts = [], options = {}) {
    const fractionOfOptimum = options.fractionOfOptimum ?? 0.9;
    const reactions = options.reactions || Object.keys(model.reactions || {});

    // First solve FBA to get optimal objective
    const fbaResult = await this.solveFBA(model, constraints, knockouts);

    if (fbaResult.status !== SolverStatus.OPTIMAL) {
      return { status: fbaResult.status, ranges: {} };
    }

    const requiredObj = fbaResult.objectiveValue * fractionOfOptimum;
    const ranges = {};

    // Find objective reaction ONCE for efficiency and correctness
    const objRxn = this.findObjectiveReaction(model);

    // For each reaction, find min and max
    for (let i = 0; i < reactions.length; i++) {
      const rxnId = reactions[i];

      // Report progress
      if (options.onProgress) {
        options.onProgress((i + 1) / reactions.length);
      }

      // Build problem with objective constraint
      const { problem, rxnVars } = this.buildMetabolicProblem(model, constraints, knockouts);

      // CRITICAL: Add objective constraint to maintain minimum biomass
      // This ensures we're finding flux ranges at optimal (or near-optimal) growth
      if (objRxn) {
        problem.constraints.push({
          name: 'min_objective',
          lhs: [
            { name: `v_${objRxn}_pos`, coef: 1 },
            { name: `v_${objRxn}_neg`, coef: -1 }
          ],
          type: 'ge',
          rhs: requiredObj,
        });
      }

      // Set objective to target reaction: maximize/minimize v_rxn = v_pos - v_neg
      problem.objective = [
        { name: `v_${rxnId}_pos`, coef: 1 },
        { name: `v_${rxnId}_neg`, coef: -1 },
      ];

      // Minimize flux through this reaction
      problem.sense = 'min';
      const minResult = await this.solve(problem);

      // Maximize flux through this reaction
      problem.sense = 'max';
      const maxResult = await this.solve(problem);

      // CRITICAL: Correctly extract flux as v_pos - v_neg
      // The L2 norm issue (2.2M for iJR904) suggests fluxes were being
      // extracted incorrectly. This ensures proper flux calculation.
      ranges[rxnId] = {
        min: minResult.status === SolverStatus.OPTIMAL
          ? this.extractFlux(minResult.variables, rxnId)
          : -Infinity,
        max: maxResult.status === SolverStatus.OPTIMAL
          ? this.extractFlux(maxResult.variables, rxnId)
          : Infinity,
      };
    }

    return {
      status: SolverStatus.OPTIMAL,
      objectiveValue: fbaResult.objectiveValue,
      ranges,
      solver: 'highs-wasm',
    };
  }

  /**
   * Extract flux value from split variables
   *
   * Helper to ensure consistent flux extraction: v = v_pos - v_neg
   *
   * @param {Object} variables - Variable values from solver
   * @param {string} rxnId - Reaction ID
   * @returns {number} Flux value
   */
  extractFlux(variables, rxnId) {
    const pos = variables[`v_${rxnId}_pos`] || 0;
    const neg = variables[`v_${rxnId}_neg`] || 0;
    return pos - neg;
  }

  /**
   * Solve iMAT using true MILP formulation
   *
   * Reference: Shlomi et al. (2008) Nat Biotechnol
   */
  async solveIMAT(model, expressionData, options = {}) {
    const highThreshold = options.highThreshold ?? 0.75;
    const lowThreshold = options.lowThreshold ?? 0.25;
    const epsilon = options.epsilon ?? 1e-3;
    const M = options.bigM ?? 1000;

    const { problem, rxnVars } = this.buildMetabolicProblem(model, {}, []);

    // Classify reactions by expression
    const highExprRxns = [];
    const lowExprRxns = [];

    rxnVars.forEach(rxnId => {
      const rxn = model.reactions[rxnId];
      if (rxn.gpr || rxn.gene_reaction_rule) {
        const expr = this.evaluateGPR(rxn.gpr || rxn.gene_reaction_rule, expressionData);
        if (expr >= highThreshold) {
          highExprRxns.push(rxnId);
        } else if (expr <= lowThreshold) {
          lowExprRxns.push(rxnId);
        }
      }
    });

    // Add binary variables for high-expression reactions
    // y_h = 1 if reaction is active (|v| >= epsilon)
    highExprRxns.forEach(rxnId => {
      const yName = `y_h_${rxnId}`;

      problem.variables.push({
        name: yName,
        lb: 0,
        ub: 1,
        type: 'binary',
      });

      // v_pos + v_neg >= epsilon * y_h
      problem.constraints.push({
        name: `imat_high_${rxnId}`,
        lhs: [
          { name: `v_${rxnId}_pos`, coef: 1 },
          { name: `v_${rxnId}_neg`, coef: 1 },
          { name: yName, coef: -epsilon },
        ],
        type: 'ge',
        rhs: 0,
      });

      // Add to objective (maximize y_h)
      problem.objective.push({ name: yName, coef: 1 });
    });

    // Add binary variables for low-expression reactions
    // y_l = 1 if reaction is inactive (|v| <= epsilon)
    lowExprRxns.forEach(rxnId => {
      const yName = `y_l_${rxnId}`;

      problem.variables.push({
        name: yName,
        lb: 0,
        ub: 1,
        type: 'binary',
      });

      // v_pos + v_neg <= M * (1 - y_l) => v_pos + v_neg + M*y_l <= M
      problem.constraints.push({
        name: `imat_low_${rxnId}`,
        lhs: [
          { name: `v_${rxnId}_pos`, coef: 1 },
          { name: `v_${rxnId}_neg`, coef: 1 },
          { name: yName, coef: M },
        ],
        type: 'le',
        rhs: M,
      });

      // Add to objective (maximize y_l)
      problem.objective.push({ name: yName, coef: 1 });
    });

    // Set objective to maximize consistency
    problem.sense = 'max';

    const result = await this.solve(problem, { timeLimit: 300, mipGap: 0.05 });

    return this.formatFBAResult(result, rxnVars, model, 'imat');
  }

  /**
   * Solve linear MOMA (Minimization of Metabolic Adjustment)
   *
   * Finds the flux distribution closest to wild-type after a perturbation
   * (e.g., gene knockout). Uses the L1-norm (Manhattan distance) linearization:
   *   min Σ|v_i - v_wt_i|
   * instead of the original QP formulation (Segrè et al. 2002):
   *   min Σ(v_i - v_wt_i)²
   *
   * The L1 linearization is exact for LP solvers and produces biologically
   * similar results to QP MOMA (Becker et al. 2007).
   *
   * References:
   * - Segrè et al. (2002) PNAS 99(23):15112-15117
   * - Becker et al. (2007) BMC Syst Biol 1:2 (linear MOMA)
   *
   * @param {Object} model - Metabolic model
   * @param {Object} constraints - Additional flux constraints
   * @param {Array} knockouts - Gene knockouts
   * @param {Object} options - MOMA options
   * @returns {Object} MOMA result with fluxes closest to wild-type
   */
  async solveMOMA(model, constraints = {}, knockouts = [], options = {}) {
    // Step 1: Get wild-type flux distribution (no knockouts)
    const wtResult = await this.solveFBA(model, constraints, []);

    if (wtResult.status !== SolverStatus.OPTIMAL) {
      return {
        status: wtResult.status,
        error: 'Wild-type FBA failed',
        objectiveValue: 0,
        fluxes: {},
        method: 'lmoma',
        solver: 'highs-wasm',
      };
    }

    const wtFluxes = wtResult.fluxes;

    // Step 2: Build knockout problem with L1-distance objective
    const { problem, rxnVars } = this.buildMetabolicProblem(model, constraints, knockouts);

    // Replace objective: minimize Σ|v_i - v_wt_i|
    // Linearize using: |v - v_wt| = d_pos + d_neg where v - v_wt = d_pos - d_neg
    problem.objective = [];
    problem.sense = 'min';

    rxnVars.forEach(rxnId => {
      const wtFlux = wtFluxes[rxnId] || 0;

      // Add deviation variables d_pos, d_neg >= 0
      const dPosName = `d_${rxnId}_pos`;
      const dNegName = `d_${rxnId}_neg`;

      problem.variables.push(
        { name: dPosName, lb: 0, ub: Infinity, type: 'continuous' },
        { name: dNegName, lb: 0, ub: Infinity, type: 'continuous' },
      );

      // Objective: minimize d_pos + d_neg (= |v - v_wt|)
      problem.objective.push(
        { name: dPosName, coef: 1 },
        { name: dNegName, coef: 1 },
      );

      // Constraint: (v_pos - v_neg) - v_wt = d_pos - d_neg
      // Rearranged: v_pos - v_neg - d_pos + d_neg = v_wt
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

    const result = await this.solve(problem);

    const formatted = this.formatFBAResult(result, rxnVars, model, 'lmoma');

    // Add MOMA-specific metadata
    formatted.wildTypeObjective = wtResult.objectiveValue;
    formatted.totalDeviation = result.objectiveValue; // L1 distance
    formatted.method = 'lmoma';

    return formatted;
  }

  /**
   * Solve GIMME using LP formulation
   *
   * Reference: Becker & Palsson (2008) PLoS Comput Biol
   */
  async solveGIMME(model, expressionData, options = {}) {
    const threshold = options.threshold ?? 0.25;
    const requiredFraction = options.requiredFraction ?? 0.9;

    // First, get optimal objective value
    const fbaResult = await this.solveFBA(model, {}, []);

    if (fbaResult.status !== SolverStatus.OPTIMAL) {
      return fbaResult;
    }

    const requiredObj = fbaResult.objectiveValue * requiredFraction;

    // Build GIMME problem
    const { problem, rxnVars } = this.buildMetabolicProblem(model, {}, []);

    // Add objective constraint
    const objRxn = this.findObjectiveReaction(model);
    if (objRxn) {
      problem.constraints.push({
        name: 'min_objective',
        lhs: [{ name: `v_${objRxn}_pos`, coef: 1 }, { name: `v_${objRxn}_neg`, coef: -1 }],
        type: 'ge',
        rhs: requiredObj,
      });
    }

    // Build GIMME objective: minimize sum((threshold - expr_i) * |v_i|) for low-expression
    problem.objective = [];
    problem.sense = 'min';

    rxnVars.forEach(rxnId => {
      const rxn = model.reactions[rxnId];
      let expr = 1.0;

      if (rxn.gpr || rxn.gene_reaction_rule) {
        expr = this.evaluateGPR(rxn.gpr || rxn.gene_reaction_rule, expressionData);
      }

      if (expr < threshold) {
        const penalty = threshold - expr;
        problem.objective.push({ name: `v_${rxnId}_pos`, coef: penalty });
        problem.objective.push({ name: `v_${rxnId}_neg`, coef: penalty });
      }
    });

    const result = await this.solve(problem);

    return this.formatFBAResult(result, rxnVars, model, 'gimme');
  }

  /**
   * Solve E-Flux (expression-based flux bounds)
   *
   * Reference: Colijn et al. (2009) Mol Syst Biol
   */
  async solveEFlux(model, expressionData, options = {}) {
    // Scale bounds by expression and solve FBA
    // minBound prevents zero-flux bounds that could make the problem infeasible
    // Matches OmicsIntegration.js E-Flux implementation (Colijn et al. 2009)
    const minBound = options.minBound ?? 0.01;
    const scaledModel = JSON.parse(JSON.stringify(model));

    Object.entries(scaledModel.reactions).forEach(([rxnId, rxn]) => {
      if (rxn.gpr || rxn.gene_reaction_rule) {
        const expr = this.evaluateGPR(rxn.gpr || rxn.gene_reaction_rule, expressionData);
        const scalingFactor = Math.max(minBound, Math.min(1.0, expr));
        if (scalingFactor < 1.0) {
          if (rxn.upper_bound > 0) {
            rxn.upper_bound *= scalingFactor;
          }
          if (rxn.lower_bound < 0) {
            rxn.lower_bound *= scalingFactor;
          }
        }
      }
    });

    const result = await this.solveFBA(scaledModel, {}, []);
    result.method = 'eflux';
    return result;
  }

  /** Delegates to MetabolicLP.buildSplitVarProblem (shared with SolverWorker) */
  buildMetabolicProblem(model, constraints = {}, knockouts = []) {
    return buildSplitVarProblem(model, constraints, knockouts);
  }

  /** Delegates to MetabolicLP.findObjectiveReaction */
  findObjectiveReaction(model) {
    return findObjRxn(model);
  }

  /**
   * Quantitative GPR evaluation for omics integration.
   * AND → min (Liebig's law), OR → max (isozyme dominance).
   * Delegates to MetabolicLP.evaluateGPRQuantitative.
   */
  evaluateGPR(gpr, expressionData) {
    return evaluateGPRQuantitative(gpr, expressionData);
  }

  /**
   * Format solver result to standard FBA output
   *
   * CRITICAL FIX (Bug #1):
   * For pFBA, the result.objectiveValue is the MINIMIZED total flux,
   * NOT the biomass. We must use the provided biomassObjective parameter
   * or compute it from the fluxes.
   *
   * @param {Object} result - Raw solver result
   * @param {Array} rxnVars - Reaction variable names
   * @param {Object} model - Metabolic model
   * @param {string} method - Method name ('fba', 'pfba', 'imat', 'gimme')
   * @param {number} biomassObjective - Optional pre-computed biomass value (for pFBA)
   * @returns {Object} Formatted FBA result
   */
  formatFBAResult(result, rxnVars, model, method = 'fba', biomassObjective = null) {
    if (result.status !== SolverStatus.OPTIMAL) {
      return {
        status: result.status,
        error: result.error,
        objectiveValue: 0,
        growthRate: 0,
        fluxes: {},
        method,
        solver: 'highs-wasm',
        phenotype: 'infeasible',
      };
    }

    // Reconstruct fluxes from split variables: v = v_pos - v_neg
    const fluxes = {};
    rxnVars.forEach(rxnId => {
      const pos = result.variables[`v_${rxnId}_pos`] || 0;
      const neg = result.variables[`v_${rxnId}_neg`] || 0;
      fluxes[rxnId] = pos - neg;
    });

    // Find growth rate from biomass reaction flux
    let growthRate = 0;
    const objRxn = this.findObjectiveReaction(model);
    if (objRxn && fluxes[objRxn] !== undefined) {
      growthRate = fluxes[objRxn];
    }

    // CRITICAL: Determine correct objective value
    // - For standard FBA: use result.objectiveValue (correct)
    // - For pFBA: use biomassObjective parameter or growthRate
    //   (result.objectiveValue is minimized total flux, NOT biomass!)
    let objectiveValue;
    if (method === 'pfba') {
      // For pFBA, COBRApy returns the biomass as objective_value
      // Use provided biomassObjective, or fall back to growthRate
      objectiveValue = biomassObjective !== null ? biomassObjective : growthRate;
    } else {
      // For FBA, iMAT, GIMME: result.objectiveValue is correct
      objectiveValue = result.objectiveValue;
    }

    return {
      status: SolverStatus.OPTIMAL,
      objectiveValue,
      growthRate,
      fluxes,
      method,
      solver: 'highs-wasm',
      solveTime: result.solveTime,
      phenotype: growthRate > 0.01 ? 'viable' : 'lethal',
      iterations: result.iterations,
      mipNodes: result.nodes,
    };
  }

  /**
   * Get solver information
   */
  getInfo() {
    return {
      name: 'HiGHS',
      version: 'WASM',
      capabilities: ['LP', 'MILP'],
      initialized: this.initialized,
    };
  }
}

// Export singleton instance
export const highsSolver = new HiGHSSolverClass();

// Export class for testing
export { HiGHSSolverClass };

export default highsSolver;
