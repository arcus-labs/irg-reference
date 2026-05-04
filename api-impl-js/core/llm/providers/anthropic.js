'use strict';

const https = require('https');

/**
 * Anthropic Messages API client.
 *
 * Uses the native /v1/messages endpoint. Adapts the response to match the
 * common `{ content, usage }` shape. Anthropic's `usage` exposes
 * `input_tokens` and `output_tokens` directly; we map them to the standard
 * prompt/completion/total naming used elsewhere.
 *
 * Structured output (`jsonSchema`) is not natively supported via a
 * `response_format` param on Anthropic — the recommended pattern is
 * tool-use forcing or prompt instruction. For simplicity we drop the
 * schema and rely on prompt-level JSON instructions; this matches how
 * Anthropic is most commonly used in this codebase already.
 */
class AnthropicClient {
  constructor({ apiKey, model = 'claude-sonnet-4-5-20250929' } = {}) {
    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.host = 'api.anthropic.com';
    this.path = '/v1/messages';
  }

  async call(prompt, opts = {}) {
    const temperature = opts.temperature ?? 0.7;
    const maxTokens = opts.maxTokens ?? 8192;

    const requestBody = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    };

    const requestBodyStr = JSON.stringify(requestBody);

    const options = {
      hostname: this.host,
      port: 443,
      path: this.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBodyStr),
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`anthropic API error ${res.statusCode}: ${data}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            // content is an array of blocks; concatenate text blocks
            const content = Array.isArray(parsed.content)
              ? parsed.content
                  .filter((block) => block.type === 'text')
                  .map((block) => block.text)
                  .join('')
              : '';
            const usage = parsed.usage || {};
            const inputTokens = usage.input_tokens || 0;
            const outputTokens = usage.output_tokens || 0;
            resolve({
              content,
              usage: {
                prompt_tokens: inputTokens,
                completion_tokens: outputTokens,
                total_tokens: inputTokens + outputTokens,
                reasoning_tokens: 0,
              },
            });
          } catch (err) {
            reject(new Error(`Failed to parse anthropic response: ${err.message}`));
          }
        });
      });
      req.on('error', reject);
      req.write(requestBodyStr);
      req.end();
    });
  }
}

AnthropicClient.providerName = 'anthropic';
AnthropicClient.envKey = 'API_KEY_ANTHROPIC';
AnthropicClient.modelPrefixes = ['claude-'];
AnthropicClient.defaultModel = 'claude-sonnet-4-5-20250929';
AnthropicClient.curatedModels = [
  { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

module.exports = AnthropicClient;
