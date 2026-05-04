/**
 * IRG Format Utilities
 * Centralized format specifications, prompt builders, and response parsers
 * Used across all IRG nodes to ensure consistent LLM response formatting
 */

// ============================================================================
// FORMAT SPECIFICATIONS
// ============================================================================

const RESPONSE_FORMATS = {
  clarify: {
    fields: ['ambiguities', 'missing_context', 'assumptions', 'scope_assessment', 'clarification_questions', 'can_proceed', 'confidence', 'reasoning'],
    required: ['ambiguities', 'missing_context', 'can_proceed', 'confidence'],
    arrays: ['ambiguities', 'missing_context', 'assumptions', 'clarification_questions'],
    description: 'YAML format with clarification analysis'
  },
  draft: {
    fields: ['key_claims', 'sources_needed', 'overall_confidence', 'caveats', 'alternative_interpretations', 'confidence_by_section', 'assumptions', 'clarification_request'],
    required: ['key_claims', 'overall_confidence'],
    arrays: ['key_claims', 'sources_needed', 'caveats', 'alternative_interpretations', 'assumptions'],
    description: 'YAML frontmatter with metadata and markdown content'
  },
  evaluate: {
    fields: ['factual_assessment', 'logical_coherence', 'completeness', 'critical_issues', 'bias_issues', 'overconfidence_flags', 'strengths', 'overall_assessment'],
    required: ['factual_assessment', 'overall_assessment'],
    arrays: ['factual_assessment', 'critical_issues', 'bias_issues', 'overconfidence_flags', 'strengths'],
    description: 'YAML format with evaluation results'
  },
  impact: {
    fields: ['misunderstanding_risks', 'harm_assessment', 'positive_impacts', 'stakeholder_effects', 'mitigation_strategies', 'overall_risk_level'],
    required: ['misunderstanding_risks', 'harm_assessment', 'overall_risk_level'],
    arrays: ['misunderstanding_risks', 'positive_impacts', 'stakeholder_effects', 'mitigation_strategies'],
    description: 'YAML format with impact prediction'
  },
  revise: {
    fields: ['changes_made', 'confidence_improvement', 'remaining_issues', 'revised_response'],
    required: ['changes_made', 'revised_response'],
    arrays: ['changes_made', 'remaining_issues'],
    description: 'YAML frontmatter with revision metadata and updated content'
  }
};

// ============================================================================
// PROMPT BUILDERS
// ============================================================================

function buildYamlFormatInstructions(responseType) {
  const format = RESPONSE_FORMATS[responseType];
  if (!format) throw new Error(`Unknown response type: ${responseType}`);
  
  const arrayFields = format.arrays.map(f => `${f}:\n  - item 1\n  - item 2`).join('\n');
  
  return `RESPONSE FORMAT (CRITICAL - PURE YAML):
Return ONLY valid YAML with no code fences, markdown, or extra formatting.
Use arrays for list fields.

REQUIRED YAML FIELDS:
${arrayFields}

VALIDATION RULES:
- All required fields must be present
- Array fields must be actual arrays (start with -)
- No code fences or markdown formatting
- No extra content before or after YAML`;
}

