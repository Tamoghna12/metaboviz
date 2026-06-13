#!/usr/bin/env python3
"""
Run Full Validation Suite - HiGHS WASM vs COBRApy

This script:
1. Loads cached COBRApy results
2. Runs HiGHS WASM solver on same models via HTTP API
3. Compares results with statistical analysis
4. Generates publication-ready validation report

Usage:
    python run_validation.py --num-models 100 --output validation_report.tex
"""

import os
import sys
import json
import time
import argparse
import numpy as np
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
import requests

# BiGG API for model download
BIGG_MODEL_URL = "http://bigg.ucsd.edu/static/models/{model_id}.json"

# HiGHS WASM runs in browser, but we can test via the API backend
# For now, we'll use the cached HiGHS results from browser benchmark runs
HIGHS_RESULTS_CACHE = Path(__file__).parent / "metabolicsuite" / "benchmark_data" / "results"
COBRA_RESULTS_CACHE = Path(__file__).parent / "metabolicsuite" / "benchmark_data" / "results"

@dataclass
class ValidationResult:
    model_id: str
    method: str
    highs_obj: float
    cobra_obj: float
    obj_diff: float
    obj_rel_diff: float
    flux_l2_norm: float
    flux_max_diff: float
    flux_max_diff_rxn: Optional[str]
    highs_time_ms: float
    cobra_time_ms: float
    passed: bool
    notes: str = ""


def load_cobrapy_results(filepath: str) -> List[dict]:
    """Load COBRApy benchmark results"""
    with open(filepath, 'r') as f:
        return json.load(f)


def load_highs_results(filepath: str) -> List[dict]:
    """Load HiGHS WASM benchmark results"""
    if not os.path.exists(filepath):
        return None
    with open(filepath, 'r') as f:
        return json.load(f)


def compute_flux_l2_norm(fluxes_a: dict, fluxes_b: dict) -> Tuple[float, float, str]:
    """Compute L2 norm of flux differences"""
    common_rxns = set(fluxes_a.keys()) & set(fluxes_b.keys())
    if not common_rxns:
        return None, None, None
    
    diffs = {}
    for rxn in common_rxns:
        diff = abs(fluxes_a.get(rxn, 0) - fluxes_b.get(rxn, 0))
        diffs[rxn] = diff
    
    l2_norm = np.sqrt(sum(d**2 for d in diffs.values()))
    max_diff = max(diffs.values())
    max_rxn = max(diffs, key=diffs.get)
    
    return l2_norm, max_diff, max_rxn


def validate_results(cobra_results: List[dict], highs_results: List[dict]) -> List[ValidationResult]:
    """Compare HiGHS and COBRApy results"""
    validations = []
    
    # Index results by (model_id, method)
    cobra_index = {(r['model_id'], r['method']): r for r in cobra_results}
    highs_index = {(r['model_id'], r['method']): r for r in highs_results}
    
    for key, cobra_res in cobra_index.items():
        if key not in highs_index:
            continue
        
        highs_res = highs_index[key]
        
        # Check if both optimal
        if cobra_res.get('status') != 'optimal' or highs_res.get('status') != 'optimal':
            validations.append(ValidationResult(
                model_id=key[0],
                method=key[1],
                highs_obj=highs_res.get('objective_value'),
                cobra_obj=cobra_res.get('objective_value'),
                obj_diff=None,
                obj_rel_diff=None,
                flux_l2_norm=None,
                flux_max_diff=None,
                flux_max_diff_rxn=None,
                highs_time_ms=highs_res.get('solve_time_ms', 0),
                cobra_time_ms=cobra_res.get('solve_time_ms', 0),
                passed=False,
                notes=f"Non-optimal: {highs_res.get('status')}/{cobra_res.get('status')}"
            ))
            continue
        
        # Compare objectives
        highs_obj = highs_res.get('objective_value', 0)
        cobra_obj = cobra_res.get('objective_value', 0)
        obj_diff = abs(highs_obj - cobra_obj)
        obj_rel_diff = obj_diff / max(abs(highs_obj), abs(cobra_obj), 1e-10)
        
        # Compare fluxes
        flux_l2, flux_max, flux_max_rxn = compute_flux_l2_norm(
            highs_res.get('fluxes', {}),
            cobra_res.get('fluxes', {})
        )
        
        # Determine pass/fail (1e-6 tolerance for objective)
        passed = obj_diff < 1e-6
        notes = ""
        if not passed:
            notes = f"Objective diff {obj_diff:.2e} exceeds 1e-6 tolerance"
        elif flux_max and flux_max > 1e-4:
            notes = f"Large flux diff at {flux_max_rxn}: {flux_max:.2e} (alternate optima)"
        
        validations.append(ValidationResult(
            model_id=key[0],
            method=key[1],
            highs_obj=highs_obj,
            cobra_obj=cobra_obj,
            obj_diff=obj_diff,
            obj_rel_diff=obj_rel_diff,
            flux_l2_norm=flux_l2,
            flux_max_diff=flux_max,
            flux_max_diff_rxn=flux_max_rxn,
            highs_time_ms=highs_res.get('solve_time_ms', 0),
            cobra_time_ms=cobra_res.get('solve_time_ms', 0),
            passed=passed,
            notes=notes
        ))
    
    return validations


