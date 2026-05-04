'use strict';

/**
 * LLM Client Factory
 *
 * createLLMClient({ provider?, model?, env? }) → instance of the matching
 * provider client. Both `provider` and `model` are optional:
 *
 *   - If `provider` is given, it must be enabled (configured + allow-listed
 *     by LLM_PROVIDERS_ENABLED). The provider's default model is used if
 *     `model` is omitted.
 *   - If only `model` is given, we infer the provider from the model's
 *     prefix (e.g. `claude-*` → anthropic). If no prefix matches, we fall
 *     back to the default provider.
 *   - If neither is given, we use the default provider with its default
 *     model.
 */

const {
  getEnabledProviders,
  getProviderByName,
  inferProviderFromModel,
  getDefaultProvider,
  describeEnabledProviders,
} = require('./provider-registry');

function createLLMClient({ provider, model, env = process.env } = {}) {
  let ProviderClass = null;

  if (provider) {
    ProviderClass = getProviderByName(provider, env);
    if (!ProviderClass) {
      throw new Error(
        `Provider "${provider}" is not enabled. ` +
        `Enabled providers: ${getEnabledProviders(env).map((p) => p.providerName).join(', ') || '(none)'}`
      );
    }
  } else if (model) {
    ProviderClass = inferProviderFromModel(model, env);
  }

  if (!ProviderClass) {
    ProviderClass = getDefaultProvider(env);
  }

  if (!ProviderClass) {
    throw new Error(
      'No LLM providers are enabled. Set at least one provider API key ' +
      '(e.g. API_KEY_GROQ) and optionally configure LLM_PROVIDERS_ENABLED.'
    );
  }

  const apiKey = ProviderClass.envKey ? env[ProviderClass.envKey] : undefined;
  const finalModel = model || ProviderClass.defaultModel;

  return new ProviderClass({ apiKey, model: finalModel });
}

module.exports = {
  createLLMClient,
  getEnabledProviders,
  describeEnabledProviders,
};
