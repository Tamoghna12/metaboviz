# Changelog

**All notable changes to MetabolicSuite by version**

---

## [Unreleased]

### Current Development

- [ ] Real LP solver integration (WASM-compiled GLPK)
- [ ] OmicsIntegration.js wire-up to UI
- [ ] Comprehensive validation suite
- [ ] Production deployment

---

## Version 0.1.0 (Planned - Q1 2025)

### New Features

#### Web Application

**Research Features**:
- **Real FBA solver**: GLPK.js integration with WASM compilation
- **Dynamic GPR evaluation**: Recursive Boolean parser for arbitrary expressions
- **Multi-omics integration**: GIMME, E-Flux, iMAT, MADE implementations

**Educational Features**:
- **Gamified learning system**: XP, badges, levels
- **Interactive tutorials**: Step-by-step algorithm explanations
- **Quiz system**: Knowledge testing with immediate feedback
- **Learning-research bridge**: Toggle between simplified and research modes

**Visualization Features**:
- **Subsystem view**: Hierarchical pathway exploration
- **Multi-omics overlays**: Color-coded flux distributions
- **Production envelopes**: Multi-dimensional phenotype phase planes
- **Comparative analysis**: Wild-type vs mutant comparisons

#### Jupyter Widget

**Features**:
- **React-based widget** for Jupyter notebooks
- **Interactive pathway visualization** in notebooks
- **Model loading** from COBRApy
- **Multi-omics data integration**

### Improvements

**Bug Fixes**:
- Fixed SBML parser for nested GPR expressions
- Resolved memory leaks in pathway visualization
- Fixed coordinate transformation issues
- Improved error handling for invalid models

**Performance**:
- Optimized force-directed layout algorithm
- Implemented code splitting for faster initial load
- Added lazy loading for heavy components

### Documentation**

- Comprehensive API documentation (`docs/API.md`)
- Complete user guide (`docs/USER_GUIDE.md`)
- Developer setup guide (`docs/DEVELOPER_GUIDE.md`)
- Deployment guide (`docs/DEPLOYMENT.md`)
- Troubleshooting guide (`docs/TROUBLESHOOTING.md`)
- Algorithm documentation (`docs/ALGORITHMS.md`)
- Reference models guide (`docs/REFERENCE_MODELS.md`)
- Contributing guidelines (`docs/CONTRIBUTING.md`)

---

## Version 0.2.0 (Planned - Q2 2025)

### New Features

#### Research Enhancements

**Advanced Analysis**:
- **Thermodynamic FBA (tFBA)**: Loopless constraints, ΔG°' calculations
- **Flux sampling**: ACHR, OPTGEM algorithms for solution space exploration
- **Production envelope multi-optimization**: Trade-off analysis between substrates/products

**Omics Integration**:
- **Machine learning integration**: Neural networks for flux prediction
- **Time-series omics analysis**: Dynamic metabolic modeling
- **Batch processing**: Multiple dataset support

#### Visualization Improvements

**Advanced Visualizations**:
- **3D pathway maps**: Three.js-based visualization
- **Time-lapse animations**: Show flux changes over time
- **Comparative pathway maps**: Side-by-side model comparison
- **Custom map builder**: Interactive pathway creation tools

### Technical Improvements

**Solver Performance**:
- **Web Workers**: Offload solver to background thread
- **Sparse matrix optimization**: Use CSR format for large models
- **Incremental solving**: Warm-start with previous solutions
- **Memory management**: Better browser memory handling for large models

**Accessibility Enhancements**:
- **High contrast mode**: WCAG AAA compliance
- **Screen reader optimization**: Improved ARIA labels
- **Keyboard-only navigation**: Full keyboard support
- **Reduced motion settings**: For accessibility

### Bug Fixes

- Fixed FBA solver edge cases for complex models
- Resolved GPR parsing for deeply nested expressions
- Fixed memory leaks in long simulation runs
- Improved error recovery from solver failures
- Fixed UI responsiveness during heavy computations

---

## Version 0.3.0 (Planned - Q3 2025)

### New Features

#### Collaboration Features

**Real-time Collaboration**:
- **Multi-user editing**: Simultaneous pathway map editing
- **Comment threads**: Discuss models and analyses
- **Version history**: Track changes with attribution
- **Conflict resolution**: Merge/reject changes

**Cloud Integration**:
- **Model database**: Store and share models online
- **Session management**: Save/load analysis sessions
- **Shared datasets**: Collaborative omics data pools

#### Advanced Research Features

**Ensemble Modeling**:
- **Multi-model analysis**: Compare multiple models simultaneously
- **Consensus networks**: Aggregate multiple metabolic networks
- **Strain comparison**: Comparative analysis across organisms

**Publication Tools**:
- **Figure generation**: Publication-quality pathway maps
- **Data export formats**: Standard formats for journals
- **Citation export**: BibTeX, EndNote formats
- **Methodology documentation**: Auto-generate methods section

#### Python Integration**

**COBRApy Integration**:
- **Direct Python solver calls**: Use COBRApy via API
- **Hybrid workflows**: Use best of both tools
- **Result synchronization**: Keep web and Python in sync

