'use strict';

const OpenAICompatibleClient = require('../openai-compatible-client');

class MistralClient extends OpenAICompatibleClient {
  constructor({ apiKey, model = 'mistral-large-latest' } = {}) {
    super({
      apiKey,
      model,
      host: 'api.mistral.ai',
      path: '/v1/chat/completions',
      providerName: 'mistral',
    });
  }
}

MistralClient.providerName = 'mistral';
MistralClient.envKey = 'API_KEY_MISTRAL';
MistralClient.modelPrefixes = ['mistral-', 'mixtral-', 'magistral-', 'codestral-', 'open-mistral-', 'open-mixtral-', 'ministral-'];
MistralClient.defaultModel = 'mistral-large-latest';
MistralClient.curatedModels = [
  { id: 'mistral-large-latest', label: 'Mistral Large' },
  { id: 'mistral-small-latest', label: 'Mistral Small' },
  { id: 'codestral-latest', label: 'Codestral' },
];

module.exports = MistralClient;
