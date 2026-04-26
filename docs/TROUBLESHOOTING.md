# Troubleshooting Guide

**Common issues and solutions for MetabolicSuite**

---

## Table of Contents

- [Installation Issues](#installation-issues)
- [Running Application](#running-application)
- [Model Loading Issues](#model-loading-issues)
- [FBA Solving Issues](#fba-solving-issues)
- [Omics Integration Issues](#omics-integration-issues)
- [Visualization Issues](#visualization-issues)
- [Performance Issues](#performance-issues)
- [Browser Compatibility](#browser-compatibility)
- [Jupyter Widget Issues](#jupyter-widget-issues)

---

## Installation Issues

### Issue: Node.js Version Too Old

**Symptoms**:
```
SyntaxError: Unexpected token
SyntaxError: Unexpected identifier
```

**Cause**: MetabolicSuite requires Node.js 18+ but you're using an older version.

**Solutions**:

**Option 1: Update Node.js**
```bash
# Check current version
node --version

# If <18.0.0, update using nvm
nvm install 18
nvm use 18

# Verify
node --version  # Should now be v18.x.x.x
```

**Option 2: Use official installer**
- Download from https://nodejs.org/
- Install LTS version (18.x)

### Issue: npm Install Fails

**Symptoms**:
```
npm ERR! code EACCES
npm ERR! syscall chmod
```

**Cause**: Permission denied when writing to node_modules.

**Solutions**:

**Option 1: Fix permissions**
```bash
# Fix ownership of .npm directory
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) /usr/local/lib/node_modules
```

**Option 2: Use sudo**
```bash
sudo npm install
```

**Option 3: Clear cache**
```bash
npm cache clean --force
npm install
```

### Issue: Port Already in Use

**Symptoms**:
```
Error: listen EADDRINUSE: address already in use :::5173
```

**Cause**: Port 5173 is already being used by another process.

**Solutions**:

**Option 1: Find and kill process**
```bash
# Find process using port
lsof -i :5173

# Kill process
kill -9 <PID>
```

**Option 2: Use different port**
```bash
# Start on port 3000
npm run dev -- --port 3000

# Or specify host
npm run dev -- --host 127.0.0.1
```

---

## Running Application

### Issue: Blank Screen on Load

**Symptoms**:
- White page
- No error messages
- Network tab shows 200 OK

**Possible Causes**:
1. JavaScript error not displayed in console
2. CSS issue blocking content
3. Build incomplete
4. Browser cache serving stale content

**Solutions**:

**Step 1: Check browser console**
- Open Developer Tools (F12)
- Look for red error messages
- Note any failed resource loads

**Step 2: Check build output**
```bash
# Verify dist/ directory exists
ls -la dist/

# Should contain index.html and assets/ folder
```

**Step 3: Clear browser cache**
- Chrome: Ctrl+Shift+Delete
- Firefox: Ctrl+Shift+Del
- Or try incognito/private browsing

**Step 4: Check Vite config**
```javascript
// Verify vite.config.js has correct settings
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',  // Should be '/' for production
  // ...
});
```

### Issue: Hot Module Replacement (HMR) Not Working

**Symptoms**:
- Changes to code don't appear
- Need to refresh browser manually
- Console shows HMR errors

**Solutions**:

**Step 1: Check dev server is running**
```bash
# Vite dev server should be running
npm run dev

# Should see "Local: http://localhost:5173"
```

**Step 2: Check network configuration**
- Ensure no firewall blocking localhost
- Try disabling VPN
- Check browser extensions interfering

**Step 3: Restart dev server**
```bash
# Stop with Ctrl+C
# Start again
npm run dev
```

### Issue: Production Build Fails

**Symptoms**:
```
Build failed with 1 error:
error: "build" task failed with exit code 1
```

**Solutions**:

**Option 1: Clear node_modules**
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

**Option 2: Increase Node.js memory**
```bash
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

**Option 3: Check Vite config for errors**
```javascript
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Check for syntax errors
  }
});
```

---

## Model Loading Issues

### Issue: SBML Parsing Fails

**Symptoms**:
```
Error: Invalid SBML format
Error: Failed to parse XML
Error: Required element not found
```

**Cause**: SBML file is malformed or not supported.

**Solutions**:

**Step 1: Validate SBML file**
- Use [SBML Validator](https://sbml.org/validator)
- Upload your SBML file
- Check for validation errors
- Fix errors in model before uploading

**Step 2: Check SBML version**
```javascript
// MetabolicSuite supports SBML Level 2 and 3
// Check file header
<sbml level="2" version="4">
<!-- or -->
<sbml level="3" version="2">
```

**Step 3: Check for required elements**
- Ensure `<model>` element exists
- Ensure `<listOfReactions>` exists
- Ensure `<listOfSpecies>` exists
- Ensure biomass reaction exists

**Step 4: Use alternative format**
- Export from BiGG as COBRApy JSON
- Use BiGG model converter

### Issue: Model Loads But No Data Displayed

**Symptoms**:
- Loading completes
- Statistics show "0 genes, 0 reactions"
- No pathway map displayed

**Cause**: Model parsing succeeded but data structure is unexpected.

**Solutions**:

**Step 1: Check model structure in browser console**
```javascript
// Check what was loaded
console.log('Model:', model);
console.log('Reactions:', model.reactions);
console.log('Metabolites:', model.metabolites);
console.log('Genes:', model.genes);
```

**Step 2: Try default model**
- Click "Reset to Default" button
- If default model works, issue is with your file

**Step 3: Check for empty data**
- Ensure reactions have stoichiometry
- Ensure metabolites are connected to reactions

---

## FBA Solving Issues

### Issue: FBA Returns "Infeasible"

**Symptoms**:
```
Status: INFEASIBLE
Growth rate: 0
Error: Infeasible problem
```

**Cause**: Contradictory constraints or missing required resources.

**Solutions**:

**Step 1: Check exchange constraints**
```
Glucose uptake: -10  ← Must be negative (uptake)
Oxygen uptake: -20  ← Must be negative
Biomass: unbounded  ← Should have upper bound
```

**Step 2: Check for at least one substrate**
```
# Must have at least one negative exchange (substrate import)
# Examples:
EX_glc__D_e: -10  ✓ (correct)
EX_glc__D_e: 0   ✗ (blocked - no substrate)
```

**Step 3: Check biomass reaction exists**
- Model must have biomass reaction
- Biomass should produce growth-coupled metabolites

**Step 4: Check for contradictory constraints**
- Remove all custom constraints temporarily
- If problem is solved, add constraints back one by one

### Issue: FBA Returns "Unbounded"

**Symptoms**:
```
Status: UNBOUNDED
Growth rate: Infinity
Error: Objective function unbounded
```

**Cause**: Objective reaction has no upper bound or problem allows infinite growth.

**Solutions**:

**Step 1: Add upper bound to objective**
```javascript
// Check model reactions
console.log('Biomass reaction:', model.reactions['BIOMASS']);

// Ensure upper bound exists
model.reactions['BIOMASS'].upper_bound = 1000;  // Add if missing
```

**Step 2: Add bounds to all exchange reactions**
```javascript
// Ensure no reaction has both bounds at infinity
Object.values(model.reactions).forEach(rxn => {
  if (!isFinite(rxn.lower_bound)) {
    rxn.lower_bound = -1000;
  }
  if (!isFinite(rxn.upper_bound)) {
    rxn.upper_bound = 1000;
  }
});
```

### Issue: Solver is Very Slow

**Symptoms**:
- FBA takes >30 seconds
- Browser becomes unresponsive
- CPU usage 100%

**Cause**: Large model or complex constraints.

**Solutions**:

**Option 1: Reduce model size**
- Use subsystem view instead of full model
- Filter out unused pathways

**Option 2: Adjust fraction of optimality (FVA)**
```javascript
// Instead of 0.9, try 0.8
const result = await solveFVA(model, {
  fraction: 0.8  // Reduces search time
});
```

**Option 3: Disable animations**
- Disable pathway animations
- Reduce visual updates while solving

**Option 4: Use Web Worker** (future feature)
- Offload solver to background thread
- Keep UI responsive

---

## Omics Integration Issues

### Issue: Gene Not Found in Model

**Symptoms**:
```
Error: Gene 'pfkA' not found in model
Warning: 100 genes not matched to model
```

**Cause**: Gene IDs in omics data don't match model gene IDs.

**Solutions**:

**Step 1: Check model gene IDs**
```javascript
// Get all gene IDs from model
const modelGenes = Object.keys(model.genes);
console.log('Model genes:', modelGenes.slice(0, 20), '...');
```

**Step 2: Check omics data gene IDs**
```javascript
// Check your omics file
const omicsGenes = Array.from(geneExpression.keys());
console.log('Omics genes:', omicsGenes.slice(0, 20), '...');
```

**Step 3: Use BiGG standard gene IDs**
- E. coli: `b` + number (e.g., `b0001`)
- S. cerevisiae: Standard ORF names

**Step 4: Use gene ID mapping**
```javascript
// Create mapping file
const geneMapping = {
  'pfkA_Ec': 'b0001',
  'pfkA_Sc': 'pfkA'
};

// Transform data before loading
const mappedData = new Map();
geneExpression.forEach((value, id) => {
  const mappedId = geneMapping[id] || id;
  mappedData.set(mappedId, value);
});
```

### Issue: GIMME Fails with Inconsistency Score >1000

**Symptoms**:
```
Inconsistency score: 2340
Status: OPTIMAL (but results don't make sense)
```

**Cause**: Gene expression data doesn't match model's metabolic state.

**Solutions**:

**Option 1: Check experimental conditions**
- Ensure gene expression from same condition as model (e.g., minimal media)
- Gene expression should reflect growth state

**Option 2: Adjust threshold**
```javascript
// Increase threshold to include more genes as "low expression"
const result = await solveGIMME(model, geneExpression, {
  threshold: 0.5  // Include bottom 50%
});
```

**Option 3: Normalize expression data**
```javascript
// Ensure expression is on log2 scale or normalized
// Options: log2FC, TPM, RPKM
const normalizedData = normalizeExpression(rawData, 'log2FC');
```

### Issue: File Upload Fails

**Symptoms**:
```
Error: Invalid CSV format
Error: Failed to parse Excel file
Error: File too large
```

**Cause**: File format issues or size limits.

**Solutions**:

**For CSV**:
- Ensure comma-separated values
- Use consistent delimiter (comma or tab)
- Ensure header row matches expected format
- Remove BOM (Byte Order Mark) if present

**For Excel**:
- Save as `.xlsx` (not `.xls`)
- Ensure first row contains headers
- Use simple column names (Gene_ID, Condition_1, etc.)

**For file size**:
- Split large files into smaller chunks (<10MB)
- Use compressed formats if possible

---

## Visualization Issues

### Issue: Pathway Map Not Displaying

**Symptoms**:
- Blank area where pathway map should be
- Console shows no errors
- Loading spinner spins indefinitely

**Cause**: Graph layout algorithm failing or no data.

**Solutions**:

**Step 1: Check browser console for errors**
```javascript
// Look for D3.js errors
// Look for layout errors
// Look for memory errors
```

**Step 2: Check model has nodes and edges**
```javascript
console.log('Nodes:', model.nodes);
console.log('Edges:', model.edges);

// Should have non-empty arrays
if (model.nodes.length === 0) {
  console.error('No nodes in model');
}
```

**Step 3: Reduce number of displayed nodes**
```javascript
// Use subsystem view to limit displayed nodes
// Only show top 100 nodes by connectivity
const topNodes = model.nodes
  .sort((a, b) => b.connectivity - a.connectivity)
  .slice(0, 100);
```

**Step 4: Disable animations**
```javascript
// Turn off force-directed layout animation
const layout = {
  animate: false,
  coolDown: false,
  iterations: 100
};
```

### Issue: Flux Heatmap Colors Not Showing

**Symptoms**:
- All cells same color
- Color legend not appearing
- No variation in flux values

**Cause**: Color scale configuration issue or all fluxes are zero.

**Solutions**:

**Step 1: Check visualization settings**
```javascript
// Verify color scale is "diverging" not "sequential"
const visSettings = {
  colorScale: 'diverging',
  centerValue: 0
};

// Verify min/max values are appropriate
```

**Step 2: Check for valid flux data**
```javascript
// Ensure fluxes are not all zero
const hasFlux = Object.values(result.fluxes).some(f => Math.abs(f) > 0.01);

if (!hasFlux) {
  console.warn('All fluxes are near zero');
}
```

**Step 3: Adjust color scale**
```javascript
// Use sequential scale if small range
const visSettings = {
  colorScale: 'sequential',
  minValue: 0,
  maxValue: 5
};
```

---

## Performance Issues

### Issue: Browser Crashes with Large Models

**Symptoms**:
- Tab crashes
- "Out of memory" error
- Browser becomes unresponsive

**Cause**: Model size exceeds browser memory limits.

**Solutions**:

**Option 1: Use subsystem view**
- Don't load full model at once
- Load only selected subsystem

**Option 2: Increase browser memory limit**
```bash
# Chrome
# Settings → Performance → Memory: Increase limit

# Firefox
# about:config → Performance → Increase memory limit
```

**Option 3: Close other tabs**
- Close other browser tabs to free memory
- Don't run other web applications simultaneously

**Option 4: Use 64-bit browser**
- 32-bit browsers limited to ~2GB address space
- 64-bit browsers can use much more memory

### Issue: Slow FBA Solves

**Symptoms**:
- FBA takes >10 seconds
- UI freezes during solve
- Poor user experience

**Cause**: Inefficient solver or large model.

**Solutions**:

**Option 1: Reduce model size** (see above)

**Option 2: Disable FVA for large models**
```javascript
// FVA requires solving LP problem for each reaction
// Can be very slow for models with 2000+ reactions

// Instead, run FVA on subset
const importantReactions = getTopReactions(model, 100);
const fvaResult = await solveFVA(model, {
  reactions: importantReactions  // Only these
});
```

**Option 3: Use pFBA instead of MOMA** for initial analysis
```javascript
// pFBA is faster than MOMA
// Use MOMA for knockouts only
```

---

## Browser Compatibility

### Issue: glpk.js Not Loading

**Symptoms**:
```
Error: WebAssembly.instantiate() failed
Error: glpk.js not defined
```

**Cause**: WASM not supported or disabled.

**Solutions**:

**Step 1: Check WebAssembly support**
```javascript
if (typeof WebAssembly === 'undefined') {
  alert('Your browser does not support WebAssembly');
  alert('Please upgrade to a modern browser');
}
```

**Step 2: Check browser version**
- Chrome: 90+
- Firefox: 88+
- Safari: 14+
- Edge: 90+

**Step 3: Check browser settings**
- Disable extensions that block WASM
- Check firewall/security settings

### Issue: Safari Compatibility

**Symptoms**:
- Layout looks broken
- Charts not rendering
- Features not working

**Cause**: Safari has different default CSS or JavaScript behavior.

**Solutions**:

**Step 1: Add Safari-specific CSS**
```css
/* Safari-specific fixes */
@supports (-webkit-touch-callout: none) {
  .pathway-node {
    -webkit-font-smoothing: antialiased;
  }
}
```

**Step 2: Test in Safari**
- Open application in Safari
- Use Safari Developer Tools to debug
- Check for console errors

**Step 3: Check polyfills**
- Ensure required polyfills are loaded
- Use modern JavaScript features safely with feature detection

---

## Jupyter Widget Issues

### Issue: Widget Not Displaying in Jupyter

**Symptoms**:
```
ModuleNotFoundError: No module named 'metabolicsuite'
Widget appears as plain text
```

**Cause**: Widget not installed or not correctly integrated.

**Solutions**:

**Step 1: Verify installation**
```bash
# Check if package is installed
pip list | grep metabolicsuite

# Should see:
# metabolicsuite    0.1.0
```

**Step 2: Reinstall if needed**
```bash
# Uninstall
pip uninstall metabolicsuite

# Reinstall
cd python
pip install -e .
```

**Step 3: Check Jupyter notebook kernel**
```python
# Verify correct kernel is active
# Kernel should be same Python version used to install widget

# Or restart kernel:
# Kernel → Restart
```

**Step 4: Enable widget extension**
```python
# Make sure anywidget extension is enabled
%load_ext metabolicsuite.js
```

### Issue: Widget Not Responsive

**Symptoms**:
- Clicks don't register
- Widget freezes
- Updates don't reflect

**Cause**: JavaScript errors or communication issues.

**Solutions**:

**Step 1: Check browser console**
- Open Jupyter console (not notebook console)
- Look for JavaScript errors
- Look for communication errors

**Step 2: Restart kernel**
```python
# Restart Jupyter kernel
# Kernel → Restart
```

**Step 3: Clear browser cache**
- Hard refresh (Ctrl+Shift+R)
- Clear browser cache
- Reload widget

---

## Getting Help

### Additional Resources

If you can't resolve your issue:

1. **Search existing issues**: https://github.com/yourusername/metabolic-suite/issues
2. **Read documentation**: Check [docs/](./) folder
3. **Ask in discussions**: https://github.com/yourusername/metabolic-suite/discussions
4. **Contact maintainers**: [support-email@example.com](mailto:support-email@example.com)

### When Creating an Issue

Include:
- **Browser and version**
- **Operating system**
- **Steps to reproduce**
- **Expected behavior**
- **Actual behavior**
- **Screenshots** (if applicable)
- **Console errors** (full error messages)

---

*Last Updated: December 25, 2025*
