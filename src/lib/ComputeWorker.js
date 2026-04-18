/**
 * ComputeWorker - Background Thread Computation Manager
 *
 * Moves heavy LP/MILP solving to Web Workers to prevent UI blocking.
 * Implements an algorithm registry pattern for extensible solvers.
 *
 * Architecture:
 * - Main thread: UI, React components
 * - Worker thread: WASM solvers (GLPK, HiGHS)
 * - Remote: Python backend (COBRApy/Gurobi)
 *
 * Usage:
 *   const result = await computeManager.solve('fba', model, options);
 *
 * @module ComputeWorker
 */

import { backendService } from './BackendService';

// Algorithm registry - maps method names to solver implementations
const ALGORITHM_REGISTRY = new Map();

/**
 * Register an algorithm implementation
 *
 * @param {string} name - Algorithm name (e.g., 'fba', 'pfba')
 * @param {Object} implementation - Algorithm implementation
 */
export function registerAlgorithm(name, implementation) {
  ALGORITHM_REGISTRY.set(name, implementation);
}

/**
 * Algorithm implementation interface
 *
 * @typedef {Object} AlgorithmImplementation
 * @property {string} name - Display name
 * @property {string} type - 'local' | 'remote' | 'hybrid'
 * @property {boolean} requiresMILP - Whether MILP is required
 * @property {Function} solve - Solver function
 * @property {string} reference - Academic reference
 */

/**
 * ComputeManager - Orchestrates computation across workers and backends
 */
class ComputeManager {
  constructor() {
    this.worker = null;
    this.workerReady = false;
    this.pendingJobs = new Map();
    this.jobCounter = 0;
    this.backendAvailable = null;
  }

  /**
   * Initialize the compute worker
   */
  async initialize() {
    // Check backend availability
    this.backendAvailable = await backendService.checkHealth();

    // Initialize Web Worker if supported
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(
          new URL('./SolverWorker.js', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (event) => this.handleWorkerMessage(event);
        this.worker.onerror = (error) => this.handleWorkerError(error);

        // Wait for worker ready signal
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Worker timeout')), 10000);
          const handler = (event) => {
            if (event.data.type === 'ready') {
              clearTimeout(timeout);
              this.workerReady = true;
              this.worker.removeEventListener('message', handler);
              resolve();
            }
          };
          this.worker.addEventListener('message', handler);
        });

        console.log('Compute worker initialized');
      } catch (error) {
        console.warn('Failed to initialize worker:', error);
        this.worker = null;
      }
    }

    return this;
  }

  /**
   * Handle messages from the worker
   */
  handleWorkerMessage(event) {
    const { jobId, type, result, error, progress } = event.data;

    if (type === 'progress' && this.pendingJobs.has(jobId)) {
      const job = this.pendingJobs.get(jobId);
      if (job.onProgress) {
        job.onProgress(progress);
      }
      return;
    }

    if (!this.pendingJobs.has(jobId)) {
      console.warn('Received message for unknown job:', jobId);
      return;
    }

    const job = this.pendingJobs.get(jobId);
    this.pendingJobs.delete(jobId);

    if (error) {
      job.reject(new Error(error));
    } else {
      job.resolve(result);
    }
  }

  /**
   * Handle worker errors
   */
  handleWorkerError(error) {
    console.error('Worker error:', error);

    // Reject all pending jobs
    this.pendingJobs.forEach((job) => {
      job.reject(new Error('Worker crashed'));
    });
    this.pendingJobs.clear();

    // Try to restart worker
    this.workerReady = false;
    this.initialize().catch(console.error);
  }

  /**
   * Execute a computation
   *
   * @param {string} method - Algorithm name
   * @param {Object} model - Metabolic model
   * @param {Object} options - Algorithm-specific options
   * @returns {Promise<Object>} Computation result
   */
  async solve(method, model, options = {}) {
    // Determine best execution strategy
    const strategy = this.selectStrategy(method, model, options);

    switch (strategy) {
      case 'backend':
        return this.solveViaBackend(method, model, options);
      case 'worker':
        return this.solveViaWorker(method, model, options);
      case 'main':
      default:
        return this.solveOnMainThread(method, model, options);
    }
  }

  /**
   * Select execution strategy based on method and model size
   *
   * Strategy priority:
   * 1. HiGHS WASM worker - supports true MILP, no network latency
   * 2. Python backend - for very large models or when worker unavailable
   * 3. Main thread - fallback for small models only
   */
  selectStrategy(method, model, options) {
    const numReactions = Object.keys(model.reactions || {}).length;
    const isMILPMethod = ['imat', 'gimme'].includes(method);
    const isExpensiveMethod = ['fva', 'moma'].includes(method);

    // Very large models (>3000 reactions) - prefer backend if available
    // Backend uses optimized COBRApy/Gurobi which handles genome-scale better
    if (numReactions > 3000 && this.backendAvailable) {
      return 'backend';
    }

    // MILP methods: HiGHS WASM now supports true MILP
    // Prefer worker for models up to ~1500 reactions (HiGHS handles well)
    // Fall back to backend for larger MILP problems
    if (isMILPMethod) {
      if (this.workerReady && numReactions <= 1500) {
        return 'worker';
      }
      if (this.backendAvailable) {
        return 'backend';
      }
      // No backend available - try worker anyway
      if (this.workerReady) {
        return 'worker';
      }
    }

    // FVA: computationally expensive (2*n LP solves)
    // Prefer worker for small-medium, backend for large
    if (method === 'fva') {
      if (numReactions > 1000 && this.backendAvailable) {
        return 'backend';
      }
      if (this.workerReady) {
        return 'worker';
      }
    }

    // Large models (>2000) - prefer backend for better performance
    if (numReactions > 2000 && this.backendAvailable) {
      return 'backend';
    }

    // Medium models (>100) - always use worker to avoid UI blocking
    if (numReactions > 100 && this.workerReady) {
      return 'worker';
    }

    // Small models - worker preferred, main thread as fallback
    return this.workerReady ? 'worker' : 'main';
  }

  /**
   * Solve using Python backend
   */
  async solveViaBackend(method, model, options) {
    const methodMap = {
      'fba': () => backendService.solveFBA(model, options.constraints, options.knockouts),
      'pfba': () => backendService.solvePFBA(model, options.constraints, options.knockouts),
      'fva': () => backendService.solveFVA(model, options.constraints, options.knockouts, options),
      'moma': () => backendService.solveMOMA(model, options.constraints, options.knockouts, options.referenceFluxes),
      'gimme': () => backendService.solveGIMME(model, options.expressionData, options),
      'imat': () => backendService.solveIMAT(model, options.expressionData, options),
      'eflux': () => backendService.solveEFlux(model, options.expressionData, options),
    };

    if (!methodMap[method]) {
      throw new Error(`Unknown method: ${method}`);
    }

    return methodMap[method]();
  }

  /**
   * Solve using Web Worker
   */
  async solveViaWorker(method, model, options) {
    if (!this.workerReady) {
      throw new Error('Worker not ready');
    }

    const jobId = ++this.jobCounter;

    return new Promise((resolve, reject) => {
      this.pendingJobs.set(jobId, {
        resolve,
        reject,
        onProgress: options.onProgress,
      });

      this.worker.postMessage({
        jobId,
        method,
        model,
        options,
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.pendingJobs.has(jobId)) {
          this.pendingJobs.delete(jobId);
          reject(new Error('Computation timed out'));
        }
      }, 300000);
    });
  }

  /**
   * Solve on main thread (fallback using GLPK.js)
   *
   * Uses the GLPK-based FBASolver.js directly to avoid circular dependency
   * with EnhancedModeling.jsx (which routes through ComputeWorker).
   */
  async solveOnMainThread(method, model, options) {
    // Import GLPK-based solver directly (not the EnhancedModeling wrapper)
    const { solveFBA, solveFVA } = await import('./FBASolver.js');

    // Convert options to the GLPK solver format
    const solverOptions = {
      constraints: options.constraints || {},
      knockouts: options.knockouts || [],
      objective: options.objective || null,
    };

    switch (method) {
      case 'fba':
        return solveFBA(model, solverOptions);
      case 'fva':
        return solveFVA(model, solverOptions);
      case 'pfba':
        // pFBA requires two-phase solving - fallback to standard FBA
        console.warn('pFBA not available on main thread, using standard FBA');
        return solveFBA(model, solverOptions);
      case 'moma':
        // Linear MOMA uses LP (L1 norm), but still requires two-phase solving
        console.warn('MOMA not available on main thread, using standard FBA as fallback');
        return solveFBA(model, solverOptions);
      default:
        throw new Error(`Method ${method} not available on main thread`);
    }
  }

  /**
   * Get computation status
   */
  getStatus() {
    return {
      workerReady: this.workerReady,
      backendAvailable: this.backendAvailable,
      pendingJobs: this.pendingJobs.size,
      solverInfo: backendService.solverInfo,
    };
  }

  /**
   * Terminate the worker
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
    }
  }
}

// Export singleton
export const computeManager = new ComputeManager();

/**
 * Convenience function to run a computation
 */
