/**
 * SBML (Systems Biology Markup Language) Parser
 * Supports SBML Level 2 and Level 3 with FBC (Flux Balance Constraints) package
 *
 * Based on SBML specifications:
 * - SBML Level 2 Version 4: http://sbml.org/Documents/Specifications
 * - SBML Level 3 Version 2: http://sbml.org/Documents/Specifications
 * - FBC Package Version 2: http://sbml.org/Documents/Specifications/SBML_Level_3/Packages/fbc
 */

// XML Namespace constants
const SBML_NS = {
  sbml2: 'http://www.sbml.org/sbml/level2',
  sbml3: 'http://www.sbml.org/sbml/level3/version1/core',
  sbml3v2: 'http://www.sbml.org/sbml/level3/version2/core',
  fbc: 'http://www.sbml.org/sbml/level3/version1/fbc/version2',
  fbc1: 'http://www.sbml.org/sbml/level3/version1/fbc/version1',
  groups: 'http://www.sbml.org/sbml/level3/version1/groups/version1',
  layout: 'http://www.sbml.org/sbml/level3/version1/layout/version1',
  render: 'http://www.sbml.org/sbml/level3/version1/render/version1'
};

/**
 * Parse an SBML XML string into a standardized model format
 */
export const parseSBML = (xmlString) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  // Check for parsing errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`XML parsing error: ${parseError.textContent}`);
  }

  // Get SBML root element
  const sbmlElement = doc.querySelector('sbml');
  if (!sbmlElement) {
    throw new Error('Invalid SBML: No <sbml> root element found');
  }

  // Detect SBML level and version
  const level = parseInt(sbmlElement.getAttribute('level') || '3', 10);
  const version = parseInt(sbmlElement.getAttribute('version') || '1', 10);

  // Get the model element
  const modelElement = sbmlElement.querySelector('model');
  if (!modelElement) {
    throw new Error('Invalid SBML: No <model> element found');
  }

  const modelId = modelElement.getAttribute('id') || modelElement.getAttribute('name') || 'sbml_model';
  const modelName = modelElement.getAttribute('name') || modelId;

  // Parse compartments
  const compartments = parseCompartments(modelElement);

  // Parse species (metabolites)
  const { species, metabolites } = parseSpecies(modelElement, compartments);

  // Parse gene products (SBML L3 FBC)
  const geneProducts = parseGeneProducts(modelElement);

  // Parse global parameters FIRST so FBC flux bound references can be resolved
  const parameterLookup = parseParameterLookup(modelElement);

  // Parse reactions (passing parameterLookup for FBC bound resolution)
  const { reactions, genes } = parseReactions(modelElement, species, geneProducts, level, parameterLookup);

  // Parse layout information if available
  const layoutInfo = parseLayout(modelElement);

  // Generate visualization graph
  const { nodes, edges } = generateGraphFromSBML(reactions, metabolites, species, layoutInfo);

  // Parse FBC v2 objectives (listOfObjectives) and apply to reactions
  parseFBCObjectives(modelElement, reactions);

  // Extract flux bounds if FBC package is used
  const fluxBounds = parseFluxBounds(modelElement, reactions);

  // Parse groups/subsystems if available
  const groups = parseGroups(modelElement);
  assignSubsystems(reactions, groups);

  // Parse and validate unit definitions
  const { unitDefinitions, unitWarnings } = parseUnitDefinitions(modelElement);

  return {
    id: modelId,
    name: modelName,
    level,
    version,
    format: 'SBML',
    compartments,
    metabolites,
    genes,
    reactions,
    nodes,
    edges,
    fluxBounds,
    unitDefinitions,
    unitWarnings,
    metaboliteCount: Object.keys(metabolites).length,
    geneCount: Object.keys(genes).length,
    reactionCount: Object.keys(reactions).length
  };
};

/**
 * Parse compartments from SBML
 */
const parseCompartments = (modelElement) => {
  const compartments = {};
  const compartmentList = modelElement.querySelector('listOfCompartments');

  if (compartmentList) {
    compartmentList.querySelectorAll('compartment').forEach(comp => {
      const id = comp.getAttribute('id');
      compartments[id] = {
        id,
        name: comp.getAttribute('name') || id,
        size: parseFloat(comp.getAttribute('size') || comp.getAttribute('volume') || '1'),
        outside: comp.getAttribute('outside') || null,
        spatialDimensions: parseInt(comp.getAttribute('spatialDimensions') || '3', 10)
      };
    });
  }

  // Default compartment if none defined
  if (Object.keys(compartments).length === 0) {
    compartments['default'] = { id: 'default', name: 'Default', size: 1 };
  }

  return compartments;
};

/**
 * Parse species (metabolites) from SBML
 */
