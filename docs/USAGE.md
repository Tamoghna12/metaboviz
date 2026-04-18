# MetaboViz — Usage Guide

This guide walks through every feature from model upload to phenotype analysis.

---

## Table of Contents

1. [Loading a model](#1-loading-a-model)
2. [Pathway browser](#2-pathway-browser)
3. [Reactions tab](#3-reactions-tab)
4. [Metabolites tab](#4-metabolites-tab)
5. [Genes tab](#5-genes-tab)
6. [Pathway maps](#6-pathway-maps)
7. [FBA panel](#7-fba-panel)
8. [Gene knockout & phenotype simulation](#8-gene-knockout--phenotype-simulation)
9. [Comparative model viewer](#9-comparative-model-viewer)
10. [Export](#10-export)
11. [Keyboard shortcuts](#11-keyboard-shortcuts)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Loading a model

### Drag and drop

Drag any `.xml` (SBML) or `.json` (COBRApy/BiGG) file onto the landing page drop zone.

**SBML support**: Level 2 and Level 3 with FBC package (flux bounds, gene associations), Groups package (subsystem assignment), and Layout package (optional node positions).

**JSON support**: COBRApy `model.to_json()` format and direct BiGG database downloads.

### Example model

Click **Try E. coli Example** on the landing page to load the E. coli core model immediately with no file required.

### Getting model files

| Source | URL | Format |
|--------|-----|--------|
| BiGG Models | bigg.ucsd.edu → model page → Download JSON | JSON |
| BioModels | ebi.ac.uk/biomodels → model → Files | SBML |
| MetaNetX | metanetx.org → model → Download | SBML |
| COBRApy | `cobra.io.save_json_model(model, "model.json")` | JSON |

### What gets parsed

- All reactions with stoichiometry, bounds, reversibility
- All metabolites with compartment assignment
- All genes with GPR associations
- Subsystem/pathway annotations
- Objective reaction (biomass or specified)

---

## 2. Pathway browser

The **Pathways** tab is the default view after loading a model.

### Category cards

Reactions are automatically classified into biological categories (Amino Acid Metabolism, Lipid Metabolism, Transport, etc.) by matching subsystem names against a curated keyword dictionary derived from BiGG and KEGG nomenclature.

Each card shows:
- Reaction count and percentage of the total model
- Metabolite count
- Number of subsystems within the category

Click a card to expand it and see individual subsystems.

### Treemap view

Switch to the **Treemap** view (button in the top-right of the Pathways tab) for a size-proportional visual overview of the entire model. Block area encodes reaction count. Click any block to navigate into that subsystem.

### Search

The global search bar (top-right of the app or pressing `/`) searches across reaction IDs, reaction names, metabolite names, and gene IDs simultaneously. Results are highlighted inline.

### Breadcrumb navigation

Once inside a subsystem, a breadcrumb trail appears at the top: `All Pathways > Category > Subsystem`. Click any level to go back.

---

## 3. Reactions tab

Lists every reaction in the current model (or current subsystem if drilled in).

### Columns

| Column | Description |
|--------|-------------|
| ID | BiGG/SBML reaction identifier |
| Name | Human-readable name |
| Stoichiometry | Full equation with compartment suffixes colour-coded |
| Rev | Badge shown for reversible reactions (lb < 0) |
| Bounds | `[lb, ub]` in mmol/gDW/h |
| GPR | Gene-protein-reaction rule (AND/OR boolean) |

### Sorting and filtering

Click any column header to sort. Use the search bar to filter by substring. Toggle **Rev** / **GPR** buttons to show only reversible or GPR-annotated reactions.

---

## 4. Metabolites tab

Lists all metabolites with compartment, formula (if available in the model), and connectivity (number of reactions each metabolite participates in).

---

## 5. Genes tab

Lists all genes. For each gene, shows:
- Gene ID and product name
- Subsystem(s) the gene is associated with via GPR rules
- Number of reactions controlled by this gene

---

## 6. Pathway maps

Click the **Maps** tab to open the Escher-style pathway visualiser.

### Built-in templates

| Template | Coverage |
|----------|----------|
| E. coli Central Carbon | Glycolysis, PPP, TCA, overflow metabolism |
| Glycolysis | EMP pathway with ATP investment/payoff phases |
| TCA Cycle | Full Krebs cycle with cofactor stoichiometry |
| Pentose Phosphate | Oxidative and non-oxidative branches |

### Loading a BiGG Escher map

Select any option from the **BiGG / Escher (online)** group in the dropdown. The app fetches the map directly from `escher.github.io`. Requires an internet connection.

Available: E. coli Core, E. coli iJO1366, S. cerevisiae iMM904, and more.

### Importing your own Escher map

Select **+ Load Escher JSON…** and choose a `.json` file exported from [escher.github.io](https://escher.github.io/). Full cubic-bezier segment routing is preserved.

### Navigation

| Action | How |
|--------|-----|
| Pan | Click and drag |
| Zoom | Scroll wheel |
| Fit to screen | Click **Fit** button |
| Zoom in/out | **+** / **−** buttons |

### Flux overlay

After running FBA (see section 7), reaction edges automatically colour-code:

- **Green**: forward flux (v > 0)
- **Orange**: reverse flux (v < 0)
- **Grey**: blocked (v ≈ 0)
- **Edge width**: scales with |flux| magnitude

### Phenotype overlay

After running a WT vs KO comparison (see section 8), the colour scheme switches to:

- **Red**: reaction lost flux in KO (WT active, KO blocked)
- **Purple**: reaction gained flux in KO
- **Orange**: flux reduced > 50% in KO
- **Green**: active in both with similar flux
- **Grey**: inactive in both

---

## 7. FBA panel

Click the **FBA** button in the top-right header to open the FBA panel docked at the bottom of the screen.

### Setting constraints

The constraints table lists exchange reactions. For each, you can set:
- **lb** (lower bound): negative = uptake, positive = export minimum
- **ub** (upper bound): maximum export flux

Common constraints:
```
EX_glc__D_e   lb = -10    (glucose uptake 10 mmol/gDW/h)
EX_o2_e       lb = -20    (aerobic, unrestricted)
EX_o2_e       lb = 0      (anaerobic)
```

### Objective

The objective reaction is auto-detected from the model (typically `BIOMASS_*`). You can change it from the dropdown.

### Running FBA

Click **Run FBA**. The solver (GLPK.js) formulates the LP, solves it, and returns:
- **Objective value** (growth rate μ in h⁻¹ for biomass objective)
- **All reaction fluxes** — shown in the Reactions tab and overlaid on the pathway map

Typical solve time: 0.2–1 s for genome-scale models.

### Interpreting results

| Status | Meaning |
|--------|---------|
| OPTIMAL | Solution found; objective value is the maximum |
| INFEASIBLE | Constraints are contradictory — check that at least one carbon source exchange has a negative lb |
| UNBOUNDED | Missing an upper bound — unlikely with standard models |

---

## 8. Gene knockout & phenotype simulation

With the FBA panel open:

1. Type a gene ID in the **Knockout genes** search box
2. Matching genes appear; click to add them to the KO set
3. Click **Compare WT vs KO**

The solver runs **two FBA problems in parallel**:
- Wild-type: no knockouts
- Knockout: GPR boolean evaluation blocks all reactions whose enzyme complex or sole isozyme requires the knocked-out gene(s)

Results shown in the FBA panel header:
```
WT μ = 0.877 → KO μ = 0.412  (−53%)   12 reactions lost · 3 gained
```

The pathway map and network canvas update simultaneously with the phenotype colour overlay.

### GPR logic

```
(geneA and geneB) or geneC
```
- If `geneA` is knocked out: the AND complex is broken → reaction blocked **unless** `geneC` is present (isozyme)
- If both `geneA` and `geneC` are knocked out: reaction fully blocked

MetaboViz evaluates GPR rules recursively using a proper boolean parser — it does not approximate.

---

## 9. Comparative model viewer

Click **Compare** in the header to open the side-by-side model diff panel.

### Loading models

Each slot (A and B) has its own drag-and-drop zone. Load any two SBML or BiGG JSON models.

### Output

**Overlap bar**: A-only (blue) | Shared (teal) | B-only (amber) reactions

**Sørensen-Dice similarity**:
```
D = 2 × |shared| / (|A| + |B|)
```
A value of 1.0 means identical reaction sets; 0.0 means no overlap.

**Subsystem table**: for each subsystem, shows reaction count in A, reaction count in B, and status (shared / A-only / B-only).

**Reaction diff table**: every reaction across both models, filterable by status. Shows bounds from each model side by side.

---

## 10. Export

The **Export** tab (last tab in SubsystemView) provides:

- **CSV export**: reactions, metabolites, or genes as tab-separated values
- **SVG export**: network canvas or treemap as a scalable vector graphic suitable for publication/poster use
- **JSON export**: the parsed model in internal format

---

## 11. Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `/` | Focus global search |
| `Escape` | Clear search / go up one level |
| `↑` / `↓` | Navigate search results or subsystem list |
| `Enter` | Select highlighted item |
| `F` | Toggle FBA panel |
| `C` | Toggle Compare panel |
| `D` | Toggle dark mode |

---

## 12. Troubleshooting

### Model fails to load

- **SBML**: validate your file at [sbml.org/validator](https://sbml.org/validator/). The most common issue is missing the FBC package namespace for flux bounds.
- **JSON**: ensure it is a COBRApy `model.to_json()` export with `reactions` and `metabolites` arrays at the top level.

### FBA returns INFEASIBLE

- Ensure at least one carbon/nitrogen source exchange has a negative lower bound (uptake allowed)
- Check that the biomass reaction is not itself blocked by a missing metabolite exchange
- For anaerobic models: set `EX_o2_e` lb = 0, ensure fermentation product exchanges are open

### Pathway map not showing flux colours

FBA must be run **after** loading the model. If you loaded a model, switched to Maps, and then ran FBA, the colours should appear automatically. If not, click **Fit** to redraw.

### App is slow with a very large model (>5 000 reactions)

- Use the **Pathways** tab to navigate subsystems rather than loading the full network
- The network canvas limits itself to the top 30 most-connected metabolites by default for performance
- Close other browser tabs to free heap memory

### BiGG map fails to load

The BiGG Escher maps are fetched from `escher.github.io`. If you are behind a firewall or have no internet connection, use the built-in templates or import a locally saved Escher JSON file instead.
