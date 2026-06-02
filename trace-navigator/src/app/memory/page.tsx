'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import Spinner from '@/components/Spinner';

interface DomainCount {
  domain: string;
  n: number | bigint;
}

interface Stats {
  claims: {
    total: number;
    by_domain: DomainCount[];
    by_inferred_domain?: DomainCount[];
  } | null;
  citations: {
    total: number;
    provisional: number;
    expired: number;
    by_domain: DomainCount[];
  } | null;
}

interface SweepResult {
  inspected: number;
  removed: number;
  alreadyGone: number;
  errors: { file: string; error: string }[];
  dryRun: boolean;
  duration_ms: number;
  swept_at: string;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--paper-warm)',
  border: '1px solid var(--rule)',
  borderRadius: '3px',
  padding: '1.75rem',
};

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--accent)',
  background: 'none',
  border: '1px solid var(--rule)',
  borderRadius: '3px',
  padding: '0.55rem 1.1rem',
  fontSize: '0.85rem',
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'var(--sans)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  fontWeight: 500,
  color: 'var(--stone)',
  marginBottom: '0.35rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  fontFamily: 'var(--sans)',
};

const metricValueStyle: React.CSSProperties = {
  fontFamily: 'var(--mono)',
  fontSize: '2.1rem',
  color: 'var(--ink)',
  margin: 0,
  lineHeight: 1.1,
};

function asNumber(n: number | bigint | undefined): number {
  if (typeof n === 'bigint') return Number(n);
  return typeof n === 'number' ? n : 0;
}

