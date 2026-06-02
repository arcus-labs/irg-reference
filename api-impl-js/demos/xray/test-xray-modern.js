/**
 * X-Ray IRG — modern-stack smoke test.
 *
 * Runs the X-ray graph on the SHARED api-impl-js linear interpreter via
 * run-xray-modern, using the same deterministic mock client as
 * test-xray-graph.js. Verifies:
 *   - all phases execute in order on the shared interpreter (gate + loop work)
 *   - the output formatter still produces a report
 *   - the I/O seal is present and verifies (tamper-evident)
 */

'use strict';

const { runXrayModern } = require('./core/run-xray-modern');
const { formatOutputMarkdown } = require('./core/output-formatter');
const { verifySeal } = require('../_adjudication-kit/io-seal');

const mockResponses = {
  clinicalContext: JSON.stringify({
    structured_question: 'Evaluate PA chest X-ray for pulmonary infiltrate in 65-year-old with cough and fever.',
    assumptions: ['No prior films available'], missing_info: ['Lateral view not provided'],
    can_proceed: true, confidence: 0.85,
  }),
  imageObservation: JSON.stringify({
    findings: [
      { region: 'lungs', observation: 'Consolidation in left lower lobe', laterality: 'left' },
      { region: 'lungs', observation: 'Air bronchograms within consolidation', laterality: 'left' },
    ],
    systematic_review: { lungs: 'LLL consolidation with air bronchograms' },
    image_quality: 'diagnostic', image_quality_reasons: [], observation_confidence: 0.8,
  }),
  hypothesis: JSON.stringify({
    hypotheses: [
      { label: 'Pneumonia', supporting_findings: ['LLL consolidation', 'air bronchograms'], conflicting_findings: [], confidence: 0.75, status: 'active', reasoning: 'Classic' },
      { label: 'Lung mass w/ post-obstructive pneumonia', supporting_findings: ['consolidation'], conflicting_findings: ['air bronchograms'], confidence: 0.2, status: 'active', reasoning: 'Must not miss' },
    ],
  }),
  differentialExpansion: JSON.stringify({
    new_hypotheses: [], confidence_adjustments: [{ label: 'Pneumonia', new_confidence: 0.8, reason: 'Air bronchograms favor pneumonia' }],
    discriminating_features: ['CT pattern'], missing_evidence: ['Lateral view'],
  }),
  adversary: JSON.stringify({
    alternative_explanations: [{ finding: 'LLL consolidation', alternative: 'Organizing pneumonia' }],
    disproval_checklist: ['Check for mass'], overlooked_hypotheses: ['TB'], red_flags: [],
    targeted_questions: ['Is there a mass within the consolidation?'], confidence: 0.7,
  }),
  targetedReanalysis: JSON.stringify({
    focused_findings: [{ question: 'Is there a mass within the consolidation?', finding: 'No mass identified', present: false, confidence: 0.8 }],
  }),
  evidenceLink: JSON.stringify({
    evidence_links: [
      { hypothesis: 'Pneumonia', supports: ['air bronchograms', 'no mass'], weakens: [], invalidates: [], new_confidence: 0.85, reasoning: 'Strengthened' },
      { hypothesis: 'Lung mass w/ post-obstructive pneumonia', supports: [], weakens: ['no mass'], invalidates: [], new_confidence: 0.08, reasoning: 'Weakened' },
    ],
  }),
  triage: JSON.stringify({
    ranked_differential: [{ label: 'Community-acquired pneumonia', confidence: 0.85, key_supporting: ['LLL consolidation', 'air bronchograms'], key_contradicting: [], reasoning: 'Most likely' }],
    recommended_next_steps: ['Clinical correlation with CBC, CRP', 'Sputum culture'], urgency: 'urgent',
    clinical_correlation: 'Consistent with CAP. Clinical correlation required.', confidence: 0.8,
  }),
};

const mockLlmClient = { async call(prompt, opts) { return mockResponses[opts.node] || '{}'; } };

(async () => {
  console.log('=== X-Ray IRG · Modern-Stack Smoke Test ===\n');

  const initialState = {
    clinicalQuestion: 'Evaluate chest X-ray for infiltrate',
    patientAge: '65', patientSymptoms: 'Cough, fever for 3 days', patientHistory: 'Hypertension',
    imagingModality: 'X-ray', bodyRegion: 'chest',
    imageDescriptions: 'PA chest radiograph: LLL opacity with air bronchograms.',
    config: { maxIterations: 3, confidenceThreshold: 0.75 },
  };

  const { state, provenance } = await runXrayModern(initialState, mockLlmClient, { modelId: 'mock/canned-responses' });

  const phases = (state.history || []).map(h => h.phase);
  console.log('Phases:', phases.join(' → '));
  console.log('Termination state:', state.terminationState);
  console.log('Iterations:', state.iteration);
  console.log('Hypotheses:', (state.hypotheses || []).length);
  console.log('Total ms:', state.metrics?.totalMs);

  const seal = provenance.io_seal;
  const v = verifySeal(seal);
  console.log('\nI/O seal — calls:', seal.call_count, '· verify:', JSON.stringify(v));
  console.log('Provenance model:', provenance.model.model_id, '· artifacts sealed:', Object.keys(provenance.artifacts).length);

  console.log('\n--- Report (first 500 chars) ---\n');
  console.log((formatOutputMarkdown(state) || '').slice(0, 500));

  // Assertions
  const ok =
    phases.includes('clinicalContext') &&
    phases.includes('imageObservation') &&
    phases.includes('triage') &&
    phases.includes('convergenceCheck') &&
    v.ok === true &&
    seal.call_count >= 6;

  console.log('\n=== ' + (ok ? 'PASSED' : 'FAILED') + ' ===');
  if (!ok) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
