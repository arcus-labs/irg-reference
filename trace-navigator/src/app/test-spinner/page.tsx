'use client';

import Spinner from '@/components/Spinner';

export default function TestSpinner() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3rem', padding: '2rem' }}>
      <h1 style={{ fontSize: '2rem', fontFamily: 'var(--serif)', color: 'var(--ink)' }}>Spinner Sizes</h1>
      
      <div style={{ display: 'flex', gap: '4rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <Spinner size="xs" color="var(--accent)" />
          <p style={{ fontSize: '0.875rem', color: 'var(--stone)' }}>Extra Small (xs)</p>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <Spinner size="sm" color="var(--accent)" />
          <p style={{ fontSize: '0.875rem', color: 'var(--stone)' }}>Small (sm)</p>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <Spinner size="md" color="var(--accent)" />
          <p style={{ fontSize: '0.875rem', color: 'var(--stone)' }}>Medium (md)</p>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <Spinner size="lg" color="var(--accent)" />
          <p style={{ fontSize: '0.875rem', color: 'var(--stone)' }}>Large (lg)</p>
        </div>
      </div>

      <div style={{ marginTop: '2rem', padding: '2rem', background: 'var(--paper-warm)', borderRadius: '4px', maxWidth: '600px' }}>
        <h2 style={{ fontSize: '1.25rem', fontFamily: 'var(--serif)', color: 'var(--ink)', marginBottom: '1rem' }}>Custom Colors</h2>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            <Spinner size="md" color="var(--accent)" />
            <p style={{ fontSize: '0.75rem', color: 'var(--stone)' }}>Accent</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            <Spinner size="md" color="#e74c3c" />
            <p style={{ fontSize: '0.75rem', color: 'var(--stone)' }}>Red</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            <Spinner size="md" color="#3498db" />
            <p style={{ fontSize: '0.75rem', color: 'var(--stone)' }}>Blue</p>
          </div>
        </div>
      </div>
    </div>
  );
}

