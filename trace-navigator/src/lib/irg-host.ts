import { getRequiredServerEnv } from './server-env';

/**
 * Derive the IRG API host (scheme + host[:port]) from the configured
 * IRG_ENDPOINT. The endpoint env var includes a path component
 * (e.g. `…/webhook/irg-process`); routes that hit other paths on the
 * same host can build URLs off this base.
 *
 * Throws if IRG_ENDPOINT is missing or unparseable.
 */
export function getIrgHostBase(): string {
  const irgEndpoint = getRequiredServerEnv('IRG_ENDPOINT');
  let parsed: URL;
  try {
    parsed = new URL(irgEndpoint);
  } catch {
    throw new Error('IRG_ENDPOINT is not a valid URL');
  }
  return `${parsed.protocol}//${parsed.host}`;
}