export default function MemoryPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fact-store/stats', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        router.push('/login');
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || body?.detail?.message || 'Failed to load stats');
      } else {
        setStats(body?.stats ?? null);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const runSweep = async (dryRun: boolean) => {
    setSweepBusy(true);
    setSweepResult(null);
    try {
      const url = `/api/fact-store/sweep${dryRun ? '?dry_run=1' : ''}`;
      const res = await fetch(url, { method: 'POST' });
      if (res.status === 401 || res.status === 403) {
        router.push('/login');
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || body?.detail?.message || 'Sweep failed');
      } else {
        setSweepResult(body?.result);
        // Refresh stats only after a real sweep — dry runs don't
        // change anything on disk, so re-querying the store is wasted.
        if (!dryRun) loadStats();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSweepBusy(false);
    }
  };

  const claims = stats?.claims;
  const citations = stats?.citations;
  const isEmpty = !loading && !error && !claims && !citations;

  return (
    <main style={{ background: 'var(--paper)', color: 'var(--ink)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '1.5rem 2rem' }}>
        <Navigation />
      </div>

      <div style={{ marginTop: '50px', paddingTop: '2rem', paddingBottom: '2rem', paddingLeft: '2rem', paddingRight: '2rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.5rem', color: 'var(--stone)', lineHeight: 1.8 }}>Fact-Store</p>
        <h1 style={{ fontSize: 'clamp(2.4rem, 5vw, 3.6rem)', fontFamily: 'var(--serif)', fontWeight: 400, marginBottom: '1rem', color: 'var(--ink)' }}>Memory Layer</h1>
        <p style={{ fontSize: '1.05rem', color: 'var(--stone)', lineHeight: 1.8 }}>
          Claims and citations the IRG has accrued across sessions.
        </p>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingLeft: '2rem', paddingRight: '2rem', paddingBottom: '4rem' }}>
        <div style={{ width: '100%', maxWidth: '900px' }}>

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', justifyContent: 'flex-end' }}>
            <button style={buttonStyle} onClick={loadStats} disabled={loading || sweepBusy}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button style={buttonStyle} onClick={() => runSweep(true)} disabled={sweepBusy || loading}>
              Sweep (dry-run)
            </button>
            <button
              style={{ ...buttonStyle, color: 'var(--paper)', background: 'var(--accent)' }}
              onClick={() => runSweep(false)}
              disabled={sweepBusy || loading}
            >
              {sweepBusy ? 'Sweeping…' : 'Sweep expired'}
            </button>
          </div>

          {/* Error state */}
          {error && (
            <div style={{ ...cardStyle, marginBottom: '1.5rem', borderColor: 'var(--code-keyword)' }}>
              <p style={{ color: 'var(--code-keyword)', fontWeight: 500, marginBottom: '0.25rem' }}>Error</p>
              <p style={{ color: 'var(--stone)', fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>{error}</p>
            </div>
          )}

          {/* Loading state */}
          {loading && !stats && (
            <div style={{ ...cardStyle, textAlign: 'center', padding: '3rem' }}>
              <Spinner size="lg" color="var(--accent)" />
            </div>
          )}

          {/* Empty state */}
          {isEmpty && (
            <div style={{ ...cardStyle, textAlign: 'center', padding: '3rem' }}>
              <p style={{ fontSize: '1.1rem', color: 'var(--ink)', marginBottom: '0.5rem' }}>The fact-store is empty.</p>
              <p style={{ color: 'var(--stone)' }}>
                Run a query from the <a href="/" style={{ color: 'var(--accent)' }}>home page</a> to begin seeding it.
                Both <code>irg-simple</code> and <code>irg-external-facts</code> persist claims.
              </p>
            </div>
          )}

          {/* Claims card */}
          {claims && (
            <div style={{ ...cardStyle, marginBottom: '1.5rem' }}>
              <span style={labelStyle}>Claims</span>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '2rem', alignItems: 'start' }}>
                <div>
                  <p style={metricValueStyle}>{asNumber(claims.total)}</p>
                  <p style={{ color: 'var(--stone)', fontSize: '0.8rem', margin: 0 }}>total extracted</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <p style={{ color: 'var(--stone)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.4rem 0' }}>
                      by domain <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>(hand-tuned)</span>
                    </p>
                    <DomainBreakdown rows={claims.by_domain} />
                  </div>
                  {claims.by_inferred_domain && claims.by_inferred_domain.length > 0 && (
                    <div>
                      <p style={{ color: 'var(--stone)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.4rem 0' }}>
                        by inferred domain <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>(classifier)</span>
                      </p>
                      <DomainBreakdown rows={claims.by_inferred_domain} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Citations card */}
          {citations && (
            <div style={cardStyle}>
              <span style={labelStyle}>Citations</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 160px) 1fr', gap: '2rem', alignItems: 'start' }}>
                <div>
                  <p style={metricValueStyle}>{asNumber(citations.total)}</p>
                  <p style={{ color: 'var(--stone)', fontSize: '0.8rem', margin: 0 }}>total stored</p>
                </div>
                <div>
                  <p style={{ ...metricValueStyle, color: 'var(--accent)' }}>{asNumber(citations.provisional)}</p>
                  <p style={{ color: 'var(--stone)', fontSize: '0.8rem', margin: 0 }}>provisional</p>
                </div>
                <div>
                  <p style={{ ...metricValueStyle, color: asNumber(citations.expired) > 0 ? 'var(--code-keyword)' : 'var(--stone)' }}>
                    {asNumber(citations.expired)}
                  </p>
                  <p style={{ color: 'var(--stone)', fontSize: '0.8rem', margin: 0 }}>expired (ready to sweep)</p>
                </div>
                <DomainBreakdown rows={citations.by_domain} />
              </div>
            </div>
          )}

          {/* Last sweep result */}
          {sweepResult && (
            <div style={{ ...cardStyle, marginTop: '1.5rem' }}>
              <span style={labelStyle}>Last Sweep {sweepResult.dryRun ? '(dry-run)' : ''}</span>
              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                <SweepMetric label="inspected" value={sweepResult.inspected} />
                <SweepMetric label={sweepResult.dryRun ? 'would-remove' : 'removed'} value={sweepResult.removed} />
                <SweepMetric label="already gone" value={sweepResult.alreadyGone} />
                <SweepMetric label="errors" value={sweepResult.errors.length} />
                <SweepMetric label="duration" value={`${sweepResult.duration_ms}ms`} />
              </div>
              {sweepResult.errors.length > 0 && (
                <ul style={{ marginTop: '1rem', color: 'var(--code-keyword)', fontSize: '0.8rem', fontFamily: 'var(--mono)' }}>
                  {sweepResult.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>{e.file}: {e.error}</li>
                  ))}
                  {sweepResult.errors.length > 5 && <li>…and {sweepResult.errors.length - 5} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function DomainBreakdown({ rows }: { rows: DomainCount[] }) {
  if (!rows || rows.length === 0) {
    return <p style={{ color: 'var(--stone)', fontSize: '0.85rem', margin: 0 }}>No domain breakdown available.</p>;
  }
  const max = Math.max(...rows.map((r) => asNumber(r.n)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {rows.map((row) => {
        const n = asNumber(row.n);
        const pct = max > 0 ? (n / max) * 100 : 0;
        return (
          <div key={row.domain} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 40px', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--stone)', fontFamily: 'var(--mono)' }}>{row.domain}</span>
            <div style={{ height: '6px', background: 'var(--rule)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
            <span style={{ fontSize: '0.85rem', color: 'var(--ink)', fontFamily: 'var(--mono)', textAlign: 'right' }}>{n}</span>
          </div>
        );
      })}
    </div>
  );
}

function SweepMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p style={{ fontSize: '0.7rem', color: 'var(--stone)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>{label}</p>
      <p style={{ fontFamily: 'var(--mono)', fontSize: '1.15rem', color: 'var(--ink)', margin: 0 }}>{value}</p>
    </div>
  );
}