def generate_summary(validations: List[ValidationResult]) -> dict:
    """Generate summary statistics with Bland-Altman analysis"""
    total = len(validations)
    passed = sum(1 for v in validations if v.passed)
    failed = total - passed
    
    obj_diffs = [v.obj_diff for v in validations if v.obj_diff is not None]
    flux_l2s = [v.flux_l2_norm for v in validations if v.flux_l2_norm is not None]
    highs_times = [v.highs_time_ms for v in validations]
    cobra_times = [v.cobra_time_ms for v in validations]
    
    # Bland-Altman analysis
    mean_bias = np.mean(obj_diffs) if obj_diffs else 0
    std_bias = np.std(obj_diffs) if obj_diffs else 0
    loa_lower = mean_bias - 1.96 * std_bias
    loa_upper = mean_bias + 1.96 * std_bias
    
    # Group by method
    by_method = {}
    for v in validations:
        method = v.method
        if method not in by_method:
            by_method[method] = {'total': 0, 'passed': 0}
        by_method[method]['total'] += 1
        if v.passed:
            by_method[method]['passed'] += 1
    
    return {
        'total': total,
        'passed': passed,
        'failed': failed,
        'pass_rate': passed / total if total > 0 else 0,
        'obj_diff': {
            'mean': mean_bias,
            'std': std_bias,
            'max': max(obj_diffs) if obj_diffs else 0,
            'min': min(obj_diffs) if obj_diffs else 0,
        },
        'bland_altman': {
            'mean_bias': mean_bias,
            'std_bias': std_bias,
            'loa_lower': loa_lower,
            'loa_upper': loa_upper,
            'interpretation': 'acceptable' if abs(mean_bias) < 1e-8 and loa_upper < 1e-6 else 'concerning',
        },
        'flux_l2': {
            'mean': np.mean(flux_l2s) if flux_l2s else 0,
            'max': max(flux_l2s) if flux_l2s else 0,
        },
        'solve_time': {
            'highs': {
                'mean': np.mean(highs_times) if highs_times else 0,
            },
            'cobra': {
                'mean': np.mean(cobra_times) if cobra_times else 0,
            }
        },
        'by_method': by_method,
    }


def generate_tex_report(validations: List[ValidationResult], summary: dict, output_path: str):
    """Generate LaTeX validation report"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    tex = f"""\\documentclass{{article}}
\\usepackage{{booktabs}}
\\usepackage{{amsmath}}
\\usepackage{{geometry}}
\\usepackage{{graphicx}}
\\geometry{{margin=1in}}

