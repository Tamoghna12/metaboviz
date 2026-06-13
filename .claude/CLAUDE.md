# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Starting the Application

**Quick start (from this directory):**
```bash
npm install        # first time only
npm run dev        # starts at http://localhost:5173 (auto-increments if port is taken)
```

Open the printed URL in a browser. Drag-and-drop an SBML (.xml) or COBRApy JSON (.json) model file onto the landing page to load it.

**Build & Development:**
- `npm run dev` — Start Vite dev server with HMR (http://localhost:5173)
- `npm run build` — Create production bundle in `dist/`
- `npm run preview` — Preview the built app locally (serves `dist/`)
- `npm run lint` — Run ESLint (flat config, no TypeScript)

**If port 5173 is already in use** (multiple dev servers running), Vite auto-picks the next available port (5174, 5175, …). Check the terminal output for the actual URL.

**Test & Quality:**
- No automated test suite currently configured. Manual testing is done via dev server or preview.

## Codebase Architecture

### Overview
MetabolicSuite is an interactive educational platform for constraint-based metabolic modeling (CBM). It visualizes complex biological concepts through React components and implements FBA (Flux Balance Analysis) solvers in pure JavaScript.

### Project Structure

**Entry Points:**
- `src/main.jsx` - App bootstrap
- `src/App.jsx` - Navigation hub (home landing page vs. learning platform)

**Core Components:**
- `src/components/MetabolicModelingPlatform.jsx` - Main container for learning/simulation (wrapped with ProgressProvider for XP/achievements)
- `src/components/EducationalFeatures.jsx` - Learning system (XP tracking, badges, quizzes, tutorials, learning paths)
- `src/components/EnhancedModeling.jsx` - Constraint-based modeling solvers (FBA, PFBA, MOMA, FVA) with flux analysis
- `src/components/Visualizations.jsx` - Network graphs, heatmaps, pathway diagrams, comparative analysis

**State & Context:**
- `src/contexts/ThemeContext.jsx` - Dark mode toggle + colorblind-accessible palette (IBM Design Library colors)
- `src/contexts/ModelContext.jsx` - Dynamic model management (upload, select, remove models)

**Data & Utilities:**
- `src/data/metabolicData.js` - Static educational modules (intro, FBA, GPR, FVA, PFBA, MOMA), default E. coli reactions/genes
- `src/utils/modelParser.js` - Unified parser entry point with auto-format detection (JSON/SBML)
- `src/utils/sbmlParser.js` - Comprehensive SBML parser (Level 2/3, FBC, Groups, Layout packages)

**Styling:**
- `src/index.css` - Tailwind + CSS custom properties for theming
- `src/App.css` - Minimal app-specific styles
- `postcss.config.js` & Tailwind v4 configuration included

### Toolbar Features (integration status)

All buttons are in `ModelVisualizerApp.jsx`. Each is mutually exclusive (toggling one closes others).

| Button | Component | Status |
|---|---|---|
| Live Flux | `LiveFluxCanvas.jsx` | ✅ Real — Escher-style canvas, bezier edges, flux-width encoding |
| Compare | `CompareView.jsx` | ✅ Real — parallel FBA on two models, structural diff |
| Validate | `ValidationPanel.jsx` | ✅ Real — reproduces Orth 2010 / Feist 2007 reference values |
| Gene KO | `EssentialGenePanel.jsx` | ✅ Real — FBA loop over all genes, classifies essential/non-essential |
| Phase Plane | `PhasePlanePanel.jsx` | ✅ Real — 2D FBA sweep over two exchange fluxes |
| Media Analysis | `GapFillPanel.jsx` | ⚠️ Partial — FBA-based minimal media + blocked reaction scan; true MILP gap-filling not implemented client-side |

The **Uncertainty** button was removed — its panel had no computation behind it (UI stub only).

### Key Architectural Decisions

**Simulation Engine:** FBASolver implemented in pure JavaScript (no external solver). It's a simplified educational implementation—not intended for genome-scale production models.

**Educational Features:** ProgressProvider context wraps learning modules with progression tracking (XP, unlocked badges). Quizzes are multiple-choice, keyed to module content.

**Visual Encoding:** ThemeContext provides CSS custom properties and accessible color palettes. Colorblind mode uses IBM Design Library palette (Blue/Magenta/Gold/Purple) with separate light/dark variants. Graphs, heatmaps, and diagrams use Recharts.

**Model Loading:** ModelContext wraps the app and provides `useModel()` hook. Supports two formats via drag-and-drop:
- **JSON:** CobraPy export (`model.to_json()`) and BIGG Models database downloads
- **SBML/XML:** Level 2 and Level 3 with FBC package (flux bounds, gene associations), Groups package (subsystems), and Layout package (visual coordinates)

`parseModel()` auto-detects format, normalizes structure, and generates network graph layout. The SBML parser extracts compartments, species, reactions with stoichiometry, GPR associations, and flux bounds without external dependencies.

**Code Splitting:** Heavy components (Visualizations, Recharts charts) are lazy-loaded with React.lazy/Suspense. Vite's manualChunks splits React, Recharts, and icons into separate cacheable bundles.

### Development Notes

- **JS not TS:** Project uses .jsx/.js files, not TypeScript. ESLint configured for JSX but set to ignore unused variables starting with uppercase/underscore.
- **No Testing Framework:** Tests would be manual or require Jest/Vitest setup.
- **Vite + React 19:** Uses latest React with @vitejs/plugin-react for Babel/Fast Refresh.
- **Styling:** Tailwind CSS 4.x with PostCSS. CSS custom properties set dynamically by ThemeContext for light/dark modes and colorblind modes.
- **Educational Focus:** Modules contain quiz objects with questions/options. Learning paths tracked via progress context. Tooltips and badges provide progressive disclosure.

### Common Patterns

**React Hooks:** Heavy use of useState, useEffect, useCallback for component logic and side effects. useTheme() is the main context consumer.

**Component Composition:** Complex features broken into smaller components (e.g., Visualizations has NetworkGraph, FluxHeatmap, PathwayDiagram, etc.). EnhancedModeling exports multiple solvers.

**Simulation State:** MetabolicModelingPlatform manages constraints, knockouts, solver method, and results as local state; runs simulation on changes via useEffect.

**Data Flow:** Educational modules remain static in metabolicData.js. Metabolic model data (reactions, genes) comes from ModelContext which defaults to E. coli core but supports user-uploaded models. Simulation results and UI state managed per-component.

**Accessibility:** ARIA roles and labels added to interactive elements. Focus indicators on buttons. Colorblind mode toggles both `accessibleColors` object and CSS custom properties (`--success`, `--warning`, `--danger`, `--info`).

### Supported Model Sources

Models can be obtained from these databases and exported in supported formats:
- **BIGG Models** (bigg.ucsd.edu) - JSON format
- **BioCyc** (biocyc.org) - SBML Level 3
- **MetaNetX** (metanetx.org) - SBML with FBC
- **KEGG** (genome.jp/kegg) - SBML export
- **BioModels** (ebi.ac.uk/biomodels) - SBML Level 2/3
- **CobraPy exports** - `model.to_json()` or `cobra.io.write_sbml_model()`
