'use strict';

const https = require('https');

/**
 * Google Gemini client (native generativelanguage.googleapis.com API).
 *
 * Adapts the response to the common `{ content, usage }` shape. Gemini
 * exposes `usageMetadata` with `promptTokenCount` and `candidatesTokenCount`.
 */
class GoogleClient {
  constructor({ apiKey, model = 'gemini-2.5-flash' } = {}) {
    if (!apiKey) {
      throw new Error('Google API key is required');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.host = 'generativelanguage.googleapis.com';
  }

  async call(prompt, opts = {}) {
    const temperature = opts.temperature ?? 0.7;
    const maxTokens = opts.maxTokens ?? 8192;

    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    };

    if (opts.jsonSchema) {
      // Gemini supports response schema via responseMimeType + responseSchema.
      // We pass through if a schema is provided; the caller knows their schema
      // is in JSON-Schema-ish shape.
      requestBody.generationConfig.responseMimeType = 'application/json';
      if (opts.jsonSchema.schema) {
        requestBody.generationConfig.responseSchema = opts.jsonSchema.schema;
      }
    }

    const requestBodyStr = JSON.stringify(requestBody);
    const path = `/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const options = {
      hostname: this.host,
      port: 443,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBodyStr),
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`google API error ${res.statusCode}: ${data}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const candidate = parsed.candidates?.[0];
            const parts = candidate?.content?.parts || [];
            const content = parts.map((p) => p.text || '').join('');
            const usage = parsed.usageMetadata || {};
            const inputTokens = usage.promptTokenCount || 0;
            const outputTokens = usage.candidatesTokenCount || 0;
            const totalTokens = usage.totalTokenCount || (inputTokens + outputTokens);
            resolve({
              content,
              usage: {
                prompt_tokens: inputTokens,
                completion_tokens: outputTokens,
                total_tokens: totalTokens,
                reasoning_tokens: usage.thoughtsTokenCount || 0,
              },
            });
          } catch (err) {
            reject(new Error(`Failed to parse google response: ${err.message}`));
          }
        });
      });
      req.on('error', reject);
      req.write(requestBodyStr);
      req.end();
    });
  }
}

GoogleClient.providerName = 'google';
GoogleClient.envKey = 'API_KEY_GOOGLE';
GoogleClient.modelPrefixes = ['gemini-'];
GoogleClient.defaultModel = 'gemini-2.5-flash';
GoogleClient.curatedModels = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
];

module.exports = GoogleClient;
