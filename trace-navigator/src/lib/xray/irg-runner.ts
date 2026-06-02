/**
 * IRG Runner — wraps the CommonJS core modules for use in Next.js API routes.
 * Uses dynamic require with runtime-computed paths to avoid webpack bundling issues.
 */

import path from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { createLLMClient, type LLMClient, type ImagePayload } from './llm';

// Load the CommonJS X-ray engine from outside the Next bundle at runtime.
// The `turbopackIgnore` magic comment tells Turbopack NOT to statically
// analyze / bundle this import (the engine lives in a sibling package and is
// plain CJS); Node loads it normally, so its transitive requires (js-yaml, the
// shared interpreter, io-seal) resolve via standard Node resolution.
async function getCoreModule(moduleName: string) {
  // api-impl-js/demos/xray/core, relative to the trace-navigator app root.
  const coreDir = path.resolve(process.cwd(), '..', 'api-impl-js', 'demos', 'xray', 'core');
  const href = pathToFileURL(path.join(coreDir, `${moduleName}.js`)).href;
  const mod = await import(/* turbopackIgnore: true */ href);
  return mod.default ?? mod;
}

export interface IRGResult {
  modelId: string;
  history: Array<{ phase: string; timestamp?: string; data?: Record<string, unknown> }>;
  nodes: Array<{ id: string; type: string; content: Record<string, unknown>; status?: string; timestamp?: string }>;
  hypotheses: Array<{ label: string; confidence: number; status: string }>;
  metrics: { totalMs: number; phaseTimings: Record<string, number> };
  iteration: number;
  terminationState: string;
  report: Record<string, unknown> & { markdownReport: string };
  provenance: Record<string, unknown>;
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.dicom': 'application/dicom', '.dcm': 'application/dicom',
};

/**
 * Resolve an uploaded image to base64 + mime type.
 */
function loadImageBase64(imagePath: string): ImagePayload {
  const diskPath = path.join(process.cwd(), 'public', imagePath);
  const buffer = readFileSync(diskPath);
  const ext = path.extname(imagePath).toLowerCase();
  return { base64: buffer.toString('base64'), mimeType: MIME_MAP[ext] || 'image/png' };
}

/**
 * Load all uploaded images for a case.
 */
function loadAllImages(imagePaths: string[]): ImagePayload[] {
  return imagePaths.map(p => loadImageBase64(p));
}

export async function runXrayIRG(params: {
  clinicalQuestion: string;
  patientAge: string;
  patientSymptoms: string;
  patientHistory: string;
  bodyRegion: string;
  imagePaths: string[];
  modelId: string;
}): Promise<IRGResult> {
  // Modern stack: run the X-ray graph on the shared api-impl-js linear
  // interpreter with the I/O seal + provenance, instead of the legacy
  // bespoke xray-interpreter.
  const { runXrayModern } = await getCoreModule('run-xray-modern');
  const { formatOutput, formatOutputMarkdown } = await getCoreModule('output-formatter');

  // Load all images for vision providers
  let llmClient: LLMClient;
  if (params.modelId === 'mock/canned-responses') {
    llmClient = createLLMClient(params.modelId);
  } else {
    const images = loadAllImages(params.imagePaths);
    llmClient = createLLMClient(params.modelId, { images });
  }

  const viewDesc = params.imagePaths.length === 1
    ? `Uploaded X-ray image: ${params.imagePaths[0]}`
    : `Uploaded ${params.imagePaths.length} X-ray views: ${params.imagePaths.join(', ')}`;

  const initialState = {
    clinicalQuestion: params.clinicalQuestion,
    patientAge: params.patientAge,
    patientSymptoms: params.patientSymptoms,
    patientHistory: params.patientHistory,
    imagingModality: 'X-ray',
    bodyRegion: params.bodyRegion,
    imageDescriptions: viewDesc,
    config: { maxIterations: 3, confidenceThreshold: 0.75 },
  };

  const { state, provenance } = await runXrayModern(initialState, llmClient, { modelId: params.modelId });
  const report = formatOutput(state);
  const markdownReport = formatOutputMarkdown(state);

  return {
    modelId: params.modelId,
    history: state.history,
    nodes: state.nodes || [],
    hypotheses: state.hypotheses,
    metrics: state.metrics,
    iteration: state.iteration,
    terminationState: state.terminationState,
    report: { ...report, markdownReport },
    provenance,
  };
}