const parseSpecies = (modelElement, compartments) => {
  const species = {};
  const metabolites = {};
  const speciesList = modelElement.querySelector('listOfSpecies');

  if (speciesList) {
    speciesList.querySelectorAll('species').forEach(sp => {
      const id = sp.getAttribute('id');
      const name = sp.getAttribute('name') || id;
      const compartment = sp.getAttribute('compartment') || 'default';
      const boundaryCondition = sp.getAttribute('boundaryCondition') === 'true';

      // Get FBC charge and formula if available
      const charge = sp.getAttributeNS(SBML_NS.fbc, 'charge') ||
                     sp.getAttribute('fbc:charge') ||
                     sp.getAttribute('charge');
      const formula = sp.getAttributeNS(SBML_NS.fbc, 'chemicalFormula') ||
                      sp.getAttribute('fbc:chemicalFormula');

      // Parse annotations for additional metadata
      const annotation = parseAnnotation(sp);

      species[id] = {
        id,
        name,
        compartment,
        boundaryCondition,
        charge: charge ? parseInt(charge, 10) : null,
        formula: formula || null,
        annotation
      };

      // Create metabolite entry (simplified for app use)
      metabolites[id] = {
        name: cleanMetaboliteName(name),
        compartment,
        formula: formula || '',
        boundaryCondition
      };
    });
  }

  return { species, metabolites };
};

/**
 * Parse gene products from SBML Level 3 FBC package
 */
const parseGeneProducts = (modelElement) => {
  const geneProducts = {};

  // Try FBC v2 style (listOfGeneProducts)
  const geneProductList = modelElement.querySelector('listOfGeneProducts') ||
                          modelElement.querySelector('fbc\\:listOfGeneProducts');

  if (geneProductList) {
    geneProductList.querySelectorAll('geneProduct, fbc\\:geneProduct').forEach(gp => {
      const id = gp.getAttribute('id') || gp.getAttributeNS(SBML_NS.fbc, 'id');
      const label = gp.getAttribute('label') || gp.getAttributeNS(SBML_NS.fbc, 'label') || id;
      const name = gp.getAttribute('name') || gp.getAttributeNS(SBML_NS.fbc, 'name') || label;

      geneProducts[id] = {
        id,
        label,
        name
      };
    });
  }

  return geneProducts;
};

/**
 * Parse global parameters into a lookup map (ID → numeric value).
 * Used to resolve FBC v2 flux bound parameter references.
 */
const parseParameterLookup = (modelElement) => {
  const lookup = {};
  const paramList = modelElement.querySelector('listOfParameters');
  if (paramList) {
    paramList.querySelectorAll('parameter').forEach(param => {
      const id = param.getAttribute('id');
      const value = parseFloat(param.getAttribute('value') || '0');
      if (id && !isNaN(value)) {
        lookup[id] = value;
      }
    });
  }
  return lookup;
};

/**
 * Parse reactions from SBML
 */
const parseReactions = (modelElement, species, geneProducts, level, parameterLookup = {}) => {
  const reactions = {};
  const genes = {};
  const reactionList = modelElement.querySelector('listOfReactions');

  if (reactionList) {
    reactionList.querySelectorAll('reaction').forEach(rxn => {
      const id = rxn.getAttribute('id');
      const name = rxn.getAttribute('name') || id;
      const reversible = rxn.getAttribute('reversible') !== 'false';

      // Parse reactants and products
      const reactants = parseSpeciesReferences(rxn.querySelector('listOfReactants'));
      const products = parseSpeciesReferences(rxn.querySelector('listOfProducts'));
      const modifiers = parseModifierReferences(rxn.querySelector('listOfModifiers'));

      // Build equation string
      const equation = buildEquationString(reactants, products, reversible, species);

      // Build metabolites object (stoichiometry)
      const metaboliteStoich = {};
      reactants.forEach(r => { metaboliteStoich[r.species] = -r.stoichiometry; });
      products.forEach(p => { metaboliteStoich[p.species] = p.stoichiometry; });

      // Parse GPR (Gene-Protein-Reaction) association
      const { gpr, geneList } = parseGPR(rxn, geneProducts, level);

      // Add genes to global gene list
      geneList.forEach(geneId => {
        if (!genes[geneId]) {
          const gp = geneProducts[geneId];
          genes[geneId] = {
            product: gp?.name || gp?.label || geneId,
            essential: false,
            subsystem: 'Unknown'
          };
        }
      });

      // Parse flux bounds (resolve FBC parameter references)
      const bounds = parseReactionBounds(rxn, reversible, parameterLookup);

      // Parse subsystem from notes or annotation
      const subsystem = parseSubsystem(rxn) || determineSubsystem(id, name);

      // Parse annotation
      const annotation = parseAnnotation(rxn);

      reactions[id] = {
        name,
        equation,
        subsystem,
        genes: geneList,
        gpr,
        reversible,
        lower_bound: bounds.lower,
        upper_bound: bounds.upper,
        metabolites: metaboliteStoich,
        reactants,
        products,
        modifiers,
        annotation,
        objective_coefficient: parseObjectiveCoefficient(rxn)
      };

      // Update gene subsystems
      geneList.forEach(geneId => {
        if (genes[geneId] && genes[geneId].subsystem === 'Unknown') {
          genes[geneId].subsystem = subsystem;
        }
      });
    });
  }

  return { reactions, genes };
};

