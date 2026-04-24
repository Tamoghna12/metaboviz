/**
 * SolverWorker - Web Worker for Background LP/MILP Solving
 *
 * Runs HiGHS WASM solver in a background thread to prevent blocking the UI.
 * Imports shared LP utilities from MetabolicLP.js — single source of truth.
 *
 * Message Protocol:
 *   Input:  { jobId, method, model, options }
 *   Output: { jobId, type: 'result'|'progress'|'error', result?, error?, progress? }
 *
 * Supported methods: fba, pfba, fva, moma, imat, gimme, eflux
 *
 * @module SolverWorker
 */

import {
  SOLVER_TOLERANCE,
  DEFAULT_VIABILITY_THRESHOLD,
  IMAT_EPSILON,
  findObjectiveReaction,
  evaluateGPRQuantitative,
  buildLPFormat,
  buildDirectFBAProblem,
  buildSplitVarProblem,
  formatDirectResult,
  formatSplitResult,
} from './MetabolicLP.js';

export { SOLVER_TOLERANCE, DEFAULT_VIABILITY_THRESHOLD };

// ── HiGHS initialization ──────────────────────────────────────────────────────

let solver = null;
let solverReady = false;

async function initializeSolver() {
  try {
    const highsImport = await import('highs');
    let highsFactory = highsImport;
    if (typeof highsFactory !== 'function') highsFactory = highsImport.default;
    if (typeof highsFactory !== 'function' && highsFactory?.default) highsFactory = highsFactory.default;

    const highsModule = await highsFactory({
      locateFile: file => (file.endsWith('.wasm') ? '/highs.wasm' : file),
    });

    solver = {
      solve(lpString, options = {}) {
        // Note: do NOT pass log_to_console: false — HiGHS routes writeSolution()
        // output through the same stdout handler (g.print → q[]). Suppressing it
        // empties q before fc() parses the solution, causing "Too few lines" for
        // every model regardless of feasibility.
        const opts = { ...options };
        delete opts.log_to_console;

        try {
          return highsModule.solve(lpString, opts);
        } catch (err) {
          // fc() throws when q.length < 3, which happens for genuinely
          // Infeasible/Unbounded results where writeSolution writes no column data.
          if (err.message?.includes('Too few lines') || err.message?.includes('parse solution')) {
            return { Status: 'Infeasible', Columns: {}, Rows: [], ObjectiveValue: NaN };
          }
          throw err;
        }
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

// ── Solver functions ──────────────────────────────────────────────────────────

/**
 * Standard FBA using direct variables (n variables, not 2n).
 *
 * Supports options.objective to override the objective reaction at call time,
 * avoiding a full model clone when sweeping objectives (e.g., for FVA setup).
 */
async function solveFBA(model, options = {}) {
  const knockouts = options.knockouts || [];
  const { problem, rxnVars } = buildDirectFBAProblem(
    model,
    options.constraints || {},
    knockouts,
    options.objective || null,
  );

  const lp = buildLPFormat(problem);
  const raw = solver.solve(lp, {});
  return formatDirectResult(raw, rxnVars, model, 'fba', options);
}

/**
 * Parsimonious FBA — two-stage per Lewis et al. (2010) Mol Syst Biol 6:390.
 *
 * Stage 1: standard FBA → get optimal biomass.
 * Stage 2: fix biomass ≥ fraction * optimal, minimize Σ(v_pos + v_neg).
 * Uses split variables in Stage 2 because |v| appears in the objective.
 * Returns Stage 1 biomass as objectiveValue (matching COBRApy convention).
 */
async function solvePFBA(model, options = {}) {
  const fbaResult = await solveFBA(model, options);
  if (fbaResult.status !== 'optimal') return { ...fbaResult, method: 'pfba' };

  const biomassObjective = fbaResult.objectiveValue;
  const fractionOfOptimum = options.fractionOfOptimum ?? 1.0;

  const knockouts = options.knockouts || [];
  const { problem, rxnVars } = buildSplitVarProblem(
    model,
    options.constraints || {},
    knockouts,
  );

  // Use the same objective that Stage 1 used — not re-detected from model
  const objRxn = options.objective ?? findObjectiveReaction(model);
  if (objRxn) {
    problem.constraints.push({
      name: 'fix_obj',
      lhs: [
        { name: `v_${objRxn}_pos`, coef: 1 },
        { name: `v_${objRxn}_neg`, coef: -1 },
      ],
      type: 'ge',
      rhs: biomassObjective * fractionOfOptimum,
    });
  }

  problem.objective = [];
  problem.sense = 'min';
  rxnVars.forEach(id => {
    problem.objective.push({ name: `v_${id}_pos`, coef: 1 });
    problem.objective.push({ name: `v_${id}_neg`, coef: 1 });
  });

  const lp = buildLPFormat(problem);
  const raw = solver.solve(lp, {});
  return formatSplitResult(raw, rxnVars, model, 'pfba', options, biomassObjective);
}

/**
 * Flux Variability Analysis.
 *
 * Performance fix: pre-builds the LP problem ONCE outside the loop.
 * All 2n solves share the same constraint structure — only the objective
 * changes per iteration. Avoids O(n) JS-side constraint reconstructions.
 *
 * Note: true warm-starting (basis reuse across LP solves) is not available
 * in the HiGHS WASM LP-string API. Each solve starts from scratch.
 * Reference: Mahadevan & Schilling (2003) Metab Eng 5(4):264-276.
 */
async function solveFVA(model, options = {}) {
  const fbaResult = await solveFBA(model, options);
  if (fbaResult.status !== 'optimal') return { status: fbaResult.status, ranges: {} };

  const fractionOfOptimum = options.fractionOfOptimum ?? 0.9;
  const requiredObj = fbaResult.objectiveValue * fractionOfOptimum;
  const reactions = options.reactions || Object.keys(model.reactions || {});
  const knockouts = options.knockouts || [];

  // Use the same objective that the initial FBA used — not re-detected from model
  const objRxn = options.objective ?? findObjectiveReaction(model);

  // Pre-build the problem ONCE — avoids O(n) constraint reconstructions
  const { problem, rxnVars } = buildDirectFBAProblem(
    model,
    options.constraints || {},
    knockouts,
  );

  if (objRxn && requiredObj > 0) {
    problem.constraints.push({
      name: 'min_obj',
      lhs: [{ name: `v_${objRxn}`, coef: 1 }],
      type: 'ge',
      rhs: requiredObj,
    });
  }

  const ranges = {};

  for (let i = 0; i < reactions.length; i++) {
    const rxnId = reactions[i];

    if (options.jobId) {
      self.postMessage({
        jobId: options.jobId,
        type: 'progress',
        progress: (i + 1) / reactions.length,
      });
    }

    // Swap objective only — constraints are shared across all iterations
    problem.objective = [{ name: `v_${rxnId}`, coef: 1 }];

    problem.sense = 'min';
    const minRaw = solver.solve(buildLPFormat(problem), {});

    problem.sense = 'max';
    const maxRaw = solver.solve(buildLPFormat(problem), {});

    const getFlux = raw => {
      if (raw.Status !== 'Optimal') return null;
      const v = raw.Columns?.[`v_${rxnId}`]?.Primal ?? 0;
      return Math.abs(v) < SOLVER_TOLERANCE ? 0 : v;
    };

    const minFlux = getFlux(minRaw);
    const maxFlux = getFlux(maxRaw);
    ranges[rxnId] = {
      min: minFlux !== null ? minFlux : -Infinity,
      max: maxFlux !== null ? maxFlux : Infinity,
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
 * Linear MOMA — minimize L1 distance from wild-type flux distribution.
 *
 * Uses deviation variables d_pos, d_neg with |v - v_wt| = d_pos + d_neg.
 * References:
 *   Segrè et al. (2002) PNAS 99(23):15112-15117
 *   Becker et al. (2007) BMC Syst Biol 1:2 (linear MOMA)
 */
async function solveMOMA(model, options = {}) {
  const wtResult = await solveFBA(model, { ...options, knockouts: [] });
  if (wtResult.status !== 'optimal') return { ...wtResult, method: 'lmoma' };

  const wtFluxes = wtResult.fluxes;
  const knockouts = options.knockouts || [];
  const { problem, rxnVars } = buildSplitVarProblem(
    model,
    options.constraints || {},
    knockouts,
  );

  problem.objective = [];
  problem.sense = 'min';

  rxnVars.forEach(rxnId => {
    const wtFlux = wtFluxes[rxnId] || 0;
    const dPos = `d_${rxnId}_pos`;
    const dNeg = `d_${rxnId}_neg`;

    problem.variables.push(
      { name: dPos, lb: 0, ub: Infinity, type: 'continuous' },
      { name: dNeg, lb: 0, ub: Infinity, type: 'continuous' },
    );
    problem.objective.push({ name: dPos, coef: 1 }, { name: dNeg, coef: 1 });

    // (v_pos - v_neg) - v_wt = d_pos - d_neg
    problem.constraints.push({
      name: `moma_dev_${rxnId}`,
      lhs: [
        { name: `v_${rxnId}_pos`, coef: 1 },
        { name: `v_${rxnId}_neg`, coef: -1 },
        { name: dPos, coef: -1 },
        { name: dNeg, coef: 1 },
      ],
      type: 'eq',
      rhs: wtFlux,
    });
  });

  const lp = buildLPFormat(problem);
  const raw = solver.solve(lp, {});
  const result = formatSplitResult(raw, rxnVars, model, 'lmoma', options);
  result.wildTypeObjective = wtResult.objectiveValue;
  result.totalDeviation = raw.ObjectiveValue;
  return result;
}

/**
 * iMAT (Integrative Metabolic Analysis Tool) — true MILP.
 *
 * Maximizes consistency with gene expression via binary activity variables.
 * Reference: Shlomi et al. (2008) Nat Biotechnol 26:1003-1010.
 *
 * NOTE: The constraint v_pos + v_neg >= epsilon * y_h is a standard approximation
 * of |v| >= epsilon. See MetabolicLP.js buildSplitVarProblem for the caveat.
 * Big-M is set dynamically from model bounds to avoid numerical ill-conditioning
 * (Williams 2013, "Model Building in Mathematical Programming").
 */
async function solveIMAT(model, options = {}) {
  const highThreshold = options.highThreshold ?? 0.75;
  const lowThreshold = options.lowThreshold ?? 0.25;
  const epsilon = options.epsilon ?? IMAT_EPSILON;
  const expressionData = options.expressionData || {};

  const maxFluxBound = Math.max(
    ...Object.values(model.reactions || {}).map(rxn =>
      Math.max(Math.abs(rxn.lower_bound ?? -1000), Math.abs(rxn.upper_bound ?? 1000)),
    ),
    1000,
  );
  const M = maxFluxBound;

  const { problem, rxnVars } = buildSplitVarProblem(model, {}, []);

  const highExpr = [];
  const lowExpr = [];

  rxnVars.forEach(rxnId => {
    const rxn = model.reactions[rxnId];
    if (rxn.gpr || rxn.gene_reaction_rule) {
      const expr = evaluateGPRQuantitative(rxn.gpr || rxn.gene_reaction_rule, expressionData);
      if (expr >= highThreshold) highExpr.push(rxnId);
      else if (expr <= lowThreshold) lowExpr.push(rxnId);
    }
  });

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

  lowExpr.forEach(rxnId => {
    problem.variables.push({ name: `y_l_${rxnId}`, lb: 0, ub: 1, type: 'binary' });
    // v_pos + v_neg <= M * (1 - y_l)  ⟺  v_pos + v_neg + M*y_l <= M
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

  const lp = buildLPFormat(problem);
  const raw = solver.solve(lp, { log_to_console: false, time_limit: 300, mip_rel_gap: 0.05 });
  return formatSplitResult(raw, rxnVars, model, 'imat', options);
}

/**
 * GIMME — minimize flux through low-expression reactions.
 * Reference: Becker & Palsson (2008) PLoS Comput Biol.
 */
async function solveGIMME(model, options = {}) {
  const threshold = options.threshold ?? 0.25;
  const requiredFraction = options.requiredFraction ?? 0.9;
  const expressionData = options.expressionData || {};

  const fbaResult = await solveFBA(model, {});
  if (fbaResult.status !== 'optimal') return fbaResult;

  const { problem, rxnVars } = buildSplitVarProblem(model, {}, []);

  const objRxn = findObjectiveReaction(model);
  if (objRxn) {
    problem.constraints.push({
      name: 'min_obj',
      lhs: [
        { name: `v_${objRxn}_pos`, coef: 1 },
        { name: `v_${objRxn}_neg`, coef: -1 },
      ],
      type: 'ge',
      rhs: fbaResult.objectiveValue * requiredFraction,
    });
  }

  problem.objective = [];
  problem.sense = 'min';

  rxnVars.forEach(rxnId => {
    const rxn = model.reactions[rxnId];
    let expr = 1.0;
    if (rxn.gpr || rxn.gene_reaction_rule) {
      expr = evaluateGPRQuantitative(rxn.gpr || rxn.gene_reaction_rule, expressionData);
    }
    if (expr < threshold) {
      const penalty = threshold - expr;
      problem.objective.push({ name: `v_${rxnId}_pos`, coef: penalty });
      problem.objective.push({ name: `v_${rxnId}_neg`, coef: penalty });
    }
  });

  const lp = buildLPFormat(problem);
  const raw = solver.solve(lp, {});
  return formatSplitResult(raw, rxnVars, model, 'gimme', options);
}

/**
 * E-Flux — scale reaction bounds by expression level, then run FBA.
 * Reference: Colijn et al. (2009) Mol Syst Biol.
 */
async function solveEFlux(model, options = {}) {
  const expressionData = options.expressionData || {};
  const minBound = options.minBound ?? 0.01;
  const scaledModel = JSON.parse(JSON.stringify(model));

  Object.entries(scaledModel.reactions).forEach(([rxnId, rxn]) => {
    if (rxn.gpr || rxn.gene_reaction_rule) {
      const expr = evaluateGPRQuantitative(rxn.gpr || rxn.gene_reaction_rule, expressionData);
      const scale = Math.max(minBound, Math.min(1.0, expr));
      if (scale < 1.0) {
        if (rxn.upper_bound > 0) rxn.upper_bound *= scale;
        if (rxn.lower_bound < 0) rxn.lower_bound *= scale;
      }
    }
  });

  const result = await solveFBA(scaledModel, options);
  result.method = 'eflux';
  return result;
}

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = async function (event) {
  const { jobId, method, model, options = {} } = event.data;

  if (!solverReady) {
    self.postMessage({ jobId, type: 'error', error: 'Solver not initialized' });
    return;
  }

  try {
    let result;
    switch (method) {
      case 'fba':   result = await solveFBA(model, options);   break;
      case 'pfba':  result = await solvePFBA(model, options);  break;
      case 'fva':   result = await solveFVA(model, { ...options, jobId }); break;
      case 'moma':  result = await solveMOMA(model, options);  break;
      case 'imat':  result = await solveIMAT(model, options);  break;
      case 'gimme': result = await solveGIMME(model, options); break;
      case 'eflux': result = await solveEFlux(model, options); break;
      default:      throw new Error(`Unknown method: ${method}`);
    }
    self.postMessage({ jobId, type: 'result', result });
  } catch (error) {
    self.postMessage({ jobId, type: 'error', error: error.message });
  }
};

// Initialize on load and signal ready
initializeSolver().then(success => {
  self.postMessage({
    type: 'ready',
    solverReady: success,
    solver: 'highs-wasm',
    capabilities: success ? ['LP', 'MILP'] : [],
  });
});
