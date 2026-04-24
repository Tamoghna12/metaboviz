/**
 * ModelExporter
 *
 * Serialises the internal currentModel representation back to standard formats:
 *   - COBRApy JSON  (model.to_json() compatible)
 *   - SBML Level 3 + FBC v2  (can be round-tripped through COBRApy/libSBML)
 *
 * The internal model structure is a superset of COBRApy JSON, so JSON export
 * is straightforward. SBML export re-generates the XML from scratch, preserving
 * stoichiometry, bounds, GPR associations, and subsystem annotations.
 */

/* ── helpers ──────────────────────────────────────────────────────────────── */

const esc = s =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ── COBRApy JSON export ──────────────────────────────────────────────────── */

export function exportJSON(model) {
  const reactions = Object.entries(model.reactions || {}).map(([id, r]) => ({
    id,
    name: r.name || '',
    lower_bound: r.lower_bound ?? -1000,
    upper_bound: r.upper_bound ?? 1000,
    gene_reaction_rule: r.gene_reaction_rule || '',
    subsystem: r.subsystem || '',
    metabolites: Object.fromEntries(Object.entries(r.metabolites || {})),
    objective_coefficient: r.objective_coefficient ?? 0,
    notes: r.notes || {},
    annotation: r.annotation || {},
  }));

  const metabolites = Object.entries(model.metabolites || {}).map(([id, m]) => ({
    id,
    name: m.name || '',
    formula: m.formula || '',
    compartment: m.compartment || 'c',
    charge: m.charge ?? 0,
    notes: m.notes || {},
    annotation: m.annotation || {},
  }));

  const genes = Object.entries(model.genes || {}).map(([id, g]) => ({
    id,
    name: g.name || '',
    notes: g.notes || {},
    annotation: g.annotation || {},
  }));

  const compartments = {};
  metabolites.forEach(m => { compartments[m.compartment] = m.compartment; });

  return JSON.stringify({
    id:   model.id   || 'exported_model',
    name: model.name || 'Exported Model',
    version: 1,
    reactions,
    metabolites,
    genes,
    compartments,
  }, null, 2);
}

export function downloadJSON(model) {
  const id = model.id || 'model';
  downloadBlob(exportJSON(model), `${id}.json`, 'application/json');
}

/* ── GPR string → FBC XML ─────────────────────────────────────────────────── */

function splitDepth0(str, sep) {
  const parts = [], sl = sep.length;
  let depth = 0, last = 0;
  for (let i = 0; i <= str.length - sl; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') depth--;
    else if (depth === 0 && str.slice(i, i + sl).toLowerCase() === sep) {
      parts.push(str.slice(last, i).trim());
      last = i + sl; i += sl - 1;
    }
  }
  parts.push(str.slice(last).trim());
  return parts.filter(Boolean);
}

function parseGPR(s) {
  s = s.trim();
  // Strip balanced outer parens
  let stripped = true;
  while (stripped && s.startsWith('(') && s.endsWith(')')) {
    let depth = 0; stripped = true;
    for (let i = 1; i < s.length - 1; i++) {
      if (s[i] === '(') depth++;
      if (s[i] === ')') { depth--; if (depth < 0) { stripped = false; break; } }
    }
    if (stripped) s = s.slice(1, -1).trim();
  }

  const orParts  = splitDepth0(s, ' or ');
  if (orParts.length  > 1) return `<fbc:or>${orParts.map(parseGPR).join('')}</fbc:or>`;
  const andParts = splitDepth0(s, ' and ');
  if (andParts.length > 1) return `<fbc:and>${andParts.map(parseGPR).join('')}</fbc:and>`;

  return `<fbc:geneProductRef fbc:geneProduct="${esc(s.replace(/[()]/g, '').trim())}"/>`;
}

/* ── SBML Level 3 + FBC v2 export ────────────────────────────────────────── */