/**
 * Parse species references (reactants/products)
 */
const parseSpeciesReferences = (listElement) => {
  const refs = [];
  if (!listElement) return refs;

  listElement.querySelectorAll('speciesReference').forEach(ref => {
    refs.push({
      species: ref.getAttribute('species'),
      stoichiometry: parseFloat(ref.getAttribute('stoichiometry') || '1'),
      constant: ref.getAttribute('constant') === 'true'
    });
  });

  return refs;
};

/**
 * Parse modifier species references
 */
const parseModifierReferences = (listElement) => {
  const refs = [];
  if (!listElement) return refs;

  listElement.querySelectorAll('modifierSpeciesReference').forEach(ref => {
    refs.push({
      species: ref.getAttribute('species')
    });
  });

  return refs;
};

/**
 * Build human-readable equation string
 */
const buildEquationString = (reactants, products, reversible, species) => {
  const formatSide = (refs) => {
    if (refs.length === 0) return '∅';
    return refs.map(r => {
      const sp = species[r.species];
      const name = sp ? cleanMetaboliteName(sp.name) : r.species;
      const compartment = sp?.compartment;
      const displayName = compartment && compartment !== 'c' ? `${name}[${compartment}]` : name;
      return r.stoichiometry === 1 ? displayName : `${r.stoichiometry} ${displayName}`;
    }).join(' + ');
  };

  const arrow = reversible ? '↔' : '→';
  return `${formatSide(reactants)} ${arrow} ${formatSide(products)}`;
};

/**
 * Clean metabolite name for display
 */
const cleanMetaboliteName = (name) => {
  // Remove common prefixes/suffixes
  return name
    .replace(/^M_/, '')
    .replace(/_[cepmnrgx]$/, '')
    .replace(/_DASH_/g, '-')
    .replace(/_LPAREN_/g, '(')
    .replace(/_RPAREN_/g, ')')
    .replace(/__/g, '_');
};

/**
 * Parse GPR (Gene-Protein-Reaction) association
 */
const parseGPR = (rxnElement, geneProducts, level) => {
  let gpr = '';
  const geneList = [];

  // Try FBC v2 geneProductAssociation
  const gpaElement = rxnElement.querySelector('geneProductAssociation, fbc\\:geneProductAssociation');

  if (gpaElement) {
    const result = parseGPRAssociation(gpaElement);
    gpr = result.gpr;
    geneList.push(...result.genes);
  } else {
    // Try FBC v1 style (in notes or annotation)
    const notes = rxnElement.querySelector('notes');
    if (notes) {
      const gprMatch = notes.textContent.match(/GENE[_\s]*ASSOCIATION[:\s]*([^\n<]+)/i) ||
                       notes.textContent.match(/GPR[:\s]*([^\n<]+)/i);
      if (gprMatch) {
        gpr = gprMatch[1].trim();
        geneList.push(...extractGeneIds(gpr));
      }
    }
  }

  // Map gene product IDs to labels if available
  const mappedGeneList = geneList.map(g => {
    const gp = geneProducts[g];
    return gp?.label || g;
  });

  return { gpr, geneList: [...new Set(mappedGeneList)] };
};

/**
 * Parse FBC geneProductAssociation recursively
 */
const parseGPRAssociation = (element) => {
  const genes = [];
  let gpr = '';

  // Check for AND/OR elements — use direct children only to avoid
  // matching nested descendants (which would flatten the tree)
  const children = Array.from(element.children);
  const andElement = children.find(c => c.localName === 'and');
  const orElement = children.find(c => c.localName === 'or');
  const geneRefElement = children.find(c => c.localName === 'geneProductRef');

  if (andElement) {
    const children = [];
    andElement.childNodes.forEach(child => {
      if (child.nodeType === 1) { // Element node
        const result = parseGPRAssociation(child);
        if (result.gpr) {
          children.push(result.gpr);
          genes.push(...result.genes);
        }
      }
    });
    gpr = `(${children.join(' AND ')})`;
  } else if (orElement) {
    const children = [];
    orElement.childNodes.forEach(child => {
      if (child.nodeType === 1) {
        const result = parseGPRAssociation(child);
        if (result.gpr) {
          children.push(result.gpr);
          genes.push(...result.genes);
        }
      }
    });
    gpr = `(${children.join(' OR ')})`;
  } else if (geneRefElement) {
    const geneProductId = geneRefElement.getAttribute('geneProduct') ||
                          geneRefElement.getAttributeNS(SBML_NS.fbc, 'geneProduct');
    genes.push(geneProductId);
    gpr = geneProductId;
  } else {
    // Direct children might be gene refs
    element.querySelectorAll('geneProductRef, fbc\\:geneProductRef').forEach(ref => {
      const geneProductId = ref.getAttribute('geneProduct') ||
                            ref.getAttributeNS(SBML_NS.fbc, 'geneProduct');
      if (geneProductId) {
        genes.push(geneProductId);
        gpr = geneProductId;
      }
    });
  }

  return { gpr, genes };
};

