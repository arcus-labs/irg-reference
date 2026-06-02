/**
 * OpenAI Provider — GPT-4o / GPT-4o-mini with vision support.
 * Uses raw fetch against the OpenAI Chat Completions API.
 */

import { VISION_NODES, type LLMClient, type LLMCallOpts, type LLMProviderFactory, type ModelInfo, type ImagePayload } from './types';

const MODELS: Omit<ModelInfo, 'available'>[] = [
  { id: 'openai/gpt-4o', provider: 'openai', model: 'gpt-4o', label: 'GPT-4o (OpenAI)', vision: true },
  { id: 'openai/gpt-4o-mini', provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o Mini (OpenAI)', vision: true },
  { id: 'openai/gpt-4.1', provider: 'openai', model: 'gpt-4.1', label: 'GPT-4.1 (OpenAI)', vision: true },
  { id: 'openai/gpt-4.1-mini', provider: 'openai', model: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (OpenAI)', vision: true },
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

      // Build messages
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

      const body = {
        model: config.model,
        messages: [{ role: 'user', content: useVision ? userContent : prompt }],
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 4096,
        response_format: { type: 'json_object' },
      };

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenAI API error (${res.status}): ${err}`);
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? '{}';
    },
  };
}

export const openaiProvider: LLMProviderFactory = {
  provider: 'openai',
  createClient,
  listModels(): ModelInfo[] {
    const available = !!process.env.OPENAI_API_KEY;
    return MODELS.map(m => ({ ...m, available }));
  },
};

