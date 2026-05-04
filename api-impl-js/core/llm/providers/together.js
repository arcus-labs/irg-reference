'use strict';

const OpenAICompatibleClient = require('../openai-compatible-client');

class TogetherClient extends OpenAICompatibleClient {
  constructor({ apiKey, model = 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo' } = {}) {
    super({
      apiKey,
      model,
      host: 'api.together.xyz',
      path: '/v1/chat/completions',
      providerName: 'together',
    });
  }
}

TogetherClient.providerName = 'together';
TogetherClient.envKey = 'API_KEY_TOGETHER';
// Together hosts many model families; we route on these owner prefixes.
TogetherClient.modelPrefixes = ['meta-llama/', 'mistralai/', 'Qwen/', 'deepseek-ai/', 'NousResearch/', 'together/'];
TogetherClient.defaultModel = 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo';
TogetherClient.curatedModels = [
  { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', label: 'Llama 3.1 70B Turbo' },
  { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', label: 'Llama 3.1 8B Turbo' },
  { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', label: 'Mixtral 8x7B' },
  { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen 2.5 72B Turbo' },
];

module.exports = TogetherClient;
