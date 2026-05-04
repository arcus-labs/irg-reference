import { diff_match_patch } from 'diff-match-patch';

export interface DiffResult {
  originalWithMarkup: string;
  revisedClean: string;
  hasChanges: boolean;
  changeCount: number;
}

/**
 * Calculate line-based diff between original and revised text
 * Returns markup with <del> and <ins> tags for rendering
 */
export function calculateDiff(originalText: string, revisedText: string): DiffResult {
  const dmp = new diff_match_patch();

  // Split into lines
  const originalLines = originalText.split('\n');
  const revisedLines = revisedText.split('\n');

  // Use linesToChars for proper line-based diffing
  const lineArray = dmp.diff_linesToChars_(originalText, revisedText);
  const lineText1 = lineArray.chars1;
  const lineText2 = lineArray.chars2;
  const lineArray2 = lineArray.lineArray;

  // Do line-level diff
  const lineDiffs = dmp.diff_main(lineText1, lineText2, false);

  // Convert the diff back to lines
  dmp.diff_charsToLines_(lineDiffs, lineArray2);
  dmp.diff_cleanupSemantic(lineDiffs);

  // Build markup with both deletions and insertions
  // Use special markers that DiffRenderer will convert to styled components
  const originalWithMarkup = lineDiffs
    .map((diff: any) => {
      const [type, text] = diff;
      if (type === 0) {
        // Unchanged
        return text;
      } else if (type === -1) {
        // Deleted - wrap in special markers
        return `~~DELETED_START~~${text}~~DELETED_END~~`;
      } else if (type === 1) {
        // Added - wrap in special markers (show on original side too)
        return `~~INSERTED_START~~${text}~~INSERTED_END~~`;
      }
      return '';
    })
    .join('');

  // Count changes
  const changeCount = lineDiffs.filter((d: any) => d[0] !== 0).length;
  const hasChanges = changeCount > 0;

  return {
    originalWithMarkup,
    revisedClean: revisedText,
    hasChanges,
    changeCount,
  };
}

/**
 * Extract meaningful content by finding first heading
 */
export function extractMeaningfulContent(text: string): string {
  if (!text) return '';

  const headingMatch = text.match(/^([\s\S]*?)(^#\s)/m);
  if (headingMatch && headingMatch.index !== undefined) {
    return text.substring(headingMatch.index + headingMatch[1].length);
  }

  return text;
}

