import { buildAuthOptions } from './auth-options';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('buildAuthOptions', () => {
  test('configures Google as the only provider', () => {
    const options = buildAuthOptions({
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      NEXTAUTH_SECRET: 'secret',
    });

    expect(options.providers).toHaveLength(1);
    expect(options.providers?.[0]?.id).toBe('google');
    expect(options.pages?.signIn).toBe('/login');
    expect(options.pages?.error).toBe('/login');
    expect(options.session?.strategy).toBe('jwt');
    expect(options.secret).toBe('secret');
  });

  test('allows accounts in a configured allowed domain to sign in', async () => {
    const options = buildAuthOptions({
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      NEXTAUTH_SECRET: 'secret',
      TRACE_NAVIGATOR_ALLOWED_DOMAINS: 'example.com',
    });

    await expect(
      options.callbacks?.signIn?.({
        user: { email: 'analyst@example.com' },
        account: null,
        profile: { email: 'analyst@example.com', email_verified: true },
        email: undefined,
        credentials: undefined,
      } as any)
    ).resolves.toBe(true);
  });

  test('rejects accounts outside the configured allowlist', async () => {
    const options = buildAuthOptions({
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      NEXTAUTH_SECRET: 'secret',
      TRACE_NAVIGATOR_ALLOWED_DOMAINS: 'example.com',
    });

    await expect(
      options.callbacks?.signIn?.({
        user: { email: 'outside@gmail.com' },
        account: null,
        profile: { email: 'outside@gmail.com', email_verified: true },
        email: undefined,
        credentials: undefined,
      } as any)
    ).resolves.toBe(false);
  });

  test('rejects all sign-ins when no allowlist is configured', async () => {
    const options = buildAuthOptions({
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      NEXTAUTH_SECRET: 'secret',
    });

    await expect(
      options.callbacks?.signIn?.({
        user: { email: 'anyone@example.com' },
        account: null,
        profile: { email: 'anyone@example.com', email_verified: true },
        email: undefined,
        credentials: undefined,
      } as any)
    ).resolves.toBe(false);
  });

  test('allows explicitly allowlisted external accounts to sign in', async () => {
    const options = buildAuthOptions({
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      NEXTAUTH_SECRET: 'secret',
      TRACE_NAVIGATOR_ALLOWED_EMAILS: 'outside@gmail.com',
    });

    await expect(
      options.callbacks?.signIn?.({
        user: { email: 'outside@gmail.com' },
        account: null,
        profile: { email: 'outside@gmail.com', email_verified: true },
        email: undefined,
        credentials: undefined,
      } as any)
    ).resolves.toBe(true);
  });

  test('falls back to AUTH_SECRET when NEXTAUTH_SECRET is absent', () => {
    const options = buildAuthOptions({
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      AUTH_SECRET: 'fallback-secret',
    });

    expect(options.secret).toBe('fallback-secret');
  });

  test('loads google auth values from the repo-root .env when process.env is missing them', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-nav-auth-'));
    const traceNavigatorRoot = path.join(tempRoot, 'trace-navigator');
    fs.mkdirSync(traceNavigatorRoot, { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, '.env'),
      [
        'GOOGLE_CLIENT_ID=repo-google-client-id',
        'GOOGLE_CLIENT_SECRET=repo-google-client-secret',
        'NEXTAUTH_SECRET=repo-nextauth-secret',
      ].join('\n') + '\n'
    );

    const previousCwd = process.cwd();
    const originalEnv = {
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
      AUTH_SECRET: process.env.AUTH_SECRET,
    };

    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.AUTH_SECRET;
    process.chdir(traceNavigatorRoot);

    try {
      const options = buildAuthOptions();

      expect(options.secret).toBe('repo-nextauth-secret');
      expect(options.providers?.[0]?.options?.clientId).toBe('repo-google-client-id');
      expect(options.providers?.[0]?.options?.clientSecret).toBe('repo-google-client-secret');
    } finally {
      process.chdir(previousCwd);

      if (originalEnv.GOOGLE_CLIENT_ID === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = originalEnv.GOOGLE_CLIENT_ID;

      if (originalEnv.GOOGLE_CLIENT_SECRET === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = originalEnv.GOOGLE_CLIENT_SECRET;

      if (originalEnv.NEXTAUTH_SECRET === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = originalEnv.NEXTAUTH_SECRET;

      if (originalEnv.AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = originalEnv.AUTH_SECRET;

      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});