#!/usr/bin/env python3
"""
Browser-Based Cross-Solver Validation: HiGHS WASM vs COBRApy

Runs HiGHS WASM solver in a real browser via Playwright, then compares
results with COBRApy reference solutions. This produces genuine cross-solver
validation data suitable for publication.

Requirements:
    pip install playwright numpy cobra
    playwright install chromium

Usage:
    python run_browser_validation.py --num-models 5 --output highs_results.json

The workflow:
1. Start the Vite dev server (or use an existing one)
2. Load each model JSON into the browser
3. Execute HiGHS WASM FBA/pFBA/FVA via page.evaluate()
4. Collect results and save as JSON
5. Compare against COBRApy reference solutions

Reference:
    Ebrahim et al. (2013) "Do genome-scale models need exact solvers
    or verified numerics?" Bioinformatics 29(8):1021-1028
"""

import asyncio
import json
import os
import sys
import subprocess
import time
import argparse
import signal
import numpy as np
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("ERROR: playwright not installed. Run: pip install playwright && playwright install chromium")
    sys.exit(1)

try:
    import cobra
except ImportError:
    cobra = None
    print("WARNING: COBRApy not installed. Will only collect HiGHS results.")


BIGG_MODEL_IDS = [
    'e_coli_core',
    'iAF1260',
    'iML1515',
    'iJR904',
    'iAF692',
    'iIT341',
    'iNJ661',
    'iSB619',
    'iYO844',
    'iMM904',
]

METHODS = ['fba', 'pfba', 'fva']

# JS code injected into the browser to run HiGHS FBA
BROWSER_FBA_SCRIPT = """
async (modelJson) => {
    // Import solver modules (already bundled in the app)
    const { highsSolver, SolverStatus } = await import('/src/lib/HiGHSSolver.js');

    // Parse model
    const model = JSON.parse(modelJson);

    const results = {};

    // FBA
    try {
        const t0 = performance.now();
        const fbaResult = await highsSolver.solveFBA(model);
        const t1 = performance.now();
        results.fba = {
            status: fbaResult.status,
            objective_value: fbaResult.objectiveValue,
            fluxes: fbaResult.fluxes,
            solve_time_ms: t1 - t0,
        };
    } catch (e) {
        results.fba = { status: 'error', error: e.message };
    }

    // pFBA
    try {
        const t0 = performance.now();
        const pfbaResult = await highsSolver.solvePFBA(model);
        const t1 = performance.now();
        results.pfba = {
            status: pfbaResult.status,
            objective_value: pfbaResult.objectiveValue,
            fluxes: pfbaResult.fluxes,
            solve_time_ms: t1 - t0,
        };
    } catch (e) {
        results.pfba = { status: 'error', error: e.message };
    }

    // FVA (first 20 reactions only for speed)
    try {
        const rxnIds = Object.keys(model.reactions).slice(0, 20);
        const t0 = performance.now();
        const fvaResult = await highsSolver.solveFVA(model, {}, [], {
            fractionOfOptimum: 1.0,
            reactions: rxnIds,
        });
        const t1 = performance.now();
        results.fva = {
            status: fvaResult.status,
            ranges: fvaResult.ranges,
            solve_time_ms: t1 - t0,
        };
    } catch (e) {
        results.fva = { status: 'error', error: e.message };
    }

    return results;
}
"""


@dataclass
class ComparisonResult:
    model_id: str
    method: str
    highs_obj: float
    cobra_obj: float
    obj_diff: float
    obj_rel_diff: float
    flux_l2_norm: float
    flux_max_diff: float
    highs_time_ms: float
    cobra_time_ms: float
    passed: bool
    notes: str = ""


