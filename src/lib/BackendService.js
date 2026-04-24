/**
 * BackendService - Python Backend Bridge
 *
 * Connects the React frontend to the FastAPI/COBRApy backend for:
 * - Heavy computations (large models, FVA)
 * - True MILP solving (iMAT)
 * - Native solver access (Gurobi, CPLEX, HiGHS)
 *
 * Automatically falls back to browser-based WASM solver when backend
 * is unavailable or for small models.
 *
 * @module BackendService
 */

// Backend configuration
// VITE_BACKEND_URL is injected at build time (set in Railway / .env.local)
const DEFAULT_BACKEND_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) ||
  'http://localhost:8000';
const TIMEOUT_MS = 60000; // 60 second timeout for heavy computations

/**
 * Backend service singleton
 */
class BackendService {
  constructor() {
    this.baseUrl = DEFAULT_BACKEND_URL;
    this.isAvailable = null; // null = unknown, true/false = checked
    this.solverInfo = null;
    this.lastHealthCheck = null;
  }

  /**
   * Configure the backend URL
   */
  setBaseUrl(url) {
    this.baseUrl = url;
    this.isAvailable = null; // Reset availability
  }

  /**
   * Check if the backend is available
   */
  async checkHealth() {
    // Don't check more than once per 30 seconds
    if (this.lastHealthCheck && Date.now() - this.lastHealthCheck < 30000 && this.isAvailable !== null) {
      return this.isAvailable;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        this.solverInfo = data;
        this.isAvailable = true;
        this.lastHealthCheck = Date.now();
        console.log('Backend available:', data);
        return true;
      }
    } catch (error) {
      console.log('Backend not available:', error.message);
    }

