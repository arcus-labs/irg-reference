import { getAllowedDomains, getAllowedEmails, isEmailAllowed } from './access-control';

describe('access control', () => {
  test('rejects all emails when no allowlist is configured', () => {
    const env = {};
    expect(isEmailAllowed('person@example.com', env)).toBe(false);
    expect(isEmailAllowed('person@arcusx.ai', env)).toBe(false);
  });

  test('matches emails case-insensitively', () => {
    const env = { TRACE_NAVIGATOR_ALLOWED_DOMAINS: 'example.com' };
    expect(isEmailAllowed('Person@Example.COM', env)).toBe(true);
  });

  test('allows explicitly configured external emails', () => {
    const env = { TRACE_NAVIGATOR_ALLOWED_EMAILS: 'outside@gmail.com, second@example.com' };

    expect(getAllowedEmails(env)).toEqual(['outside@gmail.com', 'second@example.com']);
    expect(isEmailAllowed('outside@gmail.com', env)).toBe(true);
  });

  test('supports configuring allowed domains', () => {
    const env = { TRACE_NAVIGATOR_ALLOWED_DOMAINS: 'example.com, partner.org' };

    expect(getAllowedDomains(env)).toEqual(['example.com', 'partner.org']);
    expect(isEmailAllowed('member@partner.org', env)).toBe(true);
    expect(isEmailAllowed('outsider@other.org', env)).toBe(false);
  });

  test('rejects malformed email values', () => {
    const env = { TRACE_NAVIGATOR_ALLOWED_DOMAINS: 'example.com' };
    expect(isEmailAllowed(undefined, env)).toBe(false);
    expect(isEmailAllowed('not-an-email', env)).toBe(false);
    expect(isEmailAllowed('@example.com', env)).toBe(false);
  });
});