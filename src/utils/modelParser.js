/**
 * Unified Model Parser for Metabolic Models
 *
 * Supports:
 * - JSON: CobraPy export (model.to_json()), BIGG Models database
 * - SBML: Level 2 and Level 3 with FBC, Groups, Layout packages
 *
 * Features:
 * - Auto-detection of file format
 * - Extraction of reactions, metabolites, genes, GPR rules
 * - Automatic graph layout generation for visualization
 * - Support for flux bounds and objective coefficients
 */

import { parseSBML } from './sbmlParser';

/**
 * Detect file format from content
 */
const detectFormat = (content) => {
  const trimmed = content.trim();

  // XML/SBML detection
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<sbml') || trimmed.startsWith('<SBML')) {
    return 'sbml';
  }

  // Check for SBML-like content anywhere
  if (trimmed.includes('<sbml') || trimmed.includes('<model') && trimmed.includes('</model>')) {
    return 'sbml';
  }

  // JSON detection
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json';
  }

  return 'unknown';
};

/**
 * Main entry point: Parse model from File object
 */
export const parseModel = async (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const content = e.target.result;
        const format = detectFormat(content);

        if (format === 'sbml') {
          // Parse SBML/XML
          const model = parseSBML(content);
          model.format = 'SBML';
          resolve(model);
        } else if (format === 'json') {
          // Parse JSON (CobraPy/BIGG)
          const jsonData = JSON.parse(content);
          const model = standardizeBIGGModel(jsonData);
          model.format = 'JSON';
          resolve(model);
        } else {
          reject(new Error("Unknown file format. Supported formats: JSON (CobraPy/BIGG), SBML (XML Level 2/3)."));
        }
      } catch (error) {
        reject(new Error("Failed to parse model: " + error.message));
      }
    };

    reader.onerror = () => reject(new Error("File reading failed"));
    reader.readAsText(file);
  });
};

/**
 * Parse model from string content (for programmatic use)
 */
export const parseModelFromString = (content, formatHint = null) => {
  const format = formatHint || detectFormat(content);

  if (format === 'sbml') {
    const model = parseSBML(content);
    model.format = 'SBML';
    return model;
  } else if (format === 'json') {
    const jsonData = JSON.parse(content);
    const model = standardizeBIGGModel(jsonData);
    model.format = 'JSON';
    return model;
  } else {
    throw new Error("Unknown format. Expected JSON or SBML.");
  }
};

/**
 * Get supported file extensions
 */
export const getSupportedFormats = () => ({
  json: {
    extensions: ['.json'],
    mimeTypes: ['application/json'],
    description: 'CobraPy JSON / BIGG Models'
  },
  sbml: {
    extensions: ['.xml', '.sbml'],
    mimeTypes: ['application/xml', 'text/xml', 'application/sbml+xml'],
    description: 'SBML Level 2/3 (with FBC support)'
  }
});

/**
 * Validate if file is a supported format
 */
export const isValidModelFile = (file) => {
  const name = file.name.toLowerCase();
  const formats = getSupportedFormats();

  return formats.json.extensions.some(ext => name.endsWith(ext)) ||
         formats.sbml.extensions.some(ext => name.endsWith(ext));
};

/**
 * Standardizes a BIGG/CobraPy model JSON into the format used by our app.
 */
const standardizeBIGGModel = (biggModel) => {
  // Validate required fields
  if (!biggModel.reactions) {
    throw new Error("Invalid model format: missing 'reactions' field.");
  }
  if (!biggModel.metabolites) {
    throw new Error("Invalid model format: missing 'metabolites' field.");
  }

  const modelId = biggModel.id || biggModel.name || 'uploaded_model';

  // 1. Transform Genes
  const genes = {};
  if (biggModel.genes && Array.isArray(biggModel.genes)) {
    biggModel.genes.forEach(g => {
      const geneId = g.id || g.name;
      genes[geneId] = {
        product: g.name || geneId,
        essential: false,
        subsystem: 'Unknown'
      };
    });
  }

  // 2. Build metabolite lookup for visualization
  const metabolites = {};
  if (Array.isArray(biggModel.metabolites)) {
    biggModel.metabolites.forEach(m => {
      metabolites[m.id] = {
        name: m.name || m.id,
        compartment: m.compartment || extractCompartment(m.id),
        formula: m.formula || ''
      };
    });
  }

  // 3. Transform Reactions and track metabolite connectivity
  const reactions = {};
  const metaboliteConnectivity = {};

  (biggModel.reactions || []).forEach(r => {
    const reactionMetabolites = r.metabolites || {};

    // Track connectivity for graph layout
    Object.keys(reactionMetabolites).forEach(metId => {
      metaboliteConnectivity[metId] = (metaboliteConnectivity[metId] || 0) + 1;
    });

    // Determine reaction type
    let subsystem = r.subsystem || 'Unclassified';
    if (r.id.startsWith('EX_')) subsystem = 'Exchange';
    else if (r.id.startsWith('DM_')) subsystem = 'Demand';
    else if (r.id.startsWith('SK_')) subsystem = 'Sink';
    else if (r.id.toLowerCase().includes('biomass')) subsystem = 'Biomass';

    reactions[r.id] = {
      name: r.name || r.id,
      equation: buildEquation(reactionMetabolites, metabolites),
      subsystem,
      genes: parseGeneReactionRule(r.gene_reaction_rule),
      gpr: r.gene_reaction_rule || '',
      gene_reaction_rule: r.gene_reaction_rule || '',
      lower_bound: r.lower_bound ?? -1000,
      upper_bound: r.upper_bound ?? 1000,
      metabolites: reactionMetabolites,
      objective_coefficient: r.objective_coefficient || 0
    };

    // Update gene subsystem info
    reactions[r.id].genes.forEach(geneId => {
      if (genes[geneId] && genes[geneId].subsystem === 'Unknown') {
        genes[geneId].subsystem = subsystem;
      }
    });
  });

  // 4. Generate visualization graph
  const { nodes, edges } = generateGraphLayout(reactions, metabolites, metaboliteConnectivity);

  return {
    id: modelId,
    genes,
    reactions,
    metabolites,
    nodes,
    edges,
    metaboliteCount: Object.keys(metabolites).length,
    geneCount: Object.keys(genes).length,
    reactionCount: Object.keys(reactions).length
  };
};