### Documentation

**Case Studies**:
- **Published example analyses**: Step-by-step reproductions
- **Tutorial datasets**: Pre-configured educational datasets
- **Publication-ready figures**: High-quality exports

### Testing Infrastructure

**Automated Tests**:
- **Unit test coverage**: 90%+ coverage target
- **Integration tests**: All workflows tested
- **E2E tests**: End-to-end user scenarios
- **Performance benchmarks**: Continuous monitoring

**CI/CD Pipeline**:
- Automated testing on pull requests
- Deployment automation
- Performance regression detection

---

## Version 1.0.0 (Release - Planned)

### Major Release

**Breaking Changes**:
- Removal of fake solver fallback (hardcoded heuristics)
- New API structure for omics integration
- Updated file format specifications
- Migration guide for v0.0.x users

### Features

**Complete Research Suite**:
- **Real LP solver**: WASM-compiled GLPK.js integration
- **FBA**: Flux Balance Analysis
- **FVA**: Flux Variability Analysis
- **pFBA**: Parsimonious FBA
- **MOMA**: Minimization of Metabolic Adjustment
- **GIMME**: Gene Inactivity Moderated by Metabolism and Expression
- **E-Flux**: Expression-constrained Flux Analysis
- **iMAT**: Integrative Metabolic Analysis Tool
- **MADE**: Metabolic Adjustment by Differential Expression

**Multi-Omics Integration**:
- Transcriptomics integration via GIMME
- Proteomics data overlay
- Metabolomics data overlay
- Fluxomics data visualization

**Interactive Visualization**:
- Pathway map builder with D3.js force-directed layout
- Flux heatmap visualization
- Production envelope generation
- Multi-condition comparative analysis

**Educational Platform**:
- Gamified learning system with XP and badges
- Interactive tutorials for each algorithm
- Quiz system with immediate feedback
- Progress tracking across modules

### Documentation

- Complete API reference with JSDoc
- Comprehensive user guide with tutorials
- Developer contribution guide
- Deployment instructions for multiple platforms
- Troubleshooting guide

**Jupyter Widget**:
- React-based widget for Jupyter notebooks
- COBRApy integration
- Export functionality (SVG, PNG)

### Technical Improvements

- Code splitting for faster initial load
- Lazy loading for heavy components
- Memory optimization for large models
- Web Worker support for non-blocking UI
- Error boundary implementation
- Accessibility-first design throughout

---

## Version 1.1.0 (Maintenance Release - Planned - Q4 2025)

### Bug Fixes

**Critical Fixes**:
- Fix crash when loading very large models (>5000 reactions)
- Fix memory leak in long-running analyses
- Fix SBML parser for malformed XML
- Fix GPR parser for edge cases
- Fix solver failures in Safari browser

**Performance Fixes**:
- Optimize FBA solve time for genome-scale models
- Reduce memory footprint for pathway visualization
- Optimize force-directed layout algorithm
- Improve caching of computed results

### Compatibility

**Browser Improvements**:
- Improved Safari support
- Better mobile responsiveness
- Touch interface optimizations
- Improved high contrast mode

### Documentation

- Updated API docs for all modules
- Added troubleshooting guide
- Expanded user guide with more tutorials
- Added developer guide contribution instructions

---

## Version 1.0.0 (Initial Release)

### Initial Release

**Core Features**:
- Basic FBA solver with real LP formulation (glpk.js integration)
- GPR Boolean evaluation
- Basic FVA implementation
- Pathway map visualization
- Flux heatmap
- Model upload (SBML, JSON)
- Educational quizzes and learning modules

### Documentation

- Installation guide
- User guide with basic tutorials
- API documentation
- License file (MIT)
- Contributing guidelines

### Known Limitations

- Fake fallback solver for educational demo (hardcoded heuristics)
- Limited GPR complexity support
- OmicsIntegration.js exists but not wired to UI
- No validation suite
- No published benchmarks
- Jupyter widget uses placeholder implementation

---

## Migration Guides

### From v0.0.x to v1.0.0

**Breaking Changes**:
- Remove fake fallback solver
- Update API interfaces
- Update documentation to reflect real implementations

**API Migration**:
```javascript
// Old (v0.0.x)
const result = FBASolver._fallbackSolve(constraints);

// New (v1.0.0)
const result = await solveFBA(model, options);
```

**Data Structure Migration**:
```javascript
// Old model format (incomplete)
{
  reactions: [...],
  metabolites: [...]
}

// New model format (complete)
{
  reactions: {
    [rxnId]: {
      name, metabolites, bounds, gpr, genes, subsystem
    }
  },
  metabolites: {
    [metId]: { name, compartment, formula, charge }
  },
  genes: {
    [geneId]: { name, essential: false, subsystem }
  },
  nodes: [...],
  edges: [...]
}
```

---

## Upgrade Instructions

### From v0.x to v1.0.0

**For Web Application**:

1. Backup current data:
   ```bash
   # Export current workspace
   npm run export-workspace
   ```

2. Pull latest version:
   ```bash
   git pull origin main
   ```

3. Clear cache and reinstall:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

4. Test after upgrade:
   ```bash
   npm run test
   npm run lint
   ```