\\title{{MetabolicSuite Solver Validation Report}}
\\author{{HiGHS WASM vs COBRApy/GLPK}}
\\date{{Generated: {timestamp}}}

\\begin{{document}}

\\maketitle

\\section{{Executive Summary}}

This report validates the numerical accuracy of MetabolicSuite's HiGHS WASM solver
against the gold-standard COBRApy implementation with GLPK.

\\begin{{table}}[h]
\\centering
\\caption{{Validation Summary Statistics}}
\\label{{tab:summary}}
\\begin{{tabular}}{{lr}}
\\toprule
\\textbf{{Metric}} & \\textbf{{Value}} \\\\
\\midrule
Total Models Tested & {summary['total']} \\\\
Passed & {summary['passed']} \\\\
Failed & {summary['failed']} \\\\
\\textbf{{Pass Rate}} & \\textbf{{{summary['pass_rate']*100:.1f}\\%}} \\\\
\\midrule
Mean |Δobj| & {summary['obj_diff']['mean']:.2e} \\\\
Max |Δobj| & {summary['obj_diff']['max']:.2e} \\\\
Min |Δobj| & {summary['obj_diff']['min']:.2e} \\\\
Std |Δobj| & {summary['obj_diff']['std']:.2e} \\\\
\\midrule
Mean Flux L2 Norm & {summary['flux_l2']['mean']:.2e} \\\\
Max Flux L2 Norm & {summary['flux_l2']['max']:.2e} \\\\
\\midrule
Mean HiGHS Solve Time & {summary['solve_time']['highs']['mean']:.1f} ms \\\\
Mean COBRApy Solve Time & {summary['solve_time']['cobra']['mean']:.1f} ms \\\\
\\bottomrule
\\end{{tabular}}
\\end{{table}}

\\section{{Validation Criteria}}

\\begin{{itemize}}
    \\item \\textbf{{Pass Criterion}}: |Δobj| < 10$^{{-6}}$ (absolute objective difference)
    \\item \\textbf{{Flux Tolerance}}: Individual flux differences < 10$^{{-4}}$
    \\item \\textbf{{Expected Pass Rate}}: ≥99\\% for production-ready solver
\\end{{itemize}}

\\section{{Results by Method}}

"""
    
    for method, stats in summary['by_method'].items():
        pass_rate = stats['passed'] / stats['total'] * 100 if stats['total'] > 0 else 0
        tex += f"""\\subsection{{{method.upper()}}}
Passed: {stats['passed']}/{stats['total']} ({pass_rate:.1f}\\%)

"""
    
    tex += """\\section{Detailed Results}

\\begin{table}[h]
\\centering
\\caption{Per-Model Validation Results}
\\label{tab:details}
\\resizebox{\\textwidth}{!}{%
\\begin{tabular}{llrrrrr}
\\toprule
\\textbf{Model} & \\textbf{Method} & \\textbf{HiGHS} & \\textbf{COBRApy} & \\textbf{|Δobj|} & \\textbf{Flux L2} & \\textbf{Status} \\\\
\\midrule
"""
    
    for v in validations[:50]:  # First 50 results
        status = "✓ Pass" if v.passed else "✗ Fail"
        obj_diff_str = f"{v.obj_diff:.2e}" if v.obj_diff else "N/A"
        flux_l2_str = f"{v.flux_l2_norm:.2e}" if v.flux_l2_norm else "N/A"
        tex += f"{v.model_id} & {v.method} & {v.highs_obj:.4f} & {v.cobra_obj:.4f} & {obj_diff_str} & {flux_l2_str} & {status} \\\\\n"
    
    if len(validations) > 50:
        tex += f"\\multicolumn{{7}}{{l}}{{\\dots and {len(validations) - 50} more rows}} \\\\\n"
    
    tex += """\\bottomrule
\\end{tabular}%
}
\\end{table}

\\section{Bland-Altman Analysis}

To assess agreement between HiGHS WASM and COBRApy, we performed Bland-Altman analysis
on the objective value differences across all benchmark models.

