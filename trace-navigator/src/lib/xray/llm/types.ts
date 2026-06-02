/**
 * LLM Provider Abstraction — Types
 *
 * A provider-agnostic interface for vision-capable language models.
 * Each provider implements `LLMProvider` using raw fetch (no SDKs).
 */

/** Nodes that require the X-ray image to be sent as vision input. */
export const VISION_NODES = new Set(['imageObservation', 'targetedReanalysis']);

/** Options passed through from the IRG node pipeline. */
export interface LLMCallOpts {
  node: string;
  temperature?: number;
  maxTokens?: number;
}

/** A configured LLM client ready to make calls. */
export interface LLMClient {
  call(prompt: string, opts: LLMCallOpts): Promise<string>;
}

/** Provider metadata for the model selector UI. */
export interface ModelInfo {
  id: string;           // e.g. "openai/gpt-4o"
  provider: string;     // e.g. "openai"
  model: string;        // e.g. "gpt-4o"
  label: string;        // e.g. "GPT-4o (OpenAI)"
  vision: boolean;      // supports image input
  available: boolean;   // API key is configured
}

/** A single image payload for vision nodes. */
export interface ImagePayload {
  base64: string;
  mimeType: string;
}

/** Factory function signature — creates an LLMClient given config. */
export interface LLMProviderFactory {
  provider: string;
  createClient(config: {
    model: string;
    apiKey: string;
    images?: ImagePayload[];   // base64-encoded X-ray images (multiple views)
    /** @deprecated — use images[] instead */
    imageBase64?: string;
    /** @deprecated — use images[] instead */
    imageMimeType?: string;
  }): LLMClient;
  listModels(): ModelInfo[];
}

