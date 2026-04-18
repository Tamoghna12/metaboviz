/**
 * EscherParser - Escher Map Import/Export Bridge
 *
 * Converts between Escher JSON format and MetabolicSuite internal format.
 * Enables import of community-curated pathway maps from:
 * - BiGG Models Escher maps (E. coli, Human, Yeast, etc.)
 * - User-created Escher maps
 *
 * Escher Format Reference:
 * - King et al. (2015) "Escher: A Web Application for Building, Sharing,
 *   and Embedding Data-Rich Visualizations of Biological Pathways"
 *   PLoS Computational Biology
 *
 * @module EscherParser
 */

/**
 * Escher map schema (simplified)
 *
 * {
 *   map_name: string,
 *   map_id: string,
 *   map_description: string,
 *   schema: string,  // "1-0-0"
 *   canvas: { x, y, width, height },
 *   reactions: { [id]: ReactionSegment },
 *   nodes: { [id]: Node },
 *   text_labels: { [id]: TextLabel }
 * }
 */

// Escher color schemes
const ESCHER_COLORS = {
  reaction: '#334E68',
  metabolite: '#486581',
  cofactor: '#9FB3C8',
  selected: '#1992D4',
  highlight: '#F0B429',
};

/**
 * Parse an Escher JSON map into MetabolicSuite format
 *
 * @param {Object} escherMap - Parsed Escher JSON
 * @returns {Object} MetabolicSuite-compatible map data
 */
export function parseEscherMap(escherMap) {
  if (!escherMap) {
    throw new Error('Invalid Escher map: null or undefined');
  }

  // Validate schema
  const schema = escherMap.schema || escherMap[0]?.schema;
  if (schema && !schema.startsWith('1-')) {
    console.warn(`Escher schema ${schema} may not be fully compatible`);
  }

  // Handle both array format [header, body] and object format
  const mapData = Array.isArray(escherMap) ? escherMap[1] : escherMap;
  const header = Array.isArray(escherMap) ? escherMap[0] : escherMap;

  const nodes = [];
  const edges = [];
  const textLabels = [];

  // Extract canvas/viewport info
  const canvas = mapData.canvas || { x: 0, y: 0, width: 1000, height: 800 };

  // Process nodes (metabolites)
  const nodeIdMap = new Map(); // Escher node_id -> our node index

  if (mapData.nodes) {
    Object.entries(mapData.nodes).forEach(([nodeId, node]) => {
      const metaboliteNode = parseEscherNode(nodeId, node, canvas);
      if (metaboliteNode) {
        nodeIdMap.set(nodeId, nodes.length);
        nodes.push(metaboliteNode);
      }
    });
  }

  // Process reactions (edges/segments)
  if (mapData.reactions) {
    Object.entries(mapData.reactions).forEach(([reactionId, reaction]) => {
      const reactionEdges = parseEscherReaction(reactionId, reaction, nodeIdMap, nodes, canvas);
      edges.push(...reactionEdges);
    });
  }

  // Process text labels
  if (mapData.text_labels) {
    Object.entries(mapData.text_labels).forEach(([labelId, label]) => {
      textLabels.push({
        id: labelId,
        text: label.text || '',
        x: label.x,          // raw Escher coords
        y: label.y,
        fontSize: label.font_size || 12,
      });
    });
  }

  return {
    id: header.map_id || 'escher_map',
    name: header.map_name || 'Imported Escher Map',
    description: header.map_description || '',
    source: 'escher',
    schema: schema,
    canvas: {
      width: canvas.width,
      height: canvas.height,
      viewBox: `${canvas.x} ${canvas.y} ${canvas.width} ${canvas.height}`,
    },
    nodes,
    edges,
    textLabels,
    metadata: {
      importedAt: new Date().toISOString(),
      originalNodeCount: Object.keys(mapData.nodes || {}).length,
      originalReactionCount: Object.keys(mapData.reactions || {}).length,
    },
  };
}

/**
 * Parse an Escher node into MetabolicSuite node format.
 * Midmarker/multimarker nodes are retained (type:'marker') so that reaction
 * segments can look up their coordinates — they are not rendered as circles.
 */
function parseEscherNode(nodeId, node, canvas) {
  const isMarker     = node.node_type === 'midmarker' || node.node_type === 'multimarker';
  const isMetabolite = node.node_type === 'metabolite';
  const isCofactor   = isMetabolite && node.node_is_primary === false;

  return {
    id:      nodeId,
    biggId:  node.bigg_id || node.name,
    name:    node.name || node.bigg_id || nodeId,
    label:   isMetabolite ? (node.name || node.bigg_id || null) : null,
    type:    isMarker ? 'marker' : (isCofactor ? 'cofactor' : 'metabolite'),
    // Store raw Escher coordinates — EscherMapView's computeBBox + fitToScreen handles scaling
    x:       node.x,
    y:       node.y,
    labelX:  node.label_x,
    labelY:  node.label_y,
    isPrimary: !isCofactor,
    radius:  isMarker ? 0 : (isCofactor ? 6 : 12),
  };
}

