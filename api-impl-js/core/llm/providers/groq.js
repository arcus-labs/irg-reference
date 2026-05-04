'use strict';

const OpenAICompatibleClient = require('../openai-compatible-client');

class GroqClient extends OpenAICompatibleClient {
  constructor({ apiKey, model = 'llama-3.3-70b-versatile' } = {}) {
    super({
      apiKey,
      model,
      host: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      providerName: 'groq',
    });
  }
}

GroqClient.providerName = 'groq';
GroqClient.envKey = 'API_KEY_GROQ';
GroqClient.modelPrefixes = []; // catch-all default — no exclusive prefix
GroqClient.defaultModel = 'llama-3.3-70b-versatile';
GroqClient.curatedModels = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
];

module.exports = GroqClient;
