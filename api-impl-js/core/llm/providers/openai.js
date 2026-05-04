'use strict';

const OpenAICompatibleClient = require('../openai-compatible-client');

class OpenAIClient extends OpenAICompatibleClient {
  constructor({ apiKey, model = 'gpt-4o-mini' } = {}) {
    super({
      apiKey,
      model,
      host: 'api.openai.com',
      path: '/v1/chat/completions',
      providerName: 'openai',
    });
  }
}

OpenAIClient.providerName = 'openai';
OpenAIClient.envKey = 'API_KEY_OPENAI';
OpenAIClient.modelPrefixes = ['gpt-', 'o1', 'o3', 'o4', 'chatgpt-'];
OpenAIClient.defaultModel = 'gpt-4o-mini';
OpenAIClient.curatedModels = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'o1', label: 'o1' },
  { id: 'o3-mini', label: 'o3-mini' },
];

module.exports = OpenAIClient;
