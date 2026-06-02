/**
 * Google Gemini Provider — Gemini 2.0 / 1.5 with vision support.
 * Uses raw fetch against the Gemini generateContent API.
 */

import { VISION_NODES, type LLMClient, type LLMCallOpts, type LLMProviderFactory, type ModelInfo, type ImagePayload } from './types';

const MODELS: Omit<ModelInfo, 'available'>[] = [
  { id: 'google/gemini-2.0-flash', provider: 'google', model: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Google)', vision: true },
  { id: 'google/gemini-2.5-flash-preview-05-20', provider: 'google', model: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash (Google)', vision: true },
  { id: 'google/gemini-2.5-pro-preview-05-06', provider: 'google', model: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro (Google)', vision: true },
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

      // Gemini uses a "parts" array inside contents
      const parts: Array<Record<string, unknown>> = [];
      if (useVision) {
        for (const img of allImages) {
          parts.push({
            inline_data: {
              mime_type: img.mimeType,
              data: img.base64,
            },
          });
        }
      }
      parts.push({ text: prompt });

      const body = {
        contents: [{ parts }],
        generationConfig: {
          temperature: opts.temperature ?? 0.4,
          maxOutputTokens: opts.maxTokens ?? 4096,
        },
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Google Gemini API error (${res.status}): ${err}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return text ?? '{}';
    },
  };
}

export const googleProvider: LLMProviderFactory = {
  provider: 'google',
  createClient,
  listModels(): ModelInfo[] {
    const available = !!process.env.GOOGLE_AI_API_KEY;
    return MODELS.map(m => ({ ...m, available }));
  },
};

