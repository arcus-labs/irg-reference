'use client';

import { useEffect, useState, use } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { VerticalTimeline, VerticalTimelineElement } from 'react-vertical-timeline-component';
import 'react-vertical-timeline-component/style.min.css';
import '@/components/timeline-overrides.css';

interface TraceEntry { phase: string; timestamp?: string; data?: Record<string, unknown> }

interface CaseDetail {
  id: string;
  clinicalQuestion: string;
  patientAge: string;
  patientSymptoms: string;
  patientHistory: string;
  bodyRegion: string;
  imagePaths?: string[];
  imagePath?: string;
  createdAt: string;
  status: string;
  terminationState?: string;
  report?: { markdownReport?: string; urgency?: string };
  trace?: {
    history: TraceEntry[];
    nodes: Array<{ id: string; type: string; goal?: string; content: Record<string, unknown>; status?: string; confidence?: number; timestamp?: string }>;
    metrics: { totalMs: number; phaseTimings: Record<string, number> };
    iteration: number;
    terminationState: string;
  };
  error?: string;
}

const NODE_COLORS: Record<string, string> = {
  clinicalContext: 'var(--node-clinical)',
  imageObservation: 'var(--node-observation)',
  imageQualityGate: 'var(--node-quality)',
  hypothesis: 'var(--node-hypothesis)',
  differentialExpansion: 'var(--node-differential)',
  adversary: 'var(--node-adversary)',
  targetedReanalysis: 'var(--node-reanalysis)',
  evidenceLink: 'var(--node-evidence)',
  convergenceCheck: 'var(--node-convergence)',
  triage: 'var(--node-triage)',
  termination: 'var(--node-termination)',
  record: 'var(--node-record)',
};

function titleize(phase: string): string {
  return phase.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}
function titleizeKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// Match the regular trace-navigator's colored-box styling.
// Match the regular trace-navigator exactly (Title Case titles + colon, no uppercase).
const createBoxStyle = (c: string): React.CSSProperties => ({ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.75rem', borderLeft: `4px solid ${c}` });
const createBoxTitleStyle = (c: string): React.CSSProperties => ({ fontWeight: 600, color: c, marginBottom: '0.5rem' });
const fieldLabel: React.CSSProperties = { color: 'var(--stone)', fontWeight: 600 };
const BOX_PALETTE = ['var(--accent)', 'var(--code-func)', 'var(--code-string)', 'var(--code-type)', 'var(--code-keyword)', 'var(--accent-light)'];

// Render a node's content as the regular navigator does: scalars grouped into a
// "Summary" box, each array/object in its own colored box.
function NodeContentBoxes({ content }: { content: Record<string, unknown> }) {
  const entries = Object.entries(content || {});
  const scalars = entries.filter(([, v]) => v === null || typeof v !== 'object');
  const complex = entries.filter(([, v]) => v !== null && typeof v === 'object');
  let ci = 0;
  const next = () => BOX_PALETTE[ci++ % BOX_PALETTE.length];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {scalars.length > 0 && (() => { const c = next(); return (
        <div style={createBoxStyle(c)}>
          <p style={createBoxTitleStyle(c)}>Summary:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {scalars.map(([k, v]) => (
              <div key={k} style={{ fontSize: '16px', lineHeight: 1.5 }}>
                <span style={fieldLabel}>{titleizeKey(k)}:</span>{' '}
                <span style={{ color: 'var(--ink)' }}>{typeof v === 'boolean' ? (v ? 'yes' : 'no') : (v === null || v === '' ? '—' : String(v))}</span>
              </div>
            ))}
          </div>
        </div>
      ); })()}
      {complex.map(([k, v]) => { const c = next(); return (
        <div key={k} style={createBoxStyle(c)}>
          <p style={createBoxTitleStyle(c)}>{titleizeKey(k)}:</p>
          <ContentView data={v} />
        </div>
      ); })}
    </div>
  );
}

// Readable recursive renderer for a node's structured content (no raw JSON).
function ContentView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined || data === '') return <span style={{ color: 'var(--stone)' }}>—</span>;
  if (typeof data !== 'object') {
    return <span style={{ color: 'var(--ink)' }}>{typeof data === 'boolean' ? (data ? 'yes' : 'no') : String(data)}</span>;
  }
  if (depth > 4) return <code style={{ fontSize: '0.72rem', color: 'var(--stone)' }}>{JSON.stringify(data)}</code>;
  if (Array.isArray(data)) {
    if (data.length === 0) return <span style={{ color: 'var(--stone)' }}>none</span>;
    return (
      <ul style={{ listStyleType: 'disc', margin: '0.2rem 0 0.2rem 1.2rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {data.map((item, i) => <li key={i} style={{ lineHeight: 1.5 }}><ContentView data={item} depth={depth + 1} /></li>)}
      </ul>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {Object.entries(data as Record<string, unknown>).map(([k, v]) => {
        const nested = v !== null && typeof v === 'object';
        return nested ? (
          <div key={k}>
            <span style={fieldLabel}>{titleizeKey(k)}:</span>
            <div style={{ marginLeft: '0.6rem', marginTop: '0.1rem' }}><ContentView data={v} depth={depth + 1} /></div>
          </div>
        ) : (
          <div key={k} style={{ lineHeight: 1.5 }}>
            <span style={fieldLabel}>{titleizeKey(k)}:</span>{' '}
            <ContentView data={v} depth={depth + 1} />
          </div>
        );
      })}
    </div>
  );
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const load = async () => {
      const res = await fetch(`/api/xray/cases/${id}`);
      const data = await res.json();
      setCaseData(data.case);
      if (data.case?.status === 'processing') interval = setTimeout(load, 2000);
    };
    load();
    return () => clearTimeout(interval);
  }, [id]);

  if (!caseData) return <div style={{ padding: '4rem', textAlign: 'center' }}>Loading…</div>;

  const images = (caseData.imagePaths && caseData.imagePaths.length > 0)
    ? caseData.imagePaths
    : caseData.imagePath ? [caseData.imagePath] : [];
  const history = caseData.trace?.history || [];
  const nodes = caseData.trace?.nodes || [];

  return (
    <>
      <a href="/medical/xray" className="detail-back">← All Cases</a>

      <div className="detail-header">
        <h1>{caseData.clinicalQuestion || 'Case Detail'}</h1>
        <div className="detail-header-meta">
          <span>{caseData.bodyRegion}</span>
          <span>Age: {caseData.patientAge || '—'}</span>
          <span>{new Date(caseData.createdAt).toLocaleString()}</span>
          {caseData.terminationState && <span className="case-card-status converged">{caseData.terminationState}</span>}
          {caseData.report?.urgency && <span className={`urgency-badge ${caseData.report.urgency}`}>{caseData.report.urgency}</span>}
        </div>
      </div>

      <div className="detail-disclaimer">
        <p>⚠️ <strong>This is a decision-support tool and not a definitive medical diagnosis.</strong> All findings require verification by a qualified radiologist. This system is intended for assistive purposes only.</p>
      </div>

      {caseData.status === 'processing' && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="spinner" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent', width: 32, height: 32 }} />
          <p style={{ marginTop: '1rem', fontFamily: 'var(--sans)', color: 'var(--stone)' }}>Running IRG analysis…</p>
        </div>
      )}

      {caseData.status === 'error' && (
        <div className="report-section" style={{ borderLeft: '3px solid #6d0000' }}>
          <h2>Error</h2>
          <p>{caseData.error}</p>
        </div>
      )}

      {/* Source image — single column, centered */}
      {images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center', margin: '0 0 2rem' }}>
          {images.map((img, i) => (
            <figure key={i} style={{ margin: 0, maxWidth: '480px' }}>
              <img src={img} alt={`X-ray view ${i + 1}`} style={{ width: '100%', borderRadius: '4px', background: 'var(--code-bg)' }} />
              <figcaption className="detail-image-label">{images.length > 1 ? `View ${i + 1} of ${images.length}` : 'Source image'} · {caseData.bodyRegion} X-ray</figcaption>
            </figure>
          ))}
        </div>
      )}

      {/* Diagnostic report */}
      {caseData.report?.markdownReport && (
        <div className="report-section">
          <h2>Diagnostic Report</h2>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{caseData.report.markdownReport}</ReactMarkdown>
        </div>
      )}

      {/* Reasoning trace — vertical-timeline node cards (single column) */}
      {history.length > 0 && (
        <div style={{ marginTop: '2.5rem' }}>
          <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500, marginBottom: '0.25rem' }}>
            Reasoning Trace
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--stone-light)', marginLeft: '0.8rem' }}>
              {history.length} steps · {caseData.trace?.metrics?.totalMs}ms
            </span>
          </h2>
          <VerticalTimeline lineColor="var(--rule)" animate={false} layout="1-column-left">
            {history.map((entry, i) => {
              const color = NODE_COLORS[entry.phase] || 'var(--stone)';
              const node = nodes[i];
              const ms = caseData.trace?.metrics?.phaseTimings?.[entry.phase];
              return (
                <VerticalTimelineElement
                  key={i}
                  icon={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRadius: '50%', color: 'var(--paper)', fontWeight: 700, fontSize: '16px', background: color }}>{i + 1}</div>}
                  iconStyle={{ background: color, color: 'var(--paper)', boxShadow: `0 0 0 4px var(--paper), 0 0 0 6px ${color}`, width: '40px', height: '40px' }}
                  contentStyle={{ background: 'var(--paper-warm)', color: 'var(--ink)', border: `2px solid ${color}`, borderRadius: '4px', boxShadow: 'var(--shadow-soft)', padding: '1rem 1.25rem' }}
                  contentArrowStyle={{ borderRight: `7px solid ${color}` }}
                  date={ms != null ? `${ms}ms` : ''}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                        <span style={{ padding: '0.25rem 0.5rem', borderRadius: '2px', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', background: color, color: 'var(--paper)' }}>{titleize(entry.phase)}</span>
                        {node?.id && <span style={{ color: 'var(--stone)', fontSize: '0.7rem', fontFamily: 'var(--mono)' }}>ID: {node.id}</span>}
                      </div>
                      {node?.goal && <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--serif)' }}>{node.goal}</h3>}
                    </div>

                    {node?.content ? <NodeContentBoxes content={node.content} /> : <span style={{ color: 'var(--stone)' }}>—</span>}

                    {(node?.status || typeof node?.confidence === 'number') && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {node?.status && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ color: 'var(--stone)', fontSize: '0.75rem' }}>Status:</span>
                            <span style={{ padding: '0.2rem 0.5rem', borderRadius: '2px', fontSize: '0.72rem', fontWeight: 600, background: 'var(--status-completed)', color: 'var(--paper)' }}>{node.status}</span>
                          </span>
                        )}
                        {typeof node?.confidence === 'number' && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1, minWidth: '160px' }}>
                            <span style={{ color: 'var(--stone)', fontSize: '0.75rem' }}>Confidence:</span>
                            <span style={{ flex: 1, background: 'var(--rule)', borderRadius: '9999px', height: '8px', maxWidth: '160px' }}>
                              <span style={{ display: 'block', background: color, height: '8px', borderRadius: '9999px', width: `${Math.round(node.confidence * 100)}%` }} />
                            </span>
                            <span style={{ color: 'var(--stone)', fontSize: '0.72rem', fontFamily: 'var(--mono)' }}>{Math.round(node.confidence * 100)}%</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </VerticalTimelineElement>
              );
            })}
          </VerticalTimeline>
        </div>
      )}
    </>
  );
}
