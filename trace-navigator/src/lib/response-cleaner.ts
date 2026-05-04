/**
 * Unified Response Cleaner Utility
 *
 * Handles all wrapping issues across the IRG workflow:
 * - YAML frontmatter format (--- YAML --- Markdown)
 * - XML wrapper tags (<json_response>, <revised_response>)
 * - Double-encoded JSON strings
 * - Literal newlines in JSON strings
 * - Analysis sections bleeding into response fields
 *
 * This is a TEMPORARY utility until upstream validation is implemented
 * at the IRG node layer. Once nodes validate responses properly, this
 * can be removed.
 */

import YAML from 'js-yaml';

interface CleanedResponse {
  revised_response?: string;
  changes_made?: any[];
  issues_not_addressed?: any[];
  new_confidence?: number;
  remaining_concerns?: any[];
  [key: string]: any;
}

/**
 * Parse YAML frontmatter format: --- YAML --- Markdown
 * Handles both new YAML format and legacy JSON format
 */
export function parseYamlFrontmatter(text: string): {
  metadata: Record<string, any>;
  content: string;
} {
  if (!text || typeof text !== 'string') {
    return { metadata: {}, content: '' };
  }

  // Strip dangling fragments (content after last ---)
  const lastSeparator = text.lastIndexOf('---');
  if (lastSeparator > 0) {
    text = text.substring(0, lastSeparator + 3);
  }

  // Try YAML frontmatter format first
  if (text.startsWith('---')) {
    const parts = text.split('---');
    if (parts.length >= 3) {
      try {
        const frontmatterYaml = parts[1].trim();
        const content = parts.slice(2).join('---').trim();

        const metadata = YAML.load(frontmatterYaml) as Record<string, any>;
        return { metadata, content };
      } catch (e) {
        console.warn('Failed to parse YAML frontmatter:', e);
      }
    }
  }

  // Fallback: try JSON format (legacy)
  try {
    const jsonMatch = text.match(/<json_response>\s*([\s\S]*?)\s*<\/json_response>/i);
    if (jsonMatch) {
      const jsonStr = jsonMatch[1].trim();
      const parsed = JSON.parse(jsonStr);

      // Extract content from draft_response or revised_response
      const content = parsed.draft_response || parsed.revised_response || '';

      // Build metadata from other fields
      const metadata = { ...parsed };
      delete metadata.draft_response;
      delete metadata.revised_response;

      return { metadata, content };
    }
  } catch (e) {
    console.warn('Failed to parse JSON format:', e);
  }

  // Last resort: return raw text as content
  return { metadata: {}, content: text };
}

/**
 * Strip XML wrapper tags from a string
 */
function stripXmlWrappers(text: string): string {
  if (typeof text !== 'string') return text;
  return text
    .replace(/<json_response>/gi, '')
    .replace(/<\/json_response>/gi, '')
    .replace(/<revised_response>/gi, '')
    .replace(/<\/revised_response>/gi, '')
    .trim();
}

/**
 * Extract JSON from text, handling XML wrappers
 */
