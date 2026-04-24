/**
 * PyodideWorker - Browser-native Python FBA via Pyodide + scipy
 *
 * Runs scipy.optimize.linprog (HiGHS backend) inside a Web Worker.
 * No server required — Python executes entirely in the browser via WASM.
 *
 * First load: ~30 MB (pyodide + numpy + scipy). Cached by the browser thereafter.
 * Solve time for genome-scale models: comparable to COBRApy on a local machine.
 *
 * Message protocol (mirrors SolverWorker):
 *   Input:  { jobId, method, model, options }
 *   Output: { jobId, type: 'result'|'progress'|'error'|'ready', result?, error? }
 *
 * Supported methods: fba, pfba, fva, moma
 */

const PYODIDE_VERSION = '0.27.0';

let pyodide = null;
let pyReady = false;

// ── Python FBA implementation ─────────────────────────────────────────────────

const PY_FBA = `
import numpy as np
from scipy.optimize import linprog
import json, re

_TOL = 1e-9

# ── GPR evaluation ────────────────────────────────────────────────────────────

def _split0(s, sep):
    """Split string by sep only at parenthesis depth 0."""
    parts, depth, start = [], 0, 0
    sl = len(sep)
    i = 0
    while i <= len(s) - sl:
        if s[i] == '(':
            depth += 1
        elif s[i] == ')':
            depth -= 1
        elif depth == 0 and s[i:i+sl].lower() == sep.lower():
            parts.append(s[start:i].strip())
            start = i + sl
            i += sl - 1
        i += 1
    parts.append(s[start:].strip())
    return [p for p in parts if p]

def _gpr_active(gpr, ko_set):
    """Return True if reaction is still active after gene knockouts."""
    if not gpr or not ko_set:
        return True
    s = gpr.strip()
    while s.startswith('(') and s.endswith(')'):
        s = s[1:-1].strip()
    or_p = _split0(s, ' or ')
    if len(or_p) > 1:
        return any(_gpr_active(p, ko_set) for p in or_p)
    and_p = _split0(s, ' and ')
    if len(and_p) > 1:
        return all(_gpr_active(p, ko_set) for p in and_p)
    return s.strip('() ').lower() not in ko_set

# ── Problem builder ───────────────────────────────────────────────────────────

def _build(model, knockouts=None, extra_cons=None, obj_override=None):
    ko = {g.lower() for g in (knockouts or [])}
    ec = extra_cons or {}

    rxns = list(model['reactions'].keys())
    mets = list((model.get('metabolites') or {}).keys())
    n, m = len(rxns), len(mets)

    lb = np.array([model['reactions'][r].get('lower_bound', -1000) for r in rxns], dtype=float)
    ub = np.array([model['reactions'][r].get('upper_bound',  1000) for r in rxns], dtype=float)
    c  = np.zeros(n)

    # Objective
    if obj_override:
        if obj_override in rxns:
            c[rxns.index(obj_override)] = 1.0
    else:
        for j, rid in enumerate(rxns):
            coef = model['reactions'][rid].get('objective_coefficient', 0) or 0
            if coef:
                c[j] = float(coef)

    if not c.any():  # fallback: first reaction whose ID contains 'biomass'
        for j, rid in enumerate(rxns):
            if 'biomass' in rid.lower():
                c[j] = 1.0
                break

    # Knockouts
    if ko:
        for j, rid in enumerate(rxns):
            rxn  = model['reactions'][rid]
            gpr  = rxn.get('gene_reaction_rule', '') or rxn.get('gpr', '') or ''
            genes = set(re.findall(r'\\b(?!and\\b|or\\b|AND\\b|OR\\b)[A-Za-z0-9_.]+\\b', gpr))
            if genes and not _gpr_active(gpr, ko):
                lb[j] = ub[j] = 0.0

    # Additional bound constraints from UI
    for rid, bds in ec.items():
        if rid in rxns:
            j = rxns.index(rid)
            if 'lb' in bds: lb[j] = float(bds['lb'])
            if 'ub' in bds: ub[j] = float(bds['ub'])

    # Stoichiometric matrix
    S = np.zeros((m, n))
    if m:
        mi = {met: i for i, met in enumerate(mets)}
        for j, rid in enumerate(rxns):
            for mid, coef in (model['reactions'][rid].get('metabolites') or {}).items():
                if mid in mi:
                    S[mi[mid], j] = float(coef)

    return rxns, mets, S, lb, ub, c

# ── LP helpers ────────────────────────────────────────────────────────────────

def _lp_max(c_obj, S, lb, ub, A_ub=None, b_ub=None):
    """Maximize c_obj^T v subject to Sv=0, lb<=v<=ub, A_ub v <= b_ub."""
    m = S.shape[0]
    return linprog(
        -c_obj,
        A_eq  = S         if m else None,
        b_eq  = np.zeros(m) if m else None,
        A_ub  = A_ub,
        b_ub  = b_ub,
        bounds = list(zip(lb.tolist(), ub.tolist())),
        method = 'highs',
    )

def _lp_min(c_obj, S, lb, ub, A_ub=None, b_ub=None):
    """Minimize c_obj^T v subject to Sv=0, lb<=v<=ub, A_ub v <= b_ub."""
    m = S.shape[0]
    return linprog(
        c_obj,
        A_eq  = S           if m else None,
        b_eq  = np.zeros(m) if m else None,
        A_ub  = A_ub,
        b_ub  = b_ub,
        bounds = list(zip(lb.tolist(), ub.tolist())),
        method = 'highs',
    )

def _status_map(code):
    return {0: 'optimal', 1: 'iteration_limit', 2: 'infeasible', 3: 'unbounded'}.get(code, 'error')

def _fmt(rxns, c, res, method, wt_obj=None):
    if res.status != 0:
        return {'status': _status_map(res.status), 'objectiveValue': 0, 'growthRate': 0,
                'fluxes': {}, 'method': method, 'solver': 'pyodide-scipy', 'phenotype': 'infeasible'}
    x = res.x
    fluxes = {rxns[j]: float(x[j]) if abs(x[j]) > _TOL else 0.0 for j in range(len(rxns))}
    obj_val = wt_obj if wt_obj is not None else float(-res.fun)
    obj_rxn = next((rxns[j] for j in range(len(rxns)) if c[j] != 0), None)
    gr = fluxes.get(obj_rxn, 0) if obj_rxn else obj_val
    return {'status': 'optimal', 'objectiveValue': obj_val, 'growthRate': gr,
            'fluxes': fluxes, 'method': method, 'solver': 'pyodide-scipy',
            'phenotype': 'viable' if gr > 1e-3 else 'lethal'}

# ── Exported solve functions ──────────────────────────────────────────────────

def py_fba(model_json, opts_json):
    model = json.loads(model_json)
    opts  = json.loads(opts_json)
    rxns, _, S, lb, ub, c = _build(model, opts.get('knockouts'), opts.get('constraints'), opts.get('objective'))
    res = _lp_max(c, S, lb, ub)
    return json.dumps(_fmt(rxns, c, res, 'fba'))

def py_pfba(model_json, opts_json):
    model = json.loads(model_json)
    opts  = json.loads(opts_json)
    frac  = float(opts.get('fractionOfOptimum', 1.0))

    rxns, mets, S, lb, ub, c = _build(model, opts.get('knockouts'), opts.get('constraints'), opts.get('objective'))
    n, m = len(rxns), len(mets)

    # Stage 1: standard FBA
    res1 = _lp_max(c, S, lb, ub)
    if res1.status != 0:
        return json.dumps(_fmt(rxns, c, res1, 'pfba'))

    wt_obj = float(-res1.fun)
    obj_idx = next((j for j in range(n) if c[j] != 0), None)

    # Stage 2: minimize sum|v_j| via auxiliary variables w_j >= |v_j|
    # Variables: [v (n), w (n)]
    # Minimize  0^T v + 1^T w
    # s.t.      S v = 0          (mass balance, augmented with zeros for w)
    #           v_j - w_j <= 0   (w >= v)
    #          -v_j - w_j <= 0   (w >= -v)
    #          -v_obj    <= -frac*wt  (objective floor)
    #           lb <= v <= ub,  0 <= w <= max_bound
    max_w = max(float(np.max(np.abs(ub))), float(np.max(np.abs(lb))), 1000.0)

    c2  = np.zeros(2*n); c2[n:] = 1.0
    lb2 = np.concatenate([lb, np.zeros(n)])
    ub2 = np.concatenate([ub, np.full(n, max_w)])

    S2 = np.hstack([S, np.zeros((m, n))]) if m else np.zeros((0, 2*n))

    rows, rhs = [], []
    for j in range(n):
        r1 = [0.0]*(2*n); r1[j]=  1.0; r1[n+j]=-1.0; rows.append(r1); rhs.append(0.0)
        r2 = [0.0]*(2*n); r2[j]= -1.0; r2[n+j]=-1.0; rows.append(r2); rhs.append(0.0)
    if obj_idx is not None:
        r3 = [0.0]*(2*n); r3[obj_idx] = -1.0; rows.append(r3); rhs.append(-frac*wt_obj)

    res2 = linprog(
        c2,
        A_eq = S2 if m else None, b_eq = np.zeros(m) if m else None,
        A_ub = np.array(rows), b_ub = np.array(rhs),
        bounds = list(zip(lb2.tolist(), ub2.tolist())),
        method = 'highs',
    )
    return json.dumps(_fmt(rxns, c, res2, 'pfba', wt_obj))

def py_fva(model_json, opts_json, job_id=''):
    model  = json.loads(model_json)
    opts   = json.loads(opts_json)
    frac   = float(opts.get('fractionOfOptimum', 0.9))
    targets = opts.get('reactions')

    rxns, mets, S, lb, ub, c = _build(model, opts.get('knockouts'), opts.get('constraints'), opts.get('objective'))
    n, m = len(rxns), len(mets)

    res0 = _lp_max(c, S, lb, ub)
    if res0.status != 0:
        return json.dumps({'status': _status_map(res0.status), 'ranges': {}})

    wt_obj  = float(-res0.fun)
    obj_idx = next((j for j in range(n) if c[j] != 0), None)

    A_ub_base, b_ub_base = None, None
    if obj_idx is not None and wt_obj > _TOL:
        row = np.zeros(n); row[obj_idx] = -1.0
        A_ub_base = row.reshape(1, n)
        b_ub_base = np.array([-frac * wt_obj])

    scan = [r for r in (targets or rxns) if r in rxns]
    ranges = {}
    bds = list(zip(lb.tolist(), ub.tolist()))

    for i, rid in enumerate(scan):
        j = rxns.index(rid)
        c_j = np.zeros(n); c_j[j] = 1.0

        rmin = linprog(c_j,
                       A_eq=S if m else None, b_eq=np.zeros(m) if m else None,
                       A_ub=A_ub_base, b_ub=b_ub_base, bounds=bds, method='highs')
        rmax = linprog(-c_j,
                       A_eq=S if m else None, b_eq=np.zeros(m) if m else None,
                       A_ub=A_ub_base, b_ub=b_ub_base, bounds=bds, method='highs')

        ranges[rid] = {
            'min': float(rmin.x[j]) if rmin.status == 0 else float('-inf'),
            'max': float(-rmax.fun) if rmax.status == 0 else float('inf'),
        }

    return json.dumps({'status': 'optimal', 'objectiveValue': wt_obj, 'ranges': ranges, 'solver': 'pyodide-scipy'})

def py_moma(model_json, opts_json):
    """Linear MOMA: minimize L1 distance to wild-type flux distribution."""
    model = json.loads(model_json)
    opts  = json.loads(opts_json)
    rxns, mets, S, lb, ub, c = _build(model, [], opts.get('constraints'), opts.get('objective'))
    n, m = len(rxns), len(mets)

    # Wild-type FBA
    wt_res = _lp_max(c, S, lb, ub)
    if wt_res.status != 0:
        return json.dumps(_fmt(rxns, c, wt_res, 'lmoma'))
    wt_flux = wt_res.x

    # Knockout model
    rxns_ko, _, S_ko, lb_ko, ub_ko, _ = _build(model, opts.get('knockouts'), opts.get('constraints'))
    n_ko = len(rxns_ko)

    # L1 MOMA: min sum |v - v_wt| via d_pos, d_neg where v - v_wt = d_pos - d_neg
    # Variables: [v (n_ko), d_pos (n_ko), d_neg (n_ko)]
    c2 = np.zeros(3*n_ko); c2[n_ko:] = 1.0  # minimize sum(d_pos + d_neg)

    lb2 = np.concatenate([lb_ko, np.zeros(2*n_ko)])
    ub2 = np.concatenate([ub_ko, np.full(2*n_ko, 2000.0)])

    S2 = np.hstack([S_ko, np.zeros((m, 2*n_ko))]) if m else np.zeros((0, 3*n_ko))

    # Equality: v_j - d_pos_j + d_neg_j = v_wt_j
    A_eq_dev = np.zeros((n_ko, 3*n_ko))
    b_eq_dev = np.zeros(n_ko)
    for j, rid in enumerate(rxns_ko):
        A_eq_dev[j, j]        =  1.0
        A_eq_dev[j, n_ko+j]   = -1.0
        A_eq_dev[j, 2*n_ko+j] =  1.0
        b_eq_dev[j] = float(wt_flux[rxns.index(rid)]) if rid in rxns else 0.0

    A_eq = np.vstack([S2, A_eq_dev]) if m else A_eq_dev
    b_eq = np.concatenate([np.zeros(m), b_eq_dev]) if m else b_eq_dev

    res = linprog(c2, A_eq=A_eq, b_eq=b_eq,
                  bounds=list(zip(lb2.tolist(), ub2.tolist())), method='highs')
    return json.dumps(_fmt(rxns_ko, np.zeros(n_ko), res, 'lmoma'))
`;

