/**
 * Simple file-based case store for X-Ray IRG cases.
 * Stores cases as JSON files in a local directory.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface XrayCase {
  id: string;
  clinicalQuestion: string;
  patientAge: string;
  patientSymptoms: string;
  patientHistory: string;
  bodyRegion: string;
  modelId?: string;           // LLM provider/model used (e.g. "openai/gpt-4o")
  imagePaths: string[];       // relative paths to uploaded images (multiple views)
  /** @deprecated Use imagePaths[0] instead */
  imagePath?: string;         // kept for backward compat with old cases
  createdAt: string;          // ISO date
  status: 'processing' | 'completed' | 'error';
  terminationState?: string;
  report?: any;               // formatted output from output-formatter
  trace?: any;                // full IRG state (history, nodes, etc.)
  provenance?: any;           // model + code SHAs + determinism + I/O seal
  error?: string;
}

// Namespaced under trace-navigator so xray data doesn't collide with the
// fintech trace store. process.cwd() is the trace-navigator app root.
function getCasesDir(): string {
  const dir = join(process.cwd(), 'data', 'xray-cases');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getUploadsDir(): string {
  const dir = join(process.cwd(), 'public', 'xray-uploads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveCase(c: XrayCase): void {
  const dir = getCasesDir();
  writeFileSync(join(dir, `${c.id}.json`), JSON.stringify(c, null, 2));
}

export function getCase(id: string): XrayCase | null {
  const filepath = join(getCasesDir(), `${id}.json`);
  if (!existsSync(filepath)) return null;
  return JSON.parse(readFileSync(filepath, 'utf-8'));
}

export function listCases(): XrayCase[] {
  const dir = getCasesDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  return files
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as XrayCase)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getUploadsPath(): string {
  return getUploadsDir();
}

