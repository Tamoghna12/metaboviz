# Environment Specification

Pinned versions for reproducibility. All versions verified against actual installed packages.

## Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| Node.js | ≥20.0.0 | JavaScript runtime |
| React | 19.x | UI framework |
| Vite | 7.x | Build tool |
| glpk.js | 5.x | LP solver (GLPK via Emscripten) |
| highs | 1.8.x | LP/MILP solver (HiGHS via WASM) |
| recharts | 3.x | Charting library |

## Test Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| Vitest | 4.x | Test runner |
| jsdom | 27.x | DOM environment for testing |

## Validation Dependencies (Python)

| Package | Version | Purpose |
|---------|---------|---------|
| Python | ≥3.10 | Runtime |
| COBRApy | ≥0.29 | Reference FBA solver |
| NumPy | ≥1.24 | Numerical computation |
| Playwright | ≥1.40 | Browser automation for WASM validation |

## Solver Versions

| Solver | Interface | Underlying Engine |
|--------|-----------|-------------------|
| GLPK.js | glpk.js npm package | GLPK 5.0 (Emscripten) |
| HiGHS | highs npm package | HiGHS 1.8 (WASM) |
| COBRApy | pip package | GLPK or Gurobi (user choice) |

## Reproducibility

```bash
# Exact reproduction
docker build -t metabolicsuite .
docker run -p 4173:4173 metabolicsuite

# Local development
npm ci          # Use lockfile for exact versions
npm test        # Verify all tests pass
npm run build   # Production build
```

## Browser Requirements

HiGHS WASM requires:
- WebAssembly support (all modern browsers)
- Web Workers (for background solving)
- SharedArrayBuffer (for multi-threaded HiGHS, optional)