// ── Worker initialization ─────────────────────────────────────────────────────

async function init() {
  try {
    self.postMessage({ type: 'loading', message: 'Loading Pyodide…' });

    const { loadPyodide } = await import(
      `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`
    );

    self.postMessage({ type: 'loading', message: 'Loading numpy + scipy…' });
    pyodide = await loadPyodide();
    await pyodide.loadPackage(['numpy', 'scipy']);

    self.postMessage({ type: 'loading', message: 'Compiling FBA kernel…' });
    await pyodide.runPythonAsync(PY_FBA);

    pyReady = true;
    self.postMessage({
      type: 'ready',
      solver: 'pyodide-scipy-highs',
      version: PYODIDE_VERSION,
      capabilities: ['fba', 'pfba', 'fva', 'moma'],
    });
  } catch (err) {
    self.postMessage({ type: 'error', error: `Pyodide init failed: ${err.message}` });
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

const METHOD_MAP = {
  fba:  'py_fba',
  pfba: 'py_pfba',
  fva:  'py_fva',
  moma: 'py_moma',
};

self.onmessage = async function (event) {
  const { jobId, method, model, options = {} } = event.data;

  if (!pyReady) {
    self.postMessage({ jobId, type: 'error', error: 'Pyodide not ready' });
    return;
  }

  const pyFn = METHOD_MAP[method];
  if (!pyFn) {
    self.postMessage({ jobId, type: 'error', error: `Method '${method}' not supported in Pyodide tier` });
    return;
  }

  try {
    // Pass JSON via pyodide globals to avoid JS string escaping issues
    pyodide.globals.set('_model_json',   JSON.stringify(model));
    pyodide.globals.set('_options_json', JSON.stringify(options));

    const resultJson = await pyodide.runPythonAsync(`${pyFn}(_model_json, _options_json)`);

    const result = JSON.parse(resultJson);
    result._tier = 'pyodide';
    self.postMessage({ jobId, type: 'result', result });
  } catch (err) {
    self.postMessage({ jobId, type: 'error', error: err.message });
  }
};

// Start initialization immediately
init();
