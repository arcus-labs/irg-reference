'use client';

import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import type { Scenario } from '@/lib/scenarios';

interface Props {
  scenario: Scenario;
  /** optional bullet list of what the live version will do */
  plannedCapabilities?: string[];
}

export default function ScenarioComingSoon({ scenario, plannedCapabilities }: Props) {
  const router = useRouter();
  const backHref = `/${scenario.vertical}`;

  return (
    <main style={{ background: 'var(--paper)', color: 'var(--ink)', minHeight: '100vh', padding: '2rem', overflowX: 'auto', marginTop: '5rem' }}>
      <button
        onClick={() => router.push(backHref)}
        style={{
          color: 'var(--accent)',
          background: 'var(--nav-surface)',
          border: '1px solid var(--rule)',
          borderRadius: '999px',
          padding: '0.45rem 0.8rem',
          cursor: 'pointer',
          fontSize: '0.85rem',
          fontFamily: 'var(--mono)',
          fontWeight: 500,
          boxShadow: 'var(--shadow-soft)',
          position: 'fixed',
          top: '7.35rem',
          left: '80px',
          zIndex: 50,
        }}
      >
        ← Back to {scenario.vertical}
      </button>

      <div style={{ maxWidth: '760px', margin: '0 auto' }}>
        <div style={{ padding: '1.5rem 0', marginBottom: '1rem' }}>
          <Navigation />
        </div>

        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '0.2rem 0.6rem',
              borderRadius: '2px',
              background: 'var(--paper)',
              border: '1px solid var(--rule)',
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--stone)',
              marginBottom: '1rem',
            }}
          >
            Planned
          </span>
          <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', fontFamily: 'var(--serif)', fontWeight: 400, marginBottom: '0.5rem', color: 'var(--ink)' }}>
            {scenario.title}
          </h1>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '0.88rem', color: 'var(--stone)' }}>
            {scenario.subtitle}
          </p>
        </div>

        <div style={{ background: 'var(--paper-warm)', borderRadius: '4px', padding: '2rem', borderLeft: '4px solid var(--stone-light)' }}>
          <p style={{ fontSize: '1.02rem', lineHeight: 1.7, color: 'var(--ink)', marginBottom: '1.5rem' }}>
            {scenario.description}
          </p>

          {scenario.regulations.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontSize: '0.78rem', color: 'var(--stone)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Reasons over
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {scenario.regulations.map((r) => (
                  <span
                    key={r}
                    style={{
                      padding: '0.18rem 0.5rem',
                      background: 'var(--paper)',
                      border: '1px solid var(--rule)',
                      borderRadius: '2px',
                      fontFamily: 'var(--mono)',
                      fontSize: '0.78rem',
                      color: 'var(--ink)',
                    }}
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {plannedCapabilities && plannedCapabilities.length > 0 && (
            <div>
              <p style={{ fontSize: '0.78rem', color: 'var(--stone)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Planned capabilities
              </p>
              <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', color: 'var(--ink)' }}>
                {plannedCapabilities.map((c, i) => (
                  <li key={i} style={{ fontSize: '0.95rem', lineHeight: 1.5 }}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: '2rem', paddingTop: '1.25rem', borderTop: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--stone)', fontSize: '0.88rem' }}>
            <span aria-hidden="true">🚧</span>
            <span>This scenario is on the IRG roadmap but not yet implemented. The Reg E adjudication demo on this site shows the structural shape this scenario will follow.</span>
          </div>
        </div>
      </div>
    </main>
  );
}
