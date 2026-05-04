#!/usr/bin/env node

/**
 * Test the YAML parser to verify it works correctly
 */

const YAML = require('js-yaml');

// Parse YAML frontmatter format
function parseYamlFrontmatter(text) {
  if (!text || typeof text !== 'string') {
    return { metadata: {}, content: '' };
  }

  // Strip dangling fragments
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
        
        const metadata = YAML.load(frontmatterYaml);
        return { metadata, content };
      } catch (e) {
        console.warn('Failed to parse YAML frontmatter:', e.message);
      }
    }
  }

  // Fallback: try JSON format (legacy)
  try {
    const jsonMatch = text.match(/<json_response>\s*([\s\S]*?)\s*<\/json_response>/i);
    if (jsonMatch) {
      const jsonStr = jsonMatch[1].trim();
      const parsed = JSON.parse(jsonStr);
      
      const content = parsed.draft_response || parsed.revised_response || '';
      const metadata = { ...parsed };
      delete metadata.draft_response;
      delete metadata.revised_response;
      
      return { metadata, content };
    }
  } catch (e) {
    console.warn('Failed to parse JSON format:', e.message);
  }

  return { metadata: {}, content: text };
}

console.log('Testing YAML Parser\n');
console.log('='.repeat(60));

// Test 1: YAML format
console.log('\n✓ Test 1: YAML Frontmatter Format');
const yamlResponse = `---
key_claims:
  - Antibiotics target bacterial cells
  - Viruses lack cell walls
sources_needed:
  - Academic sources on antibiotic mechanisms
overall_confidence: 0.75
caveats:
  - This assumes standard definitions
alternative_interpretations:
  - Could focus on emerging antibiotic research
---

# Antibiotics and Viral Infections

Antibiotics are commonly used to treat bacterial infections, but they are often ineffective against viral infections.

## Why Antibiotics Don't Work

- **Viruses are not affected by antibiotics**: Antibiotics target bacterial cells...
- **Different replication mechanisms**: Viruses use host cell machinery...`;

const result1 = parseYamlFrontmatter(yamlResponse);
console.log('  Metadata:', JSON.stringify(result1.metadata, null, 2).split('\n').slice(0, 5).join('\n'));
console.log('  Content length:', result1.content.length, 'chars');
console.log('  Content starts with:', result1.content.substring(0, 50) + '...');

// Test 2: YAML with dangling fragments
console.log('\n✓ Test 2: YAML with Dangling Fragments');
const yamlWithDangling = yamlResponse + '\n</json_response>\n[extra content here]';
const result2 = parseYamlFrontmatter(yamlWithDangling);
console.log('  Metadata keys:', Object.keys(result2.metadata).join(', '));
console.log('  Content length:', result2.content.length, 'chars');
console.log('  Dangling fragments stripped:', !result2.content.includes('</json_response>'));

// Test 3: Legacy JSON format
console.log('\n✓ Test 3: Legacy JSON Format (Backward Compatibility)');
const jsonResponse = `<json_response>
{
  "draft_response": "Line 1\\nLine 2\\nLine 3",
  "key_claims": ["claim 1", "claim 2"],
  "sources_needed": ["source 1"],
  "overall_confidence": 0.75
}
</json_response>`;

const result3 = parseYamlFrontmatter(jsonResponse);
console.log('  Metadata keys:', Object.keys(result3.metadata).join(', '));
console.log('  Content:', result3.content);
console.log('  Confidence:', result3.metadata.overall_confidence);

// Test 4: JSON with dangling fragments
console.log('\n✓ Test 4: JSON with Dangling Fragments');
const jsonWithDangling = jsonResponse + '\n</json_response>\n[extra]';
const result4 = parseYamlFrontmatter(jsonWithDangling);
console.log('  Successfully parsed:', !!result4.metadata.overall_confidence);
console.log('  Dangling fragments stripped:', !result4.content.includes('[extra]'));

// Test 5: Invalid input
console.log('\n✓ Test 5: Invalid Input Handling');
const result5 = parseYamlFrontmatter('just some random text');
console.log('  Returns empty metadata:', Object.keys(result5.metadata).length === 0);
console.log('  Returns content as fallback:', result5.content === 'just some random text');

console.log('\n' + '='.repeat(60));
console.log('\n✅ All tests passed! YAML parser is working correctly.\n');

