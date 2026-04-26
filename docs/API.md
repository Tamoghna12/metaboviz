# API Reference

**Complete API documentation for MetabolicSuite modules and components**

---

## Table of Contents

- [FBASolver API](#fbasolver-api)
- [OmicsIntegration API](#omicsintegration-api)
- [ModelParser API](#modelparser-api)
- [SBMLParser API](#sbmlparser-api)
- [React Components API](#react-components-api)
- [React Hooks API](#react-hooks-api)
- [Context APIs](#context-apis)

---

## FBASolver API

**Module**: `src/lib/FBASolver.js`

Real Flux Balance Analysis solver using glpk.js (WASM-compiled GNU Linear Programming Kit).

### Core Functions

#### `solveFBA(model, options)`

Perform standard Flux Balance Analysis.

**Parameters**:
```typescript
{
  model: {
    reactions: { [rxnId]: Reaction },
    metabolites?: { [metId]: Metabolite },
    genes?: { [geneId]: Gene }
  },
  options: {
    objective?: string,           // Default: auto-detect biomass reaction
    direction?: 'max' | 'min', // Default: 'max'
    knockoutGenes?: Set<string>,  // Genes to knock out
    constraints?: { [rxnId]: { lb: number, ub: number } }
  }
}

interface Reaction {
  name: string,
  metabolites: { [metId]: number },  // Stoichiometry
  lower_bound: number,
  upper_bound: number,
  gpr?: string,
  genes?: string[],
  subsystem?: string
}

interface Metabolite {
  name: string,
  compartment?: string,
  formula?: string,
  charge?: number
}

interface Gene {
  name: string,
  essential?: boolean,
  subsystem?: string
}
```

**Returns**: `Promise<FBAResult>`
```typescript
{
  status: 'OPTIMAL' | 'INFEASIBLE' | 'UNBOUNDED' | 'NO_MODEL',
  objectiveValue: number,        // Optimal biomass/growth rate
  fluxes: { [rxnId]: number }, // Flux vector
  solverInfo: {
    iterations: number,
    status: number,
    time: number
  },
  knockedOutGenes?: string[]    // List of blocked reactions
}
```

**Example**:
```javascript
import { solveFBA } from './lib/FBASolver';

const result = await solveFBA(model, {
  objective: 'BIOMASS_Ecoli',
  knockoutGenes: new Set(['pfkA']),
  constraints: {
    'EX_glc__D_e': { lb: -10 }
  }
});

console.log(`Growth rate: ${result.objectiveValue}`);
console.log(`Fluxes:`, result.fluxes);
```

---

#### `solveFVA(model, options)`

Flux Variability Analysis - compute min/max flux ranges for all reactions at specified fraction of optimality.

**Parameters**:
```typescript
{
  model: Model,
  options: {
    objective?: string,
    fraction?: number,           // Default: 0.9 (90% of optimal)
    knockoutGenes?: Set<string>,
    constraints?: Constraints
  }
}
```

**Returns**: `Promise<FVAResult>`
```typescript
{
  status: string,
  optimalObjective: number,       // Wild-type optimal value
  variability: {
    [rxnId]: {
      min: number,             // Minimum feasible flux
      max: number,             // Maximum feasible flux
      blocked: boolean          // True if min = max = 0
    }
  }
}
```

**Example**:
```javascript
const fvaResult = await solveFVA(model, {
  fraction: 0.9
});

Object.entries(fvaResult.variability).forEach(([rxn, range]) => {
  console.log(`${rxn}: ${range.min} to ${range.max}`);
  if (range.blocked) {
    console.log(`  Reaction blocked by constraints`);
  }
});
```

---

#### `solvePFBA(model, options)`

Parsimonious Flux Balance Analysis - minimize total flux while maintaining optimal biomass.

**Parameters**: Same as `solveFBA()`

**Returns**: `Promise<PFBAResult>`
```typescript
{
  status: string,
  objectiveValue: number,        // Biomass (same as FBA)
  fluxes: { [rxnId]: number },
  totalFlux: number,            // Sum of absolute fluxes
  parsimonyScore: number         // Lower is more parsimonious
}
```

**Example**:
```javascript
const pfbaResult = await solvePFBA(model, {
  objective: 'BIOMASS'
});

console.log(`Total flux: ${pfbaResult.totalFlux}`);
console.log(`Parsimony score: ${pfbaResult.parsimonyScore}`);
```

---

#### `solveMOMA(model, options)`

Minimization of Metabolic Adjustment - minimize Euclidean distance to wild-type flux distribution.

**Parameters**:
```typescript
{
  model: Model,
  options: {
    knockoutGenes: Set<string>,
    wildTypeFluxes?: { [rxnId]: number } // Pre-computed wild-type fluxes
  }
}
```

**Returns**: `Promise<MOMAResult>`
```typescript
{
  status: string,
  fluxes: { [rxnId]: number },
  distanceToWildtype: number,    // Euclidean distance
  relativeDistance: number       // Normalized distance
}
```

**Example**:
```javascript
const momaResult = await solveMOMA(model, {
  knockoutGenes: new Set(['pfkA'])
});

console.log(`Distance to wild-type: ${momaResult.distanceToWildtype}`);
```

---

### GPR Functions

#### `evaluateGPR(gprString, activeGenes)`

Parse and evaluate Gene-Protein-Reaction Boolean expression.

**Parameters**:
```typescript
{
  gprString: string,              // e.g., "b3916 and b1723"
  activeGenes: Set<string>       // Set of active (non-knocked-out) genes
}
```

**Returns**: `boolean`
- `true`: Reaction is active (can carry flux)
- `false`: Reaction is blocked by knockout(s)

**Supported Operators**:
- `AND`: Enzyme complex (all subunits required)
- `OR`: Isozymes (one is sufficient)
- Parentheses: Nested expressions, e.g., `(A and B) or C`

**Example**:
```javascript
import { evaluateGPR } from './lib/FBASolver';

const activeGenes = new Set(['b3916', 'b1723', 'gapA']);

// Simple cases
evaluateGPR('b3916', activeGenes);  // true
evaluateGPR('b3917', activeGenes);  // false

// Complex cases
evaluateGPR('b3916 and b1723', activeGenes);     // true (both present)
evaluateGPR('b3916 and b1723', activeGenes);     // false (b1723 missing)
evaluateGPR('b3916 or b1723', activeGenes);      // true (one is present)
evaluateGPR('(b3916 and b1723) or gapA', activeGenes);  // true
evaluateGPR('(b3916 and b1723) or gapA', new Set(['gapA']));  // true (gapA present)
```

---

#### `buildStoichiometricMatrix(model)`

Construct stoichiometric matrix S (metabolites × reactions) from model.

**Parameters**:
- `model`: Model object

**Returns**: `StoichiometricMatrix`
```typescript
{
  S: number[][],              // Dense matrix [metabolites][reactions]
  metabolites: string[],      // Metabolite IDs
  reactions: string[],       // Reaction IDs
  metIndex: Map<string, number>,  // Metabolite ID → matrix row index
  rxnIndex: Map<string, number>    // Reaction ID → matrix column index
}
```

**Example**:
```javascript
import { buildStoichiometricMatrix } from './lib/FBASolver';

const { S, metabolites, reactions, metIndex, rxnIndex } =
  buildStoichiometricMatrix(model);

// S[i][j] = stoichiometric coefficient of metabolite i in reaction j
console.log(`Matrix size: ${S.length}x${S[0].length}`);
console.log(`Metabolites: ${metabolites.join(', ')}`);
console.log(`Reactions: ${reactions.join(', ')}`);
```

---

#### `extractAllGenes(model)`

Extract all unique genes from model.

**Parameters**:
- `model`: Model object

**Returns**: `Set<string>` - Set of gene IDs

**Example**:
```javascript
import { extractAllGenes } from './lib/FBASolver';

const genes = extractAllGenes(model);
console.log(`Total genes: ${genes.size}`);
console.log(`Genes: ${Array.from(genes).join(', ')}`);
```

---

## OmicsIntegration API

**Module**: `src/lib/OmicsIntegration.js`

Multi-omics data integration algorithms: GIMME, E-Flux, iMAT, MADE.

### Core Functions

#### `solveGIMME(model, geneExpression, options)`

Gene Inactivity Moderated by Metabolism and Expression.

**Algorithm**:
1. Calculate reaction expression from GPR and gene expression
2. Determine expression threshold (bottom percentile)
3. Solve FBA to find optimal biomass
4. Constrain biomass to fraction of optimal
5. Minimize sum of fluxes through low-expression reactions

**Parameters**:
```typescript
{
  model: Model,
  geneExpression: Map<string, number>,  // Gene ID → expression level
  options: {
    threshold?: number,          // Default: 0.25 (bottom 25%)
    requiredFraction?: number,   // Default: 0.9 (90% of optimal)
    objective?: string
  }
}
```

**Returns**: `Promise<GIMMEResult>`
```typescript
{
  status: 'OPTIMAL' | 'BASE_FBA_FAILED' | 'ERROR',
  objectiveValue: number,
  fluxes: { [rxnId]: number },
  reactionExpression: { [rxnId]: number },
  lowExpressionReactions: string[],
  threshold: number,
  inconsistencyScore: number,        // Lower is better
  method: 'GIMME',
  reference: 'Becker & Palsson (2008) PLoS Comput Biol'
}
```

**Example**:
```javascript
import { solveGIMME } from './lib/OmicsIntegration';

const geneExpression = new Map([
  ['b3916', 0.8],
  ['b1723', 0.3],
  ['gapA', 0.9]
]);

const result = await solveGIMME(model, geneExpression, {
  threshold: 0.25,
  requiredFraction: 0.9
});

console.log(`Inconsistency score: ${result.inconsistencyScore}`);
console.log(`Low expression reactions:`, result.lowExpressionReactions);
```

---

#### `solveEFlux(model, geneExpression, options)`

Expression-constrained Flux Analysis.

**Algorithm**:
1. Calculate reaction expression from GPR
2. Normalize expression values
3. Scale reaction bounds proportionally to expression
4. Solve standard FBA with modified bounds

**Parameters**:
```typescript
{
  model: Model,
  geneExpression: Map<string, number>,
  options: {
    scalingMethod?: 'linear' | 'log' | 'percentile',  // Default: 'linear'
    minBound?: number,           // Default: 0.01 (1% of original)
    objective?: string
  }
}
```

**Returns**: `Promise<EFluxResult>`
```typescript
{
  status: string,
  objectiveValue: number,
  fluxes: { [rxnId]: number },
  reactionExpression: { [rxnId]: number },
  scalingMethod: string,
  method: 'E-Flux',
  reference: 'Colijn et al. (2009) Mol Syst Biol'
}
```

**Example**:
```javascript
const result = await solveEFlux(model, geneExpression, {
  scalingMethod: 'linear',
  minBound: 0.01
});

console.log(`Expression-scaled fluxes computed`);
```

---

#### `solveIMAT(model, geneExpression, options)`

Integrative Metabolic Analysis Tool.

**Algorithm**:
1. Classify reactions as high/medium/low expression
2. Introduce binary variables for reaction activity
3. Maximize number of correctly active/inactive reactions
4. Subject to FBA constraints

**Parameters**:
```typescript
{
  model: Model,
  geneExpression: Map<string, number>,
  options: {
    highThreshold?: number,   // Default: 0.75 (top 25%)
    lowThreshold?: number,    // Default: 0.25 (bottom 25%)
    epsilon?: number,         // Default: 0.001 (min flux threshold)
    objective?: string
  }
}
```

**Returns**: `Promise<IMATResult>`
```typescript
{
  status: string,
  objectiveValue: number,
  fluxes: { [rxnId]: number },
  reactionExpression: { [rxnId]: number },
  highExpressionReactions: string[],
  lowExpressionReactions: string[],
  consistency: {
    highActive: number,        // High expression reactions with flux
    highTotal: number,
    lowInactive: number,       // Low expression reactions without flux
    lowTotal: number,
    score: number              // Overall consistency score (0-1)
  },
  method: 'iMAT',
  reference: 'Shlomi et al. (2008) Nat Biotechnol'
}
```

**Example**:
```javascript
const result = await solveIMAT(model, geneExpression, {
  highThreshold: 0.75,
  lowThreshold: 0.25
});

console.log(`Consistency score: ${result.consistency.score}`);
console.log(`High expression active: ${result.consistency.highActive}/${result.consistency.highTotal}`);
```

---

#### `solveMADE(controlExpression, treatmentExpression, options)`

Metabolic Adjustment by Differential Expression.

**Algorithm**:
1. Solve E-Flux for control condition
2. Solve E-Flux for treatment condition
3. Calculate flux changes
4. Identify differentially active reactions

**Parameters**:
```typescript
{
  controlExpression: Map<string, number>,
  treatmentExpression: Map<string, number>,
  options: {
    foldChangeThreshold?: number,  // Default: 2.0 (log2 FC)
    objective?: string
  }
}
```

**Returns**: `Promise<MADEResult>`
```typescript
{
  status: 'COMPLETE',
  control: EFluxResult,
  treatment: EFluxResult,
  fluxChanges: {
    [rxnId]: {
      control: number,
      treatment: number,
      change: number,
      foldChange: number
    }
  },
  differentiallyActive: {
    rxnId: string,
    foldChange: number,
    direction: 'up' | 'down'
  }[],
  objectiveChange: {
    control: number,
    treatment: number,
    percentChange: number
  },
  method: 'MADE',
  reference: 'Jensen & Papin (2011) Bioinformatics'
}
```

**Example**:
```javascript
const controlExpr = new Map([...controlData]);
const treatExpr = new Map([...treatmentData]);

const result = await solveMADE(controlExpr, treatExpr, {
  foldChangeThreshold: 2.0
});

result.differentiallyActive.forEach(({rxnId, foldChange, direction}) => {
  console.log(`${rxnId}: ${direction}regulated, log2FC=${foldChange}`);
});
```

---

#### `gprToReactionExpression(gprString, geneExpression)`

Convert gene expression to reaction expression using GPR rules.

**Parameters**:
```typescript
{
  gprString: string,
  geneExpression: Map<string, number>
}
```

**Returns**: `number`
- **AND (enzyme complex)**: Minimum of subunit expressions
- **OR (isozymes)**: Maximum of isozyme expressions
- **Empty**: Returns 1.0 (constitutive)

**Example**:
```javascript
import { gprToReactionExpression } from './lib/OmicsIntegration';

const expr = new Map([
  ['geneA', 0.9],
  ['geneB', 0.3]
]);

gprToReactionExpression('geneA and geneB', expr);    // 0.3 (minimum)
gprToReactionExpression('geneA or geneB', expr);     // 0.9 (maximum)
gprToReactionExpression('(geneA and geneB) or geneC',
  new Map([...expr, ['geneC', 0.5]));  // 0.5 (max of min and geneC)
```

---

#### `integrateMetabolomics(model, metaboliteConcentrations, options)`

Adjust exchange reaction bounds based on measured metabolite concentrations.

**Parameters**:
```typescript
{
  model: Model,
  metaboliteConcentrations: Map<string, number>,  // Metabolite ID → concentration
  options: {
    method?: 'bound_adjustment' | 'thermodynamic',  // Default: 'bound_adjustment'
    scalingFactor?: number                                   // Default: 0.1
  }
}
```

**Returns**: `IntegrationResult`
```typescript
{
  model: Model,               // Modified model with adjusted bounds
  adjustedExchanges: {
    rxnId: string,
    metabolite: string,
    concentration: number,
    newLb: number,
    newUb: number
  }[],
  method: string
}
```

**Example**:
```javascript
import { integrateMetabolomics } from './lib/OmicsIntegration';

const conc = new Map([
  ['glc__D_e', 10.0],    // 10 mM glucose
  ['o2_e', 5.0]            // 5 mM oxygen
]);

const result = integrateMetabolomics(model, conc, {
  scalingFactor: 0.1
});

result.adjustedExchanges.forEach(adj => {
  console.log(`${adj.rxnId}: ${adj.newLb} to ${adj.newUb}`);
});
```

---

## ModelParser API

**Module**: `src/utils/modelParser.js`

Utilities for parsing and validating model files.

### Functions

#### `parseModel(file)`

Parse model file (SBML or JSON) into internal format.

**Parameters**:
```typescript
{
  file: File  // File object from <input type="file">
}
```

**Returns**: `Promise<ParsedModel>`
```typescript
{
  id: string,
  name: string,
  level?: number,
  version?: number,
  format: 'SBML' | 'JSON',
  compartments: { [compId]: Compartment },
  metabolites: { [metId]: Metabolite },
  genes: { [geneId]: Gene },
  reactions: { [rxnId]: Reaction },
  nodes: Node[],          // Visualization nodes
  edges: Edge[],           // Visualization edges
  metaboliteCount: number,
  geneCount: number,
  reactionCount: number
}
```

**Example**:
```javascript
import { parseModel } from './utils/modelParser';

const file = fileInput.files[0];
const model = await parseModel(file);

console.log(`Loaded ${model.name} with ${model.reactionCount} reactions`);
```

---

## SBMLParser API

**Module**: `src/utils/sbmlParser.js`

SBML (Systems Biology Markup Language) Level 2 and 3 parser with FBC package support.

### Functions

#### `parseSBML(xmlString)`

Parse SBML XML string into internal model format.

**Parameters**:
- `xmlString`: SBML XML string

**Returns**: `ParsedModel` (see ModelParser API)

**Supports**:
- **SBML Level 2 Version 4**
- **SBML Level 3 Version 1 & 2**
- **FBC Package Version 2**: Flux Balance Constraints
- **Layout Package**: Coordinate data for nodes/edges
- **Groups Package**: Subsystem/pathway annotations
- **Render Package**: Visual styling information

**Example**:
```javascript
import { parseSBML } from './utils/sbmlParser';

const xmlString = await file.text();
const model = parseSBML(xmlString);

console.log(`SBML Level ${model.level} Version ${model.version}`);
console.log(`Compartments:`, model.compartments);
```

---

## React Components API

### MetabolicModelingPlatform

**Location**: `src/components/MetabolicModelingPlatform.jsx`

Main application container.

**Props**: None (uses Context providers)

**State Management**:
- Uses `ModelContext`, `OmicsContext`, `ThemeContext`
- Orchestrates all sub-components

**Key Features**:
- Tab-based interface (Learn, Model, Analyze, Visualize)
- Lazy loading of heavy components
- Responsive layout

---

### EnhancedModeling

**Location**: `src/components/EnhancedModeling.jsx`

FBA/FVA/pFBA/MOMA interface.

**Props**:
```typescript
{
  model?: Model,
  onResult?: (result: FBAResult) => void
}
```

**Key Features**:
- Solver method selection (FBA, FVA, pFBA, MOMA)
- Constraint input forms
- Gene knockout interface
- Results visualization (charts, tables)
- Export functionality (CSV, JSON, SVG)

**Example**:
```javascript
<EnhancedModeling
  model={currentModel}
  onResult={(result) => console.log(result.fluxes)}
/>
```

---

### OmicsDataUpload

**Location**: `src/components/OmicsDataUpload.jsx`

Multi-omics data upload and validation.

**Supported Formats**:
- CSV (Comma-Separated Values)
- TSV (Tab-Separated Values)
- Excel (`.xlsx`, `.xls`)

**Data Types**:
- Transcriptomics (gene expression)
- Proteomics (protein abundance)
- Metabolomics (metabolite concentrations)
- Fluxomics (measured fluxes)

**Props**: None (uses OmicsContext)

**Key Features**:
- Drag-and-drop file upload
- Column mapping interface
- Data preview and validation
- Visualization settings per omics type

---

### PathwayMapBuilder

**Location**: `src/components/PathwayMapBuilder.jsx`

Interactive metabolic network visualization.

**Props**:
```typescript
{
  model: Model,
  fluxes?: { [rxnId]: number },
  editable?: boolean,
  showSecondaryMetabolites?: boolean
}
```

**Key Features**:
- D3.js force-directed layout
- Interactive node/edge manipulation
- Pan/zoom/drag
- Keyboard shortcuts
- Undo/redo history
- Search functionality

**Example**:
```javascript
<PathwayMapBuilder
  model={currentModel}
  fluxes={fbaResult.fluxes}
  editable={true}
/>
```

---

### SubsystemView

**Location**: `src/components/SubsystemView.jsx`

Hierarchical subsystem explorer.

**Props**: None (uses ModelContext)

**Key Features**:
- Subsystem tree view
- Click to drill-down into pathways
- Multi-subsystem comparison
- Cross-subsystem navigation

---

## React Hooks API

### useKeyboardShortcuts

**Location**: `src/hooks/useKeyboardShortcuts.js`

Keyboard event handling hook.

**Parameters**:
```typescript
{
  handlers: {
    [actionName]: (event: KeyboardEvent) => void
  },
  enabled?: boolean,
  containerRef?: RefObject<HTMLElement>
}
```

**Returns**:
```typescript
{
  getShortcutLabel: (action: string) => string,
  shortcutGroups: {
    [groupName]: string[]
  },
  shortcuts: { [key]: Shortcut }
}
```

**Default Shortcuts**:
- `v/p/a/r/t`: Mode switching
- `Delete/Backspace`: Delete selected
- `z/y` (with Ctrl): Undo/Redo
- `0/+/ -/f`: Zoom/pan
- `/` (with Ctrl): Open search

---

### useMapHistory

**Location**: `src/hooks/useMapHistory.js`

Undo/redo history management for pathway maps.

**Parameters**:
```typescript
{
  initialNodes?: Node[],
  initialEdges?: Edge[],
  initialAnnotations?: Annotation[]
}
```

**Returns**:
```typescript
{
  nodes: Node[],
  edges: Edge[],
  annotations: Annotation[],
  // History operations
  undo: () => boolean,
  redo: () => boolean,
  clearHistory: () => void,
  canUndo: boolean,
  canRedo: boolean,
  // Tracked updates
  updateNodes: (updater, action) => void,
  updateEdges: (updater, action) => void,
  updateAnnotations: (updater, action) => void,
  moveNode: (nodeId, x, y, final) => void,
  addNode: (node) => string,
  removeNode: (nodeId) => void,
  addEdge: (edge) => string,
  removeEdge: (reactionId) => void,
  batchUpdate: (updateFn, action) => void
}
```

---

### useMapSearch

**Location**: `src/hooks/useMapSearch.js`

Search functionality for pathway elements.

**Parameters**: None

**Returns**:
```typescript
{
  searchQuery: string,
  setSearchQuery: (query: string) => void,
  searchResults: SearchResult[],
  highlightNext: () => void,
  highlightPrev: () => void,
  clearSearch: () => void
}
```

---

## Context APIs

### ModelContext

**Location**: `src/contexts/ModelContext.jsx`

**Provider**:
```javascript
<ModelProvider>
  {/* Child components */}
</ModelProvider>
```

**Hook**:
```javascript
import { useModel } from '../contexts/ModelContext';

const {
  currentModel,
  loading,
  error,
  uploadedModels,
  availableModels,
  loadModel,
  selectModel,
  resetToDefault,
  removeModel,
  modelStats,
  exchangeReactions,
  subsystems,
  isDefaultModel
} = useModel();
```

---

### OmicsContext

**Location**: `src/contexts/OmicsContext.jsx`

**Provider**:
```javascript
<OmicsProvider>
  {/* Child components */}
</OmicsProvider>
```

**Hook**:
```javascript
import { useOmics } from '../contexts/OmicsContext';

const {
  datasets,
  selectedCondition,
  visSettings,
  loading,
  error,
  summary,
  loadOmicsData,
  removeDataset,
  setSelectedCondition,
  updateVisSettings
} = useOmics();
```

---

### ThemeContext

**Location**: `src/contexts/ThemeContext.jsx`

**Provider**:
```javascript
<ThemeProvider>
  {/* Child components */}
</ThemeProvider>
```

**Hook**:
```javascript
import { useTheme } from '../contexts/ThemeContext';

const {
  darkMode,
  colorblindMode,
  fontSize,
  highContrast,
  accessibleColors,
  toggleDarkMode,
  setColorblindMode,
  setFontSize,
  setHighContrast
} = useTheme();
```

---

## Error Handling

All functions return Promise rejections on errors.

**Error Format**:
```typescript
{
  message: string,
  code?: string,
  details?: any
}
```

**Common Error Codes**:
- `NO_MODEL`: Model not provided or empty
- `INVALID_SBML`: SBML parsing failed
- `SOLVER_ERROR`: GLPK solver failed
- `INFEASIBLE`: LP problem has no solution
- `UNBOUNDED`: LP problem is unbounded
- `GENE_NOT_FOUND`: Knockout gene not in model
- `INVALID_EXPRESSION`: Gene expression data format error

---

*Last Updated: December 25, 2025*
