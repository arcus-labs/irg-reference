/**
 * Groq Provider — OpenAI-compatible API with vision support.
 * Uses raw fetch against the Groq Chat Completions endpoint.
 */

import { VISION_NODES, type LLMClient, type LLMCallOpts, type LLMProviderFactory, type ModelInfo, type ImagePayload } from './types';

const MODELS: Omit<ModelInfo, 'available'>[] = [
  { id: 'groq/meta-llama/llama-4-scout-17b-16e-instruct', provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B (Groq)', vision: true },
  { id: 'groq/meta-llama/llama-4-maverick-17b-128e-instruct', provider: 'groq', model: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B (Groq)', vision: true },
];

function resolveImages(config: { images?: ImagePayload[]; imageBase64?: string; imageMimeType?: string }): ImagePayload[] {
  if (config.images?.length) return config.images;
  if (config.imageBase64) return [{ base64: config.imageBase64, mimeType: config.imageMimeType || 'image/png' }];
  return [];
}

function createClient(config: { model: string; apiKey: string; images?: ImagePayload[]; imageBase64?: string; imageMimeType?: string }): LLMClient {
  const allImages = resolveImages(config);
  return {
    async call(prompt: string, opts: LLMCallOpts): Promise<string> {
      const useVision = VISION_NODES.has(opts.node) && allImages.length > 0;

      // Build messages — OpenAI-compatible format
      const userContent: Array<Record<string, unknown>> = [];
      if (useVision) {
        for (const img of allImages) {
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
          });
        }
      }
      userContent.push({ type: 'text', text: prompt });

      const body: Record<string, unknown> = {
        model: config.model,
        messages: [{ role: 'user', content: useVision ? userContent : prompt }],
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 4096,
      };

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Groq API error (${res.status}): ${err}`);
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? '{}';
    },
  };
}

export const groqProvider: LLMProviderFactory = {
  provider: 'groq',
  createClient,
  listModels(): ModelInfo[] {
    const available = !!process.env.GROQ_API_KEY;
    return MODELS.map(m => ({ ...m, available }));
  },
};