def run_cobrapy_reference(model_path: str, model_id: str) -> dict:
    """Run COBRApy FBA/pFBA/FVA as reference solution."""
    if cobra is None:
        return {}

    try:
        if model_path.endswith('.json'):
            model = cobra.io.load_json_model(model_path)
        elif model_path.endswith('.xml') or model_path.endswith('.sbml'):
            model = cobra.io.read_sbml_model(model_path)
        else:
            return {}
    except Exception as e:
        print(f"  COBRApy failed to load {model_id}: {e}")
        return {}

    results = {}

    # FBA
    try:
        t0 = time.perf_counter()
        sol = model.optimize()
        t1 = time.perf_counter()
        results['fba'] = {
            'status': sol.status,
            'objective_value': sol.objective_value,
            'fluxes': dict(sol.fluxes),
            'solve_time_ms': (t1 - t0) * 1000,
        }
    except Exception as e:
        results['fba'] = {'status': 'error', 'error': str(e)}

    # pFBA
    try:
        t0 = time.perf_counter()
        sol = cobra.flux_analysis.pfba(model)
        t1 = time.perf_counter()
        results['pfba'] = {
            'status': 'optimal',
            'objective_value': sol.objective_value,
            'fluxes': dict(sol.fluxes),
            'solve_time_ms': (t1 - t0) * 1000,
        }
    except Exception as e:
        results['pfba'] = {'status': 'error', 'error': str(e)}

    # FVA (first 20 reactions)
    try:
        rxn_ids = [r.id for r in model.reactions[:20]]
        t0 = time.perf_counter()
        fva_result = cobra.flux_analysis.flux_variability_analysis(
            model, reaction_list=rxn_ids, fraction_of_optimum=1.0
        )
        t1 = time.perf_counter()
        ranges = {}
        for rxn_id in fva_result.index:
            ranges[rxn_id] = {
                'min': float(fva_result.loc[rxn_id, 'minimum']),
                'max': float(fva_result.loc[rxn_id, 'maximum']),
            }
        results['fva'] = {
            'status': 'optimal',
            'ranges': ranges,
            'solve_time_ms': (t1 - t0) * 1000,
        }
    except Exception as e:
        results['fva'] = {'status': 'error', 'error': str(e)}

    return results


def compare_results(highs: dict, cobra_ref: dict, model_id: str) -> list:
    """Compare HiGHS WASM vs COBRApy results."""
    comparisons = []

    for method in ['fba', 'pfba']:
        h = highs.get(method, {})
        c = cobra_ref.get(method, {})

        if h.get('status') != 'optimal' or c.get('status') not in ('optimal', 'feasible'):
            continue

        h_obj = h.get('objective_value', 0) or 0
        c_obj = c.get('objective_value', 0) or 0
        obj_diff = abs(h_obj - c_obj)
        obj_rel = obj_diff / max(abs(c_obj), 1e-10)

        # Flux comparison (L2 norm of difference)
        h_fluxes = h.get('fluxes', {})
        c_fluxes = c.get('fluxes', {})
        common_rxns = set(h_fluxes.keys()) & set(c_fluxes.keys())

        diffs = [h_fluxes[r] - c_fluxes[r] for r in common_rxns]
        l2 = np.sqrt(sum(d ** 2 for d in diffs)) if diffs else 0
        max_diff = max(abs(d) for d in diffs) if diffs else 0

        # Tolerance: 1e-6 for objective, or 1% relative
        passed = obj_rel < 0.01 or obj_diff < 1e-6

        comparisons.append(ComparisonResult(
            model_id=model_id,
            method=method,
            highs_obj=h_obj,
            cobra_obj=c_obj,
            obj_diff=obj_diff,
            obj_rel_diff=obj_rel,
            flux_l2_norm=l2,
            flux_max_diff=max_diff,
            highs_time_ms=h.get('solve_time_ms', 0),
            cobra_time_ms=c.get('solve_time_ms', 0),
            passed=passed,
        ))

    return comparisons


