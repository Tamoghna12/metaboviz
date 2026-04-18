/**
 * GPRExpression - Gene-Protein-Reaction Boolean Expression Parser
 *
 * Parses and evaluates GPR rules for metabolic models.
 * Supports:
 * - AND (enzyme complexes): All subunits required
 * - OR (isozymes): One sufficient
 * - Nested expressions with parentheses
 *
 * Examples:
 * - "b1241 and b1849" - Enzyme complex
 * - "(b1241 and b1849) or b2925" - Complex or isozyme
 * - "b0720 or b0721 or b0722" - Multiple isozymes
 *
 * @module GPRExpression
 */

/**
 * Tokenize GPR string into tokens
 * @param {string} gprString - GPR rule string
 * @returns {string[]} Array of tokens (genes, AND, OR, parentheses)
 */
export function tokenizeGPR(gprString) {
  const tokens = [];
  let current = '';

  for (let i = 0; i < gprString.length; i++) {
    const char = gprString[i];

    if (char === '(' || char === ')') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(char);
      current = '';
    } else if (char === ' ') {
      if (current.trim()) {
        const word = current.trim().toLowerCase();
        if (word === 'and' || word === 'or') {
          tokens.push(word.toUpperCase());
        } else {
          tokens.push(current.trim());
        }
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    const word = current.trim().toLowerCase();
    if (word === 'and' || word === 'or') {
      tokens.push(word.toUpperCase());
    } else {
      tokens.push(current.trim());
    }
  }

  return tokens;
}

/**
 * Parse GPR tokens into Abstract Syntax Tree (AST)
 * @param {string[]} tokens - Tokenized GPR string
 * @returns {Object} AST representing the GPR expression
 */
export function parseGPRTokens(tokens) {
  let pos = 0;

  function parseExpression() {
    let left = parseTerm();

    while (pos < tokens.length && tokens[pos] === 'OR') {
      pos++; // consume OR
      const right = parseTerm();
      left = { type: 'OR', left, right };
    }

    return left;
  }

  function parseTerm() {
    let left = parseFactor();

    while (pos < tokens.length && tokens[pos] === 'AND') {
      pos++; // consume AND
      const right = parseFactor();
      left = { type: 'AND', left, right };
    }

    return left;
  }

  function parseFactor() {
    if (tokens[pos] === '(') {
      pos++; // consume (
      const expr = parseExpression();
      if (tokens[pos] === ')') pos++; // consume )
      return expr;
    }

    // Gene identifier
    const gene = tokens[pos++];
    return { type: 'GENE', id: gene };
  }

  return parseExpression();
}

/**
 * Evaluate GPR AST with boolean logic (gene presence/absence)
 * @param {Object} ast - GPR AST
 * @param {Set<string>} activeGenes - Set of active (non-knocked-out) genes
 * @returns {boolean} Whether the reaction is active
 */
export function evaluateGPRAst(ast, activeGenes) {
  if (!ast) return true;

  switch (ast.type) {
    case 'GENE':
      return activeGenes.has(ast.id);
    case 'AND':
      return evaluateGPRAst(ast.left, activeGenes) && evaluateGPRAst(ast.right, activeGenes);
    case 'OR':
      return evaluateGPRAst(ast.left, activeGenes) || evaluateGPRAst(ast.right, activeGenes);
    default:
      return true;
  }
}

/**
 * Evaluate GPR AST with expression values (quantitative)
 * @param {Object} ast - GPR AST
 * @param {Map<string, number>} geneExpression - Gene ID to expression level map
 * @returns {number} Reaction expression level
 */
export function evaluateGPRExpression(ast, geneExpression) {
  if (!ast) return 1.0;

  switch (ast.type) {
    case 'GENE':
      return geneExpression.get(ast.id) ?? 1.0;
    case 'AND':
      // Enzyme complex: limited by lowest subunit (Liebig's law)
      return Math.min(
        evaluateGPRExpression(ast.left, geneExpression),
        evaluateGPRExpression(ast.right, geneExpression)
      );
    case 'OR':
      // Isozymes: highest expressed isozyme dominates
      return Math.max(
        evaluateGPRExpression(ast.left, geneExpression),
        evaluateGPRExpression(ast.right, geneExpression)
      );
    default:
      return 1.0;
  }
}

/**
 * Parse and evaluate GPR string (boolean version)
 * @param {string} gprString - GPR rule string
 * @param {Set<string>} activeGenes - Set of active genes
 * @returns {boolean} Whether the reaction is active
 */
export function evaluateGPR(gprString, activeGenes) {
  if (!gprString || gprString.trim() === '') return true;

  try {
    const tokens = tokenizeGPR(gprString);
    const ast = parseGPRTokens(tokens);
    return evaluateGPRAst(ast, activeGenes);
  } catch (e) {
    console.warn('GPR parsing failed for:', gprString, e);
    return true; // Default to active if parsing fails
  }
}

/**
 * Parse and evaluate GPR string (quantitative version)
 * @param {string} gprString - GPR rule string
 * @param {Map<string, number>} geneExpression - Gene expression map
 * @returns {number} Reaction expression level
 */
export function gprToReactionExpression(gprString, geneExpression) {
  if (!gprString || gprString.trim() === '') return 1.0;

  try {
    const tokens = tokenizeGPR(gprString);
    const ast = parseGPRTokens(tokens);
    return evaluateGPRExpression(ast, geneExpression);
  } catch (e) {
    console.warn('GPR expression evaluation failed:', gprString, e);
    return 1.0;
  }
}

/**
 * Extract all gene IDs from GPR string
 * @param {string} gprString - GPR rule string
 * @returns {string[]} Array of unique gene IDs
 */
export function extractGenesFromGPR(gprString) {
  if (!gprString) return [];

  // Match gene IDs (alphanumeric with underscores, dots, hyphens)
  const matches = gprString.match(/[a-zA-Z][a-zA-Z0-9_.-]*/g) || [];
  // Filter out Boolean operators
  const keywords = new Set(['and', 'or', 'AND', 'OR', 'And', 'Or']);
  return [...new Set(matches.filter(m => !keywords.has(m)))];
}
