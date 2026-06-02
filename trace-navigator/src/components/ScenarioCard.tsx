'use client';

import { useRouter } from 'next/navigation';
import type { Scenario } from '@/lib/scenarios';
import { hrefFor } from '@/lib/scenarios';

interface Props { scenario: Scenario; }

export default function ScenarioCard({ scenario }: Props) {
  const router = useRouter();
  const isLive = scenario.status === 'live';
  const href = hrefFor(scenario);

  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      style={{
        textAlign: 'left',
        background: 'var(--paper-warm)',
        border: '1px solid var(--rule)',
        borderLeft: `4px solid ${isLive ? 'var(--accent)' : 'var(--stone-light)'}`,
        borderRadius: '3px',
        padding: '1.25rem 1.5rem',
        cursor: 'pointer',
        color: 'var(--ink)',
        transition: 'transform 0.15s, box-shadow 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-soft)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h3 style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
          {scenario.title}
        </h3>
        <span
          style={{
            padding: '0.15rem 0.5rem',
            borderRadius: '2px',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            background: isLive ? 'var(--accent)' : 'var(--paper)',
            color: isLive ? 'var(--paper)' : 'var(--stone)',
            border: isLive ? 'none' : '1px solid var(--rule)',
          }}
        >
          {isLive ? 'Beta' : 'Planned'}
        </span>
      </div>
      <p style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--stone)', margin: 0 }}>
        {scenario.subtitle}
      </p>
      <p style={{ fontSize: '0.92rem', lineHeight: 1.55, color: 'var(--ink)', margin: '0.25rem 0 0 0' }}>
        {scenario.description}
      </p>
      {scenario.regulations.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' }}>
          {scenario.regulations.map((r) => (
            <span
              key={r}
              style={{
                padding: '0.15rem 0.45rem',
                background: 'var(--paper)',
                border: '1px solid var(--rule)',
                borderRadius: '2px',
                fontFamily: 'var(--mono)',
                fontSize: '0.72rem',
                color: 'var(--stone)',
              }}
            >
              {r}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
