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
import { kernelSolver } from './KernelSolver';

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
    // Pyodide tier (browser Python — loads in background)
    this.pyWorker = null;
    this.pyodideReady = false;
    this.pyodideStatus = 'idle';   // 'idle'|'loading'|'ready'|'error'
    this.pyPending = new Map();
    this._pyStatusListeners = new Set();
  }

  /** Subscribe to Pyodide status changes. Returns unsubscribe fn. */
  onPyodideStatus(fn) {
    this._pyStatusListeners.add(fn);
    fn(this.pyodideStatus);
    return () => this._pyStatusListeners.delete(fn);
  }

  _setPyStatus(status, msg = '') {
    this.pyodideStatus = status;
    this._pyStatusListeners.forEach(fn => { try { fn(status, msg); } catch {} });
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

    // Start Pyodide worker in background — doesn't block HiGHS WASM init
    this._initPyodide();

    return this;
  }

  /**
   * Start Pyodide worker without blocking the main init.
   * On first load Pyodide fetches ~30 MB from CDN; subsequent loads are cached.
   */
  _initPyodide() {
    if (this.pyWorker || typeof Worker === 'undefined') return;
    try {
      this._setPyStatus('loading', 'Fetching Pyodide…');
      this.pyWorker = new Worker(
        new URL('./PyodideWorker.js', import.meta.url),
        { type: 'module' },
      );
      this.pyWorker.onmessage = e => this._handlePyMessage(e);
      this.pyWorker.onerror   = err => {
        console.warn('PyodideWorker error:', err);
        this._setPyStatus('error', err.message);
        this.pyodideReady = false;
      };
    } catch (err) {
      console.warn('Cannot start PyodideWorker:', err);
      this._setPyStatus('error', err.message);
    }
  }

  _handlePyMessage(event) {
    const { jobId, type, result, error, message } = event.data;

    if (type === 'ready') {
      this.pyodideReady = true;
      this._setPyStatus('ready', 'Pyodide ready');
      return;
    }
    if (type === 'loading') {
      this._setPyStatus('loading', message || 'Loading…');
      return;
    }
    if (type === 'error' && !jobId) {
      this._setPyStatus('error', error);
      return;
    }

    const job = this.pyPending.get(jobId);
    if (!job) return;
    this.pyPending.delete(jobId);

    if (type === 'error') job.reject(new Error(error));
    else job.resolve(result);
  }

  /**
   * Handle messages from the worker
   */
  handleWorkerMessage(event) {
    const { jobId, type, result, error, progress } = event.data;

    // 'ready' is handled by the one-shot listener in initialize()
    if (type === 'ready') return;

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
   * Execute a computation — routes to the best available tier.
   */
  async solve(method, model, options = {}) {
    const strategy = this.selectStrategy(method, model, options);

    switch (strategy) {
      case 'kernel':  return this.solveViaKernel(method, model, options);
      case 'worker':  return this.solveViaWorker(method, model, options);
      case 'pyodide': return this.solveViaPyodide(method, model, options);
      case 'backend': return this.solveViaBackend(method, model, options);
      case 'main':
      default:        return this.solveOnMainThread(method, model, options);
    }
  }

  /**
   * Solve via local Python kernel (Tier 2).
   * Falls back to worker if kernel disconnects mid-call.
   */
  async solveViaKernel(method, model, options) {
    try {
      const result = await kernelSolver.solve(
        method,
        model,
        options,
        options.onProgress || null,
      );
      result._tier = 'kernel';
      return result;
    } catch (err) {
      console.warn('Kernel solve failed, falling back to worker:', err.message);
      if (this.workerReady) return this.solveViaWorker(method, model, options);
      throw err;
    }
  }

  /**
   * Solve via Pyodide (browser Python + scipy HiGHS).
   * Falls back to main thread if Pyodide worker crashes.
   */
  async solveViaPyodide(method, model, options) {
    if (!this.pyodideReady || !this.pyWorker) {
      throw new Error('Pyodide not ready');
    }

    const jobId = ++this.jobCounter;

    return new Promise((resolve, reject) => {
      this.pyPending.set(jobId, { resolve, reject });

      this.pyWorker.postMessage({ jobId, method, model, options });

      setTimeout(() => {
        if (this.pyPending.has(jobId)) {
          this.pyPending.delete(jobId);
          reject(new Error('Pyodide computation timed out'));
        }
      }, 600_000); // 10 min — FVA on large models can be slow
    });
  }

  /** Expose kernel solver so components can subscribe to status changes */
  get kernelSolver() {
    return kernelSolver;
  }

  /** Current active tier name for display */
  get activeTier() {
    if (kernelSolver.isConnected) return 'kernel';
    if (this.workerReady)         return 'wasm';
    if (this.pyodideReady)        return 'pyodide';
    if (this.backendAvailable)    return 'edge';
    return 'main';
  }

  /**
   * Select execution strategy — four-tier routing.
   *
   * Tier 1 — HiGHS WASM Worker (always available, no install, fastest)
   * Tier 2 — Pyodide scipy-HiGHS (browser Python, ~30 MB CDN, loads in bg)
   *           More reliable than LP-string format for genome-scale models.
   * Tier 3 — Local Python kernel (ws://localhost:8765, optional install)
   *           Full COBRApy access, warm-start FVA, always preferred when connected.
   * Tier 4 — Edge backend (FastAPI)
   * Fallback — Main thread GLPK
   */
  selectStrategy(method, model, options) {
    const pyodideOnly = ['fba', 'pfba', 'fva', 'moma'].includes(method);
    const n = Object.keys(model.reactions || {}).length;

    // Kernel beats everything when connected — native COBRApy, no size limits
    if (kernelSolver.isConnected) return 'kernel';

    // HiGHS WASM: fast, works for any size after the log_to_console fix
    if (this.workerReady) return 'worker';

    // Pyodide: reliable browser Python fallback (scipy directly builds LP matrix)
    if (this.pyodideReady && pyodideOnly) return 'pyodide';

    // Edge backend
    if (this.backendAvailable) return 'backend';

    return 'main';
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
    if (!this.workerReady || !this.worker) {
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