/**
 * Extract gene IDs from a GPR string
 */
const extractGeneIds = (gprString) => {
  if (!gprString) return [];
  const ids = gprString.match(/[a-zA-Z0-9_.-]+/g) || [];
  return ids.filter(id =>
    id.toUpperCase() !== 'AND' &&
    id.toUpperCase() !== 'OR' &&
    id !== 'and' &&
    id !== 'or' &&
    id !== '(' &&
    id !== ')'
  );
};

/**
 * Parse reaction bounds from FBC package or kinetic law.
 *
 * FBC v2 stores bounds as references to global <parameter> elements
 * (e.g., fbc:lowerFluxBound="cobra_default_lb"). We resolve these to
 * actual numeric values from the model's listOfParameters.
 *
 * Reference: Olivier & Bergmann (2018) "FBC package specification v2"
 *
 * @param {Element} rxnElement - Reaction DOM element
 * @param {boolean} reversible - Whether reaction is reversible
 * @param {Object} parameterLookup - Map of parameter ID → numeric value
 * @returns {{ lower: number, upper: number }}
 */
const parseReactionBounds = (rxnElement, reversible, parameterLookup = {}) => {
  let lower = reversible ? -1000 : 0;
  let upper = 1000;

  // Try FBC bounds (these are parameter ID references, not values)
  const lowerBoundRef = rxnElement.getAttributeNS(SBML_NS.fbc, 'lowerFluxBound') ||
                        rxnElement.getAttribute('fbc:lowerFluxBound');
  const upperBoundRef = rxnElement.getAttributeNS(SBML_NS.fbc, 'upperFluxBound') ||
                        rxnElement.getAttribute('fbc:upperFluxBound');

  // Resolve parameter references to numeric values
  if (lowerBoundRef && parameterLookup[lowerBoundRef] !== undefined) {
    lower = parameterLookup[lowerBoundRef];
  } else if (lowerBoundRef) {
    // Fallback: pattern matching for common parameter naming conventions
    // This handles models that don't include listOfParameters
    const ref = lowerBoundRef.toLowerCase();
    if (ref.includes('zero')) lower = 0;
    else if (ref.includes('minus') || ref.includes('neg')) lower = -1000;
  }

  if (upperBoundRef && parameterLookup[upperBoundRef] !== undefined) {
    upper = parameterLookup[upperBoundRef];
  } else if (upperBoundRef) {
    const ref = upperBoundRef.toLowerCase();
    if (ref.includes('zero')) upper = 0;
    else if (ref.includes('plus') || ref.includes('pos')) upper = 1000;
  }

  return { lower, upper };
};

/**
 * Parse FBC v2 listOfObjectives and apply objective coefficients to reactions.
 *
 * FBC v2 spec: The active objective is identified by fbc:activeObjective on the
 * model element. Each objective contains fluxObjective elements that reference
 * reactions with a coefficient.
 *
 * Reference: Olivier & Bergmann (2018) "FBC package v2" §3.5
 */
const parseFBCObjectives = (modelElement, reactions) => {
  const objList = modelElement.querySelector('listOfObjectives, fbc\\:listOfObjectives');
  if (!objList) return;

  // Find active objective
  const activeObjId = objList.getAttributeNS(SBML_NS.fbc, 'activeObjective') ||
                      objList.getAttribute('fbc:activeObjective') ||
                      objList.getAttribute('activeObjective');

  const objectives = objList.querySelectorAll('objective, fbc\\:objective');
  for (const obj of objectives) {
    const objId = obj.getAttribute('id') || obj.getAttributeNS(SBML_NS.fbc, 'id');
    // Only process the active objective (or the first one if no active is specified)
    if (activeObjId && objId !== activeObjId) continue;

    const fluxObjList = obj.querySelectorAll('fluxObjective, fbc\\:fluxObjective');
    for (const fo of fluxObjList) {
      const rxnRef = fo.getAttribute('reaction') || fo.getAttributeNS(SBML_NS.fbc, 'reaction');
      const coef = parseFloat(
        fo.getAttribute('coefficient') ||
        fo.getAttributeNS(SBML_NS.fbc, 'coefficient') || '1'
      );
      if (rxnRef && reactions[rxnRef]) {
        reactions[rxnRef].objective_coefficient = coef;
      }
    }
    break; // Only process one objective
  }
};

/**
 * Parse global flux bound parameters
 */
