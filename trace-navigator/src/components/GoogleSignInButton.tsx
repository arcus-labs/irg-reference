'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function GoogleSignInButton({
  label = 'Continue with Google',
}: {
  label?: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    await signIn('google', { callbackUrl: '/' }, { prompt: 'select_account' });
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        width: '100%',
        background: 'var(--accent)',
        color: 'var(--paper)',
        border: 'none',
        borderRadius: '3px',
        padding: '0.9rem 1.1rem',
        fontSize: '0.95rem',
        fontWeight: 600,
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.75 : 1,
      }}
    >
      {loading ? 'Redirecting to Google…' : label}
    </button>
  );
}