function extractJson(text: string): any {
  if (typeof text !== 'string') return null;

  // Try XML-wrapped JSON first
  const xmlMatch = text.match(/<json_response>\s*([\s\S]*?)\s*<\/json_response>/i);
  const jsonStr = xmlMatch ? xmlMatch[1].trim() : text.trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Extract revised_response field using regex (fallback for malformed JSON)
 */
function extractRevisedResponseViaRegex(text: string): CleanedResponse | null {
  if (typeof text !== 'string') return null;

  const result: CleanedResponse = {};

  // Extract revised_response (handles literal newlines)
  const revisionMatch = text.match(/"revised_response":\s*"([\s\S]*?)(?<!\\)",\s*"changes_made"/);
  if (revisionMatch) {
    result.revised_response = revisionMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();
  }

  // Extract changes_made array
  const changesMatch = text.match(/"changes_made":\s*(\[[\s\S]*?\]),\s*"issues_not_addressed"/);
  if (changesMatch) {
    try {
      result.changes_made = JSON.parse(changesMatch[1]);
    } catch {
      // Ignore parse errors
    }
  }

  // Extract new_confidence number
  const confidenceMatch = text.match(/"new_confidence":\s*([\d.]+)/);
  if (confidenceMatch) {
    result.new_confidence = parseFloat(confidenceMatch[1]);
  }

  // Extract issues_not_addressed array
  const issuesMatch = text.match(/"issues_not_addressed":\s*(\[[\s\S]*?\]),\s*"remaining_concerns"/);
  if (issuesMatch) {
    try {
      result.issues_not_addressed = JSON.parse(issuesMatch[1]);
    } catch {
      // Ignore parse errors
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Clean a single revised_response field
 */
export function cleanRevisedResponseField(value: string): CleanedResponse {
  if (typeof value !== 'string') return {};

  // Step 1: Strip XML wrappers
  let cleaned = stripXmlWrappers(value);

  // Step 2: Try to parse as JSON
  let parsed = extractJson(cleaned);

  if (parsed && typeof parsed === 'object') {
    // Successfully parsed - extract fields
    return {
      revised_response: parsed.revised_response?.trim() || '',
      changes_made: parsed.changes_made,
      issues_not_addressed: parsed.issues_not_addressed,
      new_confidence: parsed.new_confidence,
      remaining_concerns: parsed.remaining_concerns,
    };
  }

  // Step 3: Fallback to regex extraction (handles literal newlines)
  const regexResult = extractRevisedResponseViaRegex(cleaned);
  if (regexResult) {
    return regexResult;
  }

  // Step 4: Last resort - return cleaned text as revised_response
  return { revised_response: cleaned };
}

/**
 * Extract YAML metadata from the beginning of a response string
 * Handles cases where the model includes metadata at the start of draft_response
 */
export function extractMetadataFromResponse(text: string): {
  metadata: Record<string, any>;
  content: string;
} {
  if (typeof text !== 'string') {
    return { metadata: {}, content: text };
  }

  // Look for YAML-like metadata at the start (key: value patterns)
  // Stop when we hit a markdown heading (# ) or regular prose
  const lines = text.split('\n');
  let contentStartIndex = 0;
  let yamlBlock = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Stop at markdown heading
    if (trimmed.startsWith('#')) {
      contentStartIndex = i;
      break;
    }

    // Stop at empty line followed by prose (not YAML)
    if (trimmed === '' && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (nextLine && !nextLine.includes(':') && !nextLine.startsWith('-')) {
        contentStartIndex = i + 1;
        break;
      }
      // Empty line within YAML is OK, continue
      yamlBlock += line + '\n';
      contentStartIndex = i + 1;
      continue;
    }

    // Check if this looks like YAML (has : or starts with -)
    if (trimmed.includes(':') || trimmed.startsWith('-') || trimmed === '') {
      yamlBlock += line + '\n';
      contentStartIndex = i + 1;
    } else {
      // Hit prose, stop parsing YAML
      contentStartIndex = i;
      break;
    }
  }

  // Try to parse the YAML block
  let metadata: Record<string, any> = {};
  if (yamlBlock.trim()) {
    try {
      const parsed = YAML.load(yamlBlock) as Record<string, any>;
      if (parsed && typeof parsed === 'object') {
        metadata = parsed;
      }
    } catch (e) {
      // If YAML parsing fails, return empty metadata
      console.warn('Failed to parse YAML metadata:', e);
    }
  }

  const content = lines.slice(contentStartIndex).join('\n').trim();
  return { metadata, content };
}

/**
 * Recursively clean all revised_response fields in a data structure
 */
export function cleanAllRevisedResponses(data: any): any {
  if (Array.isArray(data)) {
    return data.map(cleanAllRevisedResponses);
  }

  if (data && typeof data === 'object') {
    const cleaned = { ...data };

    // Clean revised_response if present
    if (cleaned.content && typeof cleaned.content.revised_response === 'string') {
      const cleanedFields = cleanRevisedResponseField(cleaned.content.revised_response);
      Object.assign(cleaned.content, cleanedFields);
    }

    // Clean draft_response if present - extract embedded metadata
    if (cleaned.content && typeof cleaned.content.draft_response === 'string') {
      const { metadata: embeddedMetadata, content: cleanContent } = extractMetadataFromResponse(
        cleaned.content.draft_response
      );
      cleaned.content.draft_response = cleanContent;

      // Merge embedded metadata into content, preferring existing values
      // Only merge string values to avoid React rendering issues with objects/arrays
      for (const [key, value] of Object.entries(embeddedMetadata)) {
        if (!(key in cleaned.content) || cleaned.content[key] === undefined) {
          // Only merge if value is a string, number, or boolean
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            cleaned.content[key] = value;
          }
        }
      }
    }

    // Recursively clean nested objects
    for (const key in cleaned) {
      if (cleaned[key] && typeof cleaned[key] === 'object') {
        cleaned[key] = cleanAllRevisedResponses(cleaned[key]);
      }
    }

    return cleaned;
  }

  return data;
}

