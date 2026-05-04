/**
 * YAML Format Utilities for IRG
 *
 * Provides utilities for:
 * 1. Loading YAML configuration files (irg-prompts.yaml)
 * 2. Converting between JSON and YAML formats (for future YAML migration)
 *
 * Data format: Currently JSON for traces and LLM responses
 * Config format: YAML for human-readable configuration
 */

const YAML = require('js-yaml');

/**
 * Sanitize YAML by removing markdown formatting
 * Handles markdown in keys, list items, and nested structures
 * @param {string} yamlText - Raw YAML text
 * @returns {string} Sanitized YAML
 */
function sanitizeYaml(yamlText) {
  if (!yamlText || typeof yamlText !== 'string') {
    return '';
  }

  let sanitized = yamlText;

  // Remove markdown formatting from YAML keys and values
  // Handles: **text**, *text*, __text__, _text_
  sanitized = sanitized
    .replace(/\*\*([^*]+)\*\*/g, '$1')    // **text** -> text
    .replace(/\*([^*]+)\*/g, '$1')        // *text* -> text
    .replace(/__([^_]+)__/g, '$1')        // __text__ -> text
    .replace(/_([^_]+)_/g, '$1');         // _text_ -> text

  return sanitized;
}

/**
 * Parse YAML string to JavaScript object
 * Used for loading YAML configuration files (irg-prompts.yaml)
 * Sanitizes markdown formatting from keys before parsing
 * @param {string} yamlText - YAML text to parse
 * @returns {Object} Parsed object
 */
function parseYamlOnly(yamlText) {
  if (!yamlText || typeof yamlText !== 'string') {
    return {};
  }

  try {
    // Sanitize markdown formatting from keys
    const sanitized = sanitizeYaml(yamlText);
    const parsed = YAML.load(sanitized);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (e) {
    console.error('YAML parse error:', e.message);
    // Return empty object instead of throwing to allow graceful degradation
    return {};
  }
}

/**
 * Convert JavaScript object to YAML string
 * @param {Object} obj - Object to convert
 * @returns {string} YAML string
 */
function toYaml(obj) {
  try {
    return YAML.dump(obj, { lineWidth: -1, noRefs: true });
  } catch (e) {
    throw new Error(`Failed to convert to YAML: ${e.message}`);
  }
}

/**
 * Convert YAML to JSON (for export/integration)
 * @param {string} yamlText - YAML text
 * @returns {string} JSON string
 */
function yamlToJson(yamlText) {
  const obj = parseYamlOnly(yamlText);
  return JSON.stringify(obj, null, 2);
}

/**
 * Convert JSON to YAML (for internal use)
 * @param {string} jsonText - JSON text
 * @returns {string} YAML string
 */
function jsonToYaml(jsonText) {
  try {
    const obj = JSON.parse(jsonText);
    return toYaml(obj);
  } catch (e) {
    throw new Error(`Failed to convert JSON to YAML: ${e.message}`);
  }
}

module.exports = {
  sanitizeYaml,
  parseYamlOnly,
  toYaml,
  yamlToJson,
  jsonToYaml
};