export function exportSBML(model) {
  const rxns    = model.reactions  || {};
  const mets    = model.metabolites || {};
  const geneMap = model.genes       || {};

  // Compartments
  const compSet = new Set(['c']);
  Object.values(mets).forEach(m => compSet.add(m.compartment || 'c'));

  // Build parameter table for flux bounds
  // Use named parameters: cobra_default_lb/ub/0 + per-reaction overrides
  const params = new Map([
    ['cobra_default_lb', -1000],
    ['cobra_default_ub',  1000],
    ['cobra_0_bound',        0],
  ]);

  const lbParam = (id, lb) => {
    if (lb <= -1000) return 'cobra_default_lb';
    if (lb === 0)    return 'cobra_0_bound';
    const k = `F_${id}_lower`; params.set(k, lb); return k;
  };
  const ubParam = (id, ub) => {
    if (ub >= 1000) return 'cobra_default_ub';
    if (ub === 0)   return 'cobra_0_bound';
    const k = `F_${id}_upper`; params.set(k, ub); return k;
  };

  // Pre-compute per-reaction bound refs (side effect: populates params map)
  const rxnBounds = {};
  Object.entries(rxns).forEach(([id, r]) => {
    rxnBounds[id] = {
      lb: lbParam(id, r.lower_bound ?? -1000),
      ub: ubParam(id, r.upper_bound ??  1000),
      rev: (r.lower_bound ?? -1000) < 0,
    };
  });

  // Objective reaction
  const objId = Object.entries(rxns)
    .find(([, r]) => r.objective_coefficient && r.objective_coefficient !== 0)?.[0]
    || Object.keys(rxns)[0] || '';

  // Build XML
  const L = [];
  const w = s => L.push(s);

  w('<?xml version="1.0" encoding="UTF-8"?>');
  w('<sbml xmlns="http://www.sbml.org/sbml/level3/version1/core"');
  w('      xmlns:fbc="http://www.sbml.org/sbml/level3/version1/fbc/version2"');
  w('      level="3" version="1" fbc:required="false">');
  w(`  <model id="${esc(model.id || 'model')}" name="${esc(model.name || 'model')}" fbc:strict="true">`);

  // Compartments
  w('    <listOfCompartments>');
  compSet.forEach(c => w(`      <compartment id="${esc(c)}" constant="true"/>`));
  w('    </listOfCompartments>');

  // Species
  w('    <listOfSpecies>');
  Object.entries(mets).forEach(([id, m]) => {
    w(`      <species id="${esc(id)}" name="${esc(m.name || id)}" compartment="${esc(m.compartment || 'c')}" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false" fbc:charge="${m.charge ?? 0}" fbc:chemicalFormula="${esc(m.formula || '')}"/>`);
  });
  w('    </listOfSpecies>');

  // Parameters (bounds — must appear before reactions)
  w('    <listOfParameters>');
  params.forEach((val, id) => w(`      <parameter id="${esc(id)}" value="${val}" constant="true"/>`));
  w('    </listOfParameters>');

  // Reactions
  w('    <listOfReactions>');
  Object.entries(rxns).forEach(([id, rxn]) => {
    const { lb, ub, rev } = rxnBounds[id];
    const reactants = Object.entries(rxn.metabolites || {}).filter(([, c]) => c < 0);
    const products  = Object.entries(rxn.metabolites || {}).filter(([, c]) => c > 0);

    w(`      <reaction id="${esc(id)}" name="${esc(rxn.name || id)}" reversible="${rev}" fbc:lowerFluxBound="${esc(lb)}" fbc:upperFluxBound="${esc(ub)}">`);

    if (rxn.subsystem) {
      w(`        <notes><body xmlns="http://www.w3.org/1999/xhtml"><p>SUBSYSTEM: ${esc(rxn.subsystem)}</p></body></notes>`);
    }

    if (reactants.length > 0) {
      w('        <listOfReactants>');
      reactants.forEach(([sid, c]) => w(`          <speciesReference species="${esc(sid)}" stoichiometry="${Math.abs(c)}" constant="true"/>`));
      w('        </listOfReactants>');
    }

    if (products.length > 0) {
      w('        <listOfProducts>');
      products.forEach(([sid, c]) => w(`          <speciesReference species="${esc(sid)}" stoichiometry="${c}" constant="true"/>`));
      w('        </listOfProducts>');
    }

    if (rxn.gene_reaction_rule?.trim()) {
      w('        <fbc:geneProductAssociation>');
      w(`          ${parseGPR(rxn.gene_reaction_rule)}`);
      w('        </fbc:geneProductAssociation>');
    }

    w('      </reaction>');
  });
  w('    </listOfReactions>');

  // Objectives
  w('    <fbc:listOfObjectives fbc:activeObjective="obj">');
  w('      <fbc:objective fbc:id="obj" fbc:type="maximize">');
  w('        <fbc:listOfFluxObjectives>');
  if (objId) w(`          <fbc:fluxObjective fbc:reaction="${esc(objId)}" fbc:coefficient="1"/>`);
  w('        </fbc:listOfFluxObjectives>');
  w('      </fbc:objective>');
  w('    </fbc:listOfObjectives>');

  // Gene products
  w('    <fbc:listOfGeneProducts>');
  Object.entries(geneMap).forEach(([id, g]) => {
    w(`      <fbc:geneProduct fbc:id="${esc(id)}" fbc:label="${esc(id)}" fbc:name="${esc(g.name || id)}"/>`);
  });
  w('    </fbc:listOfGeneProducts>');

  w('  </model>');
  w('</sbml>');

  return L.join('\n');
}

export function downloadSBML(model) {
  const id = model.id || 'model';
  downloadBlob(exportSBML(model), `${id}.xml`, 'application/xml');
}