\\begin{table}[h]
\\centering
\\caption{{Bland-Altman Statistics}}
\\label{{tab:bland_altman}}
\\begin{{tabular}}{{lr}}
\\toprule
\\textbf{{Statistic}} & \\textbf{{Value}} \\\\
\\midrule
Mean Bias ($\\bar{{d}}$) & {summary['bland_altman']['mean_bias']:.2e} \\\\
Standard Deviation ($\\sigma$) & {summary['bland_altman']['std_bias']:.2e} \\\\
\\midrule
95\\% Limits of Agreement: & \\\\
\\quad Lower ($\\bar{{d}} - 1.96\\sigma$) & {summary['bland_altman']['loa_lower']:.2e} \\\\
\\quad Upper ($\\bar{{d}} + 1.96\\sigma$) & {summary['bland_altman']['loa_upper']:.2e} \\\\
\\midrule
Interpretation & \\textbf{{{summary['bland_altman']['interpretation'].upper()}}} \\\\
\\bottomrule
\\end{{tabular}}
\\end{{table}}

\\begin{{itemize}}
    \\item \\textbf{{Mean Bias}}: Systematic difference between HiGHS and COBRApy
    \\item \\textbf{{95\\% LoA}}: Range containing 95\\% of differences
    \\item \\textbf{{Acceptable}}: Mean bias < 10$^{{-8}}$ and Upper LoA < 10$^{{-6}}$
\\end{{itemize}}

\\begin{{figure}}[h]
\\centering
\\includegraphics[width=0.8\\textwidth]{{bland_altman_plot.png}}
\\caption{{Bland-Altman plot showing objective value differences. Solid line: mean bias.
Dashed lines: 95\\% limits of agreement.}}
\\label{{fig:bland_altman}}
\\end{{figure}}

\\section{Conclusion}

"""
    
    if summary['pass_rate'] >= 0.99:
        tex += f"""The HiGHS WASM solver achieves **{summary['pass_rate']*100:.1f}% concordance** with COBRApy/GLPK across {summary['total']} benchmark models.
This validates numerical equivalence for research applications.

\\textbf{{Recommendation}}: Solver is validated for publication.
"""
    elif summary['pass_rate'] >= 0.95:
        tex += f"""The HiGHS WASM solver achieves **{summary['pass_rate']*100:.1f}% concordance** with COBRApy/GLPK.
While most models pass, some show objective differences exceeding tolerance.

\\textbf{{Recommendation}}: Investigate failing models before publication.
"""
    else:
        tex += f"""The HiGHS WASM solver achieves only **{summary['pass_rate']*100:.1f}% concordance** with COBRApy/GLPK.
This is below the 99% threshold expected for research-grade software.

\\textbf{{Recommendation}}: Critical bugs must be fixed before publication.

\\textbf{{Common Issues}}:
\\begin{itemize}
    \\item pFBA formulation errors (objective value vs total flux)
    \\item FVA flux extraction bugs
    \\item Split variable handling (v = v_pos - v_neg)
\\end{itemize}
"""
    
    tex += """
\\section{Reproducibility}

\\begin{itemize}
    \\item COBRApy Results: \\texttt{cobrapy\_results\_*.json}
    \\item HiGHS Results: Browser benchmark (via UI)
    \\item Validation Script: \\texttt{run\_validation.py}
\\end{itemize}

