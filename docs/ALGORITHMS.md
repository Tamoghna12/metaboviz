# Algorithms

**Mathematical formulations and algorithm details for MetabolicSuite**

---

## Table of Contents

- [Flux Balance Analysis (FBA)](#flux-balance-analysis-fba)
- [Flux Variability Analysis (FVA)](#flux-variability-analysis-fva)
- [Parsimonious FBA (pFBA)](#parsimonious-fba-pfba)
- [Minimization of Metabolic Adjustment (MOMA)](#minimization-of-metabolic-adjustment-moma)
- [GPR Boolean Logic](#gpr-boolean-logic)
- [GIMME]((#gimme)
- [E-Flux]((#e-flux)
- [iMAT]((#imat)
- [MADE]((#made)
- [Graph Layout Algorithm](#graph-layout-algorithm)

---

## Flux Balance Analysis (FBA)

### Mathematical Formulation

**Problem Definition**:
```
Maximize:    cᵀ · v
Subject to:   S · v = 0           (Steady-state mass balance)
              lb ≤ v ≤ ub           (Flux bounds)
```

**Where**:
- **v**: Flux vector (n × 1) - reaction fluxes
- **S**: Stoichiometric matrix (m × n) - metabolite × reaction coefficients
- **c**: Objective coefficients (n × 1) - typically biomass = 1
- **lb**: Lower bounds vector (n × 1)
- **ub**: Upper bounds vector (n × 1)

### Implementation Details

**Stoichiometric Matrix Construction**:
```javascript
// From buildStoichiometricMatrix(model):
const S = Array(metabolites.length).fill(null)
  .map(() => Array(reactions.length).fill(0));

// Fill matrix: S[i][j] = stoichiometric coefficient
// S[i][j] = coefficient of metabolite i in reaction j
// Positive: Product (output metabolite)
// Negative: Reactant (input metabolite)
```

**LP Problem Setup** (glpk.js):
```javascript
const problem = {
  name: 'FBA',
  objective: {
    direction: glpk.GLP_MAX,  // Maximize objective
    name: 'biomass',
    vars: [
      { name: 'BIOMASS_Ecoli', coef: 1.0 }
    ]
  },
  subjectTo: [],  // S · v = 0 constraints
  
  bounds: []  // Flux bounds
};

// Add variables (reactions) with bounds
reactions.forEach((rxn, j) => {
  problem.bounds.push({
    name: rxnId,
    type: getBoundType(rxn.lower_bound, rxn.upper_bound),
    lb: rxn.lower_bound,
    ub: rxn.upper_bound
  });
});

// Add equality constraints (steady-state)
metabolites.forEach((met, i) => {
  const vars = [];
  
  reactions.forEach((rxn, j) => {
    const coeff = S[i][j];
    if (coeff !== 0) {
      vars.push({
        name: met.id,
        type: glpk.GLP_FX,
        coef: coeff
      });
    }
  });
  
  problem.subjectTo.push({
    name: `mass_balance_${met.id}`,
    vars: vars,
    bnds: { type: glpk.GLP_FX, lb: 0, ub: 0 }
  });
});
```

### Gene Knockout Integration

**GPR Evaluation**:
```javascript
// For each reaction, check if GPR evaluates to true
const activeGenes = new Set(allGenes.filter(g => !knockedOut.has(g)));

Object.entries(model.reactions).forEach(([rxnId, rxn]) => {
  const gpr = rxn.gpr || '';
  const isActive = evaluateGPR(gpr, activeGenes);
  
  if (!isActive) {
    // Block reaction by setting bounds to [0, 0]
    rxn.lower_bound = 0;
    rxn.upper_bound = 0;
  }
});
```

### Complexity Analysis

**Time Complexity**:
- Stoichiometric matrix construction: O(n × m)
- LP setup: O(n + m) where n = reactions, m = metabolites
- Solving: Depends on LP solver, typically O(n²·m) for simplex
- **Overall**: O(n × m + n²·m)

**Space Complexity**:
- Stoichiometric matrix: O(n × m)
- Flux vector: O(n)
- **Overall**: O(n × m) for dense storage

**Where**:
- **n**: Number of reactions
- **m**: Number of metabolites

### Reference

- **Orth et al. (2010)** "What is flux balance analysis?" Nat Biotechnol 28:245-248
- **Varma & Palsson (1994)** "Stoichiometric flux balance models for growth of Escherichia coli K-12" Appl Environ Microbiol 60:395-407
- **Edwards & Palsson (2000)** "Properties and analysis of genome-scale metabolic reconstructions" J Bioinform 6:301-306

---

## Flux Variability Analysis (FVA)

### Mathematical Formulation

**For each reaction i**:
```
Minimize:    v_i
Subject to:   S · v = 0
              cᵀ · v ≥ Z*   (Optimal biomass constraint)
              lb_j ≤ v_j ≤ ub_j   (Flux bounds for all reactions)
```

**Where**:
- **v_i**: Flux of reaction i (being minimized/maximized)
- **Z***: Optimal biomass value from FBA
- **fraction**: Fraction of optimal (default: 0.9)

**Two LP problems per reaction**:
1. **Minimize v_i** (lower bound)
2. **Maximize v_i** (upper bound)

### Implementation Details

**Biomass Constraint Calculation**:
```javascript
// Get optimal biomass from FBA
const fbaResult = await solveFBA(model);
const optimalBiomass = fbaResult.objectiveValue;
const minBiomass = optimalBiomass * fraction;  // e.g., 0.9 * Z*

// Add biomass constraint for FVA
problem.subjectTo.push({
  name: 'optimal_biomass',
  vars: [
    { name: 'BIOMASS_Ecoli', coef: 1.0 }
  ],
  bnds: { type: glpk.GLP_LO, lb: minBiomass }
});
```

**Reaction-Wise FVA**:
```javascript
for (const rxnId of Object.keys(model.reactions)) {
  // Minimize v_i (lower bound)
  const minResult = await glpk.minimize({
    objective: {
      direction: glpk.GLP_MIN,
      name: rxnId,
      vars: [{ name: rxnId, coef: 1.0 }]
    },
    subjectTo: steadyStateConstraints,  // All constraints
    bounds: allBounds
  });
  const minFlux = minResult.result.vars[rxnId].value;
  
  // Maximize v_i (upper bound)
  const maxResult = await glpk.maximize({
    objective: {
      direction: glpk.GLP_MAX,
      name: rxnId,
      vars: [{ name: rxnId, coef: 1.0 }]
    },
    subjectTo: [...steadyStateConstraints, optimalBiomassConstraint],
    bounds: allBounds
  });
  const maxFlux = maxResult.result.vars[rxnId].value;
  
  variability[rxnId] = { min: minFlux, max: maxFlux };
}
```

### Blocked Reactions

**A reaction is blocked if:**
```javascript
const isBlocked = (minFlux === maxFlux) && (minFlux === 0);

// Or:
const isBlocked = (Math.abs(maxFlux - minFlux) < epsilon);  // epsilon = 0.001
```

### Complexity Analysis

**Time Complexity**:
- Per reaction: O(n × m + n²·m)
- For N reactions: N × (O(n × m + n²·m)
- **Overall**: O(N × m + N × n²·m) for N reactions

**Space Complexity**:
- Stoichiometric matrix: O(n × m)
- Flux variability: O(N) - one min/max per reaction
- **Overall**: O(n × m)

---

## Parsimonious FBA (pFBA)

### Mathematical Formulation

**Two-Objective Problem**:
```
Maximize:    cᵀ · v  (Primary: maximize biomass)
Minimize:    Σ |v_j| (Secondary: minimize total flux)
Subject to:   S · v = 0
              cᵀ · v = Z*   (Constrain biomass to optimal)
              lb_j ≤ v_j ≤ ub_j
```

**Where**:
- **Σ |v_j|**: Sum of absolute fluxes (L1 norm)
- **Z***: Optimal biomass from standard FBA

### Implementation Details

**Auxiliary Variables for Flux Sum**:
```javascript
// For each reaction, create two non-negative variables
// v_j_plus ≥ 0, v_j_minus ≥ 0
// Such that: v_j = v_j_plus - v_j_minus

problem.vars = [];

Object.keys(model.reactions).forEach((rxnId, j) => {
  const v_plus = `v_${rxnId}_plus`;
  const v_minus = `v_${rxnId}_minus`;
  
  problem.vars.push(
    { name: v_plus, coef: 0, lbs: { type: glpk.GLP_LO, lb: 0 } },
    { name: v_minus, coef: 0, lbs: { type: glpk.GLP_LO, lb: 0 } }
  );
});

// Add constraint: v_j = v_j_plus - v_j_minus
// (v_plus) - (v_minus) = 0, so v_plus = v_minus
problem.subjectTo.push({
  name: `flux_decomposition_${rxnId}`,
  vars: [
    { name: v_plus, coef: 1 },
    { name: v_minus, coef: -1 }
  ],
  bnds: { type: glpk.GLP_FX, lb: 0, ub: 0 }
});
```

**Total Flux Objective**:
```javascript
problem.objective = {
  direction: glpk.GLP_MIN,
  name: 'total_flux',
  vars: Object.values(model.reactions).map((rxnId, j) => {
    return { name: `v_${rxnId}_plus`, coef: 1 };
  })
};
```

**Biomass Constraint**:
```javascript
// From FBA solution
const optimalBiomass = fbaResult.objectiveValue;

problem.subjectTo.push({
  name: 'biomass_constraint',
  vars: [{ name: 'BIOMASS_Ecoli', coef: 1.0 }],
  bnds: { type: glpk.GLP_FX, lb: optimalBiomass, ub: optimalBiomass }
});
```

### Flux Reconstruction

After solving:
```javascript
const fluxes = {};

Object.keys(model.reactions).forEach(rxnId => {
  const v_plus = result.result.vars[`v_${rxnId}_plus`]?.value || 0;
  const v_minus = result.result.vars[`v_${rxnId}_minus`]?.value || 0;
  fluxes[rxnId] = v_plus - v_minus;
});
```

### Complexity Analysis

**Time Complexity**:
- Setup: O(n + m) - variables and constraints
- Solving: O(n³·m) - more complex than FBA due to second objective
- **Overall**: O(n³·m)

**Space Complexity**:
- Auxiliary variables: O(n) - 2 per reaction
- Stoichiometric matrix: O(n × m)
- **Overall**: O(n × m)

---

## Minimization of Metabolic Adjustment (MOMA)

### Mathematical Formulation

```
Minimize:    ||v - v_wt||²     (Euclidean distance)
Subject to:   S · v = 0              (Steady-state for mutant)
              lb_j ≤ v_j ≤ ub_j      (Flux bounds)
```

**Where**:
- **v**: Flux vector for mutant
- **v_wt**: Wild-type flux vector (pre-computed)
- ||·||²**: L2 norm squared = Σ(v_i - v_wt_i)²

### Implementation Details

**Quadratic Programming** (LP approximation):
MOMA is typically solved as a Quadratic Programming (QP) problem. However, glpk.js is an LP solver, so we approximate QP with LP:

**Approach**: Decompose quadratic objective into linear constraints:

```
Minimize:    Σ (v_i - v_wt_i)²
Subject to:   -D_i ≤ v_i ≤ D_i     (Bounds on difference)
              S · v = 0              (Steady-state)
```

Where D_i = |v_wt_i| + v_wt_i and D_i = -|v_wt_i| + v_wt_i.

### Complexity Analysis

**Time Complexity**:
- Setup: O(n + m)
- Solving: O(n²·m)
- **Overall**: O(n²·m)

**Space Complexity**:
- Wild-type vector: O(n)
- Difference vector: O(n)
- Stoichiometric matrix: O(n × m)
- **Overall**: O(n × m)

### Reference

- **Suthers et al. (2007)** "Genome-scale metabolic model of Escherichia coli MG1655 and its application to strains of knockout mutants" BMC Syst Biol 8:113
- **Segrè et al. (2002)** "Prediction of optimal metabolic behaviour in Escherichia coli from limited growth data using a multiobjective optimization approach" BMC Bioinformatics 18:319

---

## GPR Boolean Logic

### Grammar

**BNF (Backus-Naur Form) for GPR expressions**:
```
<expression> ::= <term> | <expression> "OR" <term> | <term>
<term>       ::= <factor> | "(" <expression> ")"
<factor>       ::= "AND" <factor> | <gene>
<gene>        ::= [a-zA-Z0-9_.-]+
```

**Operator Precedence**:
- Parentheses: Highest
- AND: Higher than OR
- OR: Lowest

### Examples

**Simple AND** (Enzyme Complex):
```
GeneA and GeneB
Evaluates to: true (both genes must be present)

Interpretation: Both genes encode subunits of same enzyme complex
Both required for reaction to be active
```

**Simple OR** (Isozymes):
```
GeneA or GeneB
Evaluates to: true (at least one gene must be present)

Interpretation: Genes encode different isozyme versions
Either sufficient for reaction activity
```

**Nested Expression**:
```
(GeneA and GeneB) or (GeneC and GeneD)
Interpretation:
  - First complex: GeneA and GeneB (both required)
  - Second complex: GeneC and GeneD (both required)
  - Reaction active if either complex is functional
```

### Recursive Descent Parser

**Implementation**:
```javascript
function evaluateGPR(gprString, activeGenes) {
  // Parse into Abstract Syntax Tree (AST)
  const ast = parseGPRAst(gprString);
  
  // Evaluate recursively
  return evaluateGPRAst(ast, activeGenes);
}

function parseGPRAst(tokens, pos = 0) {
  if (tokens[pos] === '(') {
    return parseExpression(tokens, pos + 1);
  }
  
  if (tokens[pos] === ')') {
    const expr = parseExpression(tokens, pos + 1);
    return { type: 'PAREN', child: expr };
  }
  
  // Check for OR
  const nextPos = findNextToken(tokens, pos, 'OR');
  if (tokens[nextPos] === 'OR') {
    const left = parseFactor(tokens, pos + 1);
    const right = parseExpression(tokens, nextPos + 1);
    return { type: 'OR', left, right };
  }
  
  // Default: AND (implicit operator)
  const left = parseFactor(tokens, pos);
  const right = parseExpression(tokens, left);
  return { type: 'AND', left, right };
}

function parseFactor(tokens, pos) {
  if (tokens[pos] === '(') {
    return parseExpression(tokens, pos + 1);
  }
  
  return { type: 'GENE', id: tokens[pos] };
}

function evaluateGPRAst(node, activeGenes) {
  switch (node.type) {
    case 'GENE':
      return activeGenes.has(node.id);
    
    case 'AND':
      return evaluateGPRAst(node.left, activeGenes) && 
             evaluateGPRAst(node.right, activeGenes);
    
    case 'OR':
      return evaluateGPRAst(node.left, activeGenes) || 
             evaluateGPRAst(node.right, activeGenes);
    
    case 'PAREN':
      return evaluateGPRAst(node.child, activeGenes);
    
    default:
      return true;  // Default to active
  }
}
```

### Complexity Analysis

**Time Complexity**:
- Parsing: O(L) where L is GPR string length
- Evaluation: O(N) where N is number of AND/OR operators
- **Overall**: O(L + N)

**Space Complexity**:
- AST: O(L) where L is number of tokens
- Stack depth: O(D) where D is nesting depth
- **Overall**: O(L)

### Reference

- **Bennett et al. (2001)** "Transcriptional regulation of Escherichia coli genes" BMC Microbiol 3:2733-2774

---

## GIMME

### Mathematical Formulation

**Phase 1: Expression Classification**
```
For each reaction r, calculate expression e_r from GPR:
e_r = gprToReactionExpression(GPR_r, E_gene)

Define low-expression threshold T:
T = percentile(E_gene_values, percentile)  // Default: 25th percentile

Classify reactions:
  High if e_r ≥ T
  Medium if T/2 ≤ e_r < T
  Low   if e_r < T/2
```

**Phase 2: Base FBA**
```
Solve standard FBA to get optimal biomass Z*:
Maximize:    cᵀ · v
Subject to:   S · v = 0
              lb ≤ v ≤ ub
```

**Phase 3: GIMME Objective**

```
Minimize:    Σ (T - e_r) · |v_r|   for low-expression reactions
Subject to:   S · v = 0
              cᵀ · v ≥ Z*       (Maintain fraction of optimal)
              lb_j ≤ v_j ≤ ub_j
```

Where:
- **T**: Threshold (top value of low-expression classification)
- **Z***: Optimal biomass from Phase 2
- **fraction**: Fraction of optimal to maintain (default: 0.9)
- **e_r**: Reaction expression from GPR
- **|v_r|**: Absolute flux through reaction r

### Implementation Details

**Auxiliary Variables for Penalty Terms**:
```javascript
problem.vars = [];

// For each low-expression reaction
lowExpressionReactions.forEach((rxnId, r) => {
  const penaltyVar = `penalty_${rxnId}`;
  
  problem.vars.push({
    name: penaltyVar,
    coef: T - e_r,  // Penalty coefficient
    lbs: { type: glpk.GLP_LO, lb: 0 }  // Penalty ≥ 0
  });
  
  // Flux variable
  problem.vars.push({
    name: rxnId,
    coef: 1 0
  });
});
```

**Inconsistency Score**:
```javascript
const inconsistencyScore = lowExpressionReactions.reduce((sum, rxnId) => {
  const flux = fluxes[rxnId] || 0;
  return sum + Math.abs(flux * (T - e_r));
}, 0);
```

### Complexity Analysis

**Time Complexity**:
- Expression calculation: O(n × g) where g = max genes in GPR
- Classification: O(n × log n) for sorting
- LP solving: O(n³·m) due to additional penalty terms
- **Overall**: O(n³·m)

**Space Complexity**:
- Expression values: O(n × g)
- GPR AST: O(n × g)
- Penalty variables: O(n) for low-expression reactions
- Stoichiometric matrix: O(n × m)
- **Overall**: O(n × m + n × g)

### Reference

- **Becker & Palsson (2008)** "Context-specific metabolic networks of Escherichia coli: core and intermediate reconstruction" PLoS Comput Biol 4:e1000030
- **Flassw & Palsson (2009)** "Using the Escherichia coli genome-scale metabolic model to predict gene essentiality" BMC Bioinformatics 25:466

---

## E-Flux

### Mathematical Formulation

**Phase 1: Expression Scaling**
```
For each reaction r, calculate expression e_r from GPR:
e_r = gprToReactionExpression(GPR_r, E_gene)

Normalize expression values:
e'_r = e_r / max(E_gene_values)

Scale reaction bounds proportionally:
lb'_r = lb_r · ub_original
ub'_r = e'_r · ub_original
```

**Phase 2: Standard FBA**

```
Maximize:    cᵀ · v
Subject to:   S · v = 0
              lb'_r ≤ v_r ≤ ub'_r      (Scaled bounds)
```

**Where**:
- **ub_original**, **lb_original**: Original bounds from model
- **e'_r**: Normalized expression (0 to 1)

### Implementation Details

**Scaling Methods**

**Linear Scaling** (default):
```javascript
const e_r = expression / maxExpression;
const newLb = originalLb * e_r;
const newUb = originalUb * e_r;
```

**Log Scaling**:
```javascript
const e_r = Math.log2(expression + 1) / Math.log2(maxExpression + 1);
const newLb = originalLb * e_r;
const newUb = originalUb * e_r;
```

**Percentile Scaling**:
```javascript
const sortedExpr = [...expressionValues].sort((a, b) => a - b);
const rank = sortedExpr.indexOf(expression) / sortedExpr.length;
const e_r = rank / sortedExpr.length;  // 0 to 1
```

### Complexity Analysis

**Time Complexity**:
- Expression calculation: O(n × g) where g = max genes in GPR
- Normalization: O(n) for finding max
- LP solving: O(n²·m) (same as FBA)
- **Overall**: O(n²·m)

**Space Complexity**:
- Normalized expression: O(n)
- Scaled bounds: O(n)
- Stoichiometric matrix: O(n × m)
- **Overall**: O(n × m)

### Reference

- **Colijn et al. (2009)** "Interpreting expression data with metabolic flux models" Mol Syst Biol 5:305-310

---

## iMAT

### Mathematical Formulation

**Phase 1: Expression Classification**
```
For each reaction r, calculate expression e_r from GPR:
e_r = gprToReactionExpression(GPR_r, E_gene)

Define thresholds:
  H = percentile(E_gene_values, p_high)  // Default: 75th percentile
  L = percentile(E_gene_values, p_low)   // Default: 25th percentile
  ε = 0.001                          // Minimum flux threshold

Classify reactions:
  High:  e_r ≥ H
  Low:  e_r ≤ L
  Medium: L < e_r < H
```

**Phase 2: Binary Optimization**

```
For each reaction r, introduce binary variable y_r:
  y_r ∈ {0, 1}
  y_r = 1 → r is active
  y_r = 0 → r is inactive

Maximize:    Σ c_r · y_r         + Σ (1 - c_r) · (1 - y_r) · v_r
Subject to:   S · v = 0
              lb'_r ≤ v_r ≤ ub'_r   (Conditional bounds based on y_r)
              H: c_r = 1         → High expression, prefer activation
              L: c_r = 0          → Low expression, prefer inactivation
              ε: ε ≤ |v_r| ≤ y_r       |v_r| ≥ ε · y_r
```

Where:
- **c_r**: Reaction coefficient in objective
- **v_r**: Flux variable
- **y_r**: Binary activity variable
- **H**: Set of high-expression reactions
- **L**: Set of low-expression reactions

### Implementation Details

**Binary Variables**:
```javascript
const highExprReactions = [];
const lowExprReactions = [];

Object.entries(model.reactions).forEach(([rxnId, rxn]) => {
  const e_r = getReactionExpression(rxn);
  
  if (e_r >= highThreshold) {
    highExprReactions.push(rxnId);
  } else if (e_r <= lowThreshold) {
    lowExprReactions.push(rxnId);
  }
});

// Add binary variables for each reaction
highExprReactions.forEach(rxnId => {
  const y_active = `y_${rxnId}`;
  const y_inactive = `y_inactive_${rxnId}`;
  
  problem.vars.push(
    { name: y_active, coef: 1, type: glpk.GLP_BV, lbs: { type: glpk.GLP_FX, lb: 0, ub: 1 } },
    { name: y_inactive, coef: 1, type: glpk.GV_BV, lbs: { type: glpk.GLP_FX, lb: 0, ub: 1 } }
  );
});
```

**Conditional Bounds**:
```javascript
// For each reaction, add conditional constraint based on y_r
highExprReactions.forEach(rxnId => {
  const y_active = `y_${rxnId}`;
  const y_inactive = `y_inactive_${rxnId}`;
  
  // Constraint: y_inactive · v ≤ ε OR y_active · v ≥ ε
  problem.subjectTo.push({
    name: `conditional_bounds_${rxnId}`,
    vars: [
      { name: y_inactive, coef: 1 },
      { name: y_active, coef: 1 }
    ],
    bnds: { type: glpk.GLP_DB, ub: epsilon }  // y_inactive · v ≤ ε
  });
});
```

### Complexity Analysis

**Time Complexity**:
- Expression classification: O(n × g)
- LP setup: O(n + m) - binary variables
- Solving: O(n²·m) - MILP is harder than LP
- **Overall**: O(n²·m)

**Space Complexity**:
- Binary variables: O(n)
- Conditional constraints: O(n)
- Stoichiometric matrix: O(n × m)
- **Overall**: O(n × m)

### Reference

- **Shlomi et al. (2008)** "Network-based prediction of human tissue-specific metabolism" Nat Biotechnol 26:427-430
- **Zur et al. (2010)** "Integrating expression data in genome-scale metabolic models: a probabilistic approach" Bioinformatics 26:645

---

## MADE

### Mathematical Formulation

**Phase 1: E-Flux for Control**
```
Solve E-Flux for control expression E_ctrl:
Maximize:    cᵀ · v_ctrl
Subject to:   S · v_ctrl = 0
              lb'_ctrl · v_ctrl ≤ ub'_ctrl   (Expression-scaled bounds)
```

**Phase 2: E-Flux for Treatment**
```
Solve E-Flux for treatment expression E_trt:
Maximize:    cᵀ · v_trt
Subject to:   S · v_trt = 0
              lb'_trt · v_trt ≤ ub'_trt   (Expression-scaled bounds)
```

**Phase 3: Differential Expression Analysis**

For each reaction r:
```
Define fold change:
  FC_r = log2(v_trt / v_ctrl)  (if v_ctrl ≠ 0)

Identify differentially active:
  |FC_r| ≥ FC_threshold  AND |v_trt - v_ctrl| ≥ ε
  → Differentially active

Where:
  FC_threshold = 2.0  (log2 fold change)
  ε = 0.001 (minimum flux threshold)
```

### Complexity Analysis

**Time Complexity**:
- E-Flux solving: O(n²·m) × 2 (control + treatment)
- Differential analysis: O(n)
- **Overall**: O(n²·m)

**Space Complexity**:
- Control fluxes: O(n)
- Treatment fluxes: O(n)
- Differential results: O(n)
- Stoichiometric matrix: O(n × m)
- **Overall**: O(n × m)

### Reference

- **Jensen & Papin (2011)** "A metabolic adjustment method by differential expression (MADE) to predict gene essentiality in Escherichia coli" Bioinformatics 27:279

---

## Graph Layout Algorithm

### Force-Directed Layout

**Mathematical Model**:
```
For each node i and node j, define repulsion force:
F_ij = k_a · ||v_i - v_j||² · d_ij^(-2)

Total energy:
  E = Σ_i<j  F_ij

Layout by minimizing E
```

**Where**:
- **v_i, v_j**: Position vectors of nodes i and j
- **||v_i - v_j||**: Euclidean distance between positions
- **d_ij**: Desired distance (1 in graph)
- **k_a**: Spring constant (repulsion strength)

### Implementation Details

**D3.js Force Simulation**:
```javascript
import { forceSimulation } from 'd3';

const simulation = forceSimulation(nodes)
  .force("charge", chargeStrength)
  .force("collide", collisionRadius)
  .force("link", distanceStrength, distance)
  .force("center", centerStrength)
  .force("x", xStrength)
  .force("y", yStrength)
  .velocityDecay(0.9);  // Dampening

simulation.on('tick', () => {
  // Update node positions
  nodes.forEach(node => {
    node.x += node.vx;
    node.y += node.vy;
  });
});
```

**Collision Detection**:
```javascript
function detectCollisions(nodes) {
  const radius = 20;  // Collision radius (pixels)
  
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const distance = Math.sqrt(dx*dx + dy*dy);
      
      if (distance < radius * 2) {
        // Collision detected
        resolveCollision(nodes[i], nodes[j]);
      }
    }
  }
}

function resolveCollision(node1, node2) {
  const dx = node2.x - node1.x;
  const dy = node2.y - node1.y;
  const distance = Math.sqrt(dx*dx + dy*dy);
  
  if (distance < 20) {
    const angle = Math.atan2(dy, dx);
    const offset = 20 - distance;
    
    node1.x -= offset * Math.cos(angle);
    node1.y -= offset * Math.sin(angle);
    node2.x += offset * Math.cos(angle);
    node2.y += offset * Math.sin(angle);
  }
}
```

### Complexity Analysis

**Time Complexity**:
- Force simulation: O(n × iterations) where n = number of nodes
- Typically: O(n × 500) iterations for convergence
- Collision detection: O(n²) per iteration
- **Overall**: O(n³)

**Space Complexity**:
- Node positions: O(n)
- Velocity vectors: O(n)
- Simulation state: O(n)

### Reference

- **Fruchterman & Reingold (1991)** "Graph drawing by force-directed placement" Software - Practice and Experience
- **Jacomy et al. (2014)** "ForceAtlas2: a force-directed graph layout algorithm for visualizing biological networks" BMC Bioinformatics 2014

---

*Last Updated: December 25, 2025*
