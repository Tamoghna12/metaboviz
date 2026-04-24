/**
 * TierCalibration - Empirically calibrate WASM tier threshold.
 *
 * Fetches representative models from /public/benchmark_data/models/,
 * times FBA via the WASM Worker, compares against COBRApy/GLPK baseline,
 * and recommends a threshold for ComputeWorker.selectStrategy().
 *
 * Usage (browser console or KernelPanel):
 *   import { runTierCalibration } from './TierCalibration';
 *   const report = await runTierCalibration(onProgress);
 *
 * @module TierCalibration
 */

import { computeManager } from './ComputeWorker';
import { parseModel } from '../utils/modelParser';

// Models ordered by size — covers the full range we have locally
const CALIBRATION_MODELS = [
  { id: 'e_coli_core',  reactions: 95,   glpk_ms: 0.3 },
  { id: 'iJR904',       reactions: 1075,  glpk_ms: 3.5 },
  { id: 'iMM904',       reactions: 1577,  glpk_ms: 5.4 },
  { id: 'iJO1366',      reactions: 2583,  glpk_ms: 9.3 },
  { id: 'iJN1463',      reactions: 2927,  glpk_ms: 11.1 },
  { id: 'iMM1415',      reactions: 3726,  glpk_ms: 12.5 },
  { id: 'iCHOv1_DG44',  reactions: 3942,  glpk_ms: 13.6 },
];

const MODEL_BASE_URL = '/benchmark_data/models';

// Target UX thresholds (ms)
const INSTANT_MS  = 200;   // feels instant
const FAST_MS     = 1000;  // fast but noticeable
const SLOW_MS     = 5000;  // definitely slow → prefer kernel/backend

/**
 * Fetch and parse a model JSON from public/
 */
async function fetchModel(modelId) {
  const resp = await fetch(`${MODEL_BASE_URL}/${modelId}.json`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${modelId}`);
  const raw = await resp.json();
  return parseModel(raw);
}

/**
 * Time a single FBA solve via WASM Worker.
 * Runs N_WARMUP warm-ups then N_REPS timed reps, returns median.
 */
async function timeSolve(model, nWarmup = 1, nReps = 3) {
  // Warmup
  for (let i = 0; i < nWarmup; i++) {
    await computeManager.solveViaWorker('fba', model, {});
  }

  const times = [];
  for (let i = 0; i < nReps; i++) {
    const t0 = performance.now();
    await computeManager.solveViaWorker('fba', model, {});
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]; // median
}

/**
 * Run the full tier calibration suite.
 *
 * @param {(progress: number, message: string) => void} [onProgress]
 * @returns {Promise<CalibrationReport>}
 */
export async function runTierCalibration(onProgress = null) {
  if (!computeManager.workerReady) {
    await computeManager.initialize();
  }
  if (!computeManager.workerReady) {
    throw new Error('WASM Worker not available — cannot calibrate');
  }

  const results = [];
  const n = CALIBRATION_MODELS.length;

  for (let i = 0; i < n; i++) {
    const spec = CALIBRATION_MODELS[i];
    onProgress?.((i / n) * 0.9, `Loading ${spec.id} (${spec.reactions} rxns)…`);

    let wasm_ms = null;
    let error = null;
    try {
      const model = await fetchModel(spec.id);
      wasm_ms = await timeSolve(model);
    } catch (err) {
      error = err.message;
    }

    results.push({ ...spec, wasm_ms: wasm_ms ? +wasm_ms.toFixed(1) : null, error });
    onProgress?.((((i + 1) / n) * 0.9), `${spec.id}: ${wasm_ms ? wasm_ms.toFixed(0) + 'ms' : 'error'}`);
  }

  onProgress?.(0.95, 'Computing threshold recommendation…');
  const report = buildReport(results);
  onProgress?.(1.0, 'Done');
  return report;
}

/**
 * Derive threshold recommendation from timing results.
 */
function buildReport(results) {
  const valid = results.filter(r => r.wasm_ms !== null);

  // Find first model where WASM exceeds SLOW_MS threshold
  const slowIdx = valid.findIndex(r => r.wasm_ms > SLOW_MS);
  const recommendedThreshold = slowIdx >= 0
    ? valid[slowIdx].reactions
    : null; // all models fast — no threshold needed in observed range

  // Compute speedup ratio over GLPK
  const speedups = valid.map(r => ({
    ...r,
    speedup: +(r.glpk_ms / r.wasm_ms).toFixed(2),
    ux: r.wasm_ms < INSTANT_MS ? 'instant' : r.wasm_ms < FAST_MS ? 'fast' : r.wasm_ms < SLOW_MS ? 'slow' : 'blocked',
  }));

  return {
    timestamp: new Date().toISOString(),
    results: speedups,
    recommendedThreshold,
    summary: {
      max_reactions_tested: Math.max(...valid.map(r => r.reactions)),
      max_wasm_ms: +Math.max(...valid.map(r => r.wasm_ms)).toFixed(1),
      median_speedup_vs_glpk: +median(speedups.map(r => r.speedup)).toFixed(2),
      all_fast: speedups.every(r => r.ux !== 'blocked'),
    },
  };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Format a calibration report as a human-readable string for KernelPanel.
 */
export function formatReport(report) {
  const lines = [
    `WASM Tier Calibration — ${new Date(report.timestamp).toLocaleString()}`,
    '',
    `${'Model'.padEnd(18)} ${'Rxns'.padStart(6)} ${'WASM ms'.padStart(9)} ${'GLPK ms'.padStart(9)} ${'Speedup'.padStart(8)}  UX`,
    '─'.repeat(65),
  ];

  for (const r of report.results) {
    const wasm = r.wasm_ms != null ? r.wasm_ms.toFixed(0) : 'ERR';
    const glpk = r.glpk_ms.toFixed(1);
    const sp   = r.speedup != null ? `${r.speedup}x` : '—';
    const ux   = r.ux ?? '?';
    lines.push(
      `${r.id.padEnd(18)} ${String(r.reactions).padStart(6)} ${wasm.padStart(9)} ${glpk.padStart(9)} ${sp.padStart(8)}  ${ux}`
    );
  }

  lines.push('');
  if (report.recommendedThreshold) {
    lines.push(`⚠ Threshold recommendation: n > ${report.recommendedThreshold} rxns → prefer kernel/backend`);
  } else {
    lines.push(`✓ All tested models fast in WASM (up to ${report.summary.max_reactions_tested} rxns, ${report.summary.max_wasm_ms}ms peak)`);
    lines.push(`  Current threshold (n > 5000) is conservative — safe to raise if needed.`);
  }
  lines.push(`  Median WASM speedup vs COBRApy/GLPK: ${report.summary.median_speedup_vs_glpk}x`);

  return lines.join('\n');
}

export default runTierCalibration;
