'use strict';

/**
 * Provider Registry
 *
 * Single source of truth for which LLM providers are supported, which env
 * variable holds each one's API key, and how to map a model name back to
 * a provider when the caller doesn't specify one explicitly.
 *
 * Two layers of "enabled":
 *   - configured: an API key for the provider is present in the environment
 *     (or the provider is keyless, like Ollama)
 *   - enabled: the provider is allowed by the operator. Controlled by the
 *     LLM_PROVIDERS_ENABLED env var. If unset, every configured provider
 *     is enabled. If set, only the listed providers are enabled (and they
 *     must also be configured).
 *
 * Order of providers in LLM_PROVIDERS_ENABLED is preserved — the first
 * enabled provider becomes the default when no provider is specified
 * and no model-prefix match is found.
 */

const GroqClient = require('./providers/groq');
const OpenAIClient = require('./providers/openai');
const AnthropicClient = require('./providers/anthropic');
const MistralClient = require('./providers/mistral');
const GoogleClient = require('./providers/google');
const TogetherClient = require('./providers/together');
const OllamaClient = require('./providers/ollama');

// Order here is the natural fallback priority when no LLM_PROVIDERS_ENABLED
// is set and no key-bearing provider is otherwise selected. We default to
// Groq first (matches the existing demo behavior).
const ALL_PROVIDERS = [
  GroqClient,
  OpenAIClient,
  AnthropicClient,
  MistralClient,
  GoogleClient,
  TogetherClient,
  OllamaClient,
];

const PROVIDER_BY_NAME = Object.fromEntries(ALL_PROVIDERS.map((p) => [p.providerName, p]));

function parseEnabledList(raw) {
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isProviderConfigured(ProviderClass, env) {
  if (!ProviderClass.envKey) return true; // keyless (e.g. ollama)
  return Boolean(env[ProviderClass.envKey]);
}

/**
 * Return the ordered list of provider classes that are both:
 *   - configured (env key present, or keyless)
 *   - enabled by LLM_PROVIDERS_ENABLED (or all, if unset)
 *
 * @param {object} env  process.env-like object
 * @returns {Array}     provider classes in display order
 */
function getEnabledProviders(env = process.env) {
  const explicit = parseEnabledList(env.LLM_PROVIDERS_ENABLED);

  if (explicit) {
    return explicit
      .map((name) => PROVIDER_BY_NAME[name])
      .filter(Boolean)
      .filter((cls) => isProviderConfigured(cls, env));
  }

  return ALL_PROVIDERS.filter((cls) => isProviderConfigured(cls, env));
}

/**
 * Look up a provider class by name, validating that it is currently enabled.
 * @returns {Class|null}
 */
function getProviderByName(name, env = process.env) {
  if (!name) return null;
  const target = PROVIDER_BY_NAME[String(name).toLowerCase()];
  if (!target) return null;
  const enabled = getEnabledProviders(env);
  return enabled.includes(target) ? target : null;
}

/**
 * Infer a provider from a model string by checking each enabled provider's
 * registered model prefixes. Returns the matched class, or null if no
 * prefix matches.
 */
function inferProviderFromModel(model, env = process.env) {
  if (!model) return null;
  const lower = String(model).toLowerCase();
  const enabled = getEnabledProviders(env);
  for (const cls of enabled) {
    const prefixes = cls.modelPrefixes || [];
    if (prefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()))) {
      return cls;
    }
  }
  return null;
}

/**
 * Return the default provider class — the first enabled provider, or null
 * if no providers are enabled.
 */
function getDefaultProvider(env = process.env) {
  const enabled = getEnabledProviders(env);
  return enabled[0] || null;
}

/**
 * Build the metadata payload that the API server returns from /providers.
 * Each provider entry includes its name, default model, and curated model
 * list, in the order configured by the operator.
 */
function describeEnabledProviders(env = process.env) {
  return getEnabledProviders(env).map((cls) => ({
    name: cls.providerName,
    defaultModel: cls.defaultModel,
    models: cls.curatedModels || [],
    requiresApiKey: Boolean(cls.envKey),
    keyless: !cls.envKey,
  }));
}

module.exports = {
  ALL_PROVIDERS,
  PROVIDER_BY_NAME,
  getEnabledProviders,
  getProviderByName,
  inferProviderFromModel,
  getDefaultProvider,
  describeEnabledProviders,
};
