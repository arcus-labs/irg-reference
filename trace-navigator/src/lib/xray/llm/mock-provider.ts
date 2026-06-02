/**
 * Mock Provider — Returns canned responses for testing without API keys.
 */

import type { LLMClient, LLMCallOpts, LLMProviderFactory, ModelInfo } from './types';

const mockResponses: Record<string, string> = {
  clinicalContext: JSON.stringify({
    structured_question: 'Evaluate chest X-ray for pathology based on clinical presentation.',
    assumptions: ['Single view only', 'No prior imaging available for comparison'],
    missing_info: ['Lateral view not provided'],
    can_proceed: true,
    confidence: 0.85,
  }),

  imageObservation: JSON.stringify({
    findings: [
      { region: 'lungs', observation: 'Opacity in lower lobe region', laterality: 'left' },
      { region: 'lungs', observation: 'Air bronchograms within opacity', laterality: 'left' },
      { region: 'heart', observation: 'Normal cardiac silhouette', laterality: 'N/A' },
      { region: 'pleura', observation: 'Small pleural effusion', laterality: 'left' },
    ],
    systematic_review: {
      airway: 'Midline trachea', mediastinum: 'Normal width', heart: 'Normal size',
      lungs: 'Left lower lobe opacity with air bronchograms', pleura: 'Small left effusion',
      bones: 'No acute osseous abnormality', soft_tissues: 'Unremarkable',
    },
    image_quality: 'diagnostic',
    image_quality_reasons: [],
    observation_confidence: 0.8,
  }),

  hypothesis: JSON.stringify({
    hypotheses: [
      { label: 'Pneumonia', supporting_findings: ['LLL consolidation', 'air bronchograms', 'clinical symptoms'], conflicting_findings: [], confidence: 0.75, status: 'active', reasoning: 'Classic presentation of community-acquired pneumonia' },
      { label: 'Lung mass with post-obstructive pneumonia', supporting_findings: ['consolidation'], conflicting_findings: ['air bronchograms suggest airway patency'], confidence: 0.2, status: 'active', reasoning: 'Must exclude in appropriate age group' },
    ],
  }),

  differentialExpansion: JSON.stringify({
    new_hypotheses: [
      { label: 'Pulmonary embolism with infarction', supporting_findings: ['pleural effusion'], conflicting_findings: ['consolidation pattern atypical'], confidence: 0.15, reasoning: 'Low probability but worth considering' },
    ],
    confidence_adjustments: [
      { label: 'Pneumonia', new_confidence: 0.80, reason: 'Air bronchograms strongly favor infectious process' },
    ],
    discriminating_features: ['CT enhancement pattern', 'sputum culture results'],
    missing_evidence: ['Lateral view', 'Prior films for comparison'],
  }),

  adversary: JSON.stringify({
    alternative_explanations: [{ finding: 'LLL consolidation', alternative: 'Organizing pneumonia or cryptogenic process' }],
    disproval_checklist: ['Check for mass within consolidation', 'Evaluate for cavitation'],
    overlooked_hypotheses: ['Tuberculosis'],
    red_flags: [],
    targeted_questions: ['Is there a mass within the consolidation?', 'Any cavitation present?'],
    confidence: 0.7,
  }),

  targetedReanalysis: JSON.stringify({
    focused_findings: [
      { question: 'Is there a mass within the consolidation?', finding: 'No discrete mass identified', present: false, confidence: 0.75 },
      { question: 'Any cavitation present?', finding: 'No cavitation seen', present: false, confidence: 0.8 },
    ],
  }),

  evidenceLink: JSON.stringify({
    evidence_links: [
      { hypothesis: 'Pneumonia', supports: ['air bronchograms', 'no mass', 'clinical correlation'], weakens: [], invalidates: [], new_confidence: 0.85, reasoning: 'Evidence strongly supports infectious etiology' },
      { hypothesis: 'Lung mass with post-obstructive pneumonia', supports: [], weakens: ['no mass identified'], invalidates: [], new_confidence: 0.08, reasoning: 'Substantially weakened by targeted reanalysis' },
    ],
  }),

  triage: JSON.stringify({
    ranked_differential: [
      { label: 'Community-acquired pneumonia', confidence: 0.85, key_supporting: ['LLL consolidation', 'air bronchograms', 'clinical presentation'], key_contradicting: [], reasoning: 'Most likely diagnosis given imaging and clinical findings' },
      { label: 'Tuberculosis', confidence: 0.1, key_supporting: ['consolidation in presenting patient'], key_contradicting: ['no cavitation'], reasoning: 'Low probability but must-not-miss diagnosis' },
    ],
    recommended_next_steps: ['Clinical correlation with CBC, CRP, procalcitonin', 'Sputum culture if productive cough', 'Follow-up chest X-ray in 6 weeks to confirm resolution'],
    urgency: 'urgent',
    clinical_correlation: 'Imaging findings consistent with community-acquired pneumonia. Clinical correlation with laboratory values and patient response to treatment is required.',
    confidence: 0.8,
  }),
};

function createClient(): LLMClient {
  return {
    async call(_prompt: string, opts: LLMCallOpts): Promise<string> {
      await new Promise(r => setTimeout(r, 80 + Math.random() * 150));
      return mockResponses[opts.node] || '{}';
    },
  };
}

export const mockProvider: LLMProviderFactory = {
  provider: 'mock',
  createClient,
  listModels(): ModelInfo[] {
    return [{
      id: 'mock/canned-responses',
      provider: 'mock',
      model: 'canned-responses',
      label: 'Mock (Canned Responses)',
      vision: false,
      available: true,
    }];
  },
};

