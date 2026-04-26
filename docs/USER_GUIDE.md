# User Guide

**Comprehensive guide for using MetabolicSuite**

---

## Table of Contents

- [Getting Started](#getting-started)
- [Loading Models](#loading-models)
- [Running FBA](#running-fba)
- [Omics Integration](#omics-integration)
- [Visualization](#visualization)
- [Educational Features](#educational-features)
- [Advanced Analysis](#advanced-analysis)
- [Tips and Tricks](#tips-and-tricks)

---

## Getting Started

### First Launch

1. Open MetabolicSuite in your browser
2. Default E. coli core model is loaded
3. Explore the interface:
   - **Learn tab**: Tutorials, quizzes, learning paths
   - **Model tab**: Upload, manage, switch models
   - **Analyze tab**: FBA, FVA, pFBA, MOMA
   - **Visualize tab**: Pathway maps, charts, heatmaps

### Navigation

- **Tab Switcher**: Click tab names at top of screen
- **Keyboard Shortcuts**:
  - `v` / `p` / `a`: Switch view modes
  - `z` (Ctrl+Z): Undo
  - `y` (Ctrl+Y): Redo
  - `/`: Search
  - `Esc`: Deselect all

---

## Loading Models

### Model Formats

MetabolicSuite supports multiple model formats:

| Format | Extension | Source | Notes |
|---------|-----------|--------|-------|
| **SBML** | .xml, .sbml | BiGG, Biomodels | Best for genome-scale models |
| **COBRApy JSON** | .json | COBRApy export | Full model data |
| **BiGG Models** | (download) | BiGG database | Direct import |

### Loading a Model

#### Method 1: Upload File

1. Click **"Model"** tab
2. Click **"Upload Model"** button
3. Select file from your computer
4. Wait for parsing (usually <2 seconds)
5. Model loads with statistics displayed

**Supported File Types**:
- SBML (`.xml`, `.sbml`)
- COBRApy JSON (`.json`)
- Custom JSON (internal format)

#### Method 2: Download from BiGG

1. Click **"Model"** tab
2. Click **"Download from BiGG"**
3. Select organism:
   - Escherichia coli (iML1515)
   - Saccharomyces cerevisiae (iMM904)
   - Bacillus subtilis (iYO844)
   - etc.
4. Click **"Download"**
5. Model automatically loads

#### Method 3: Use Default Model

The built-in E. coli core model includes:
- 95 reactions
- 72 metabolites
- 30 genes
- Core pathways (glycolysis, TCA, PPP, overflow metabolism)

### Model Information Display

After loading, you'll see:

```
Model: E. coli Core (Educational)
Format: SBML
Compartments: c (cytosol), e (extracellular)

Statistics:
  Genes: 30
  Reactions: 95
  Metabolites: 72
  Nodes: 72
  Edges: 90

Subsystems:
  - Glycolysis (10 reactions)
  - TCA Cycle (9 reactions)
  - Pentose Phosphate Pathway (7 reactions)
  - Transport (20 reactions)
  - Exchange (15 reactions)
  - Biomass (1 reaction)
```

---

## Running FBA

### Setting Up FBA

1. Navigate to **"Analyze"** tab
2. Click **"FBA"** button (default selected)
3. Set exchange constraints:
   - **Glucose uptake**: -10 (default)
   - **Oxygen uptake**: -20 (default)
4. (Optional) Set objective reaction (default: auto-detect)
5. Click **"Solve FBA"**

### Understanding FBA Parameters

**Exchange Constraints**:
- Negative values: Uptake into cell (substrate import)
- Zero: No exchange (blocked)
- Positive values: Secretion from cell (product export)

**Example**:
```
EX_glc__D_e:  -10  → Uptake 10 mmol/gDW/h glucose
EX_o2_e:      -20  → Uptake 20 mmol/gDW/h oxygen
EX_ac_e:        0   → No acetate exchange (unconstrained)
```

**Objective Reaction**:
- Usually biomass reaction (e.g., `BIOMASS_Ecoli`)
- Solver maximizes flux through objective
- Default: Auto-detect based on name

**Gene Knockouts**:
- Select genes to knockout
- GPR rules evaluated
- Reactions blocked if any required gene knocked out

### Interpreting FBA Results

**Result Panel** displays:

**Growth Rate**:
- Optimal biomass production rate
- Units: 1/h (per hour)
- Example: `0.877 h⁻¹` for E. coli on glucose

**Flux Distribution**:
- Table showing all reaction fluxes
- Color-coded:
  - **Green**: High flux (>10)
  - **Yellow**: Medium flux (1-10)
  - **Red**: Low flux (<1)
  - **Gray**: Blocked (flux = 0)

**Phenotype**:
- **Optimal**: Biomass maximized
- **Suboptimal**: Constraints limit growth
- **Infeasible**: Contradictory constraints
- **Unbounded**: No upper/lower bound on objective

### Running FVA (Flux Variability Analysis)

1. After FBA, click **"FVA"** tab
2. Set **fraction of optimal**: 0.9 (90% of maximum growth)
3. Click **"Solve FVA"**
4. View min/max flux ranges for all reactions

**Understanding FVA Results**:

```
Reaction     Min      Max      Range      Status
EX_glc       -10      -10      0         Fixed
PGI           7.5      7.5      0          Fixed
PFK           4.2      7.8      3.6        Flexible
TPI           2.1      4.2      2.1        Flexible
BIOMASS       0.87     0.87     0          Fixed at optimal
```

- **Fixed reactions**: Min = Max (determined by constraints)
- **Flexible reactions**: Can vary while maintaining 90% growth

### Running pFBA (Parsimonious FBA)

1. Click **"pFBA"** tab
2. Set parameters:
   - **Objective**: Biomass reaction
3. Click **"Solve pFBA"**

**What pFBA Does**:
- Finds flux distribution that:
  1. Maximizes biomass (same as FBA)
  2. Minimizes total flux sum (parsimony)
- Result: More realistic flux distribution

**Interpretation**:
- Lower total flux = more efficient metabolism
- Useful when FBA has infinite solutions

### Running MOMA (Minimization of Metabolic Adjustment)

1. First run FBA to get wild-type fluxes
2. Knock out gene(s) in "Gene Knockouts" section
3. Click **"MOMA"** tab
4. Click **"Solve MOMA"**

**What MOMA Does**:
- Minimizes Euclidean distance to wild-type
- For knockouts, predicts phenotype
- More realistic than FBA for large knockouts

**Interpretation**:
- **Low distance** (<1): Mild growth defect
- **Medium distance** (1-5): Moderate growth defect
- **High distance** (>5): Severe growth defect
- **Very high distance** (>10): Lethal

---

## Omics Integration

### Uploading Omics Data

1. Navigate to **"Analyze"** tab
2. Click **"Omics Data"** section
3. Select omics type:
   - **Transcriptomics** (gene expression, RNA-seq, microarray)
   - **Proteomics** (protein abundance)
   - **Metabolomics** (metabolite concentrations)
   - **Fluxomics** (measured fluxes, 13C-MFA)
4. Upload file:
   - CSV/TSV (recommended)
   - Excel (.xlsx, .xls)
5. Map columns:
   - **ID column**: Gene/protein/metabolite IDs
   - **Value columns**: Expression/abundance/concentration

### File Format Requirements

**CSV/TSV Format**:
```csv
Gene_ID,  Condition1,  Condition2,  Condition3
gene1,   10.5,       8.2,       12.1
gene2,   7.3,        9.1,       6.8
gene3,   11.2,       13.5,      9.4
```

**Excel Format**:
- First row: Column headers
- Subsequent rows: Data values
- Gene/protein/metabolite IDs in first column

### Selecting Integration Method

#### GIMME (Gene Inactivity Moderated by Metabolism and Expression)

**Best For**: Transcriptomics with clear up/down regulation

**Parameters**:
- **Expression threshold**: Bottom 25% = low expression (default)
- **Fraction of optimal**: Maintain 90% of wild-type growth (default)

**What It Does**:
1. Classify reactions as low/medium/high expression
2. Minimize flux through low-expression reactions
3. Maintain high growth rate

**Interpretation**:
- **Low inconsistency score** (<100): Expression matches fluxes well
- **High inconsistency score** (>500): Expression suggests different metabolic state

#### E-Flux (Expression-constrained Flux Analysis)

**Best For**: Relative expression data (log2 fold change)

**Parameters**:
- **Scaling method**:
  - **Linear**: Direct proportional scaling
  - **Log**: Log-linear scaling
  - **Percentile**: Rank-based scaling
- **Minimum bound**: 1% of original (default)

**What It Does**:
1. Map gene expression to reactions via GPR
2. Scale reaction bounds proportionally to expression
3. Solve FBA with modified bounds

**Interpretation**:
- High expression → High flux capacity
- Low expression → Low flux capacity
- No flux if expression too low

#### iMAT (Integrative Metabolic Analysis Tool)

**Best For**: Discrete expression states (high/medium/low)

**Parameters**:
- **High threshold**: Top 25% = high expression (default)
- **Low threshold**: Bottom 25% = low expression (default)
- **Epsilon**: Minimum flux threshold 0.001 (default)

**What It Does**:
1. Classify reactions as high/medium/low
2. Binary optimization: Activate high, deactivate low
3. Maximize expression consistency

**Interpretation**:
- **Consistency score**:
  - **>0.8**: Good match between expression and fluxes
  - **0.5-0.8**: Moderate match
  - **<0.5**: Poor match (expression outdated or different conditions)

#### MADE (Metabolic Adjustment by Differential Expression)

**Best For**: Comparative studies (control vs treatment)

**Parameters**:
- **Fold change threshold**: log2FC > 2 = differential (default)

**What It Does**:
1. Run E-Flux on control expression
2. Run E-Flux on treatment expression
3. Calculate flux changes
4. Identify differentially active reactions

**Interpretation**:
- **Upregulated reactions**: Higher flux in treatment
- **Downregulated reactions**: Lower flux in treatment
- **Fold change**: log2 ratio (treatment/control)

---

## Visualization

### Pathway Maps

#### Viewing a Pathway

1. Navigate to **"Visualize"** tab
2. Click **"Pathway Map"** section
3. Select subsystem:
   - **Glycolysis** (10 reactions)
   - **TCA Cycle** (9 reactions)
   - **Pentose Phosphate Pathway** (7 reactions)
   - **All** (95 reactions, may be crowded)

#### Interactive Features

**Navigation**:
- **Pan**: Click and drag background
- **Zoom**: Mouse wheel, or +/- buttons
- **Fit to view**: Press `f`

**Node Manipulation**:
- **Select**: Click node
- **Move**: Drag node
- **Delete**: Select, press Delete/Backspace
- **Add**: Double-click background, add metabolite

**Edge Manipulation**:
- **Select**: Click edge
- **Label**: Double-click to edit
- **Delete**: Select, press Delete

**Keyboard Shortcuts**:
- `v`: Select mode
- `p`: Pan mode
- `a`: Add mode
- `Delete/Backspace`: Delete selected
- `Ctrl+Z`: Undo
- `Ctrl+Y`: Redo
- `Ctrl+F`: Search

#### Omics Overlays

1. Load omics data (see Omics Integration section)
2. Configure visualization:
   - **Target**: Edges (reactions) or Nodes (metabolites)
   - **Property**: Color, width, size, opacity, animation
   - **Color scale**: Diverging (up/down), sequential, categorical
3. Apply overlay to pathway map

**Color Coding** (Diverging Scale):
- **Red**: High upregulation
- **White**: No change
- **Blue**: High downregulation

### Flux Heatmaps

1. Run FBA/FVA to get results
2. Navigate to **"Visualize"** tab
3. Click **"Flux Heatmap"** section
4. Heatmap displays:
   - Rows: Reactions (grouped by subsystem)
   - Columns: Conditions (e.g., wild-type vs mutants)
   - Colors: Flux values

**Interpretation**:
- **Bright colors**: High flux
- **Dark colors**: Low flux
- **Green to red scale**: Flux magnitude

### Production Envelopes

1. Navigate to **"Analyze"** tab
2. Click **"Production Envelope"** button
3. Set parameters:
   - **X-axis substrate**: e.g., Glucose
   - **Y-axis product**: e.g., Biomass, Succinate
   - **Substrate range**: 0-20 mmol/gDW/h
   - **Product range**: 0-15 mmol/gDW/h
4. Click **"Generate Envelope"**

**Interpretation**:
- **Optimal point**: Maximum product at given substrate
- **Trade-offs**: Substrate vs product relationship
- **Bottlenecks**: Vertical lines indicate flux limitations

### Comparative Analysis

1. Run FBA for multiple conditions (e.g., wild-type, knockout 1, knockout 2)
2. Navigate to **"Visualize"** tab
3. Click **"Comparative Analysis"**
4. Charts display:
   - Bar chart: Growth rate comparison
   - Line chart: Flux changes across conditions
   - Scatter plot: Flux correlation

---

## Educational Features

### Learning Modules

#### Module 1: Understanding FBA

**Prerequisites**: None

**Content**:
1. Introduction to constraint-based modeling
2. Mathematical formulation
3. Interactive constraint exploration
4. Solve FBA on toy model
5. Interpret results

**Quiz**: 10 questions, 5 XP per correct answer

#### Module 2: Reading Real Papers

**Prerequisites**: Module 1 completed

**Content**:
1. Load published flux distribution (e.g., E. coli iML1515)
2. Attempt to reproduce with FBA
3. Compare your results to published values
4. Understand experimental uncertainty

**Quiz**: 8 questions, 10 XP per correct answer

#### Module 3: Design Your Experiment

**Prerequisites**: Module 2 completed

**Content**:
1. Design knockout strategy
2. Predict phenotypes using FBA/FVA/MOMA
3. Form hypothesis
4. Validate with literature

**Quiz**: 5 questions, 15 XP per correct answer

### Gamification

#### XP System

- **Correct quiz answer**: +5 XP to +15 XP (difficulty-based)
- **Complete module**: +50 XP
- **Reproduce published result**: +25 XP
- **Correct phenotype prediction**: +30 XP

#### Leveling

| Level | XP Required | Title |
|-------|-------------|-------|
| 1 | 0-100 | Metabolic Novice |
| 2 | 100-250 | Flux Analyst |
| 3 | 250-500 | Systems Biologist |
| 4 | 500-1000 | Metabolic Engineer |
| 5 | 1000+ | Principal Investigator |

#### Badges

Unlockable achievements:

**Solver Badges**:
- 🎯 **First FBA**: Run first FBA analysis
- 📊 **FVA Explorer**: Complete FVA analysis
- 🎯 **Parsimonious**: Run pFBA
- 🔧 **Adjustment Master**: Run MOMA

**Omics Badges**:
- 📈 **GIMME User**: Run GIMME analysis
- 📉 **E-Flux Expert**: Run E-Flux analysis
- 🎭 **Integrator**: Run iMAT analysis

**Visualization Badges**:
- 🗺️ **Map Maker**: Create custom pathway
- 🔍 **Search Master**: Use search feature
- ⌨️ **Keyboard Ninja**: Use 10+ keyboard shortcuts

**Educational Badges**:
- 📚 **Module 1**: Complete first learning module
- 📖 **Module 2**: Complete second learning module
- 🎓 **Module 3**: Complete third learning module
- 🏆 **Quiz Champion**: Get 90%+ on all quizzes

---

## Advanced Analysis

### Synthetic Lethality

1. Load genome-scale model (e.g., E. coli iML1515)
2. Navigate to **"Analyze"** tab
3. Click **"Gene Knockouts"** section
4. Add genes to knockout:
   - Click "Add Gene" button
   - Enter gene ID (e.g., `pfkA`)
   - Repeat for multiple genes
5. Click **"Solve FBA"** (with MOMA recommended)

**Interpretation**:
- **Growth rate = 0**: Lethal knockout
- **Growth rate <0.1 × wild-type**: Severe growth defect
- **Growth rate 0.5-0.9 × wild-type**: Moderate defect

### Double Knockout Analysis

To test synthetic lethality:

1. Knock out Gene 1 (e.g., `pfkA`)
2. Note growth rate (e.g., 0.75 h⁻¹)
3. Reset to wild-type
4. Knock out Gene 2 (e.g., `pfkB`)
5. Note growth rate (e.g., 0.70 h⁻¹)
6. Knock out BOTH genes simultaneously
7. Observe growth rate:
   - **0**: Synthetic lethal (both required)
   - **0.75**: Single knockout lethal, double lethal
   - **0.70**: Both single lethal (not synthetic)

### Phenotype Phase Plane Analysis

**Use Case**: Identify optimal substrate/product combinations

1. Navigate to **"Analyze"** tab
2. Click **"Production Envelope"**
3. Configure:
   - X-axis: Glucose uptake (0-20)
   - Y-axis: Succinate production (0-15)
   - Oxygen: Fixed at -20
4. Click **"Generate Envelope"**
5. Plot displays:
   - **Optimal curve**: Maximum succinate at each glucose level
   - **Trade-off**: Glucose vs succinate
   - **Bottlenecks**: Vertical lines (oxygen limitation)

**Interpretation**:
- **Slope**: Product yield per substrate
- **Plateau**: Limiting reagent (oxygen)
- **Knee point**: Optimal operating point

### Multi-Condition Comparison

1. Load omics data for multiple conditions (e.g., 3 time points)
2. Run FBA for each condition using omics integration (e.g., GIMME)
3. Navigate to **"Visualize"** tab
4. Click **"Comparative Analysis"**
5. View:
   - Growth rates over time
   - Flux changes between conditions
   - Pathway activation patterns

---

## Tips and Tricks

### Performance Optimization

**For Large Models** (>2000 reactions):
- Use **Subsystem view** instead of full pathway map
- **Close other browser tabs** to free memory
- **Disable animations** in settings
- **Export results** instead of keeping in browser

**For Slow Solvers**:
- Use **FVA on subset** of reactions (not all)
- Set **fraction of optimal** lower (e.g., 0.8 instead of 0.9)
- Use **pFBA** instead of MOMA (faster)

### Model Preparation

**Before Loading**:
- Validate SBML using [SBML Validator](https://sbml.org/validator)
- Remove unused metabolites/reactions
- Ensure biomass reaction exists
- Check compartment suffixes (`_c` for cytosol, `_e` for extracellular)

**Best Practices**:
- Use **standard BiGG IDs** for genes/metabolites
- Include **GPR rules** for all reactions
- Annotate **subsystems** for pathway mapping
- Add **objective coefficient** (1.0 for biomass)

### Data Management

**Exporting Results**:
1. Run analysis (FBA, FVA, etc.)
2. Click **"Export"** button
3. Select format:
   - **CSV**: Spreadsheet-compatible
   - **JSON**: Machine-readable
   - **SVG**: Publication-quality figures
4. Download file

**Saving Workspaces**:
- **Browser local storage**: Automatically saves current model and settings
- **Export workspace**: Export current state to JSON
- **Import workspace**: Restore previous session from JSON file

### Common Patterns

**Growth Limitation Diagnosis**:

| Symptom | Likely Cause | Solution |
|----------|--------------|----------|
| Low growth | Substrate limited | Increase substrate uptake |
| Low growth | ATP limited | Check energy metabolism |
| Low growth | Oxygen limited | Verify aeration in experimental conditions |
| No growth | Missing essential gene | Check gene essentiality |

**Flux Analysis Patterns**:

| Pattern | Interpretation | Example |
|---------|--------------|---------|
| High glycolysis, low TCA | Fermentative metabolism | E. coli anaerobic growth |
| Blocked reaction | Gene knockout or inhibitor | PfkA knockout |
| High flux in alternative pathway | Regulation or overflow | Acetate overflow |

### Keyboard Shortcuts Reference

| Shortcut | Action |
|----------|--------|
| `v` | Enter select mode |
| `p` | Enter pan mode |
| `a` | Enter add mode |
| `Delete` / `Backspace` | Delete selected |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+F` / `/` | Search |
| `n` | Next search result |
| `Ctrl+N` / `Shift+N` | Previous search result |
| `0` | Reset zoom |
| `+` / `-` | Zoom in/out |
| `f` | Fit view |
| `l` | Toggle labels |
| `g` | Toggle GPR display |
| `Space` | Toggle animation |
| `Ctrl+S` | Save workspace |
| `Ctrl+E` | Export as SVG |

---

## Troubleshooting

### Common User Issues

**Issue: Model won't load**

**Symptoms**:
- Upload button does nothing
- Error message: "Invalid SBML format"

**Solutions**:
1. Check file is valid SBML (use [validator](https://sbml.org/validator))
2. Ensure file is not corrupted
3. Try different format (COBRApy JSON)
4. Check browser console for error details

**Issue: FBA fails**

**Symptoms**:
- "Infeasible" status
- "Unbounded" status
- Error message after clicking "Solve FBA"

**Solutions**:
1. **Infeasible**:
   - Check exchange bounds (at least one substrate)
   - Ensure biomass reaction exists
   - Remove contradictory constraints

2. **Unbounded**:
   - Add upper bound to objective reaction
   - Add lower/upper bounds to all reactions

**Issue: Visualization is slow**

**Symptoms**:
- Lag when moving nodes
- Freezing when zooming

**Solutions**:
1. Reduce number of visible nodes (use subsystem view)
2. Disable animations
3. Close other browser tabs
4. Use faster browser (Chrome, Firefox)

**Issue: Omics integration fails**

**Symptoms**:
- "Gene not found" errors
- "Invalid data format" errors

**Solutions**:
1. Ensure gene IDs match model
2. Check column mapping is correct
3. Use standard BiGG gene IDs
4. Verify data is numeric (not text)

---

## Next Steps

- Explore [tutorials](./docs/ALGORITHMS.md) for detailed algorithm explanations
- Read [API documentation](./docs/API.md) for advanced usage
- Check [troubleshooting guide](./docs/TROUBLESHOOTING.md) for common issues
- See [contributing guidelines](./docs/CONTRIBUTING.md) to improve the platform

---

*Last Updated: December 25, 2025*
