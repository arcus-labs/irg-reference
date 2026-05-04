import type { AuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { isEmailAllowed } from './access-control';
import { loadServerEnv } from './server-env';

type EnvSource = Partial<Record<string, string | undefined>>;

export function buildAuthOptions(env: EnvSource = process.env): AuthOptions {
  if (
    env === process.env &&
    (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !(env.NEXTAUTH_SECRET || env.AUTH_SECRET))
  ) {
    loadServerEnv(process.cwd(), ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
    env = process.env;
  }

  return {
    secret: env.NEXTAUTH_SECRET || env.AUTH_SECRET,
    providers: [
      GoogleProvider({
        clientId: env.GOOGLE_CLIENT_ID || '',
        clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      }),
    ],
    pages: {
      signIn: '/login',
      error: '/login',
    },
    session: {
      strategy: 'jwt',
    },
    callbacks: {
      async signIn({ user, profile }) {
        const googleProfile = profile as
          | { email?: string; email_verified?: boolean }
          | undefined;
        const email = user.email ?? googleProfile?.email;
        const emailVerified =
          typeof googleProfile?.email_verified === 'boolean' ? googleProfile.email_verified : true;

        return emailVerified && isEmailAllowed(email, env);
      },
    },
  };
}

export const authOptions = buildAuthOptions();