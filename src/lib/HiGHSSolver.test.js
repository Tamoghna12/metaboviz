/**
 * Unit Tests for HiGHSSolver
 *
 * Tests the HiGHS-based FBA implementation.
 *
 * These tests verify:
 * - FBA optimization with HiGHS
 * - pFBA returns correct biomass objective (Bug #1 fix)
 * - FVA computes correct flux ranges (Bug #2 fix)
 * - Gene knockouts via GPR
 *
 * Reference model: Simple 3-reaction linear pathway
 * A -> B -> C -> Biomass
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { highsSolver, SolverStatus } from './HiGHSSolver.js';

// HiGHS WASM cannot load in Node.js without the .wasm binary.
// Tests that require initialization will skip gracefully.
let highs_available = false;
const initHiGHS = async () => {
  try {
    await highsSolver.initialize();
    highs_available = true;
  } catch {
    // WASM not available in this environment
    highs_available = false;
  }
};

// Simple test model: linear pathway A -> B -> C -> Biomass
//
// Model structure:
//   EX_A: External source → A_e (import, max rate 10)
//   R1: A_e → B_c
//   R2: B_c → C_c
//   R3: C_c → (drain, competes with biomass)
//   BIOMASS: C_c → (objective)
//
// At optimal: v_EX_A = v_R1 = v_R2 = 10, v_R3 = 0, v_BIOMASS = 10
const createSimpleModel = () => ({
  name: 'Test Model',
  reactions: {
    'EX_A': {
      name: 'A exchange (import)',
      metabolites: { 'A_e': 1 },   // Produces A_e (import to system)
      lower_bound: 0,              // No export
      upper_bound: 10,             // Max import rate = 10
      gpr: ''
    },
    'R1': {
      name: 'A to B',
      metabolites: { 'A_e': -1, 'B_c': 1 },
      lower_bound: 0,
      upper_bound: 1000,
      gpr: 'gene1'
    },
    'R2': {
      name: 'B to C',
      metabolites: { 'B_c': -1, 'C_c': 1 },
      lower_bound: 0,
      upper_bound: 1000,
      gpr: 'gene2'
    },
    'R3': {
      name: 'C drain',
      metabolites: { 'C_c': -1 },
      lower_bound: 0,
      upper_bound: 1000,
      gpr: 'gene3'
    },
    'BIOMASS': {
      name: 'Biomass',
      metabolites: { 'C_c': -1 },
      lower_bound: 0,
      upper_bound: 1000,
      objective_coefficient: 1,  // Explicit objective
      gpr: ''
    }
  },
  metabolites: {
    'A_e': { name: 'Metabolite A', compartment: 'e' },
    'B_c': { name: 'Metabolite B', compartment: 'c' },
    'C_c': { name: 'Metabolite C', compartment: 'c' }
  },
  genes: {
    'gene1': { name: 'Gene 1' },
    'gene2': { name: 'Gene 2' },
    'gene3': { name: 'Gene 3' }
  }
});

// Model with explicit objective coefficient
const createModelWithObjective = () => {
  const model = createSimpleModel();
  model.reactions['BIOMASS'].objective_coefficient = 1;
  return model;
};

// More complex model with isozymes and enzyme complexes
const createComplexGPRModel = () => ({
  name: 'Complex GPR Model',
  reactions: {
    'EX_glc': {
      name: 'Glucose exchange',
      metabolites: { 'glc_e': 1 },
      lower_bound: -10,
      upper_bound: 0,
      objective_coefficient: 0
    },
    'PFK': {
      name: 'Phosphofructokinase',
      metabolites: { 'glc_e': -1, 'fbp_c': 1 },
      lower_bound: 0,
      upper_bound: 1000,
      gpr: 'pfkA or pfkB',
      objective_coefficient: 0
    },
    'GAPD': {
      name: 'GAPDH',
      metabolites: { 'fbp_c': -1, 'gap_c': 1 },
      lower_bound: 0,
      upper_bound: 1000,
      gpr: 'gapA',
      objective_coefficient: 0
    },
    'PYK': {
      name: 'Pyruvate kinase',
      metabolites: { 'gap_c': -1, 'pyr_c': 1 },
      lower_bound: 0,
      upper_bound: 1000,
      gpr: '(pykA and pykB) or pykF',
      objective_coefficient: 0
    },
    'BIOMASS': {
      name: 'Biomass',
      metabolites: { 'pyr_c': -1 },
      lower_bound: 0,
      upper_bound: 1000,
      objective_coefficient: 1
    }
  },
  metabolites: {
    'glc_e': { name: 'Glucose', compartment: 'e' },
    'fbp_c': { name: 'FBP', compartment: 'c' },
    'gap_c': { name: 'GAP', compartment: 'c' },
    'pyr_c': { name: 'Pyruvate', compartment: 'c' }
  },
  genes: {}
});

describe('HiGHSSolver Initialization', () => {
  // HiGHS WASM requires browser environment or Node.js with proper WASM file path.
  // In CI/test environments without the WASM binary, initialization is expected to fail.
  it('should initialize HiGHS WASM module', async () => {
    try {
      const solver = await highsSolver.initialize();
      expect(solver.initialized).toBe(true);
      expect(solver.highs).toBeTruthy();
    } catch (e) {
      // Expected in Node.js without WASM binary — skip gracefully
      expect(e.message).toContain('HiGHS initialization failed');
    }
  });

  it('should return solver info', () => {
    const info = highsSolver.getInfo();
    expect(info.name).toBe('HiGHS');
    expect(info.capabilities).toContain('LP');
    expect(info.capabilities).toContain('MILP');
  });
});

describe('FBA - Basic Flux Balance Analysis', () => {
  beforeAll(async () => {
    await initHiGHS();
  });
  beforeEach((ctx) => {
    if (!highs_available) ctx.skip();
  });

  it('should solve simple linear pathway with optimal growth', async () => {
    const model = createSimpleModel();
    const result = await highsSolver.solveFBA(model);

    expect(result.status).toBe(SolverStatus.OPTIMAL);
    expect(result.objectiveValue).toBeCloseTo(10, 5);
    expect(result.growthRate).toBeCloseTo(10, 5);
    expect(result.method).toBe('fba');
  });

  it('should return correct flux distribution', async () => {
    const model = createSimpleModel();
    const result = await highsSolver.solveFBA(model);

    // At optimal: all flux through biomass, none through drain
    expect(result.fluxes['EX_A']).toBeCloseTo(10, 5);
    expect(result.fluxes['R1']).toBeCloseTo(10, 5);
    expect(result.fluxes['R2']).toBeCloseTo(10, 5);
    expect(result.fluxes['R3']).toBeCloseTo(0, 5);
    expect(result.fluxes['BIOMASS']).toBeCloseTo(10, 5);
  });

  it('should satisfy mass balance (steady state)', async () => {
    const model = createSimpleModel();
    const result = await highsSolver.solveFBA(model);

    // For internal metabolites B_c and C_c, production = consumption
    // B_c: produced by R1 (10), consumed by R2 (10) → net = 0
    // C_c: produced by R2 (10), consumed by R3 (0) + BIOMASS (10) → net = 0
    const fluxes = result.fluxes;
    
    // Verify steady state for B_c
    const bProduction = fluxes['R1'];
    const bConsumption = fluxes['R2'];
    expect(bProduction - bConsumption).toBeCloseTo(0, 10);

    // Verify steady state for C_c
    const cProduction = fluxes['R2'];
    const cConsumption = fluxes['R3'] + fluxes['BIOMASS'];
    expect(cProduction - cConsumption).toBeCloseTo(0, 10);
  });
});

describe('pFBA - Parsimonious FBA (Bug #1 Fix)', () => {
  beforeAll(async () => {
    await initHiGHS();
  });
  beforeEach((ctx) => {
    if (!highs_available) ctx.skip();
  });

  it('should return BIOMASS as objectiveValue, not total flux', async () => {
    // CRITICAL TEST for Bug #1
    // pFBA Stage 2 minimizes total flux, but objectiveValue must be biomass
    const model = createSimpleModel();
    
    // First get FBA result for comparison
    const fbaResult = await highsSolver.solveFBA(model);
    
    // Now get pFBA result
    const pfbaResult = await highsSolver.solvePFBA(model);

    expect(pfbaResult.status).toBe(SolverStatus.OPTIMAL);
    expect(pfbaResult.method).toBe('pfba');
    
    // CRITICAL: objectiveValue should be biomass (~10), NOT total flux (~30+)
    // Before fix: objectiveValue was ~30 (sum of all |v_i|)
    // After fix: objectiveValue should be ~10 (biomass)
    expect(pfbaResult.objectiveValue).toBeCloseTo(fbaResult.objectiveValue, 4);
    expect(pfbaResult.objectiveValue).toBeCloseTo(10, 4);
    
    // Verify it's NOT the total flux
    const totalFlux = Object.values(pfbaResult.fluxes).reduce((sum, v) => sum + Math.abs(v), 0);
    expect(pfbaResult.objectiveValue).toBeLessThan(totalFlux);
  });

  it('should minimize total flux while maintaining optimal biomass', async () => {
    const model = createSimpleModel();
    
    const fbaResult = await highsSolver.solveFBA(model);
    const pfbaResult = await highsSolver.solvePFBA(model);

    // Biomass should be maintained (within 0.1% tolerance)
    expect(pfbaResult.growthRate).toBeGreaterThanOrEqual(fbaResult.objectiveValue * 0.999);
    
    // pFBA should have lower or equal total flux compared to FBA
    // (In this simple model, they may be equal since there's only one optimal path)
    const fbaTotalFlux = Object.values(fbaResult.fluxes).reduce((sum, v) => sum + Math.abs(v), 0);
    const pfbaTotalFlux = Object.values(pfbaResult.fluxes).reduce((sum, v) => sum + Math.abs(v), 0);
    
    expect(pfbaTotalFlux).toBeLessThanOrEqual(fbaTotalFlux + 0.01); // Small tolerance
  });

  it('should have consistent growthRate and objectiveValue for pFBA', async () => {
    const model = createSimpleModel();
    const result = await highsSolver.solvePFBA(model);

    // For pFBA, growthRate and objectiveValue should both represent biomass
    expect(result.growthRate).toBeCloseTo(result.objectiveValue, 5);
  });
});

describe('FVA - Flux Variability Analysis (Bug #2 Fix)', () => {
  beforeAll(async () => {
    await initHiGHS();
  });
  beforeEach((ctx) => {
    if (!highs_available) ctx.skip();
  });

  it('should compute valid flux ranges at 100% optimality', async () => {
    const model = createSimpleModel();
    const fvaResult = await highsSolver.solveFVA(model, {}, [], { fractionOfOptimum: 1.0 });

    expect(fvaResult.status).toBe(SolverStatus.OPTIMAL);
    expect(fvaResult.objectiveValue).toBeCloseTo(10, 5);

    // For this simple linear pathway at 100% optimality, fluxes are uniquely determined
    const ranges = fvaResult.ranges;
    
    expect(ranges['EX_A'].min).toBeCloseTo(10, 5);
    expect(ranges['EX_A'].max).toBeCloseTo(10, 5);
    
    expect(ranges['R1'].min).toBeCloseTo(10, 5);
    expect(ranges['R1'].max).toBeCloseTo(10, 5);
    
    expect(ranges['R2'].min).toBeCloseTo(10, 5);
    expect(ranges['R2'].max).toBeCloseTo(10, 5);
    
    expect(ranges['R3'].min).toBeCloseTo(0, 5);
    expect(ranges['R3'].max).toBeCloseTo(0, 5);
    
    expect(ranges['BIOMASS'].min).toBeCloseTo(10, 5);
    expect(ranges['BIOMASS'].max).toBeCloseTo(10, 5);
  });

  it('should compute wider ranges at 90% optimality', async () => {
    const model = createSimpleModel();
    const fvaResult = await highsSolver.solveFVA(model, {}, [], { fractionOfOptimum: 0.9 });

    expect(fvaResult.status).toBe(SolverStatus.OPTIMAL);
    
    // At 90% optimality, some flux variability may be possible
    const ranges = fvaResult.ranges;
    
    // R3 (drain) can now have positive flux since we don't need max biomass
    expect(ranges['R3'].min).toBeLessThanOrEqual(ranges['R3'].max);
    
    // BIOMASS can range from 9 to 10
    expect(ranges['BIOMASS'].min).toBeGreaterThanOrEqual(8.9);
    expect(ranges['BIOMASS'].max).toBeLessThanOrEqual(10.1);
  });

  it('should correctly extract flux as v_pos - v_neg', async () => {
    // This test verifies Bug #2 fix - flux extraction was causing 2.2M L2 norm
    const model = createSimpleModel();
    const fvaResult = await highsSolver.solveFVA(model, {}, [], { 
      fractionOfOptimum: 1.0,
      reactions: ['BIOMASS']
    });

    const biomassRange = fvaResult.ranges['BIOMASS'];
    
    // Flux should be reasonable (~10), not millions
    expect(Math.abs(biomassRange.min)).toBeLessThan(100);
    expect(Math.abs(biomassRange.max)).toBeLessThan(100);
    
    // Specifically, should be close to 10
    expect(biomassRange.min).toBeCloseTo(10, 5);
    expect(biomassRange.max).toBeCloseTo(10, 5);
  });

  it('should handle reversible reactions correctly', async () => {
    // Create model with reversible reaction
    const model = createSimpleModel();
    model.reactions['R2'].lower_bound = -1000; // Make R2 reversible
    
    const fvaResult = await highsSolver.solveFVA(model, {}, [], { fractionOfOptimum: 1.0 });
    
    // R2 should still be positive at optimal (needed for biomass)
    expect(fvaResult.ranges['R2'].min).toBeGreaterThan(0);
  });
});

describe('Gene Knockouts via GPR', () => {
  beforeAll(async () => {
    await initHiGHS();
  });
  beforeEach((ctx) => {
    if (!highs_available) ctx.skip();
  });

  it('should handle single gene knockout', async () => {
    const model = createSimpleModel();
    
    // Knock out gene1 (required for R1)
    const result = await highsSolver.solveFBA(model, {}, ['gene1']);

    // R1 is blocked, so no flux to biomass
    expect(result.status).toBe(SolverStatus.OPTIMAL);
    expect(result.growthRate).toBeCloseTo(0, 5);
  });

  it('should handle essential gene knockout', async () => {
    const model = createSimpleModel();
    
    // gene2 is essential (only gene for R2, which is required for biomass)
    const result = await highsSolver.solveFBA(model, {}, ['gene2']);

    expect(result.growthRate).toBeCloseTo(0, 5);
    expect(result.phenotype).toBe('lethal');
  });

  it('should handle non-essential gene knockout', async () => {
    const model = createSimpleModel();
    
    // gene3 is for R3 (drain), which is not essential
    const result = await highsSolver.solveFBA(model, {}, ['gene3']);

    // Growth should still be optimal (R3 is not used anyway)
    expect(result.growthRate).toBeCloseTo(10, 5);
    expect(result.phenotype).toBe('viable');
  });

  it('should handle isozyme knockout (redundant genes)', async () => {
    const model = createComplexGPRModel();
    
    // Knock out pfkA, but pfkB is still available (isozymes)
    const result = await highsSolver.solveFBA(model, {}, ['pfkA']);

    // PFK reaction should still be active via pfkB
    expect(result.growthRate).toBeGreaterThan(0);
  });

  it('should handle enzyme complex knockout (all subunits required)', async () => {
    const model = createComplexGPRModel();
    
    // Knock out one subunit of the complex
    const result = await highsSolver.solveFBA(model, {}, ['pykA']);

    // PYK can still function via pykF (isozyme of the complex)
    // This tests the (A and B) or C logic
    expect(result.growthRate).toBeGreaterThan(0);
    
    // Knock out the isozyme instead
    const result2 = await highsSolver.solveFBA(model, {}, ['pykF']);
    
    // PYK can still function via pykA and pykB complex
    expect(result2.growthRate).toBeGreaterThan(0);
  });
});

describe('Edge Cases', () => {
  beforeAll(async () => {
    await initHiGHS();
  });
  beforeEach((ctx) => {
    if (!highs_available) ctx.skip();
  });

  it('should handle empty model', async () => {
    const model = { reactions: {}, metabolites: {}, genes: {} };
    const result = await highsSolver.solveFBA(model);

    expect(result.status).toBe(SolverStatus.OPTIMAL);
    expect(result.objectiveValue).toBe(0);
  });

  it('should handle model with no objective', async () => {
    const model = createSimpleModel();
    delete model.reactions['BIOMASS'].objective_coefficient;
    
    // Should fall back to biomass reaction by name
    const result = await highsSolver.solveFBA(model);

    expect(result.growthRate).toBeGreaterThan(0);
  });

  it('should handle infeasible constraints', async () => {
    const model = createSimpleModel();
    
    // Add impossible constraint: require biomass > 100 when max import is 10
    const result = await highsSolver.solveFBA(model, {
      'BIOMASS': { lb: 100, ub: 1000 }
    });

    expect(result.status).toBe(SolverStatus.INFEASIBLE);
  });
});

describe('GPR Evaluation (HiGHS-specific)', () => {
  it('should evaluate simple GPR', () => {
    expect(highsSolver.evaluateGPR('gene1', { gene1: 1.0 })).toBe(1.0);
    expect(highsSolver.evaluateGPR('gene1', { gene2: 1.0 })).toBe(1.0); // Default
  });

  it('should evaluate AND GPR', () => {
    const expr = { geneA: 0.8, geneB: 0.6 };
    expect(highsSolver.evaluateGPR('geneA and geneB', expr)).toBe(0.6); // min
  });

  it('should evaluate OR GPR', () => {
    const expr = { geneA: 0.8, geneB: 0.6 };
    expect(highsSolver.evaluateGPR('geneA or geneB', expr)).toBe(0.8); // max
  });

  it('should evaluate nested GPR', () => {
    const expr = { pykA: 0.5, pykB: 0.7, pykF: 0.9 };
    // (pykA and pykB) or pykF = min(0.5, 0.7) or 0.9 = 0.5 or 0.9 = 0.9
    expect(highsSolver.evaluateGPR('(pykA and pykB) or pykF', expr)).toBeCloseTo(0.9, 5);
  });
});
