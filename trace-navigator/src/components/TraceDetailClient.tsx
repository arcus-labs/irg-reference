'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TraceNavigator from '@/components/TraceNavigator';

interface TraceDetailClientProps {
  filename: string;
}

export default function TraceDetailClient({ filename }: TraceDetailClientProps) {
  const [trace, setTrace] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  const backButtonStyle = {
    color: 'var(--accent)',
    background: 'var(--nav-surface)',
    border: '1px solid var(--rule)',
    borderRadius: '999px',
    padding: '0.45rem 0.8rem',
    cursor: 'pointer',
    fontSize: '0.88rem',
    fontFamily: 'var(--mono)',
    fontWeight: 500,
    textDecoration: 'none',
    transition: 'color 0.2s, background-color 0.2s, border-color 0.2s',
    boxShadow: 'var(--shadow-soft)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
  } as const;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const loadTrace = async () => {
      try {
        const res = await fetch(`/api/traces/${encodeURIComponent(filename)}`);
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        if (!res.ok) {
          setError('Failed to load trace');
          return;
        }
        const data = await res.json();
        setTrace(data);
      } catch (error) {
        console.error('Failed to load trace:', error);
        setError('Error loading trace');
      } finally {
        setLoading(false);
      }
    };

    loadTrace();
  }, [filename, mounted]);

  // Don't render anything until mounted to avoid hydration mismatch
  if (!mounted) {
    return null;
  }

  if (loading || !trace) {
    return (
      <main style={{ background: 'var(--paper)', color: 'var(--ink)', minHeight: '100vh', padding: '2rem', display: 'flex', justifyContent: 'center' }}>
        <div style={{ maxWidth: '1200px', width: '100%' }}>
          {error && (
            <>
              <button
                onClick={() => router.push('/')}
                style={{ ...backButtonStyle, marginBottom: '1rem' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--accent-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--accent)';
                }}
              >
                ← Back to Home
              </button>
              <p style={{ color: 'var(--code-keyword)' }}>{error}</p>
            </>
          )}
          {!error && <p style={{ color: 'var(--stone)' }}>Loading trace...</p>}
        </div>
      </main>
    );
  }

  return (
    <main style={{ background: 'var(--paper)', color: 'var(--ink)', minHeight: '100vh', padding: '2rem', overflowX: 'auto', marginTop: '5rem'  }}>
      <button
        onClick={() => router.push('/')}
        style={{
          ...backButtonStyle,
          position: 'fixed',
          top: '7.35rem',
          left: '80px',
          zIndex: 50,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--accent-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--accent)';
        }}
      >
        ← Back to Home
      </button>

      <div style={{ maxWidth: '1400px', width: '100%', margin: '0 auto' }}>

        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.4rem)', fontFamily: 'var(--serif)', fontWeight: 400, marginBottom: '0.5rem', color: 'var(--ink)' }}>Trace Details</h1>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.88rem', color: 'var(--stone)' }}>{decodeURIComponent(filename)}</p>
        </div>

        <div style={{ width: '100%', overflowX: 'auto' }}>
          <TraceNavigator trace={trace} />
        </div>
      </div>
    </main>
  );
}