const parseFluxBounds = (modelElement, reactions) => {
  const bounds = {};

  // Parse listOfParameters for flux bound definitions
  const paramList = modelElement.querySelector('listOfParameters');
  if (paramList) {
    paramList.querySelectorAll('parameter').forEach(param => {
      const id = param.getAttribute('id');
      const value = parseFloat(param.getAttribute('value') || '0');
      bounds[id] = value;
    });
  }

  // Also check FBC listOfFluxBounds (FBC v1)
  const fluxBoundList = modelElement.querySelector('listOfFluxBounds, fbc\\:listOfFluxBounds');
  if (fluxBoundList) {
    fluxBoundList.querySelectorAll('fluxBound, fbc\\:fluxBound').forEach(fb => {
      const reaction = fb.getAttribute('reaction') || fb.getAttributeNS(SBML_NS.fbc, 'reaction');
      const operation = fb.getAttribute('operation') || fb.getAttributeNS(SBML_NS.fbc, 'operation');
      const value = parseFloat(fb.getAttribute('value') || fb.getAttributeNS(SBML_NS.fbc, 'value') || '0');

      if (reaction && reactions[reaction]) {
        if (operation === 'lessEqual' || operation === 'less') {
          reactions[reaction].upper_bound = value;
        } else if (operation === 'greaterEqual' || operation === 'greater') {
          reactions[reaction].lower_bound = value;
        } else if (operation === 'equal') {
          reactions[reaction].lower_bound = value;
          reactions[reaction].upper_bound = value;
        }
      }
    });
  }

  return bounds;
};

/**
 * Parse objective coefficient for FBA.
 *
 * FBC v1: attribute on reaction element (fbc:objective_coefficient)
 * FBC v2: defined in listOfObjectives > objective > listOfFluxObjectives
 *
 * This function handles the v1 attribute style. FBC v2 objectives are
 * resolved separately in parseFBCObjectives() and applied post-parse.
 */
const parseObjectiveCoefficient = (rxnElement) => {
  // FBC v1 style: attribute directly on reaction
  const coef = rxnElement.getAttributeNS(SBML_NS.fbc, 'objective_coefficient') ||
               rxnElement.getAttribute('fbc:objective_coefficient');
  return coef ? parseFloat(coef) : 0;
};

/**
 * Parse subsystem from reaction notes or annotation
 */