function buildYamlFrontmatterInstructions(responseType) {
  if (responseType !== 'draft' && responseType !== 'revise') {
    throw new Error(`Frontmatter format only for draft/revise, got: ${responseType}`);
  }

  return `RESPONSE FORMAT (CRITICAL - YAML FRONTMATTER WITH STRICT SEPARATION):

⚠️  CRITICAL: Metadata fields MUST be separate from markdown content. Do NOT embed metadata inside the markdown section.

STRUCTURE:
1. Start with: ---
2. YAML metadata section (key_claims, sources_needed, overall_confidence, caveats, alternative_interpretations)
3. Empty line
4. Markdown content section (the actual response text)
5. NO closing --- needed

REQUIRED YAML METADATA FIELDS (in frontmatter section only):
key_claims:
  - claim 1
  - claim 2
sources_needed:
  - source 1
  - source 2
overall_confidence: 0.75
caveats:
  - caveat 1
alternative_interpretations:
  - interpretation 1
assumptions:
  - assumption: "What is being assumed"
    rationale: "Why this assumption was necessary"
    impact: "How the answer changes if this assumption is wrong"
clarification_request: false

CORRECT EXAMPLE (Standard Response):
---
key_claims:
  - Antibiotics target bacterial cells
  - Viruses lack cell walls
sources_needed:
  - Academic sources on antibiotic mechanisms
overall_confidence: 0.85
caveats:
  - This assumes standard definitions
alternative_interpretations:
  - Could focus on emerging antibiotic research
assumptions:
  - assumption: "You're asking about pharmaceutical antibiotics"
    rationale: "The term 'antibiotics' is ambiguous without context"
    impact: "If you meant something else, the answer would be different"
clarification_request: false

# Why Antibiotics Don't Work Against Viruses

Antibiotics are designed to target bacterial cells, but viruses operate differently...

## Key Differences

- Viruses use host cell machinery
- Bacteria have cell walls that antibiotics can penetrate
- Viral replication is fundamentally different

CORRECT EXAMPLE (Clarification Request):
---
key_claims: []
sources_needed: []
overall_confidence: 0.0
caveats: []
alternative_interpretations: []
assumptions: []
clarification_request: true

# I Need More Information

I'm not sure what kind of investment you're referring to. To provide specific guidance, please clarify:

- **What type of investment?** (stocks, bonds, real estate, cryptocurrency, etc.)
- **What is your time horizon?** (short-term, medium-term, long-term)
- **What is your risk tolerance?** (conservative, moderate, aggressive)
- **What is your investment goal?** (growth, income, preservation, etc.)

Once you provide these details, I can give you a much more useful and specific assessment.

INCORRECT EXAMPLE (DO NOT DO THIS):
---
key_claims:
  - Antibiotics target bacteria
draft_response: |-
  sources_needed:
    - CDC
  overall_confidence: 0.8

  # Why Antibiotics Don't Work

  Antibiotics are...

❌ WRONG: metadata fields (sources_needed, overall_confidence) are embedded in the markdown content

VALIDATION RULES:
- overall_confidence must be a number between 0 and 1
- key_claims must be a non-empty array (unless clarification_request: true)
- sources_needed, caveats, alternative_interpretations, assumptions must be arrays
- clarification_request must be a boolean (true if requesting clarification, false otherwise)
- If clarification_request: true, key_claims should be empty and overall_confidence should be 0.0
- Assumptions field should list all assumptions made with rationale and impact
- Metadata fields ONLY appear in the YAML section before the markdown
- Markdown content starts after the empty line following metadata
- Use actual newlines in markdown, not escaped \\n
- No code fences or extra formatting
- No closing --- separator needed`;
}

// ============================================================================
// RESPONSE PARSERS
// ============================================================================

function parseYamlFrontmatter(text) {
  if (!text || typeof text !== 'string') {
    return { metadata: {}, content: '' };
  }
  
  if (text.startsWith('---')) {
    try {
      const parts = text.split('---');
      let frontmatterYaml = '';
      let content = '';
      
      if (parts.length >= 3) {
        frontmatterYaml = parts[1].trim();
        content = parts.slice(2).join('---').trim();
      } else if (parts.length === 2) {
        const fullText = parts[1];
        const lines = fullText.split('\n');
        let metadataEndIdx = -1;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('#') || (line === '' && i + 1 < lines.length && lines[i + 1].trim().startsWith('#'))) {
            metadataEndIdx = i;
            break;
          }
        }
        
        if (metadataEndIdx > 0) {
          frontmatterYaml = lines.slice(0, metadataEndIdx).join('\n').trim();
          content = lines.slice(metadataEndIdx).join('\n').trim();
        } else {
          frontmatterYaml = fullText.trim();
          content = '';
        }
      }
      
      const metadata = parseYamlMetadata(frontmatterYaml);
      return { metadata, content };
    } catch (e) {
      console.warn('Failed to parse YAML frontmatter:', e);
    }
  }
  
  return { metadata: {}, content: text };
}

function parseYamlMetadata(yamlText) {
  const metadata = {};
  const lines = yamlText.split('\n');
  let currentKey = null;
  let currentArray = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    if (line.startsWith('  - ')) {
      if (!currentArray && currentKey) {
        currentArray = [];
        metadata[currentKey] = currentArray;
      }
      if (currentArray) {
        currentArray.push(trimmed.substring(2).trim());
      }
    } else if (line.includes(':')) {
      const colonIdx = line.indexOf(':');
      const k = line.substring(0, colonIdx).trim();
      const v = line.substring(colonIdx + 1).trim();
      
      if (v === '' || v === '[]') {
        if (i + 1 < lines.length && lines[i + 1].startsWith('  - ')) {
          currentArray = [];
          metadata[k] = currentArray;
        } else {
          currentArray = null;
          metadata[k] = [];
        }
      } else {
        currentArray = null;
        // YAML-only: treat all values as strings, no JSON parsing
        metadata[k] = v;
      }
      currentKey = k;
    }
  }
  
  return metadata;
}

module.exports = {
  RESPONSE_FORMATS,
  buildYamlFormatInstructions,
  buildYamlFrontmatterInstructions,
  parseYamlFrontmatter,
  parseYamlMetadata
};