const extractCompartment = (metId) => {
  const match = metId.match(/_([cepmnrgx])$/);
  return match ? match[1] : 'c';
};

const buildEquation = (reactionMetabolites, metaboliteLookup) => {
  const reactants = [];
  const products = [];

  Object.entries(reactionMetabolites).forEach(([metId, coeff]) => {
    const met = metaboliteLookup[metId];
    const compartment = extractCompartment(metId);
    const baseName = metId.replace(/_[cepmnrgx]$/, '');
    const displayName = compartment !== 'c' ? `${baseName}[${compartment}]` : baseName;

    if (coeff < 0) {
      reactants.push(Math.abs(coeff) === 1 ? displayName : `${Math.abs(coeff)} ${displayName}`);
    } else {
      products.push(coeff === 1 ? displayName : `${coeff} ${displayName}`);
    }
  });

  const arrow = reactants.length === 0 || products.length === 0 ? '→' : '↔';
  return `${reactants.join(' + ') || '∅'} ${arrow} ${products.join(' + ') || '∅'}`;
};

const parseGeneReactionRule = (rule) => {
  if (!rule) return [];
  // Extract gene IDs, filtering out boolean operators
  const geneIds = rule.match(/[a-zA-Z0-9_.-]+/g) || [];
  return [...new Set(geneIds.filter(id =>
    id.toUpperCase() !== 'AND' &&
    id.toUpperCase() !== 'OR' &&
    id !== 'and' &&
    id !== 'or'
  ))];
};

/**
 * Generate a graph layout for visualization.
 * Uses a hierarchical layout based on metabolic pathway structure.
 */
const generateGraphLayout = (reactions, metabolites, connectivity) => {
  const nodes = [];
  const edges = [];
  const addedNodes = new Set();

  // Get the top N most connected metabolites for the core network
  const sortedMets = Object.entries(connectivity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  const keyMetabolites = new Set(sortedMets.map(([id]) => id));

  // Layout parameters
  const width = 800;
  const height = 600;
  const padding = 50;

  // Position metabolites in a force-directed-like spiral layout
  let angle = 0;
  let radius = 100;
  let radiusIncrement = 20;
  let angleIncrement = 0.8;

  sortedMets.forEach(([metId, count], index) => {
    const met = metabolites[metId];
    const compartment = extractCompartment(metId);

    // Spiral layout
    const x = width / 2 + radius * Math.cos(angle);
    const y = height / 2 + radius * Math.sin(angle);

    let nodeType = 'metabolite';
    if (compartment === 'e') nodeType = 'exchange';
    else if (metId.toLowerCase().includes('biomass')) nodeType = 'biomass';

    nodes.push({
      id: metId,
      x: Math.max(padding, Math.min(width - padding, x)),
      y: Math.max(padding, Math.min(height - padding, y)),
      label: met?.name || metId.replace(/_[cepmnrgx]$/, ''),
      type: nodeType,
      connectivity: count
    });

    addedNodes.add(metId);
    angle += angleIncrement;
    if (index % 5 === 4) {
      radius += radiusIncrement;
      angleIncrement *= 0.95;
    }
  });

  // Create edges between metabolites that share reactions
  Object.entries(reactions).forEach(([rxnId, rxn]) => {
    if (!rxn.metabolites) return;

    const mets = Object.entries(rxn.metabolites);
    const reactantMets = mets.filter(([, coeff]) => coeff < 0).map(([id]) => id);
    const productMets = mets.filter(([, coeff]) => coeff > 0).map(([id]) => id);

    // Create edges from reactants to products (only for key metabolites)
    reactantMets.forEach(fromId => {
      if (!keyMetabolites.has(fromId)) return;
      productMets.forEach(toId => {
        if (!keyMetabolites.has(toId)) return;
        if (fromId !== toId) {
          edges.push({
            from: fromId,
            to: toId,
            reaction: rxnId,
            label: rxnId
          });
        }
      });
    });
  });

  // Limit edges to prevent visual clutter
  const limitedEdges = edges.slice(0, 50);

  return { nodes, edges: limitedEdges };
};

