import { extractTraceResponse } from './trace-response';

describe('extractTraceResponse', () => {
  test('falls back to exit node response when draft_response is empty', () => {
    const trace = {
      draft_response: '',
      trace: [
        { type: 'clarify', content: {} },
        {
          type: 'exit',
          content: {
            response: '**This question cannot be answered** because the premise is false.',
          },
        },
      ],
    };

    expect(extractTraceResponse(trace)).toBe(
      '**This question cannot be answered** because the premise is false.'
    );
  });

  test('supports legacy node_id-wrapped trace entries', () => {
    const trace = {
      draft_response: '',
      trace: [
        {
          node_id: {
            type: 'exit',
            content: {
              response: 'Wrapped exit response',
            },
          },
        },
      ],
    };

    expect(extractTraceResponse(trace)).toBe('Wrapped exit response');
  });

  test('prefers top-level draft_response when present', () => {
    const trace = {
      draft_response: 'Top-level response',
      trace: [
        {
          type: 'exit',
          content: { response: 'Exit response' },
        },
      ],
    };

    expect(extractTraceResponse(trace)).toBe('Top-level response');
  });
});