export const traceNavigatorRequestDefaults = {
  query: 'Summarize our Q3 product roadmap risks.',
  context: {
    team: 'IRG',
    project: 'reference',
  },
  graph: 'irg-simple',
  maxIterations: 4,
  confidenceThreshold: 0.8,
  model: 'llama-3.1-8b-instant',
  maxTokens: 10000,
  enableFactCheck: true,
  enableImpactPrediction: true,
  enableAssessor: true,
  enableFactCheckPipeline: true,
} as const;

export const availableGraphOptions = [
  { value: 'irg-simple', label: 'IRG Simple' },
  { value: 'irg-external-facts', label: 'IRG + External Facts' },
] as const;