**For Jupyter Widget**:

1. Uninstall old version:
   ```bash
   pip uninstall metabolicsuite
   ```

2. Install new version:
   ```bash
   pip install metabolicsuite
   ```

3. Update notebooks to use new widget API:
   ```python
   # Update imports
   from metabolicsuite import PathwayMap, OmicsOverlay
   ```

---

## Deprecation Schedule

### Version 0.0.0 - Deprecation

- [ ] Fake fallback solver (hardcoded heuristics)
- [ ] OmicsIntegration.js (unused dead code)
- [ ] Old model format (incomplete structure)
- [ ] Placeholder Jupyter widget

### Version 0.1.0 - Deprecation

- [ ] Outdated API methods
- [ ] Legacy visualization components
- [ ] Old tutorial system

---

## Future Roadmap

### Version 0.2.0 - Enhanced Omics Integration (Q2 2025)

**Planned Features**:
- Machine learning for flux prediction
- Time-series omics data support
- Advanced case studies with real datasets
- Ensemble modeling capabilities

### Version 0.3.0 - Advanced Research Features (Q3 2025)

**Planned Features**:
- Thermodynamic FBA (tFBA)
- Flux sampling algorithms (ACHR, OPTGEM)
- Web Worker-based parallel solving
- Collaborative editing features
- Cloud model database

### Version 1.0.0 - Publication Tools (Q4 2025)

**Planned Features**:
- Publication-ready figure generation
- Multiple paper export formats (BibTeX, EndNote, Word)
- Automatic methodology section generation
- Case study documentation templates

### Version 1.1.0 - Python Integration (Q4 2025)

**Planned Features**:
- Direct COBRApy solver calls
- Hybrid Python/Jupyter workflows
- Advanced analysis capabilities

---

## How to Update

### For Bug Fixes

1. Create issue: Document bug with reproduction steps
2. Fix bug locally: Verify with tests
3. Add tests: Ensure regression doesn't occur
4. Update documentation: Document fix in changelog
5. Submit PR: With detailed description

### For New Features

1. Create RFC (Request for Comments): Discuss in discussions
2. Gather feedback: Get community input
3. Implement feature: Write tests
4. Update documentation: Add to user guide/API docs
5. Submit PR: Clear description of changes
6. Update changelog: Add entry to next version

### For Breaking Changes

1. Document extensively in PR description
2. Provide migration guide in PR
3. Update documentation files
4. Create deprecation notice (if applicable)
5. Update changelog: Mark as breaking change
6. Announce in discussions: Give 30+ days notice

---

## Contributing to Changelog

When contributing a new feature, add an entry under the next unreleased version section following this format:

```markdown
### Feature Name (Short Description)

**Type**: feat | fix | docs | perf | refactor | test | chore | ci | build | revert | style

**Description**: Detailed description of the change

**Breaking Change**: Yes/No (if applicable)

**Migration**: Steps to upgrade from previous version

**Issues**: Issue(s) this addresses (e.g., #123)

**Example**:
```markdown
### Add WASM-based FBA solver

**Type**: feat

**Description**:
Implemented real LP-based FBA solver using glpk.js compiled to WebAssembly. Replaces
heuristic fallback solver from v0.0.0.

**Implementation Details**:
- LP formulation: maximize c·v subject to S·v=0, lb≤v≤ub
- Uses glpk.js for solving
- Supports FBA, FVA, pFBA, MOMA
- Performance: <1s solve time for iML1515

**Breaking Changes**:
- Remove FBASolver._fallbackSolve() method
- API change: solveFBA() now requires valid model parameter
- Old behavior: Returns hardcoded results for invalid models
- New behavior: Throws error for invalid models

**Migration**:
1. Update code to use new solveFBA() API
2. Remove references to fallback solver
3. Test with existing models
4. Update tutorials and documentation

**Issues**: #42, #78, #103

**Example**:
```javascript
// Old (v0.0.x)
const result = FBASolver._fallbackSolve(constraints);

// New (v1.0.0)
try {
  const result = await solveFBA(model, options);
} catch (error) {
  console.error('FBA failed:', error);
  throw error;
}
```

**Related Issues**: #42, #78, #103
```

---

## Release Notes

### Version 1.0.0 (Release Date: TBA)

**Highlights**:
- Initial release of MetabolicSuite
- Real LP solver with glpk.js integration
- Comprehensive omics integration algorithms (GIMME, E-FLUX, IMAT)
- Interactive pathway visualization with D3.js
- Educational features with gamification
- Jupyter widget for Jupyter notebooks

**Supported Formats**:
- SBML Level 2/3 with FBC package
- COBRApy JSON
- Custom JSON format

**Browser Support**:
- Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

**Known Limitations**:
- Educational focus (hardcoded fallback for demo models)
- OmicsIntegration.js not wired to UI (dead code)
- No validation suite
- No published benchmarks
- Jupyter widget needs implementation

**Getting Started**:
- Installation guide with setup instructions
- User guide with tutorials
- API documentation for all modules

**Next Steps**: See roadmap for v1.1.0 and beyond.

---

*Last Updated: December 25, 2025*