/**
 * Parse an Escher reaction into MetabolicSuite edges
 */
function parseEscherReaction(reactionId, reaction, nodeIdMap, nodes, canvas) {
  const edges = [];

  if (!reaction.segments) {
    return edges;
  }

  // Reaction metadata
  const reactionMeta = {
    id: reactionId,
    biggId: reaction.bigg_id || reactionId,
    name: reaction.name || reaction.bigg_id || reactionId,
    reversibility: reaction.reversibility ?? true,
    geneReactionRule: reaction.gene_reaction_rule || '',
    genes: reaction.genes || [],
  };

  // Process segments (the actual line pieces)
  Object.entries(reaction.segments).forEach(([segmentId, segment]) => {
    const fromNodeId = segment.from_node_id;
    const toNodeId = segment.to_node_id;

    // Find or create the from/to nodes
    let fromNode = findOrCreateNode(fromNodeId, nodes, nodeIdMap, canvas);
    let toNode = findOrCreateNode(toNodeId, nodes, nodeIdMap, canvas);

    if (!fromNode || !toNode) {
      return; // Skip incomplete segments
    }

    // Create edge with raw Escher coordinates
    const edge = {
      id: `${reactionId}_${segmentId}`,
      reactionId: reactionMeta.biggId,
      reactionName: reactionMeta.name,
      from: fromNode.id,
      to: toNode.id,
      fromX: fromNode.x,   // raw Escher coords
      fromY: fromNode.y,
      toX: toNode.x,
      toY: toNode.y,
      reversible: reactionMeta.reversibility,
      gpr: reactionMeta.geneReactionRule,
      color: ESCHER_COLORS.reaction,
      strokeWidth: 2,
    };

    // Bezier control points (raw Escher coords)
    if (segment.b1 && segment.b2) {
      edge.bezier = {
        b1x: segment.b1.x,
        b1y: segment.b1.y,
        b2x: segment.b2.x,
        b2y: segment.b2.y,
      };
    }

    edges.push(edge);
  });

  // Reaction label position (raw Escher coords; only mark first segment per reaction)
  if (reaction.label_x !== undefined && reaction.label_y !== undefined && edges.length > 0) {
    edges[0].label   = reactionMeta.biggId;
    edges[0].labelX  = reaction.label_x;
    edges[0].labelY  = reaction.label_y;
  }

  return edges;
}

/**
 * Find or create a node for segment endpoints
 */
function findOrCreateNode(nodeId, nodes, nodeIdMap, canvas) {
  if (nodeIdMap.has(nodeId)) {
    return nodes[nodeIdMap.get(nodeId)];
  }

  // Node might be a marker node that we skipped
  // Return null to skip this segment
  return null;
}

/**
 * Normalize coordinate from Escher space to 0-1 space
 */
function normalizeCoord(value, offset, range) {
  if (value === undefined || value === null) return 0.5;
  return (value - offset) / range;
}

/**
 * Convert MetabolicSuite map back to Escher format
 *
 * @param {Object} mapData - MetabolicSuite map data
 * @returns {Array} Escher format [header, body]
 */
export function toEscherFormat(mapData) {
  const header = {
    map_name: mapData.name || 'Exported Map',
    map_id: mapData.id || 'exported_map',
    map_description: mapData.description || '',
    homepage: 'https://metabolicsuite.org',
    schema: '1-0-0',
  };

  const canvas = {
    x: 0,
    y: 0,
    width: mapData.canvas?.width || 1000,
    height: mapData.canvas?.height || 800,
  };

  // Convert nodes
  const escherNodes = {};
  mapData.nodes?.forEach(node => {
    escherNodes[node.id] = {
      node_type: node.type === 'marker' ? 'midmarker' : 'metabolite',
      x: denormalizeCoord(node.x, canvas.x, canvas.width),
      y: denormalizeCoord(node.y, canvas.y, canvas.height),
      bigg_id: node.biggId || node.id,
      name: node.name || node.id,
      label_x: node.labelX !== undefined
        ? denormalizeCoord(node.labelX, canvas.x, canvas.width)
        : undefined,
      label_y: node.labelY !== undefined
        ? denormalizeCoord(node.labelY, canvas.y, canvas.height)
        : undefined,
      node_is_primary: node.isPrimary !== false,
    };
  });

  // Convert reactions (group edges by reactionId)
  const escherReactions = {};
  const reactionEdges = new Map();

  mapData.edges?.forEach(edge => {
    const rxnId = edge.reactionId || edge.id;
    if (!reactionEdges.has(rxnId)) {
      reactionEdges.set(rxnId, {
        bigg_id: rxnId,
        name: edge.reactionName || rxnId,
        reversibility: edge.reversible ?? true,
        gene_reaction_rule: edge.gpr || '',
        segments: {},
        label_x: edge.labelX !== undefined
          ? denormalizeCoord(edge.labelX, canvas.x, canvas.width)
          : undefined,
        label_y: edge.labelY !== undefined
          ? denormalizeCoord(edge.labelY, canvas.y, canvas.height)
          : undefined,
      });
    }

    const reaction = reactionEdges.get(rxnId);
    const segmentId = Object.keys(reaction.segments).length.toString();

    reaction.segments[segmentId] = {
      from_node_id: edge.from,
      to_node_id: edge.to,
      b1: edge.bezier ? {
        x: denormalizeCoord(edge.bezier.b1x, canvas.x, canvas.width),
        y: denormalizeCoord(edge.bezier.b1y, canvas.y, canvas.height),
      } : undefined,
      b2: edge.bezier ? {
        x: denormalizeCoord(edge.bezier.b2x, canvas.x, canvas.width),
        y: denormalizeCoord(edge.bezier.b2y, canvas.y, canvas.height),
      } : undefined,
    };
  });

  reactionEdges.forEach((reaction, rxnId) => {
    escherReactions[rxnId] = reaction;
  });

  // Convert text labels
  const textLabels = {};
  mapData.textLabels?.forEach((label, idx) => {
    textLabels[label.id || `label_${idx}`] = {
      text: label.text,
      x: denormalizeCoord(label.x, canvas.x, canvas.width),
      y: denormalizeCoord(label.y, canvas.y, canvas.height),
      font_size: label.fontSize || 12,
    };
  });

  return [header, {
    canvas,
    nodes: escherNodes,
    reactions: escherReactions,
    text_labels: textLabels,
  }];
}

