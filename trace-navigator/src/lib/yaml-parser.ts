import YAML from 'js-yaml';

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

  // Strip dangling fragments
  const lastSeparator = text.lastIndexOf('---');
  if (lastSeparator !== -1 && lastSeparator > 0) {
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
 * Extract just the content from YAML frontmatter or JSON
 */
export function extractContent(text: string): string {
  const { content } = parseYamlFrontmatter(text);
  return content;
}

/**
 * Extract just the metadata from YAML frontmatter or JSON
 */
export function extractMetadata(text: string): Record<string, any> {
  const { metadata } = parseYamlFrontmatter(text);
  return metadata;
}

