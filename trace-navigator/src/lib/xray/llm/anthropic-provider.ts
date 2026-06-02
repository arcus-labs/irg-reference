/**
 * Anthropic Provider — Claude 3.5 Sonnet / Claude 3 Opus with vision support.
 * Uses raw fetch against the Anthropic Messages API.
 */

import { VISION_NODES, type LLMClient, type LLMCallOpts, type LLMProviderFactory, type ModelInfo, type ImagePayload } from './types';

const MODELS: Omit<ModelInfo, 'available'>[] = [
  { id: 'anthropic/claude-sonnet-4-20250514', provider: 'anthropic', model: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (Anthropic)', vision: true },
  { id: 'anthropic/claude-3-5-sonnet-20241022', provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Anthropic)', vision: true },
  { id: 'anthropic/claude-3-7-sonnet-20250219', provider: 'anthropic', model: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet (Anthropic)', vision: true },
  { id: 'anthropic/claude-3-haiku-20240307', provider: 'anthropic', model: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku (Anthropic)', vision: true },
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

      const content: Array<Record<string, unknown>> = [];
      if (useVision) {
        for (const img of allImages) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mimeType,
              data: img.base64,
            },
          });
        }
      }
      content.push({ type: 'text', text: prompt });

      const body = {
        model: config.model,
        max_tokens: opts.maxTokens ?? 4096,
        messages: [{ role: 'user', content }],
        temperature: opts.temperature ?? 0.4,
      };

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Anthropic API error (${res.status}): ${err}`);
      }

      const data = await res.json();
      // Anthropic returns content as array of blocks
      const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
      return textBlock?.text ?? '{}';
    },
  };
}

export const anthropicProvider: LLMProviderFactory = {
  provider: 'anthropic',
  createClient,
  listModels(): ModelInfo[] {
    const available = !!process.env.ANTHROPIC_API_KEY;
    return MODELS.map(m => ({ ...m, available }));
  },
};