/**
 * Denormalize coordinate from 0-1 space to Escher space
 */
function denormalizeCoord(value, offset, range) {
  if (value === undefined || value === null) return offset + range / 2;
  return offset + value * range;
}

/**
 * Validate an Escher map structure
 *
 * @param {Object} escherMap - Parsed Escher JSON
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
export function validateEscherMap(escherMap) {
  const errors = [];

  if (!escherMap) {
    errors.push('Map is null or undefined');
    return { valid: false, errors };
  }

  // Handle array format
  const mapData = Array.isArray(escherMap) ? escherMap[1] : escherMap;
  const header = Array.isArray(escherMap) ? escherMap[0] : escherMap;

  if (!mapData) {
    errors.push('Map body is missing');
    return { valid: false, errors };
  }

  // Check required fields
  if (!mapData.nodes || Object.keys(mapData.nodes).length === 0) {
    errors.push('Map has no nodes');
  }

  if (!mapData.reactions || Object.keys(mapData.reactions).length === 0) {
    errors.push('Map has no reactions');
  }

  // Check node structure
  let validNodeCount = 0;
  Object.entries(mapData.nodes || {}).forEach(([id, node]) => {
    if (node.x === undefined || node.y === undefined) {
      errors.push(`Node ${id} missing coordinates`);
    } else {
      validNodeCount++;
    }
  });

  // Check reaction structure
  let validReactionCount = 0;
  Object.entries(mapData.reactions || {}).forEach(([id, reaction]) => {
    if (!reaction.segments || Object.keys(reaction.segments).length === 0) {
      errors.push(`Reaction ${id} has no segments`);
    } else {
      validReactionCount++;
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      nodes: validNodeCount,
      reactions: validReactionCount,
      textLabels: Object.keys(mapData.text_labels || {}).length,
    },
  };
}

/**
 * Fetch an Escher map from BiGG Models
 *
 * @param {string} mapId - BiGG map ID (e.g., 'e_coli_core.Core metabolism')
 * @returns {Promise<Object>} Parsed Escher map
 */
export async function fetchBiGGMap(mapId) {
  const baseUrl = 'https://escher.github.io/1-0-0/6/maps/Escher%20Maps/';
  const encodedId = encodeURIComponent(mapId);

  try {
    const response = await fetch(`${baseUrl}${encodedId}.json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch map: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    throw new Error(`Failed to load BiGG map ${mapId}: ${error.message}`);
  }
}

/**
 * List available BiGG Escher maps
 */
export const BIGG_MAPS = [
  { id: 'e_coli_core.Core metabolism', organism: 'E. coli', name: 'Core Metabolism' },
  { id: 'iJO1366.Central metabolism', organism: 'E. coli', name: 'Central Metabolism' },
  { id: 'iJO1366.Glycolysis TCA PPP', organism: 'E. coli', name: 'Glycolysis/TCA/PPP' },
  { id: 'iJO1366.Fatty acid biosynthesis', organism: 'E. coli', name: 'Fatty Acid Biosynthesis' },
  { id: 'iJO1366.Nucleotide metabolism', organism: 'E. coli', name: 'Nucleotide Metabolism' },
  { id: 'iMM904.Central carbon metabolism', organism: 'S. cerevisiae', name: 'Central Carbon' },
  { id: 'RECON1.Glycolysis and gluconeogenesis', organism: 'H. sapiens', name: 'Glycolysis' },
];

export default {
  parseEscherMap,
  toEscherFormat,
  validateEscherMap,
  fetchBiGGMap,
  BIGG_MAPS,
};