const parseSubsystem = (rxnElement) => {
  const notes = rxnElement.querySelector('notes');
  if (notes) {
    // Try common patterns in notes
    const subsystemMatch = notes.textContent.match(/SUBSYSTEM[:\s]*([^\n<]+)/i) ||
                           notes.textContent.match(/PATHWAY[:\s]*([^\n<]+)/i);
    if (subsystemMatch) {
      return subsystemMatch[1].trim();
    }
  }

  // Check annotation for SBO terms or other ontology references
  const annotation = rxnElement.querySelector('annotation');
  if (annotation) {
    // Look for pathway information in RDF
    const pathwayMatch = annotation.textContent.match(/kegg\.pathway[:/]([^\s"<]+)/i) ||
                         annotation.textContent.match(/reactome[:/]([^\s"<]+)/i);
    if (pathwayMatch) {
      return pathwayMatch[1];
    }
  }

  return null;
};

/**
 * Determine subsystem based on reaction ID/name patterns
 */
const determineSubsystem = (id, name) => {
  const lowerName = (name + ' ' + id).toLowerCase();

  if (id.startsWith('EX_') || lowerName.includes('exchange')) return 'Exchange';
  if (id.startsWith('DM_') || lowerName.includes('demand')) return 'Demand';
  if (id.startsWith('SK_') || lowerName.includes('sink')) return 'Sink';
  if (lowerName.includes('biomass')) return 'Biomass';
  if (lowerName.includes('transport') || lowerName.includes('_t_')) return 'Transport';
  if (lowerName.includes('glycoly') || lowerName.includes('glc')) return 'Glycolysis';
  if (lowerName.includes('tca') || lowerName.includes('citrate') || lowerName.includes('krebs')) return 'TCA Cycle';
  if (lowerName.includes('pentose') || lowerName.includes('ppp')) return 'Pentose Phosphate Pathway';
  if (lowerName.includes('oxphos') || lowerName.includes('oxidative') || lowerName.includes('atp synthase')) return 'Oxidative Phosphorylation';
  if (lowerName.includes('amino acid') || lowerName.includes('aminoacid')) return 'Amino Acid Metabolism';
  if (lowerName.includes('lipid') || lowerName.includes('fatty')) return 'Lipid Metabolism';
  if (lowerName.includes('nucleotide') || lowerName.includes('purine') || lowerName.includes('pyrimidine')) return 'Nucleotide Metabolism';

  return 'Unclassified';
};

/**
 * Parse annotation element for identifiers.org references
 */
const parseAnnotation = (element) => {
  const annotation = {
    identifiers: [],
    sbo: null
  };

  const annotationEl = element.querySelector('annotation');
  if (!annotationEl) return annotation;

  // Parse RDF for identifiers.org URIs
  const rdfDescription = annotationEl.querySelector('rdf\\:Description, Description');
  if (rdfDescription) {
    rdfDescription.querySelectorAll('rdf\\:li, li').forEach(li => {
      const resource = li.getAttribute('rdf:resource') || li.getAttribute('resource');
      if (resource) {
        const match = resource.match(/identifiers\.org\/([^/]+)\/(.+)/);
        if (match) {
          annotation.identifiers.push({
            database: match[1],
            id: match[2]
          });
        }
      }
    });
  }

  // Parse SBO term
  const sboTerm = element.getAttribute('sboTerm');
  if (sboTerm) {
    annotation.sbo = sboTerm;
  }

  return annotation;
};

/**
 * Parse groups package for subsystem information
 */
const parseGroups = (modelElement) => {
  const groups = {};

  const groupList = modelElement.querySelector('listOfGroups, groups\\:listOfGroups');
  if (groupList) {
    groupList.querySelectorAll('group, groups\\:group').forEach(group => {
      const id = group.getAttribute('id') || group.getAttributeNS(SBML_NS.groups, 'id');
      const name = group.getAttribute('name') || group.getAttributeNS(SBML_NS.groups, 'name') || id;
      const kind = group.getAttribute('kind') || group.getAttributeNS(SBML_NS.groups, 'kind') || 'collection';

      const members = [];
      const memberList = group.querySelector('listOfMembers, groups\\:listOfMembers');
      if (memberList) {
        memberList.querySelectorAll('member, groups\\:member').forEach(member => {
          const idRef = member.getAttribute('idRef') || member.getAttributeNS(SBML_NS.groups, 'idRef');
          if (idRef) members.push(idRef);
        });
      }

      groups[id] = { name, kind, members };
    });
  }

  return groups;
};

/**
 * Assign subsystems to reactions based on groups
 */
const assignSubsystems = (reactions, groups) => {
  Object.values(groups).forEach(group => {
    if (group.kind === 'classification' || group.kind === 'partonomy') {
      group.members.forEach(memberId => {
        if (reactions[memberId] && reactions[memberId].subsystem === 'Unclassified') {
          reactions[memberId].subsystem = group.name;
        }
      });
    }
  });
};

/**
 * Parse layout information from SBML layout package
 */
const parseLayout = (modelElement) => {
  const layoutInfo = {
    hasLayout: false,
    speciesGlyphs: {},
    reactionGlyphs: {},
    dimensions: { width: 800, height: 600 }
  };

  const layoutList = modelElement.querySelector('listOfLayouts, layout\\:listOfLayouts');
  if (!layoutList) return layoutInfo;

  const layout = layoutList.querySelector('layout, layout\\:layout');
  if (!layout) return layoutInfo;

  layoutInfo.hasLayout = true;

  // Parse dimensions
  const dimensions = layout.querySelector('dimensions, layout\\:dimensions');
  if (dimensions) {
    layoutInfo.dimensions.width = parseFloat(dimensions.getAttribute('width') || '800');
    layoutInfo.dimensions.height = parseFloat(dimensions.getAttribute('height') || '600');
  }

  // Parse species glyphs
  const speciesGlyphList = layout.querySelector('listOfSpeciesGlyphs, layout\\:listOfSpeciesGlyphs');
  if (speciesGlyphList) {
    speciesGlyphList.querySelectorAll('speciesGlyph, layout\\:speciesGlyph').forEach(glyph => {
      const id = glyph.getAttribute('id');
      const species = glyph.getAttribute('species') || glyph.getAttributeNS(SBML_NS.layout, 'species');

      const boundingBox = glyph.querySelector('boundingBox, layout\\:boundingBox');
      if (boundingBox) {
        const position = boundingBox.querySelector('position, layout\\:position');
        const dimensions = boundingBox.querySelector('dimensions, layout\\:dimensions');

        if (position && species) {
          layoutInfo.speciesGlyphs[species] = {
            x: parseFloat(position.getAttribute('x') || '0'),
            y: parseFloat(position.getAttribute('y') || '0'),
            width: dimensions ? parseFloat(dimensions.getAttribute('width') || '50') : 50,
            height: dimensions ? parseFloat(dimensions.getAttribute('height') || '30') : 30
          };
        }
      }
    });
  }

  // Parse reaction glyphs
  const reactionGlyphList = layout.querySelector('listOfReactionGlyphs, layout\\:listOfReactionGlyphs');
  if (reactionGlyphList) {
    reactionGlyphList.querySelectorAll('reactionGlyph, layout\\:reactionGlyph').forEach(glyph => {
      const id = glyph.getAttribute('id');
      const reaction = glyph.getAttribute('reaction') || glyph.getAttributeNS(SBML_NS.layout, 'reaction');

      const boundingBox = glyph.querySelector('boundingBox, layout\\:boundingBox');
      if (boundingBox && reaction) {
        const position = boundingBox.querySelector('position, layout\\:position');
        if (position) {
          layoutInfo.reactionGlyphs[reaction] = {
            x: parseFloat(position.getAttribute('x') || '0'),
            y: parseFloat(position.getAttribute('y') || '0')
          };
        }
      }
    });
  }

  return layoutInfo;
};

/**
 * Generate visualization graph from SBML data
 */
const generateGraphFromSBML = (reactions, metabolites, species, layoutInfo) => {
  const nodes = [];
  const edges = [];
  const addedNodes = new Set();

  // Calculate metabolite connectivity
  const connectivity = {};
  Object.values(reactions).forEach(rxn => {
    if (rxn.metabolites) {
      Object.keys(rxn.metabolites).forEach(metId => {
        connectivity[metId] = (connectivity[metId] || 0) + 1;
      });
    }
  });

  // If we have layout information, use it
  if (layoutInfo.hasLayout && Object.keys(layoutInfo.speciesGlyphs).length > 0) {
    // Scale factor to normalize coordinates
    const maxX = Math.max(...Object.values(layoutInfo.speciesGlyphs).map(g => g.x + g.width), 100);
    const maxY = Math.max(...Object.values(layoutInfo.speciesGlyphs).map(g => g.y + g.height), 100);
    const scaleX = 750 / maxX;
    const scaleY = 550 / maxY;

    Object.entries(layoutInfo.speciesGlyphs).forEach(([speciesId, glyph]) => {
      const met = metabolites[speciesId] || species[speciesId];
      if (!met) return;

      const compartment = met.compartment || 'c';
      let nodeType = 'metabolite';
      if (compartment === 'e') nodeType = 'exchange';
      if (met.boundaryCondition) nodeType = 'exchange';
      if (speciesId.toLowerCase().includes('biomass')) nodeType = 'biomass';

      nodes.push({
        id: speciesId,
        x: 25 + glyph.x * scaleX,
        y: 25 + glyph.y * scaleY,
        label: met.name || speciesId,
        type: nodeType,
        connectivity: connectivity[speciesId] || 0
      });
      addedNodes.add(speciesId);
    });
  } else {
    // Generate layout algorithmically
    const sortedMets = Object.entries(connectivity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40);

    let angle = 0;
    let radius = 100;
    const width = 800;
    const height = 600;

    sortedMets.forEach(([metId, count], index) => {
      const met = metabolites[metId] || species[metId];
      if (!met) return;

      const compartment = met.compartment || 'c';
      let nodeType = 'metabolite';
      if (compartment === 'e') nodeType = 'exchange';
      if (met.boundaryCondition) nodeType = 'exchange';
      if (metId.toLowerCase().includes('biomass')) nodeType = 'biomass';

      const x = width / 2 + radius * Math.cos(angle);
      const y = height / 2 + radius * Math.sin(angle);

      nodes.push({
        id: metId,
        x: Math.max(30, Math.min(width - 30, x)),
        y: Math.max(30, Math.min(height - 30, y)),
        label: met.name || metId,
        type: nodeType,
        connectivity: count
      });

      addedNodes.add(metId);
      angle += 0.7;
      if (index % 6 === 5) {
        radius += 25;
        angle += 0.3;
      }
    });
  }

  // Create edges
  const keyMetabolites = new Set(nodes.map(n => n.id));

  Object.entries(reactions).forEach(([rxnId, rxn]) => {
    if (!rxn.metabolites) return;

    const mets = Object.entries(rxn.metabolites);
    const reactantMets = mets.filter(([, coeff]) => coeff < 0).map(([id]) => id);
    const productMets = mets.filter(([, coeff]) => coeff > 0).map(([id]) => id);

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
  return { nodes, edges: edges.slice(0, 80) };
};

/**
 * Parse and validate unit definitions from SBML
 *
 * Standard FBA flux units should be: mmol / gDW / h
 * This function validates that flux bounds use consistent units.
 *
 * Reference: Ebrahim et al. (2013) "Do genome-scale models need exact solvers or
 * verified numerics?" Bioinformatics 29(8):1021-1028
 */
const parseUnitDefinitions = (modelElement) => {
  const unitDefinitions = {};
  const unitWarnings = [];

  // Standard expected units for FBA
  const EXPECTED_FLUX_UNIT = {
    substance: { kind: 'mole', scale: -3 }, // mmol
    mass: { kind: 'gram', exponent: -1 },   // per gDW
    time: { kind: 'second', scale: 0, multiplier: 3600 } // per hour
  };

  const unitList = modelElement.querySelector('listOfUnitDefinitions');

  if (!unitList) {
    unitWarnings.push({
      type: 'missing',
      message: 'Model has no unit definitions. Assuming standard flux units (mmol/gDW/h).',
      severity: 'info'
    });
    return { unitDefinitions, unitWarnings };
  }

  // Parse each unit definition
  unitList.querySelectorAll('unitDefinition').forEach(ud => {
    const id = ud.getAttribute('id');
    const name = ud.getAttribute('name') || id;

    const units = [];
    const unitListInner = ud.querySelector('listOfUnits');

    if (unitListInner) {
      unitListInner.querySelectorAll('unit').forEach(unit => {
        units.push({
          kind: unit.getAttribute('kind'),
          scale: parseInt(unit.getAttribute('scale') || '0', 10),
          exponent: parseFloat(unit.getAttribute('exponent') || '1'),
          multiplier: parseFloat(unit.getAttribute('multiplier') || '1')
        });
      });
    }

    unitDefinitions[id] = { id, name, units };
  });

  // Validate flux units
  const fluxUnitIds = ['mmol_per_gDW_per_hr', 'flux', 'mmol_per_gDW_h', 'fba_flux'];
  let foundFluxUnit = false;

  for (const fluxId of fluxUnitIds) {
    if (unitDefinitions[fluxId]) {
      foundFluxUnit = true;
      const validation = validateFluxUnit(unitDefinitions[fluxId]);
      if (!validation.valid) {
        unitWarnings.push({
          type: 'non_standard',
          unitId: fluxId,
          message: validation.message,
          severity: 'warning',
          details: validation.details
        });
      }
      break;
    }
  }

  // Check for any flux-related unit that might be non-standard
  Object.entries(unitDefinitions).forEach(([id, def]) => {
    const idLower = id.toLowerCase();
    if (idLower.includes('flux') || idLower.includes('mmol') || idLower.includes('mol')) {
      const validation = validateFluxUnit(def);
      if (!validation.valid && validation.severity === 'error') {
        unitWarnings.push({
          type: 'inconsistent',
          unitId: id,
          message: `Unit '${id}' may not be compatible with standard FBA: ${validation.message}`,
          severity: 'warning',
          suggestion: 'Ensure flux bounds are in mmol/gDW/h for accurate FBA results.'
        });
      }
    }
  });

  // Check parameter units for flux bounds
  const paramList = modelElement.querySelector('listOfParameters');
  if (paramList) {
    paramList.querySelectorAll('parameter').forEach(param => {
      const id = param.getAttribute('id');
      const value = parseFloat(param.getAttribute('value') || '0');
      const units = param.getAttribute('units');

      // Flag potentially problematic bound values
      if ((id.includes('bound') || id.includes('BOUND')) && Math.abs(value) > 10000) {
        unitWarnings.push({
          type: 'large_bound',
          parameterId: id,
          value: value,
          message: `Parameter '${id}' has a large value (${value}). Ensure this is in correct units.`,
          severity: 'info'
        });
      }

      // Check if units reference a known unit definition
      if (units && !unitDefinitions[units] && !isBaseUnit(units)) {
        unitWarnings.push({
          type: 'undefined_unit',
          parameterId: id,
          unitRef: units,
          message: `Parameter '${id}' references undefined unit '${units}'.`,
          severity: 'warning'
        });
      }
    });
  }

  return { unitDefinitions, unitWarnings };
};

/**
 * Validate that a unit definition represents standard FBA flux units
 */
const validateFluxUnit = (unitDef) => {
  const { units } = unitDef;

  if (!units || units.length === 0) {
    return {
      valid: false,
      message: 'Unit definition has no component units',
      severity: 'warning'
    };
  }

  // Check for expected components
  let hasSubstance = false;
  let hasMassInverse = false;
  let hasTimeInverse = false;

  const details = [];

  for (const unit of units) {
    const kind = unit.kind?.toLowerCase();
    const exp = unit.exponent || 1;
    const scale = unit.scale || 0;

    if (kind === 'mole' || kind === 'item') {
      hasSubstance = exp > 0;
      if (kind === 'mole' && scale !== -3) {
        details.push(`Substance unit scale is ${scale} (expected -3 for mmol)`);
      }
    }

    if (kind === 'gram' || kind === 'kilogram') {
      hasMassInverse = exp < 0;
      if (!hasMassInverse) {
        details.push('Mass should have negative exponent (per gram dry weight)');
      }
    }

    if (kind === 'second' || kind === 'hour') {
      hasTimeInverse = exp < 0;
      if (!hasTimeInverse) {
        details.push('Time should have negative exponent (per hour)');
      }
    }

    if (kind === 'dimensionless' && exp === 1) {
      // Dimensionless is acceptable for some FBA formulations
      return { valid: true, message: 'Dimensionless flux units' };
    }
  }

  if (!hasSubstance) {
    return {
      valid: false,
      message: 'Missing substance (mole) component in flux unit',
      severity: 'warning',
      details
    };
  }

  if (!hasMassInverse) {
    details.push('Missing mass inverse (per gDW) - may be volumetric flux');
  }

  if (!hasTimeInverse) {
    return {
      valid: false,
      message: 'Missing time inverse component (per hour) in flux unit',
      severity: 'error',
      details
    };
  }

  if (details.length > 0) {
    return {
      valid: false,
      message: 'Non-standard flux unit composition',
      severity: 'warning',
      details
    };
  }

  return { valid: true };
};

/**
 * Check if a unit ID is a base SBML unit
 */
const isBaseUnit = (unitId) => {
  const baseUnits = [
    'ampere', 'avogadro', 'becquerel', 'candela', 'coulomb',
    'dimensionless', 'farad', 'gram', 'gray', 'henry', 'hertz',
    'item', 'joule', 'katal', 'kelvin', 'kilogram', 'litre', 'liter',
    'lumen', 'lux', 'metre', 'meter', 'mole', 'newton', 'ohm',
    'pascal', 'radian', 'second', 'siemens', 'sievert', 'steradian',
    'tesla', 'volt', 'watt', 'weber'
  ];
  return baseUnits.includes(unitId.toLowerCase());
};

export default parseSBML;