    this.isAvailable = false;
    this.lastHealthCheck = Date.now();
    return false;
  }

  /**
   * Determine if we should use the backend for a given task
   */
  shouldUseBackend(model, method) {
    if (!this.isAvailable) return false;

    // Always use backend for MILP methods
    if (['imat', 'gimme'].includes(method)) {
      return true;
    }

    // Use backend for large models
    const numReactions = Object.keys(model.reactions || {}).length;
    if (numReactions > 2000) {
      return true;
    }

    // Use backend for FVA (computationally expensive)
    if (method === 'fva') {
      return true;
    }

    return false;
  }

  /**
   * Convert frontend model format to backend format
   */
  formatModelForBackend(model) {
    const reactions = Object.entries(model.reactions || {}).map(([id, rxn]) => ({
      id,
      name: rxn.name || id,
      metabolites: rxn.metabolites || {},
      lower_bound: rxn.lower_bound ?? -1000,
      upper_bound: rxn.upper_bound ?? 1000,
      gene_reaction_rule: rxn.gpr || rxn.gene_reaction_rule || '',
      subsystem: rxn.subsystem || '',
      objective_coefficient: rxn.objective_coefficient || 0,
    }));

    const metabolites = Object.entries(model.metabolites || {}).map(([id, met]) => ({
      id,
      name: met.name || id,
      compartment: met.compartment || 'c',
      formula: met.formula || '',
      charge: met.charge || 0,
    }));

    const genes = Object.entries(model.genes || {}).map(([id, gene]) => ({
      id,
      name: gene.name || gene.product || id,
    }));

    // Find objective reaction
    let objective = null;
    for (const [id, rxn] of Object.entries(model.reactions || {})) {
      if (rxn.objective_coefficient && rxn.objective_coefficient !== 0) {
        objective = id;
        break;
      }
    }
    if (!objective) {
      objective = Object.keys(model.reactions || {}).find(
        id => id.includes('BIOMASS') || id.includes('biomass')
      );
    }

    return {
      id: model.id || model.name || 'model',
      name: model.name || 'Metabolic Model',
      reactions,
      metabolites,
      genes,
      objective,
    };
  }

  /**
   * Format constraints for backend
   */
  formatConstraints(constraints, knockouts) {
    const formatted = {};

    // Convert constraint format
    for (const [rxnId, bounds] of Object.entries(constraints || {})) {
      formatted[rxnId] = {
        lb: bounds.lb ?? bounds.lower_bound,
        ub: bounds.ub ?? bounds.upper_bound,
      };
    }

    return {
      constraints: Object.keys(formatted).length > 0 ? formatted : null,
      knockouts: knockouts || [],
    };
  }

  /**
   * Generic POST request to backend
   */
  async post(endpoint, data) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Backend error: ${response.status} - ${error}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error('Backend request timed out');
      }
      throw error;
    }
  }

  /**
   * Solve FBA using backend
   */
  async solveFBA(model, constraints = {}, knockouts = [], objective = null) {
    const modelData = this.formatModelForBackend(model);
    const { constraints: fmtConstraints, knockouts: fmtKnockouts } = this.formatConstraints(constraints, knockouts);

    const result = await this.post('/solve/fba', {
      model: modelData,
      constraints: fmtConstraints,
      knockouts: fmtKnockouts,
      objective: objective || modelData.objective,
    });

    return this.normalizeResult(result);
  }

  /**
   * Solve pFBA using backend
   */
  async solvePFBA(model, constraints = {}, knockouts = [], objective = null) {
    const modelData = this.formatModelForBackend(model);
    const { constraints: fmtConstraints, knockouts: fmtKnockouts } = this.formatConstraints(constraints, knockouts);

    const result = await this.post('/solve/pfba', {
      model: modelData,
      constraints: fmtConstraints,
      knockouts: fmtKnockouts,
      objective: objective || modelData.objective,
    });

    return this.normalizeResult(result);
  }

  /**
   * Solve FVA using backend
   */
  async solveFVA(model, constraints = {}, knockouts = [], options = {}) {
    const modelData = this.formatModelForBackend(model);
    const { constraints: fmtConstraints, knockouts: fmtKnockouts } = this.formatConstraints(constraints, knockouts);

    const result = await this.post('/solve/fva', {
      model: modelData,
      constraints: fmtConstraints,
      knockouts: fmtKnockouts,
      fraction_of_optimum: options.fractionOfOptimum ?? 0.9,
      reactions: options.reactions || null,
    });

    // Convert FVA response format
    return {
      status: result.status,
      objectiveValue: result.objective_value,
      ranges: result.ranges,
      solveTime: result.solve_time,
      solver: 'python-backend',
    };
  }

  /**
   * Solve MOMA using backend
   */
  async solveMOMA(model, constraints = {}, knockouts = [], referenceFluxes = null) {
    const modelData = this.formatModelForBackend(model);
    const { constraints: fmtConstraints, knockouts: fmtKnockouts } = this.formatConstraints(constraints, knockouts);

    const result = await this.post('/solve/moma', {
      model: modelData,
      constraints: fmtConstraints,
      knockouts: fmtKnockouts,
      reference_fluxes: referenceFluxes,
    });

    return this.normalizeResult(result);
  }

  /**
   * Solve GIMME using backend (true LP formulation)
   */
  async solveGIMME(model, expressionData, options = {}) {
    const modelData = this.formatModelForBackend(model);

    // Convert Map to object if needed
    const expression = expressionData instanceof Map
      ? Object.fromEntries(expressionData)
      : expressionData;

    const result = await this.post('/solve/gimme', {
      model: modelData,
      expression,
      method: 'gimme',
      threshold: options.threshold ?? 0.25,
      required_fraction: options.requiredFraction ?? 0.9,
    });

    return this.normalizeResult(result);
  }

  /**
   * Solve iMAT using backend (true MILP)
   */
  async solveIMAT(model, expressionData, options = {}) {
    const modelData = this.formatModelForBackend(model);

    const expression = expressionData instanceof Map
      ? Object.fromEntries(expressionData)
      : expressionData;

    const result = await this.post('/solve/imat', {
      model: modelData,
      expression,
      method: 'imat',
      high_threshold: options.highThreshold ?? 0.75,
      low_threshold: options.lowThreshold ?? 0.25,
    });

    return this.normalizeResult(result);
  }

  /**
   * Solve E-Flux using backend
   */
  async solveEFlux(model, expressionData, options = {}) {
    const modelData = this.formatModelForBackend(model);

    const expression = expressionData instanceof Map
      ? Object.fromEntries(expressionData)
      : expressionData;

    const result = await this.post('/solve/eflux', {
      model: modelData,
      expression,
      method: 'eflux',
    });

    return this.normalizeResult(result);
  }

  /**
   * Get model information from backend
   */
  async getModelInfo(model) {
    const modelData = this.formatModelForBackend(model);
    return await this.post('/model/info', modelData);
  }

  /**
   * Solve for benchmark comparison
   * Used by BenchmarkRunner for validation against HiGHS WASM
   */
  async solveBenchmark(model, method = 'fba', solver = 'glpk') {
    const modelData = this.formatModelForBackend(model);

    const result = await this.post('/benchmark/solve', {
      model: modelData,
      method,
      solver,
    });

    return {
      status: result.status,
      objectiveValue: result.objective_value,
      fluxes: result.fluxes || {},
      solveTimeMs: result.solve_time_ms,
      solver: result.solver,
      error: result.error,
    };
  }

  /**
   * Normalize backend result to frontend format
   */
  normalizeResult(result) {
    // Calculate growth rate and other metrics from fluxes
    let growthRate = 0;
    const biomassKeys = Object.keys(result.fluxes || {}).filter(
      k => k.includes('BIOMASS') || k.includes('biomass')
    );
    if (biomassKeys.length > 0) {
      growthRate = result.fluxes[biomassKeys[0]] || 0;
    }

    // Determine phenotype
    let phenotype = 'unknown';
    if (result.status === 'optimal') {
      phenotype = growthRate > 0.01 ? 'viable' : 'lethal';
    } else if (result.status === 'infeasible') {
      phenotype = 'lethal';
    }

    return {
      status: result.status,
      objectiveValue: result.objective_value,
      growthRate,
      fluxes: result.fluxes || {},
      shadowPrices: result.shadow_prices || {},
      reducedCosts: result.reduced_costs || {},
      method: result.method,
      solver: result.solver || 'python-backend',
      solveTime: result.solve_time,
      phenotype,
      isBackendResult: true,
    };
  }
}

// Export singleton instance
export const backendService = new BackendService();

// Export class for testing
export { BackendService };

/**
 * Check if Python backend is available
 */
export async function checkBackendAvailability() {
  return backendService.checkHealth();
}

/**
 * Configure backend URL
 */
export function setBackendUrl(url) {
  backendService.setBaseUrl(url);
}
