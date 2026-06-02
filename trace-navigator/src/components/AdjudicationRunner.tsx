'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { resolveDomain } from '@/lib/adjudication-domains';

const ALLOWED_EXT = ['.md', '.markdown', '.txt', '.csv', '.json'];

function isAllowed(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXT.some((ext) => lower.endsWith(ext));
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

type Sample = { id: string; filename: string; label: string; description: string; size_bytes: number };

/**
 * Domain-parameterized adjudication upload runner. The `slug` selects which
 * IRG (Reg E / Reg Z / CFPB / SAR) the upload + samples + run hit, via the
 * shared adjudication-domains map. One component backs every /fintech/<slug>
 * adjudication page.
 */
export default function AdjudicationRunner({ slug }: { slug: string }) {
  const router = useRouter();
  const domain = resolveDomain(slug) ?? resolveDomain('adjudication')!;
  const [mounted, setMounted] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [caseId, setCaseId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null);
  const [pastTraces, setPastTraces] = useState<string[]>([]);

  useEffect(() => { setMounted(true); }, []);

  // List prior traces for THIS domain. Each domain's runs are copied into the
  // navigator traces/ dir with a domain-specific prefix (e.g. "reg-z-adj-"),
  // so we filter the shared /api/traces listing by that prefix.
  const loadPastTraces = useCallback(async () => {
    try {
      const res = await fetch('/api/traces', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const prefix = `${domain.tracePrefix}-`;
      const mine = (data.traces || [])
        .map((t: { filename: string }) => t.filename)
        .filter((f: string) => f.startsWith(prefix) && f.endsWith('.json'))
        .sort((a: string, b: string) => b.localeCompare(a));
      setPastTraces(mine);
    } catch { /* swallow — past traces are optional */ }
  }, [domain.tracePrefix]);

  useEffect(() => {
    if (!mounted) return;
    loadPastTraces();
  }, [mounted, loadPastTraces]);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/adjudicate/samples?domain=${encodeURIComponent(slug)}`, { cache: 'no-store' });
        if (res.status === 401) { router.push('/login'); return; }
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.samples)) setSamples(data.samples);
      } catch { /* swallow — samples are optional */ }
    })();
    return () => { cancelled = true; };
  }, [mounted, router, slug]);

  const loadSample = async (sample: Sample) => {
    if (submitting) return;
    setError(null);
    setLoadingSampleId(sample.id);
    try {
      const res = await fetch(`/api/adjudicate/samples/${encodeURIComponent(sample.id)}?domain=${encodeURIComponent(slug)}`, { cache: 'no-store' });
      if (res.status === 401) { router.push('/login'); return; }
      if (!res.ok) {
        setError(`Failed to load sample "${sample.label}".`);
        return;
      }
      const data = await res.json();
      const blob = new Blob([data.content], { type: 'text/markdown' });
      const file = new File([blob], data.filename, { type: 'text/markdown', lastModified: Date.now() });
      setFiles([file]);
      setCaseId(sample.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sample.');
    } finally {
      setLoadingSampleId(null);
    }
  };

  useEffect(() => {
    if (!submitting) return;
    const stages = [
      `seeding ${domain.seedLabel}`,
      'overlaying adjudication prompt pack',
      'running the IRG (clarify · classify · strategy · adversary · arbiter · case-recall · …)',
      `projecting decision artifact + ${domain.outputName}`,
      'saving trace',
    ];
    let i = 0;
    setStage(stages[0]);
    const t = setInterval(() => { i = Math.min(i + 1, stages.length - 1); setStage(stages[i]); }, 18000);
    return () => clearInterval(t);
  }, [submitting, domain.seedLabel, domain.outputName]);

  const addFiles = (incoming: File[]) => {
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const f of incoming) {
      if (isAllowed(f.name)) accepted.push(f);
      else rejected.push(f.name);
    }
    if (rejected.length) setError(`Skipped (unsupported type): ${rejected.join(', ')}`);
    else setError(null);
    setFiles((prev) => [...prev, ...accepted]);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files || []));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files || []));
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); };
  const remove = (idx: number) => setFiles((f) => f.filter((_, i) => i !== idx));

  const submit = async () => {
    if (files.length === 0) { setError('Attach at least one evidence file.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('domain', slug);
      if (caseId.trim()) fd.append('case_id', caseId.trim());
      for (const f of files) fd.append('files', f);
      const res = await fetch('/api/adjudicate', { method: 'POST', body: fd });
      if (res.status === 401) { router.push('/login'); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.filename) {
        setError(data.error || data.detail || `Adjudication failed (HTTP ${res.status}).`);
        setSubmitting(false);
        return;
      }
      router.push(`/traces/${encodeURIComponent(data.filename)}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error.');
      setSubmitting(false);
    }
  };

  if (!mounted) return null;

  const box: React.CSSProperties = { background: 'var(--paper-warm)', borderRadius: '3px', padding: '1.25rem', borderLeft: '4px solid var(--accent)' };
  const label: React.CSSProperties = { color: 'var(--stone)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem', display: 'block' };
  const input: React.CSSProperties = { width: '100%', padding: '0.6rem 0.8rem', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: '3px', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '0.95rem' };

  return (
    <main style={{ background: 'var(--paper)', color: 'var(--ink)', minHeight: '100vh', padding: '2rem', marginTop: '5rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <Navigation />

        <div>
          <button
            onClick={() => router.push('/fintech')}
            style={{ background: 'transparent', border: '1px solid var(--rule)', color: 'var(--accent)', borderRadius: '999px', padding: '0.35rem 0.8rem', cursor: 'pointer', fontSize: '0.82rem', fontFamily: 'var(--mono)', marginBottom: '1rem' }}
          >
            ← Fintech scenarios
          </button>
          <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.4rem)', fontFamily: 'var(--serif)', fontWeight: 400, color: 'var(--ink)', textAlign: 'center', marginBottom: '0.5rem' }}>
            {domain.title}
          </h1>
          <p style={{ textAlign: 'center', color: 'var(--stone)', fontFamily: 'var(--mono)', fontSize: '0.9rem' }}>
            {domain.tagline}
          </p>
        </div>

        <div style={box}>
          <label style={label}>Case ID (optional)</label>
          <input
            style={input}
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="auto-generated if blank"
            disabled={submitting}
          />
        </div>

        {samples.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <p style={{ ...label, marginBottom: 0 }}>Sample Cases</p>
              <span style={{ color: 'var(--stone)', fontSize: '0.75rem', fontFamily: 'var(--mono)' }}>
                {samples.length} available{samples.length > 4 ? ' · scroll to see all' : ''}
              </span>
            </div>
            <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--rule)', borderRadius: '4px', padding: '0.75rem', background: 'var(--paper)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '0.75rem' }}>
                {samples.map((s) => {
                  const isLoading = loadingSampleId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => loadSample(s)}
                      disabled={submitting || isLoading}
                      style={{
                        textAlign: 'left', background: 'var(--paper-warm)', border: '1px solid var(--rule)',
                        borderLeft: '4px solid var(--code-func)', borderRadius: '3px', padding: '0.85rem 1rem',
                        cursor: submitting || isLoading ? 'not-allowed' : 'pointer', transition: 'background 0.15s, border-color 0.15s',
                        opacity: submitting ? 0.5 : 1, font: 'inherit', color: 'inherit',
                      }}
                      onMouseEnter={(e) => { if (!submitting && !isLoading) e.currentTarget.style.borderLeftColor = 'var(--accent)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = 'var(--code-func)'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span aria-hidden>📑</span>
                        <span style={{ color: 'var(--ink)', fontWeight: 600, fontFamily: 'var(--serif)', fontSize: '0.95rem' }}>{s.label}</span>
                      </div>
                      {s.description && (
                        <p style={{ color: 'var(--stone)', fontSize: '0.85rem', lineHeight: 1.4, margin: '0 0 0.4rem 0' }}>{s.description}</p>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--stone)', fontFamily: 'var(--mono)' }}>
                        <span>{s.filename}</span><span>·</span><span>{formatBytes(s.size_bytes)}</span>
                        <span style={{ marginLeft: 'auto', color: isLoading ? 'var(--stone)' : 'var(--accent)', fontWeight: 600 }}>
                          {isLoading ? 'loading…' : '↘ load'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          style={{
            background: dragOver ? 'var(--paper-warm)' : 'var(--paper)',
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--rule)'}`,
            borderRadius: '4px', padding: '2.5rem 1.5rem', textAlign: 'center',
            transition: 'background 0.15s, border-color 0.15s',
            cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.5 : 1,
          }}
          onClick={() => { if (!submitting) fileInputRef.current?.click(); }}
        >
          <input ref={fileInputRef} type="file" multiple accept={ALLOWED_EXT.join(',')} onChange={onPick} style={{ display: 'none' }} disabled={submitting} />
          <p style={{ fontSize: '1.05rem', color: 'var(--ink)', marginBottom: '0.4rem', fontFamily: 'var(--serif)' }}>
            📂 Drop evidence files here, or click to pick
          </p>
          <p style={{ color: 'var(--stone)', fontSize: '0.85rem', fontFamily: 'var(--mono)' }}>
            allowed: {ALLOWED_EXT.join('  ·  ')}
          </p>
          <p style={{ color: 'var(--stone)', fontSize: '0.8rem', marginTop: '0.75rem' }}>
            A markdown packet with a <span style={{ fontFamily: 'var(--mono)' }}>## Evidence Index</span> section gives the IRG a structured [E1]–[En] handle set to cite from. Anything else is read as context.
          </p>
        </div>

        {files.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ ...label, marginBottom: 0 }}>Attached ({files.length})</p>
            {files.map((f, i) => (
              <div key={i} style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.6rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.75rem', borderLeft: '4px solid var(--code-func)' }}>
                <span aria-hidden>📄</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)', fontSize: '0.9rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ color: 'var(--stone)', fontSize: '0.8rem', fontFamily: 'var(--mono)' }}>{formatBytes(f.size)}</span>
                <button type="button" onClick={() => remove(i)} disabled={submitting}
                  style={{ background: 'transparent', border: '1px solid var(--rule)', color: 'var(--stone)', padding: '0.25rem 0.6rem', borderRadius: '3px', cursor: submitting ? 'not-allowed' : 'pointer', fontSize: '0.8rem' }}>
                  remove
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.85rem 1rem', borderLeft: '4px solid var(--code-keyword)', color: 'var(--code-keyword)', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || files.length === 0}
            style={{
              background: submitting || files.length === 0 ? 'var(--stone)' : 'var(--accent)',
              color: 'var(--paper)', border: 'none', borderRadius: '3px', padding: '0.75rem 1.5rem',
              fontWeight: 600, fontSize: '1rem', cursor: submitting || files.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'var(--sans)',
            }}
          >
            {submitting ? 'Adjudicating…' : 'Run Adjudication'}
          </button>
          {submitting && (
            <p style={{ color: 'var(--stone)', fontSize: '0.9rem', fontFamily: 'var(--mono)' }}>
              {stage} … (this typically takes 60–180 seconds)
            </p>
          )}
        </div>

        {/* Past adjudications for THIS domain — click to reopen the trace. */}
        {pastTraces.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <p style={{ ...label, marginBottom: 0 }}>Past Adjudications</p>
              <span style={{ color: 'var(--stone)', fontSize: '0.75rem', fontFamily: 'var(--mono)' }}>
                {pastTraces.length} on file{pastTraces.length > 6 ? ' · scroll to see all' : ''}
              </span>
            </div>
            <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--rule)', borderRadius: '4px', padding: '0.5rem', background: 'var(--paper)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {pastTraces.map((f) => {
                const display = f.replace(new RegExp(`^${domain.tracePrefix}-`), '').replace(/\.json$/, '');
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => router.push(`/traces/${encodeURIComponent(f)}`)}
                    style={{
                      textAlign: 'left', background: 'var(--paper-warm)', border: '1px solid var(--rule)',
                      borderLeft: '4px solid var(--code-string)', borderRadius: '3px', padding: '0.55rem 0.85rem',
                      cursor: 'pointer', font: 'inherit', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.6rem',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = 'var(--accent)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = 'var(--code-string)'; }}
                  >
                    <span aria-hidden>🧾</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)', fontSize: '0.85rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display}</span>
                    <span style={{ color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600 }}>open ↗</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: '1rem' }}>
          <p style={{ color: 'var(--stone)', fontSize: '0.85rem' }}>
            On completion you&apos;ll be taken straight to the trace, where the Submitted Evidence appears under the prompt and the Adjudication Outcome (decision artifact + {domain.outputName}) appears below the response.
          </p>
        </div>
      </div>
    </main>
  );
}
