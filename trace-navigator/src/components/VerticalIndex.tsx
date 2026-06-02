'use client';

import Navigation from '@/components/Navigation';
import ScenarioCard from '@/components/ScenarioCard';
import { scenariosForVertical, VERTICALS, type Vertical } from '@/lib/scenarios';

interface Props { vertical: Vertical; }

export default function VerticalIndex({ vertical }: Props) {
  const meta = VERTICALS[vertical];
  const scenarios = scenariosForVertical(vertical);
  const liveCount = scenarios.filter((s) => s.status === 'live').length;
  const plannedCount = scenarios.length - liveCount;

  return (
    <main style={{ background: 'var(--paper)', color: 'var(--ink)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '1.5rem 2rem' }}>
        <Navigation />
      </div>

      <div style={{ marginTop: '50px', paddingTop: '2rem', paddingBottom: '1.5rem', paddingLeft: '2rem', paddingRight: '2rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.1rem', color: 'var(--stone)', lineHeight: 1.6, marginBottom: '0.25rem' }}>
          IRG Scenario Library
        </p>
        <h1 style={{ fontSize: 'clamp(2.2rem, 5vw, 3.2rem)', fontFamily: 'var(--serif)', fontWeight: 400, marginBottom: '0.75rem', color: 'var(--ink)' }}>
          {meta.title}
        </h1>
        <p style={{ fontFamily: 'var(--mono)', fontSize: '0.88rem', color: 'var(--stone)', marginBottom: '1rem', letterSpacing: '0.02em' }}>
          {meta.subtitle}
        </p>
        <p style={{ fontSize: '1rem', color: 'var(--ink)', lineHeight: 1.7, maxWidth: '720px', margin: '0 auto' }}>
          {meta.description}
        </p>
        <p style={{ marginTop: '0.85rem', fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--stone)' }}>
          {liveCount} beta · {plannedCount} planned
        </p>
      </div>

      <div style={{ flex: 1, paddingLeft: '2rem', paddingRight: '2rem', paddingBottom: '4rem' }}>
        <div style={{ maxWidth: '960px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.25rem' }}>
          {scenarios.length === 0 ? (
            <p style={{ color: 'var(--stone)', fontStyle: 'italic', textAlign: 'center', gridColumn: '1 / -1' }}>
              No scenarios in this vertical yet.
            </p>
          ) : (
            scenarios.map((s) => <ScenarioCard key={s.slug} scenario={s} />)
          )}
        </div>
      </div>
    </main>
  );
}