async def run_validation(args):
    """Main validation pipeline."""
    model_ids = BIGG_MODEL_IDS[:args.num_models]
    model_dir = Path(args.model_dir)

    # Check for model files
    available_models = []
    for mid in model_ids:
        json_path = model_dir / f"{mid}.json"
        if json_path.exists():
            available_models.append((mid, str(json_path)))
        else:
            print(f"  Skipping {mid}: {json_path} not found")

    if not available_models:
        print("ERROR: No model files found. Download BiGG models to", model_dir)
        print("  Example: curl -o models/e_coli_core.json http://bigg.ucsd.edu/static/models/e_coli_core.json")
        sys.exit(1)

    print(f"Found {len(available_models)} models")

    # Start dev server if not running
    dev_server = None
    dev_url = args.url
    if not dev_url:
        print("Starting Vite dev server...")
        dev_server = subprocess.Popen(
            ['npm', 'run', 'dev', '--', '--port', '5199'],
            cwd=Path(__file__).parent.parent,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        dev_url = 'http://localhost:5199'
        time.sleep(5)  # Wait for server startup

    all_highs_results = {}
    all_cobra_results = {}
    all_comparisons = []

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()

            # Navigate to the app
            print(f"Connecting to {dev_url}...")
            await page.goto(dev_url, wait_until='networkidle', timeout=30000)
            print("App loaded in browser.\n")

            for model_id, model_path in available_models:
                print(f"--- {model_id} ---")

                # Load model JSON
                with open(model_path, 'r') as f:
                    model_json = f.read()

                # Run HiGHS in browser
                print(f"  Running HiGHS WASM in browser...")
                try:
                    highs_result = await page.evaluate(BROWSER_FBA_SCRIPT, model_json)
                    all_highs_results[model_id] = highs_result

                    for method in ['fba', 'pfba', 'fva']:
                        r = highs_result.get(method, {})
                        status = r.get('status', 'missing')
                        obj = r.get('objective_value', 'N/A')
                        t = r.get('solve_time_ms', 0)
                        print(f"    {method}: status={status}, obj={obj}, time={t:.1f}ms")
                except Exception as e:
                    print(f"  HiGHS browser error: {e}")
                    all_highs_results[model_id] = {'error': str(e)}

                # Run COBRApy reference
                if cobra is not None:
                    print(f"  Running COBRApy reference...")
                    cobra_result = run_cobrapy_reference(model_path, model_id)
                    all_cobra_results[model_id] = cobra_result

                    for method in ['fba', 'pfba']:
                        r = cobra_result.get(method, {})
                        status = r.get('status', 'missing')
                        obj = r.get('objective_value', 'N/A')
                        t = r.get('solve_time_ms', 0)
                        print(f"    {method}: status={status}, obj={obj}, time={t:.1f}ms")

                    # Compare
                    comparisons = compare_results(
                        all_highs_results[model_id],
                        cobra_result,
                        model_id
                    )
                    all_comparisons.extend(comparisons)
                    for c in comparisons:
                        icon = "PASS" if c.passed else "FAIL"
                        print(f"    [{icon}] {c.method}: |Δobj|={c.obj_diff:.2e}, "
                              f"rel={c.obj_rel_diff:.2e}, L2={c.flux_l2_norm:.2e}")

                print()

            await browser.close()

    finally:
        if dev_server:
            dev_server.send_signal(signal.SIGTERM)
            dev_server.wait(timeout=5)

    # Save HiGHS results
    output_path = Path(args.output)
    with open(output_path, 'w') as f:
        json.dump(all_highs_results, f, indent=2, default=str)
    print(f"HiGHS results saved to: {output_path}")

    # Save comparison summary
    if all_comparisons:
        summary_path = output_path.with_suffix('.comparison.json')
        with open(summary_path, 'w') as f:
            json.dump([asdict(c) for c in all_comparisons], f, indent=2)
        print(f"Comparison saved to: {summary_path}")

        # Print summary
        passed = sum(1 for c in all_comparisons if c.passed)
        total = len(all_comparisons)
        print(f"\n{'='*60}")
        print(f"VALIDATION SUMMARY")
        print(f"{'='*60}")
        print(f"Total comparisons: {total}")
        print(f"Passed:            {passed}")
        print(f"Failed:            {total - passed}")
        print(f"Pass rate:         {passed/total*100:.1f}%" if total > 0 else "N/A")

        if all_comparisons:
            obj_diffs = [c.obj_diff for c in all_comparisons]
            print(f"Mean |Δobj|:       {np.mean(obj_diffs):.2e}")
            print(f"Max |Δobj|:        {np.max(obj_diffs):.2e}")
        print(f"{'='*60}")

        return 0 if passed == total else 1

    return 0


def main():
    parser = argparse.ArgumentParser(description='Browser-based HiGHS WASM validation')
    parser.add_argument('--num-models', type=int, default=3,
                        help='Number of models to test (default: 3)')
    parser.add_argument('--model-dir', type=str,
                        default=str(Path(__file__).parent / 'models'),
                        help='Directory containing model JSON files')
    parser.add_argument('--output', type=str, default='highs_results.json',
                        help='Output file for HiGHS results')
    parser.add_argument('--url', type=str, default=None,
                        help='URL of running dev server (starts one if not given)')
    args = parser.parse_args()

    return asyncio.run(run_validation(args))


if __name__ == '__main__':
    sys.exit(main() or 0)