export async function compute(method, model, options = {}) {
  if (!computeManager.workerReady && !computeManager.backendAvailable) {
    await computeManager.initialize();
  }
  return computeManager.solve(method, model, options);
}

// Register built-in algorithms
registerAlgorithm('fba', {
  name: 'Flux Balance Analysis',
  type: 'hybrid',
  requiresMILP: false,
  reference: 'Orth et al. (2010) Nat Biotechnol',
});

registerAlgorithm('pfba', {
  name: 'Parsimonious FBA',
  type: 'hybrid',
  requiresMILP: false,
  reference: 'Lewis et al. (2010) Mol Syst Biol',
});

registerAlgorithm('fva', {
  name: 'Flux Variability Analysis',
  type: 'hybrid',
  requiresMILP: false,
  reference: 'Mahadevan & Schilling (2003) Metab Eng',
});

registerAlgorithm('moma', {
  name: 'Linear MOMA (Minimization of Metabolic Adjustment)',
  type: 'hybrid',
  requiresMILP: false,
  reference: 'Segrè et al. (2002) PNAS; Becker et al. (2007) BMC Syst Biol (L1 linearization)',
});

registerAlgorithm('gimme', {
  name: 'Gene Inactivity Moderated by Metabolism and Expression',
  type: 'hybrid',  // Now supported via HiGHS WASM
  requiresMILP: false,
  reference: 'Becker & Palsson (2008) PLoS Comput Biol',
});

registerAlgorithm('imat', {
  name: 'Integrative Metabolic Analysis Tool',
  type: 'hybrid',  // Now supported via HiGHS WASM with true MILP
  requiresMILP: true,
  reference: 'Shlomi et al. (2008) Nat Biotechnol',
});

registerAlgorithm('eflux', {
  name: 'Expression-based Flux',
  type: 'hybrid',
  requiresMILP: false,
  reference: 'Colijn et al. (2009) Mol Syst Biol',
});

export default computeManager;
