'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Spinner from '@/components/Spinner';
import Navigation from '@/components/Navigation';
import { traceNavigatorRequestDefaults, availableGraphOptions } from '@/lib/runtime-defaults';

interface ProviderInfo {
  name: string;
  defaultModel: string;
  models: { id: string; label: string }[];
  requiresApiKey: boolean;
  keyless: boolean;
}

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [traces, setTraces] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [graph, setGraph] = useState<string>(traceNavigatorRequestDefaults.graph);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<string>('');
  const [model, setModel] = useState<string>(traceNavigatorRequestDefaults.model);
  const [maxIterations, setMaxIterations] = useState<number>(traceNavigatorRequestDefaults.maxIterations);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(traceNavigatorRequestDefaults.confidenceThreshold);
  const [enableAssessor, setEnableAssessor] = useState<boolean>(traceNavigatorRequestDefaults.enableAssessor);
  const [enableFactCheckPipeline, setEnableFactCheckPipeline] = useState<boolean>(traceNavigatorRequestDefaults.enableFactCheckPipeline);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadTraces();
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      const res = await fetch('/api/providers');
      if (!res.ok) return;
      const data = await res.json();
      const list: ProviderInfo[] = Array.isArray(data?.providers) ? data.providers : [];
      setProviders(list);
      if (list.length > 0) {
        setProvider(list[0].name);
        setModel(list[0].defaultModel);
      }
    } catch (err) {
      console.error('Failed to load providers:', err);
    }
  };

  const handleProviderChange = (name: string) => {
    setProvider(name);
    const next = providers.find((p) => p.name === name);
    if (next) setModel(next.defaultModel);
  };

  const currentProviderModels =
    providers.find((p) => p.name === provider)?.models ?? [];

  const loadTraces = async () => {
    try {
      const res = await fetch('/api/traces');
      if (res.status === 401 || res.status === 403) {
        router.push('/login');
        return;
      }
      const data = await res.json();
      // Get last 10 traces
      setTraces((data.traces || []).slice(0, 10));
    } catch (error) {
      console.error('Failed to load traces:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/traces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: prompt,
          context: { },
          graph,
          maxIterations,
          confidenceThreshold,
          provider,
          model,
          enableFactCheck: true,
          enableImpactPrediction: true,
          enableAssessor,
          enableFactCheckPipeline,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        router.push('/login');
        return;
      }
      const data = await res.json();
      if (data.success && data.filename) {
        // Navigate to trace detail page
        router.push(`/traces/${encodeURIComponent(data.filename)}`);
        await loadTraces();
      } else {
        setError('Failed to generate trace');
      }
    } catch (error) {
      console.error('Failed to generate trace:', error);
      setError('Error generating trace. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleTraceClick = (filename: string) => {
    router.push(`/traces/${encodeURIComponent(filename)}`);
  };

  return (
    <main style={{ background: 'var(--paper)', color: 'var(--ink)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Navigation */}
      <div style={{ padding: '1.5rem 2rem' }}>
        <Navigation />
      </div>

      {/* Header */}
      <div style={{ marginTop: '50px', paddingTop: '2rem', paddingBottom: '2rem', paddingLeft: '2rem', paddingRight: '2rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.5rem', color: 'var(--stone)', lineHeight: 1.8 }}>Iterative Reasoning Graph</p>
        <h1 style={{ fontSize: 'clamp(2.4rem, 5vw, 3.6rem)', fontFamily: 'var(--serif)', fontWeight: 400, marginBottom: '1rem', color: 'var(--ink)' }}>Trace Navigator</h1>
        <p style={{ fontSize: '1.05rem', color: 'var(--stone)', lineHeight: 1.8 }}>Visualize and explore reasoning traces</p>
      </div>

      {/* Search Section */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingLeft: '2rem', paddingRight: '2rem', paddingBottom: '4rem' }}>
        <div style={{ width: '100%', maxWidth: '720px' }}>
          {loading && (
            <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
              <div style={{ background: 'var(--paper)', borderRadius: '4px', padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                <Spinner size="lg" color="var(--accent)" />
                <p style={{ color: 'var(--stone)', fontSize: '0.95rem' }}>Generating Trace...</p>
              </div>
            </div>
          )}
          {/* Search Box */}
          <form onSubmit={handleSubmit} style={{ marginBottom: '3rem', opacity: loading ? 0.5 : 1, pointerEvents: loading ? 'none' : 'auto' }}>
            <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '2.5rem', border: '1px solid var(--rule)' }}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Enter your question or prompt..."
                style={{
                  width: '100%',
                  background: 'var(--paper)',
                  color: 'var(--ink)',
                  border: '1px solid var(--rule)',
                  borderRadius: '2px',
                  padding: '0.7rem 0.9rem',
                  fontFamily: 'var(--serif)',
                  fontSize: '1rem',
                  lineHeight: 1.6,
                  resize: 'vertical',
                  minHeight: '100px',
                  outline: 'none',
                }}
                rows={4}
                disabled={loading}
              />

              {/* Graph + Model Selection */}
              <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: 'var(--stone)', marginBottom: '0.45rem', letterSpacing: '0.02em', fontFamily: 'var(--sans)' }}>Reasoning Graph</label>
                  <select
                    value={graph}
                    onChange={(e) => setGraph(e.target.value)}
                    disabled={loading}
                    style={{
                      width: '100%',
                      background: 'var(--paper)',
                      color: 'var(--ink)',
                      border: '1px solid var(--rule)',
                      borderRadius: '2px',
                      padding: '0.7rem 0.9rem',
                      fontFamily: 'var(--sans)',
                      fontSize: '0.88rem',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {availableGraphOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: 'var(--stone)', marginBottom: '0.45rem', letterSpacing: '0.02em', fontFamily: 'var(--sans)' }}>Provider</label>
                  <select
                    value={provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    disabled={loading || providers.length === 0}
                    style={{
                      width: '100%',
                      background: 'var(--paper)',
                      color: 'var(--ink)',
                      border: '1px solid var(--rule)',
                      borderRadius: '2px',
                      padding: '0.7rem 0.9rem',
                      fontFamily: 'var(--sans)',
                      fontSize: '0.88rem',
                      outline: 'none',
                      cursor: providers.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {providers.length === 0 && <option value="">No providers configured</option>}
                    {providers.map((p) => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: 'var(--stone)', marginBottom: '0.45rem', letterSpacing: '0.02em', fontFamily: 'var(--sans)' }}>Model</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={loading || currentProviderModels.length === 0}
                    style={{
                      width: '100%',
                      background: 'var(--paper)',
                      color: 'var(--ink)',
                      border: '1px solid var(--rule)',
                      borderRadius: '2px',
                      padding: '0.7rem 0.9rem',
                      fontFamily: 'var(--sans)',
                      fontSize: '0.88rem',
                      outline: 'none',
                      cursor: currentProviderModels.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {currentProviderModels.length === 0 && (
                      <option value="">No models available</option>
                    )}
                    {currentProviderModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: 'var(--stone)', marginBottom: '0.45rem', letterSpacing: '0.02em', fontFamily: 'var(--sans)' }}>Max Iterations</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={maxIterations}
                    onChange={(e) => setMaxIterations(parseInt(e.target.value) || traceNavigatorRequestDefaults.maxIterations)}
                    disabled={loading}
                    style={{
                      width: '100%',
                      background: 'var(--paper)',
                      color: 'var(--ink)',
                      border: '1px solid var(--rule)',
                      borderRadius: '2px',
                      padding: '0.7rem 0.9rem',
                      fontFamily: 'var(--sans)',
                      fontSize: '0.88rem',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: 'var(--stone)', marginBottom: '0.45rem', letterSpacing: '0.02em', fontFamily: 'var(--sans)' }}>Confidence Threshold</label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value) || traceNavigatorRequestDefaults.confidenceThreshold)}
                    disabled={loading}
                    style={{
                      width: '100%',
                      background: 'var(--paper)',
                      color: 'var(--ink)',
                      border: '1px solid var(--rule)',
                      borderRadius: '2px',
                      padding: '0.7rem 0.9rem',
                      fontFamily: 'var(--sans)',
                      fontSize: '0.88rem',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              {/* Assessor Checkbox */}
              <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="checkbox"
                  id="enableAssessor"
                  checked={enableAssessor}
                  onChange={(e) => setEnableAssessor(e.target.checked)}
                  disabled={loading}
                  style={{
                    width: '18px',
                    height: '18px',
                    cursor: 'pointer',
                    accentColor: 'var(--accent)',
                  }}
                />
                <label
                  htmlFor="enableAssessor"
                  style={{
                    fontSize: '0.88rem',
                    color: 'var(--ink)',
                    cursor: 'pointer',
                    userSelect: 'none',
                    fontFamily: 'var(--sans)',
                  }}
                >
                  Run Assessor Node (EIE evaluation & governance audit)
                </label>
              </div>

              {/* Fact-Check Pipeline toggle hidden — using simple internal fact check */}

              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
                <button
                  type="submit"
                  disabled={loading || !prompt.trim()}
                  style={{
                    flex: 1,
                    background: loading || !prompt.trim() ? 'var(--stone-light)' : 'var(--accent)',
                    color: 'var(--paper)',
                    border: 'none',
                    borderRadius: '2px',
                    padding: '0.85rem 2rem',
                    fontFamily: 'var(--sans)',
                    fontSize: '0.88rem',
                    fontWeight: 500,
                    letterSpacing: '0.02em',
                    cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
                    transition: 'background 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                  onMouseEnter={(e) => {
                    if (!loading && prompt.trim()) {
                      e.currentTarget.style.background = 'var(--accent-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!loading && prompt.trim()) {
                      e.currentTarget.style.background = 'var(--accent)';
                    }
                  }}
                >
                  {loading ? 'Generating Trace...' : 'Generate Trace'}
                </button>
              </div>
              {error && (
                <p style={{ color: 'var(--code-keyword)', fontSize: '0.88rem', marginTop: '1rem' }}>{error}</p>
              )}
            </div>
          </form>

          {/* Recent Traces */}
          {traces.length > 0 && (
            <div>
              <h2 style={{ fontSize: '1.2rem', fontFamily: 'var(--serif)', fontWeight: 500, color: 'var(--ink)', marginBottom: '1.5rem' }}>Recent Traces</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {traces.map((trace) => (
                  <button
                    key={trace.filename}
                    onClick={() => handleTraceClick(trace.filename)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '1rem',
                      borderRadius: '3px',
                      background: 'var(--paper-warm)',
                      border: '1px solid var(--rule)',
                      color: 'var(--ink)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--code-bg)';
                      e.currentTarget.style.color = 'var(--code-text)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'var(--paper-warm)';
                      e.currentTarget.style.color = 'var(--ink)';
                    }}
                  >
                    <p style={{ fontFamily: 'var(--mono)', fontSize: '0.88rem', color: 'inherit' }}>{trace.filename}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
