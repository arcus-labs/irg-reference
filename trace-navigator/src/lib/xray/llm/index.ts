/**
 * LLM Provider Registry
 *
 * Central factory for creating LLM clients and listing available models.
 * Providers register themselves; the UI queries available models,
 * and the API route creates the right client per request.
 */

import { openaiProvider } from './openai-provider';
import { anthropicProvider } from './anthropic-provider';
import { googleProvider } from './google-provider';
import { groqProvider } from './groq-provider';
import { mockProvider } from './mock-provider';
import type { LLMClient, LLMProviderFactory, ModelInfo } from './types';

export type { LLMClient, ModelInfo, ImagePayload } from './types';

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const providers: Record<string, LLMProviderFactory> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  groq: groqProvider,
  mock: mockProvider,
};

// ---------------------------------------------------------------------------
// API key resolution (server-side only)
// ---------------------------------------------------------------------------

const API_KEY_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_AI_API_KEY',
  groq: 'GROQ_API_KEY',
};

// The rest of this repo (fintech IRGs) configures provider keys as API_KEY_*
// in the root .env. The xray providers read the canonical NAME_API_KEY form.
// Alias the repo-style keys onto the canonical names so a single key (e.g.
// API_KEY_GROQ) lights up the models here too — and so listModels()'s
// availability check (which reads process.env directly) sees them.
const KEY_ALIASES: Record<string, string> = {
  OPENAI_API_KEY: 'API_KEY_OPENAI',
  ANTHROPIC_API_KEY: 'API_KEY_ANTHROPIC',
  GOOGLE_AI_API_KEY: 'API_KEY_GOOGLE',
  GROQ_API_KEY: 'API_KEY_GROQ',
};

function applyKeyAliases(): void {
  for (const [canonical, alt] of Object.entries(KEY_ALIASES)) {
    if (!process.env[canonical] && process.env[alt]) {
      process.env[canonical] = process.env[alt];
    }
  }
}
// Run at module load so both listModels() and createLLMClient() see the keys.
applyKeyAliases();

function getApiKey(provider: string): string | undefined {
  const envVar = API_KEY_ENV[provider];
  return envVar ? process.env[envVar] : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all models across all providers, with `available` reflecting
 * whether the corresponding API key is configured.
 */
export function listAllModels(): ModelInfo[] {
  return Object.values(providers).flatMap(p => p.listModels());
}

/**
 * Create an LLM client for a given model ID (e.g. "openai/gpt-4o").
 *
 * @param modelId   — composite "provider/model" string
 * @param imageOpts — optional base64 images for vision nodes (multi-view)
 */
export function createLLMClient(
  modelId: string,
  imageOpts?: { images: Array<{ base64: string; mimeType: string }> },
): LLMClient {
  const [providerName, ...rest] = modelId.split('/');
  const modelName = rest.join('/');
  const factory = providers[providerName];

  if (!factory) {
    throw new Error(`Unknown LLM provider: "${providerName}". Available: ${Object.keys(providers).join(', ')}`);
  }

  if (providerName === 'mock') {
    return factory.createClient({ model: modelName, apiKey: '' });
  }

  const apiKey = getApiKey(providerName);
  if (!apiKey) {
    throw new Error(
      `API key not configured for "${providerName}". Set ${API_KEY_ENV[providerName]} in .env.local`,
    );
  }

  return factory.createClient({
    model: modelName,
    apiKey,
    images: imageOpts?.images,
  });
}

