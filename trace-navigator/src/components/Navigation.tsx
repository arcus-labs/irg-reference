'use client';

import { signOut, useSession } from 'next-auth/react';
import ThemeToggle from './ThemeToggle';

const actionButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--accent)',
  background: 'none',
  border: '1px solid var(--rule)',
  borderRadius: '3px',
  padding: '0.45rem 0.7rem',
  fontSize: '0.8rem',
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'none',
  lineHeight: 1.2,
  minWidth: '88px',
} as const;

export default function Navigation() {
  const { data: session, status } = useSession();

  return (
    <nav
      id="arcus-nav"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        background: 'var(--nav-surface)',
        borderRadius: '4px',
        boxShadow: 'var(--shadow-soft)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          boxSizing: 'border-box',
          gap: '1rem',
          padding: '1rem 2rem',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <a
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            textDecoration: 'none',
            cursor: 'pointer',
            flex: '0 0 auto',
          }}
          className="nav-brand"
        >
          <img src="/arcus.logo.jpeg" className="nav-logo" alt="Arcus" style={{ height: '24px', width: 'auto' }} />
          <span className="nav-mark" style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--ink)' }}>
            ARCUS LABS<span className="nav-mark-dot" style={{ color: 'var(--accent)' }}>.</span>
          </span>
        </a>

        <div
          className="nav-links"
          style={{
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginLeft: 'auto',
            flex: '1 1 auto',
          }}
        >
          {status === 'authenticated' && (
            <span style={{ color: 'var(--stone)', fontSize: '0.8rem', fontFamily: 'var(--mono)' }}>
              {session.user?.email}
            </span>
          )}

          <a
            href="/memory"
            style={actionButtonStyle}
          >
            Memory
          </a>

          <a
            href="https://arcusx.ai/schedule-consult.html"
            className="nav-cta"
            style={actionButtonStyle}
          >
            Contact
          </a>

          {status === 'authenticated' && (
            <button onClick={() => signOut({ callbackUrl: '/login' })} style={actionButtonStyle}>
              Sign out
            </button>
          )}

          <ThemeToggle iconOnly />
        </div>
      </div>
    </nav>
  );
}

