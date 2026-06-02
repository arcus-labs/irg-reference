/**
 * X-Ray IRG Node Utilities — Shared helpers for all nodes
 *
 * Provides common functions used across all node implementations:
 * - Prompt rendering
 * - JSON parsing
 * - Node recording
 */

'use strict';

/**
 * Render a prompt template, replacing {{key}} with values from vars.
 */
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    if (val === undefined || val === null) return '';
    return typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
  });
}

/**
 * Build a full prompt string from a node's prompts entry and state vars.
 */
function buildPrompt(nodePrompts, vars) {
  const system = render(nodePrompts.system || '', vars).trim();
  const user   = render(nodePrompts.user   || '', vars).trim();
  return system ? `${system}\n\n${user}` : user;
}

/**
 * Safely parse a JSON LLM response; returns {} on failure.
 * Handles markdown code fences, leading/trailing text, etc.
 */
function safeParseJson(text) {
  if (!text || typeof text !== 'string') return {};

  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // If still not starting with { or [, try to find the first JSON object
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const braceIdx = cleaned.indexOf('{');
    if (braceIdx !== -1) {
      cleaned = cleaned.slice(braceIdx);
      // Find the matching closing brace
      let depth = 0;
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === '{') depth++;
        else if (cleaned[i] === '}') depth--;
        if (depth === 0) { cleaned = cleaned.slice(0, i + 1); break; }
      }
    }
  }

  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (e) {
    // Try fixing unescaped newlines inside strings
    try {
      const fixed = cleaned.replace(/"([^"\\]|\\.)*"/g, (match) => {
        return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
      });
      const parsed = JSON.parse(fixed);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (e2) {
      console.error('JSON parse error:', e2.message, '\nFirst 200 chars:', text.slice(0, 200));
      return {};
    }
  }
}

/**
 * Append a node record to state.nodes and push a history entry.
 */
function recordNode(state, nodeRecord, phase) {
  state.nodes = [...(state.nodes || []), nodeRecord];
  state.history = [...(state.history || []), {
    phase,
    iteration: state.iteration || 0,
    timestamp: new Date().toISOString(),
  }];
  return state;
}

/**
 * Create a common prepare function for LLM nodes.
 */
function createPrepare(nodeId, promptKey, stateKeys = []) {
  return function prepare(state, prompts) {
    const vars = {};
    stateKeys.forEach(key => { vars[key] = state[key]; });
    const prompt = buildPrompt(prompts[promptKey], vars);
    return {
      ...state,
      [`${nodeId}Prompt`]: prompt,
      currentPhase: nodeId,
    };
  };
}

/**
 * Create a common LLM call function.
 */
function createLlmCall(nodeId) {
  return async function llmCall(state, llmClient) {
    return llmClient.call(state[`${nodeId}Prompt`], { node: nodeId });
  };
}

module.exports = {
  render,
  buildPrompt,
  safeParseJson,
  recordNode,
  createPrepare,
  createLlmCall,
};

