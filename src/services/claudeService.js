/**
 * Claude API integration for MetaboViz (Roles E and F)
 *
 * Role E: Natural language → FBA constraint translation
 *   User: "Block PHA synthesis and maximise biomass on glucose"
 *   → structured constraint JSON passed to HiGHS WASM solver
 *
 * Role F: Biological interpretation of FBA results
 *   User: "Why is TCA flux near-zero in this condition?"
 *   → narrative explanation with literature citations
 *
 * Requires: VITE_ANTHROPIC_API_KEY in .env.local
 * Note: In production, Claude calls route through a thin edge function
 * (src/edge/claude.js) to avoid exposing the API key in the browser bundle.
 */

const CLAUDE_MODEL = 'claude-opus-4-7';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

/**
 * Role E — Translate a natural language constraint description into
 * structured FBA bounds for the HiGHS WASM solver.
 *
 * @param {string} naturalLanguageQuery - User's plain-English constraint
 * @param {Object} modelReactions - Reaction namespace from ModelContext
 * @returns {Promise<{constraints: Object, knockouts: string[], objective: string}>}
 */
export async function nlToFBAConstraints(naturalLanguageQuery, modelReactions) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'VITE_ANTHROPIC_API_KEY not set. Add it to .env.local for Claude integration.'
    );
  }

  const reactionList = Object.entries(modelReactions)
    .slice(0, 200)  // top 200 to stay within context
    .map(([id, r]) => `${id}: ${r.name || ''} [${r.subsystem || 'unknown'}]`)
    .join('\n');

  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      tools: [{
        name: 'set_fba_constraints',
        description:
          'Set FBA exchange bounds, gene knockouts, and objective function ' +
          'based on the user\'s natural language description.',
        input_schema: {
          type: 'object',
          properties: {
            exchange_bounds: {
              type: 'object',
              description:
                'Map of exchange reaction ID → {lower_bound, upper_bound}. ' +
                'Only include reactions explicitly mentioned or implied.',
              additionalProperties: {
                type: 'object',
                properties: {
                  lower_bound: { type: 'number' },
                  upper_bound: { type: 'number' },
                },
                required: ['lower_bound', 'upper_bound'],
              },
            },
            knockouts: {
              type: 'array',
              items: { type: 'string' },
              description: 'Gene IDs to knock out (set flux to 0)',
            },
            objective_reaction: {
              type: 'string',
              description: 'Reaction ID to maximise (or null for default biomass)',
            },
            interpretation: {
              type: 'string',
              description: 'Brief explanation of how the query was interpreted',
            },
          },
          required: ['exchange_bounds', 'knockouts'],
        },
      }],
      tool_choice: { type: 'any' },
      messages: [{
        role: 'user',
        content:
          `Available reactions:\n${reactionList}\n\n` +
          `User constraint request: "${naturalLanguageQuery}"\n\n` +
          'Translate this into FBA bounds and knockouts using the available reactions.',
      }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const toolResult = data.content?.find(b => b.type === 'tool_use')?.input;

  if (!toolResult) {
    throw new Error('Claude did not return a tool_use block');
  }

  return {
    constraints: toolResult.exchange_bounds || {},
    knockouts: toolResult.knockouts || [],
    objective: toolResult.objective_reaction || null,
    interpretation: toolResult.interpretation || '',
    tokensUsed: {
      input: data.usage?.input_tokens,
      output: data.usage?.output_tokens,
    },
  };
}

/**
 * Role F — Generate a biological interpretation of an FBA result.
 *
 * @param {Object} fluxDistribution - Map of reaction ID → flux value
 * @param {Object} activeConstraints - Current exchange bounds
 * @param {string} userQuestion - What the user wants to understand
 * @param {Object} subsystemMap - Reaction ID → subsystem name
 * @returns {Promise<{explanation: string, citations: string[]}>}
 */
export async function interpretFBAResult(
  fluxDistribution,
  activeConstraints,
  userQuestion,
  subsystemMap = {}
) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('VITE_ANTHROPIC_API_KEY not set.');
  }

  // Summarise top active fluxes to stay within token budget
  const topFluxes = Object.entries(fluxDistribution)
    .filter(([, v]) => Math.abs(v) > 1e-6)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 50)
    .map(([id, v]) => `${id} (${subsystemMap[id] || '?'}): ${v.toFixed(4)}`)
    .join('\n');

  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content:
          `Active exchange constraints:\n${JSON.stringify(activeConstraints, null, 2)}\n\n` +
          `Top active fluxes (by magnitude):\n${topFluxes}\n\n` +
          `Question: ${userQuestion}\n\n` +
          'Provide a concise biological explanation (3-5 sentences) with specific ' +
          'references to the flux values above. Cite relevant literature where applicable.',
      }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const explanation = data.content?.[0]?.text || 'No interpretation generated.';

  return {
    explanation,
    tokensUsed: {
      input: data.usage?.input_tokens,
      output: data.usage?.output_tokens,
    },
  };
}
