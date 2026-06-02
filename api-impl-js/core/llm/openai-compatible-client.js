'use strict';

const https = require('https');
const http = require('http');

/**
 * OpenAI-Compatible LLM Client (base)
 *
 * Implements the standard OpenAI Chat Completions wire format. Used as the
 * base for any provider that exposes that interface: Groq, OpenAI, Together,
 * Mistral, Ollama.
 *
 * Subclasses (or the factory) provide:
 *   - host       (e.g. 'api.openai.com')
 *   - path       (default '/v1/chat/completions')
 *   - apiKey     (optional — Ollama doesn't need one)
 *   - protocol   ('https' | 'http' — default 'https'; Ollama uses 'http')
 *   - port       (optional override)
 *
 * The `call(prompt, opts)` interface returns `{ content, usage }` matching
 * every other provider client in this codebase.
 */
class OpenAICompatibleClient {
  constructor({
    apiKey,
    model,
    host,
    path = '/v1/chat/completions',
    protocol = 'https',
    port,
    requireApiKey = true,
    providerName = 'openai-compatible',
  }) {
    if (requireApiKey && !apiKey) {
      throw new Error(`${providerName} API key is required`);
    }
    if (!host) {
      throw new Error(`${providerName} host is required`);
    }
    if (!model) {
      throw new Error(`${providerName} model is required`);
    }

    this.apiKey = apiKey;
    this.model = model;
    this.host = host;
    this.path = path;
    this.protocol = protocol;
    this.port = port ?? (protocol === 'https' ? 443 : 80);
    this.providerName = providerName;
  }

  async call(prompt, opts = {}) {
    const temperature = opts.temperature ?? 0.7;
    const maxTokens = opts.maxTokens ?? 8192;
    const jsonSchema = opts.jsonSchema;
    // Determinism control. OpenAI-spec providers (Groq, OpenAI, OpenRouter,
    // many others) accept `seed` and `top_p`. Forwarding them lets a caller
    // pin output bit-identically across runs at a fixed model snapshot.
    const seed = opts.seed;
    const topP = opts.topP;

    const requestBody = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
    };
    if (Number.isFinite(seed)) requestBody.seed = seed;
    if (Number.isFinite(topP)) requestBody.top_p = topP;

    if (jsonSchema) {
      requestBody.response_format = {
        type: 'json_schema',
        json_schema: jsonSchema,
      };
    }

    const requestBodyStr = JSON.stringify(requestBody);
    const transport = this.protocol === 'http' ? http : https;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBodyStr),
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const options = {
      hostname: this.host,
      port: this.port,
      path: this.path,
      method: 'POST',
      headers,
    };

    return new Promise((resolve, reject) => {
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`${this.providerName} API error ${res.statusCode}: ${data}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content || '';
            const usage = parsed.usage || {};
            resolve({
              content,
              usage: {
                prompt_tokens: usage.prompt_tokens || 0,
                completion_tokens: usage.completion_tokens || 0,
                total_tokens: usage.total_tokens || 0,
                reasoning_tokens: usage.reasoning_tokens || 0,
              },
            });
          } catch (err) {
            reject(new Error(`Failed to parse ${this.providerName} response: ${err.message}`));
          }
        });
      });
      req.on('error', reject);
      req.write(requestBodyStr);
      req.end();
    });
  }
}

module.exports = OpenAICompatibleClient;
