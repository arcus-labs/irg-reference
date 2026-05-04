import {
  getFactCheckArtifactMetadata,
  getDisplayFinalConfidence,
  isEarlyExitTrace,
  normalizeStructuredOutline,
  resolveConvergenceDecisions,
} from './trace-display';

describe('isEarlyExitTrace', () => {
  test('returns true for unanswerable exits', () => {
    const trace = { final_decision: 'unanswerable' };
    const exitNode = { content: { convergenceDecision: 'unanswerable' } };

    expect(isEarlyExitTrace(trace, exitNode)).toBe(true);
  });

  test('returns false for normal answered exits', () => {
    const trace = { final_decision: 'answered' };
    const exitNode = { content: { convergenceDecision: 'answered' } };

    expect(isEarlyExitTrace(trace, exitNode)).toBe(false);
  });
});

describe('getDisplayFinalConfidence', () => {
  test('returns null for unanswerable exits even when legacy traces store 0', () => {
    const trace = { final_decision: 'unanswerable' };
    const exitNode = {
      confidence: 0,
      content: { confidence: 0, convergenceDecision: 'unanswerable' },
    };

    expect(getDisplayFinalConfidence(trace, exitNode)).toBeNull();
  });

  test('returns numeric confidence for answerable exits', () => {
    const trace = { final_decision: 'answered', finalConfidence: 0.72 };
    const exitNode = { content: { convergenceDecision: 'answered' } };

    expect(getDisplayFinalConfidence(trace, exitNode)).toBe(0.72);
  });
});

describe('getFactCheckArtifactMetadata', () => {
  test('detects artifact-backed fact-check metadata', () => {
    expect(getFactCheckArtifactMetadata({
      artifact_type: 'fact_check_claims',
      storage: 'filesystem_artifact',
      generated_at: '2026-03-09T02:37:14.792Z',
      source_node: 'factCheck',
      iteration: 0,
      fact_store_root: '/tmp/fact-store',
      artifact_path: 'claims/2026-03/example.json',
      critical_claim_count: 3,
      summary: 'Three claims saved for later verification.',
      confidence: 0.85,
    })).toEqual({
      artifactType: 'fact_check_claims',
      storage: 'filesystem_artifact',
      generatedAt: '2026-03-09T02:37:14.792Z',
      sourceNode: 'factCheck',
      iteration: 0,
      factStoreRoot: '/tmp/fact-store',
      artifactPath: 'claims/2026-03/example.json',
      criticalClaimCount: 3,
      summary: 'Three claims saved for later verification.',
      confidence: 0.85,
    });
  });

  test('returns null for legacy inline-claims payloads', () => {
    expect(getFactCheckArtifactMetadata({
      critical_claims: [{ claim: 'A' }],
      sources: ['source-a'],
    })).toBeNull();
  });
});

describe('normalizeStructuredOutline', () => {
  test('normalizes nested section and subsection objects', () => {
    const outline = normalizeStructuredOutline([
      {
        section: 'Understanding the Term',
        subsections: [
          { subsection: 'Definition', content: 'Define the term clearly.' },
          { subsection: 'Relevance', content: 'Explain why it matters.' },
        ],
      },
    ]);

    expect(outline).toEqual([
      {
        title: 'Understanding the Term',
        children: [
          { title: 'Definition', content: 'Define the term clearly.', children: [] },
          { title: 'Relevance', content: 'Explain why it matters.', children: [] },
        ],
      },
    ]);
  });

  test('preserves plain string items as leaf nodes', () => {
    expect(normalizeStructuredOutline(['Intro', 'Conclusion'])).toEqual([
      { title: 'Intro', children: [] },
      { title: 'Conclusion', children: [] },
    ]);
  });
});

describe('resolveConvergenceDecisions', () => {
  test('matches meta and assessor from the same convergence window', () => {
    const traceArray = [
      { id: 'draft-0', type: 'draft', content: {} },
      { id: 'meta-0', type: 'meta_evaluation', content: { recommendation: 'iterate' } },
      { id: 'assessor-0', type: 'assessor', content: { release_decision: 'refuse' } },
      { id: 'conv-0', type: 'convergence', content: { decision: 'iterate' } },
      { id: 'revision-1', type: 'revision', content: {} },
      { id: 'meta-1', type: 'meta_evaluation', content: { recommendation: 'exit' } },
      { id: 'assessor-1', type: 'assessor', content: { release_decision: 'release' } },
      { id: 'conv-1', type: 'convergence', content: { decision: 'accept' } },
    ];

    expect(resolveConvergenceDecisions(traceArray, 'conv-0')).toEqual({
      metaDecision: 'iterate',
      assessorDecision: 'iterate',
    });

    expect(resolveConvergenceDecisions(traceArray, 'conv-1')).toEqual({
      metaDecision: 'exit',
      assessorDecision: 'exit',
    });
  });

  test('does not bleed assessor decisions across a previous convergence boundary', () => {
    const traceArray = [
      { id: 'meta-0', type: 'meta_evaluation', content: { recommendation: 'exit' } },
      { id: 'assessor-0', type: 'assessor', content: { release_decision: 'release' } },
      { id: 'conv-0', type: 'convergence', content: { decision: 'accept' } },
      { id: 'revision-1', type: 'revision', content: {} },
      { id: 'meta-1', type: 'meta_evaluation', content: { recommendation: 'iterate' } },
      { id: 'conv-1', type: 'convergence', content: { decision: 'iterate' } },
    ];

    expect(resolveConvergenceDecisions(traceArray, 'conv-1')).toEqual({
      metaDecision: 'iterate',
      assessorDecision: 'unknown',
    });
  });
});