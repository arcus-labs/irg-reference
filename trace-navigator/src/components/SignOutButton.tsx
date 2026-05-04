'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';

export default function SignOutButton() {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    await signOut({ callbackUrl: '/login' });
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        width: '100%',
        background: 'transparent',
        color: 'var(--ink)',
        border: '1px solid var(--rule)',
        borderRadius: '3px',
        padding: '0.9rem 1.1rem',
        fontSize: '0.95rem',
        fontWeight: 600,
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.75 : 1,
      }}
    >
      {loading ? 'Signing out…' : 'Sign out and try another account'}
    </button>
  );
}