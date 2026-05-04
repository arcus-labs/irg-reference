import { calculateDiff, extractMeaningfulContent } from './diff-calculator';
import { extractMetadataFromResponse } from './response-cleaner';

describe('calculateDiff', () => {
  describe('Simple text changes', () => {
    test('should mark simple word replacement', () => {
      const original = 'The cat is here';
      const revised = 'The dog is here';
      const result = calculateDiff(original, revised);

      expect(result.hasChanges).toBe(true);
      expect(result.originalWithMarkup).toContain('~~DELETED_START~~');
      expect(result.originalWithMarkup).toContain('~~INSERTED_START~~');
      expect(result.originalWithMarkup).toContain('cat');
      expect(result.originalWithMarkup).toContain('dog');
    });

    test('should handle identical text', () => {
      const text = 'The same text';
      const result = calculateDiff(text, text);

      expect(result.hasChanges).toBe(false);
      expect(result.originalWithMarkup).not.toContain('~~DELETED_START~~');
      expect(result.originalWithMarkup).not.toContain('~~INSERTED_START~~');
      expect(result.originalWithMarkup).toBe(text);
    });

    test('should handle empty strings', () => {
      const result = calculateDiff('', '');
      expect(result.hasChanges).toBe(false);
    });
  });

  describe('Header changes', () => {
    test('should mark header replacement', () => {
      const original = '# Old Header\n\nContent here';
      const revised = '# New Header\n\nContent here';
      const result = calculateDiff(original, revised);

      expect(result.hasChanges).toBe(true);
      expect(result.originalWithMarkup).toContain('~~DELETED_START~~');
      expect(result.originalWithMarkup).toContain('~~INSERTED_START~~');
      expect(result.originalWithMarkup).toContain('Old Header');
      expect(result.originalWithMarkup).toContain('New Header');
    });

    test('should mark header addition', () => {
      const original = 'Content without header';
      const revised = '# New Header\n\nContent without header';
      const result = calculateDiff(original, revised);

      expect(result.hasChanges).toBe(true);
      expect(result.originalWithMarkup).toContain('~~INSERTED_START~~');
      expect(result.originalWithMarkup).toContain('New Header');
    });
  });

  describe('Multi-line changes', () => {
    test('should mark multi-line deletion', () => {
      const original = 'Line 1\nLine 2\nLine 3\nLine 4';
      const revised = 'Line 1\nLine 4';
      const result = calculateDiff(original, revised);

      expect(result.hasChanges).toBe(true);
      expect(result.originalWithMarkup).toContain('~~DELETED_START~~');
      expect(result.originalWithMarkup).toContain('Line 2');
      expect(result.originalWithMarkup).toContain('Line 3');
    });

    test('should mark multi-line addition', () => {
      const original = 'Line 1\nLine 4';
      const revised = 'Line 1\nLine 2\nLine 3\nLine 4';
      const result = calculateDiff(original, revised);

      expect(result.hasChanges).toBe(true);
      expect(result.originalWithMarkup).toContain('~~INSERTED_START~~');
      expect(result.originalWithMarkup).toContain('Line 2');
      expect(result.originalWithMarkup).toContain('Line 3');
    });
  });

  describe('Complex scenarios', () => {
    test('should handle paragraph replacement', () => {
      const original = 'Antibiotics work by inhibiting synthesis.';
      const revised = 'Antibiotics are designed to target bacteria.';
      const result = calculateDiff(original, revised);

      expect(result.hasChanges).toBe(true);
      expect(result.originalWithMarkup).toContain('~~DELETED_START~~');
      expect(result.originalWithMarkup).toContain('~~INSERTED_START~~');
    });

    test('should handle mixed additions and deletions', () => {
      const original = '# Title\n\nOld content\nMore old';
      const revised = '# Title\n\nNew content\nMore new\nExtra line';
      const result = calculateDiff(original, revised);

      expect(result.hasChanges).toBe(true);
      expect(result.changeCount).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    test('should handle text with special characters', () => {
      const original = 'Text with <tags> & symbols';
      const revised = 'Text with [brackets] & symbols';
      const result = calculateDiff(original, revised);

      expect(result.hasChanges).toBe(true);
    });

    test('should handle very long text', () => {
      const original = 'A'.repeat(1000);
      const revised = 'A'.repeat(999) + 'B';
      const result = calculateDiff(original, revised);

      expect(result.hasChanges).toBe(true);
    });

    test('should preserve newlines in markup', () => {
      const original = 'Line 1\nLine 2';
      const revised = 'Line 1\nLine 2\nLine 3';
      const result = calculateDiff(original, revised);

      expect(result.originalWithMarkup).toContain('\n');
    });
  });

  describe('Tag validation', () => {
    test('should have matching opening and closing del markers', () => {
      const original = 'Delete this\nKeep this';
      const revised = 'Keep this';
      const result = calculateDiff(original, revised);

      const delOpen = (result.originalWithMarkup.match(/~~DELETED_START~~/g) || []).length;
      const delClose = (result.originalWithMarkup.match(/~~DELETED_END~~/g) || []).length;
      expect(delOpen).toBe(delClose);
    });

    test('should have matching opening and closing ins markers', () => {
      const original = 'Keep this';
      const revised = 'Add this\nKeep this';
      const result = calculateDiff(original, revised);

      const insOpen = (result.originalWithMarkup.match(/~~INSERTED_START~~/g) || []).length;
      const insClose = (result.originalWithMarkup.match(/~~INSERTED_END~~/g) || []).length;
      expect(insOpen).toBe(insClose);
    });
  });
});

describe('extractMeaningfulContent', () => {
  test('should extract content after first heading', () => {
    const text = 'metadata\nmore metadata\n# Heading\n\nContent here';
    const result = extractMeaningfulContent(text);

    expect(result).toContain('# Heading');
    expect(result).toContain('Content here');
    expect(result).not.toContain('metadata');
  });

  test('should return full text if no heading found', () => {
    const text = 'Just content without heading';
    const result = extractMeaningfulContent(text);

    expect(result).toBe(text);
  });

  test('should handle empty string', () => {
    const result = extractMeaningfulContent('');
    expect(result).toBe('');
  });
});

describe('extractMetadataFromResponse', () => {
  test('should extract YAML metadata from response start', () => {
    const response = `key_claims:
  - Antibiotics are not effective against viral infections
overall_confidence: 0.8
caveats:
  - This response focuses on general effectiveness

# Why Antibiotics Are Not Effective

Antibiotics work by targeting bacteria...`;

    const { metadata, content } = extractMetadataFromResponse(response);

    expect(metadata.key_claims).toBeDefined();
    expect(metadata.overall_confidence).toBe(0.8);
    expect(metadata.caveats).toBeDefined();
    expect(content).toContain('# Why Antibiotics Are Not Effective');
    expect(content).not.toContain('key_claims:');
  });

  test('should handle response with no metadata', () => {
    const response = `# Title

This is just content without metadata.`;

    const { metadata, content } = extractMetadataFromResponse(response);

    expect(Object.keys(metadata).length).toBe(0);
    expect(content).toContain('# Title');
  });

  test('should stop at first markdown heading', () => {
    const response = `sources_needed:
  - CDC
  - WHO

# Main Content

This is the actual response.`;

    const { metadata, content } = extractMetadataFromResponse(response);

    expect(metadata.sources_needed).toBeDefined();
    expect(content).toContain('# Main Content');
    expect(content).toContain('This is the actual response');
  });

  test('should handle empty string', () => {
    const { metadata, content } = extractMetadataFromResponse('');

    expect(metadata).toEqual({});
    expect(content).toBe('');
  });
});