\\end{document}
"""
    
    with open(output_path, 'w') as f:
        f.write(tex)
    
    print(f"LaTeX report generated: {output_path}")


def main():
    parser = argparse.ArgumentParser(description='Run solver validation suite')
    parser.add_argument('--num-models', type=int, default=20, help='Number of models to validate')
    parser.add_argument('--methods', nargs='+', default=['fba', 'pfba'], help='Methods to test')
    parser.add_argument('--output', type=str, default='validation_report.tex', help='Output LaTeX file')
    parser.add_argument('--cobra-results', type=str, help='COBRApy results JSON file')
    parser.add_argument('--highs-results', type=str, help='HiGHS results JSON file')
    
    args = parser.parse_args()
    
    # Find latest COBRApy results
    cobra_results_file = args.cobra_results
    if not cobra_results_file:
        cobra_results = sorted(COBRA_RESULTS_CACHE.glob('cobrapy_results_*.json'))
        if cobra_results:
            cobra_results_file = str(cobra_results[-1])
    
    if not cobra_results_file or not os.path.exists(cobra_results_file):
        print(f"Error: COBRApy results not found. Run benchmark first.")
        sys.exit(1)
    
    print(f"Loading COBRApy results: {cobra_results_file}")
    cobra_results = load_cobrapy_results(cobra_results_file)
    
    # Filter by methods
    cobra_results = [r for r in cobra_results if r['method'] in args.methods]
    
    # Limit to num-models
    model_ids = list(set(r['model_id'] for r in cobra_results))[:args.num_models]
    cobra_results = [r for r in cobra_results if r['model_id'] in model_ids]
    
    print(f"Testing {len(model_ids)} models with methods: {args.methods}")
    
    # IMPORTANT: Real HiGHS WASM validation requires browser-based execution.
    # HiGHS runs as WebAssembly in the browser, so validation must use either:
    #   1. Playwright/Puppeteer to run HiGHS in a headless browser
    #   2. Exported JSON results from the MetabolicSuite benchmark UI
    #
    # Load HiGHS results from file if available
    highs_results_file = args.output.replace('.tex', '_highs_results.json')
    if not os.path.exists(highs_results_file):
        print("\n" + "=" * 60)
        print("ERROR: No HiGHS WASM results found.")
        print(f"Expected file: {highs_results_file}")
        print()
        print("To generate HiGHS results, either:")
        print("  1. Run the MetabolicSuite benchmark in the browser and export results")
        print("  2. Use the Playwright validation script: python/run_browser_validation.py")
        print()
        print("DO NOT fabricate validation data. Cross-solver agreement must be")
        print("measured from actual independent solver runs.")
        print("=" * 60)
        sys.exit(1)

    print(f"\nLoading HiGHS WASM results: {highs_results_file}")
    highs_results = load_cobrapy_results(highs_results_file)

    # Run validation
    print("Running validation...")
    validations = validate_results(cobra_results, highs_results)
    
    # Generate summary
    summary = generate_summary(validations)
    
    # Print summary
    print("\n" + "="*60)
    print("VALIDATION SUMMARY")
    print("="*60)
    print(f"Total Models:      {summary['total']}")
    print(f"Passed:            {summary['passed']}")
    print(f"Failed:            {summary['failed']}")
    print(f"Pass Rate:         {summary['pass_rate']*100:.1f}%")
    print(f"Mean |Δobj|:       {summary['obj_diff']['mean']:.2e}")
    print(f"Max |Δobj|:        {summary['obj_diff']['max']:.2e}")
    print(f"Mean HiGHS Time:   {summary['solve_time']['highs']['mean']:.1f} ms")
    print(f"Mean COBRApy Time: {summary['solve_time']['cobra']['mean']:.1f} ms")
    print("="*60)
    
    # Show failures
    failures = [v for v in validations if not v.passed]
    if failures:
        print("\nFAILURES:")
        for v in failures[:10]:
            print(f"  {v.model_id} ({v.method}): |Δobj| = {v.obj_diff:.2e} - {v.notes}")
    
    # Generate LaTeX report
    generate_tex_report(validations, summary, args.output)
    
    # Return exit code based on pass rate
    if summary['pass_rate'] >= 0.99:
        print("\n✓ VALIDATION PASSED: Ready for publication")
        return 0
    elif summary['pass_rate'] >= 0.95:
        print("\n⚠ VALIDATION MARGINAL: Review failures before submission")
        return 1
    else:
        print("\n✗ VALIDATION FAILED: Critical issues must be fixed")
        return 2


if __name__ == '__main__':
    sys.exit(main())
