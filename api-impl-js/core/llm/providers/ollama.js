'use strict';

const OpenAICompatibleClient = require('../openai-compatible-client');

/**
 * Ollama runs locally and exposes an OpenAI-compatible endpoint at
 * `/v1/chat/completions` on the configured host (default localhost:11434).
 *
 * No API key is required. To select Ollama via model-prefix inference,
 * use `ollama/<model>` (e.g. `ollama/llama3.2`); the prefix is stripped
 * before being sent to the local server.
 */
class OllamaClient extends OpenAICompatibleClient {
  constructor({ model = 'llama3.2', host: ollamaHost } = {}) {
    const url = parseHost(ollamaHost || process.env.OLLAMA_HOST || 'http://localhost:11434');
    const cleanModel = stripOllamaPrefix(model);
    super({
      apiKey: undefined,
      requireApiKey: false,
      model: cleanModel,
      host: url.host,
      port: url.port,
      protocol: url.protocol,
      path: '/v1/chat/completions',
      providerName: 'ollama',
    });
  }
}

function parseHost(raw) {
  try {
    const parsed = new URL(raw);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80),
      protocol: parsed.protocol === 'https:' ? 'https' : 'http',
    };
  } catch {
    return { host: 'localhost', port: 11434, protocol: 'http' };
  }
}

function stripOllamaPrefix(model) {
  return model.startsWith('ollama/') ? model.slice('ollama/'.length) : model;
}

OllamaClient.providerName = 'ollama';
OllamaClient.envKey = null; // no key required
OllamaClient.modelPrefixes = ['ollama/'];
OllamaClient.defaultModel = 'llama3.2';
OllamaClient.curatedModels = [
  { id: 'ollama/llama3.2', label: 'Llama 3.2 (local)' },
  { id: 'ollama/llama3.1', label: 'Llama 3.1 (local)' },
  { id: 'ollama/mistral', label: 'Mistral (local)' },
  { id: 'ollama/qwen2.5', label: 'Qwen 2.5 (local)' },
];

module.exports = OllamaClient;
