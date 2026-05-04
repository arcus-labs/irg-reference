type EnvSource = Record<string, string | undefined>;

// By default, no email or domain is allowed. Operators MUST configure
// `TRACE_NAVIGATOR_ALLOWED_DOMAINS` and/or `TRACE_NAVIGATOR_ALLOWED_EMAILS`
// to grant access. This avoids accidentally shipping a deployment that
// is open to anyone with a Google account.
function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function parseList(value?: string): string[] {
  if (!value) return [];

  return value
    .split(',')
    .map(normalizeValue)
    .filter(Boolean);
}

export function getAllowedDomains(env: EnvSource = process.env): string[] {
  return parseList(env.TRACE_NAVIGATOR_ALLOWED_DOMAINS);
}

export function getAllowedEmails(env: EnvSource = process.env): string[] {
  return parseList(env.TRACE_NAVIGATOR_ALLOWED_EMAILS);
}

export function isEmailAllowed(
  email: string | null | undefined,
  env: EnvSource = process.env
): boolean {
  if (!email) return false;

  const normalizedEmail = normalizeValue(email);
  const atIndex = normalizedEmail.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) {
    return false;
  }

  if (getAllowedEmails(env).includes(normalizedEmail)) {
    return true;
  }

  const domain = normalizedEmail.slice(atIndex + 1);
  return getAllowedDomains(env).includes(domain);
}