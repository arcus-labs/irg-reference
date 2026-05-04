import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import GoogleSignInButton from '@/components/GoogleSignInButton';
import SignOutButton from '@/components/SignOutButton';
import { isEmailAllowed } from '@/lib/access-control';
import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string | string[] }>;
}) {
  const session = await getServerSession(authOptions);
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const errorParam = resolvedSearchParams.error;
  const error = Array.isArray(errorParam) ? errorParam[0] : errorParam;
  const sessionEmail = session?.user?.email;
  const hasAllowedSession = isEmailAllowed(sessionEmail);
  const showAccessDenied = error === 'AccessDenied' || (!!sessionEmail && !hasAllowedSession);

  if (hasAllowedSession) {
    redirect('/');
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--paper)',
        color: 'var(--ink)',
        padding: '2rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          background: 'var(--paper-warm)',
          border: '1px solid var(--rule)',
          borderRadius: '4px',
          padding: '2rem',
          boxShadow: 'var(--shadow-soft)',
        }}
      >
        <p style={{ fontSize: '0.9rem', color: 'var(--stone)', marginBottom: '0.75rem' }}>
          ARCUS LABS
        </p>
        <div
          style={{
            fontSize: 'clamp(2rem, 4vw, 2.6rem)',
            fontFamily: 'var(--serif)',
            fontWeight: 400
          }}
        >
          Trace Navigator
          <p style={{ fontSize: '1.5rem'}}>Sign In</p>
        </div>
        <p style={{ color: 'var(--stone)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
          Access is restricted to approved Arcus accounts. Use your Arcus Google account to continue.
        </p>
        {showAccessDenied && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.9rem 1rem',
              borderRadius: '4px',
              border: '1px solid #c67b5c',
              background: 'rgba(198, 123, 92, 0.08)',
              color: 'var(--ink)',
            }}
          >
            <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Access denied</p>
            <p style={{ color: 'var(--stone)', lineHeight: 1.6, margin: 0 }}>
              {sessionEmail
                ? `${sessionEmail} is signed in, but this app is limited to approved Arcus accounts.`
                : 'That Google account is not approved for this app.'}
            </p>
          </div>
        )}
        {sessionEmail && !hasAllowedSession && (
          <div style={{ marginBottom: '1rem' }}>
            <SignOutButton />
          </div>
        )}
        <GoogleSignInButton />
      </div>
    </main>
  );
}