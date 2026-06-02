/**
 * Node Utilities — Shared helpers for all nodes
 *
 * Provides common functions used across all node implementations:
 * - Prompt rendering
 * - JSON parsing
 * - Node recording
 */

'use strict';

const { parseYamlOnly } = require('../parsing/yaml-format-utils');

/**
 * Render a prompt template, replacing {{key}} with values from vars.
 * @param {string} template - Template string with {{key}} placeholders
 * @param {Object} vars - Variables to substitute
 * @returns {string} Rendered prompt
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
 * @param {Object} nodePrompts - Prompts object with system and user keys
 * @param {Object} vars - Variables to substitute
 * @returns {string} Full prompt string
 */
function buildPrompt(nodePrompts, vars) {
  if (!nodePrompts) {
    console.warn('[buildPrompt] nodePrompts is undefined or null');
    return '';
  }
  const system = render(nodePrompts.system || '', vars).trim();
  const user   = render(nodePrompts.user   || '', vars).trim();
  return system ? `${system}\n\n${user}` : user;
}

/**
 * Safely parse a JSON LLM response; returns {} on failure.
 * Handles unescaped newlines in string values by fixing them.
 * @param {string} text - JSON text to parse
 * @returns {Object} Parsed JSON or empty object
 */
function safeParseJson(text) {
  // Safety check: ensure text is a string
  if (typeof text !== 'string') {
    console.warn('[safeParseJson] Input is not a string:', typeof text);
    return {};
  }

  try {
    // First attempt: try parsing as-is
    try {
      const parsed = JSON.parse(text);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (e) {
      // If parsing fails, try multiple recovery strategies
      let fixed = text;

      // Strategy 1: Fix unescaped newlines in string values
      fixed = text.replace(/"([^"\\]|\\.)*"/g, (match) => {
        // Replace actual newlines with escaped newlines
        return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
      });

      try {
        const parsed = JSON.parse(fixed);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
      } catch (e2) {
        // Strategy 2: Fix incomplete JSON by adding missing closing braces
        let openBraces = (fixed.match(/{/g) || []).length;
        let closeBraces = (fixed.match(/}/g) || []).length;

        if (openBraces > closeBraces) {
          fixed += '}'.repeat(openBraces - closeBraces);
          try {
            const parsed = JSON.parse(fixed);
            return typeof parsed === 'object' && parsed !== null ? parsed : {};
          } catch (e3) {
            // Strategy 3: Try to extract valid JSON object from malformed text
            // Look for the first { and try to find matching }
            const firstBrace = fixed.indexOf('{');
            if (firstBrace !== -1) {
              let braceCount = 0;
              let lastValidPos = -1;

              for (let i = firstBrace; i < fixed.length; i++) {
                if (fixed[i] === '{') braceCount++;
                if (fixed[i] === '}') {
                  braceCount--;
                  if (braceCount === 0) {
                    lastValidPos = i;
                    break;
                  }
                }
              }

              if (lastValidPos !== -1) {
                const extracted = fixed.substring(firstBrace, lastValidPos + 1);
                try {
                  const parsed = JSON.parse(extracted);
                  return typeof parsed === 'object' && parsed !== null ? parsed : {};
                } catch (e4) {
                  // Continue to error handling
                }
              }
            }
            throw e3;
          }
        }
        throw e2;
      }
    }
  } catch (e) {
    console.error('JSON parse error:', e.message);
    console.error('Failed to parse text (first 500 chars):', text ? text.substring(0, 500) : 'null');
    console.error('Text length:', text ? text.length : 0);
    return {};
  }
}

/**
 * Safely parse a YAML LLM response; returns {} on failure.
 * @param {string} text - YAML text to parse
 * @returns {Object} Parsed YAML or empty object
 */
function safeParseYaml(text) {
  if (typeof text !== 'string') {
    console.warn('[safeParseYaml] Input is not a string:', typeof text);
    return {};
  }

  try {
    const parsed = parseYamlOnly(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (e) {
    console.error('YAML parse error:', e.message);
    return {};
  }
}

/**
 * Extract token usage from LLM response
 * @param {Object|string} response - LLM response (can be object with usage or just string)
 * @returns {Object} Token usage object with input_tokens, output_tokens, total_tokens
 */
function extractTokens(response) {
  if (!response) {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  }

  // If response is an object with usage data
  if (typeof response === 'object' && response.usage) {
    const usage = response.usage;
    // Support both naming conventions: input_tokens/output_tokens and prompt_tokens/completion_tokens
    const input = usage.input_tokens || usage.prompt_tokens || 0;
    const output = usage.output_tokens || usage.completion_tokens || 0;
    return {
      input_tokens: input,
      output_tokens: output,
      // Providers that report prompt/completion but omit a total would otherwise
      // record total_tokens: 0 — fall back to input+output to stay consistent.
      total_tokens: usage.total_tokens || (input + output),
    };
  }

  // If response is just a string, no token data available
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
}

/**
 * Append a node record to state.nodes and push a history entry.
 * @param {Object} state - Current state
 * @param {Object} nodeRecord - Node record to append
 * @param {string} phase - Phase name
 * @returns {Object} Updated state
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

function findEarliestRestart(text, startIndex, patterns) {
  let earliest = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(text.slice(startIndex));
    if (!match) continue;
    const absoluteIndex = startIndex + match.index;
    if (earliest === -1 || absoluteIndex < earliest) {
      earliest = absoluteIndex;
    }
  }
  return earliest;
}

/**
 * Trim clearly duplicated markdown structures when a completed answer is
 * followed by a second top-level outline. This activates only after a default
 * Overview/Key Points scaffold that already reached Conclusion and then
 * restarts with another major section sequence.
 * @param {string} text
 * @returns {string}
 */
function normalizeDraftResponse(text) {
  if (!text || typeof text !== 'string') return text;

  const trimmed = text.trim();
  const hasDefaultScaffold = trimmed.startsWith('## Overview')
    && trimmed.includes('\n\n## Key Points');
  const conclusionIndex = trimmed.indexOf('\n\n## Conclusion');

  if (!hasDefaultScaffold || conclusionIndex === -1) {
    return trimmed;
  }

  const afterConclusionIndex = conclusionIndex + '\n\n## Conclusion'.length;
  const sectionRestart = findEarliestRestart(trimmed, afterConclusionIndex, [
    /\n\n## Section 1\b/i,
    /\n\n## Overview\b/i,
  ]);

  if (sectionRestart === -1) {
    return trimmed;
  }

  const hasFollowOnStructure = /\n\n## (Section 2\b|Key Points\b|Analysis\b)/i.test(trimmed.slice(sectionRestart));
  if (!hasFollowOnStructure) {
    return trimmed;
  }

  return trimmed.slice(0, sectionRestart).trimEnd();
}

/**
 * Convert plain text response to markdown format with sections and structure
 * Only converts if text is not already in markdown format
 * @param {string} text - Plain text response
 * @returns {string} Markdown formatted response
 */
function convertToMarkdown(text) {
  if (!text || typeof text !== 'string') return text;

  // If already contains markdown headers or formatting, return as-is
  if (text.includes('##') || text.includes('# ') || text.includes('**') || text.includes('- ') || text.includes('* ')) {
    return text;
  }

  // Split text into sentences and paragraphs
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

  if (paragraphs.length === 0) return text;

  // Build markdown structure
  let markdown = '';

  // First paragraph becomes overview
  if (paragraphs.length > 0) {
    markdown += '## Overview\n\n' + paragraphs[0].trim() + '\n\n';
  }

  // Look for key points or main ideas in remaining paragraphs
  if (paragraphs.length > 1) {
    markdown += '## Key Points\n\n';

    // Try to extract bullet points from text
    const remainingText = paragraphs.slice(1).join('\n\n');

    // Split into sentences and convert to bullet points
    const sentences = remainingText.match(/[^.!?]+[.!?]+/g) || [remainingText];
    const bulletPoints = sentences
      .slice(0, 5) // Limit to 5 key points
      .map(s => '- ' + s.trim())
      .join('\n');

    markdown += bulletPoints + '\n\n';
  }

  // Add remaining content as analysis section
  if (paragraphs.length > 2) {
    markdown += '## Analysis\n\n';
    markdown += paragraphs.slice(2).join('\n\n') + '\n\n';
  }

  // Add conclusion
  markdown += '## Conclusion\n\n';
  markdown += 'The analysis above provides a comprehensive understanding of the topic based on available information and evidence.';

  return markdown;
}

module.exports = {
  render,
  buildPrompt,
  safeParseJson,
  safeParseYaml,
  extractTokens,
  recordNode,
  normalizeDraftResponse,
  convertToMarkdown,
};

