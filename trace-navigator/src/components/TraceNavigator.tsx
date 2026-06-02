'use client';

import { ReactNode, useState, useRef } from 'react';
import { VerticalTimeline, VerticalTimelineElement } from 'react-vertical-timeline-component';
import 'react-vertical-timeline-component/style.min.css';
import './timeline-overrides.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import YAML from 'js-yaml';

// Trace `response` / `draft_response` text is LLM-authored and rendered as raw
// HTML (rehype-raw) so inline <citation> tags become React components. Raw HTML
// from a model is an XSS vector, so every raw render is followed by
// rehype-sanitize with a schema that ALLOWS the citation element (+ ref/seq)
// on top of the safe markdown defaults, and strips everything else (scripts,
// event handlers, javascript: URLs, etc.). Order matters: raw → sanitize.
const citationSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'citation'],
  attributes: {
    ...defaultSchema.attributes,
    citation: ['ref', 'seq'],
  },
};
const safeRawRehypePlugins = [rehypeRaw, [rehypeSanitize, citationSanitizeSchema]] as const;

import { calculateDiff, extractMeaningfulContent } from '@/lib/diff-calculator';
import { DiffRenderer } from '@/lib/diff-renderer';
import {
  getFactCheckArtifactMetadata,
  getDisplayFinalConfidence,
  isEarlyExitTrace,
  isFiniteConfidence,
  normalizeAssessorDecision,
  normalizeStructuredOutline,
  resolveConvergenceDecisions,
  StructuredOutlineItem,
} from '@/lib/trace-display';
import { extractTraceResponse } from '@/lib/trace-response';
import styles from './MarkdownRenderer.module.css';
import Navigation from './Navigation';

interface TraceNavigatorProps {
  trace: any;
  /** filename in the traces/ directory — used to locate the source trace. */
  filename?: string;
}

// Helper function to format node type names for display
const formatNodeType = (type: string): string => {
  return type
    .replace(/_/g, ' ')  // Replace underscores with spaces
    .toUpperCase();      // Convert to uppercase
};

const getNodeColor = (type: string) => {
  // Map node types to soft, cohesive color palette
  // Colors chosen to be easy on the eyes and aligned with node function
  const colors: Record<string, { bg: string; icon: string }> = {
    input: { bg: 'var(--node-clarify)', icon: 'var(--stone-light)' },
    clarify: { bg: 'var(--node-clarify)', icon: 'var(--stone-light)' },
    clarification_gate: { bg: 'var(--node-gate)', icon: 'var(--stone-light)' },
    false_premise_gate: { bg: 'var(--node-gate)', icon: 'var(--stone-light)' },
    strategy: { bg: 'var(--node-strategy)', icon: 'var(--stone-light)' },
    adversary: { bg: 'var(--node-adversary)', icon: 'var(--stone-light)' },
    arbiter: { bg: 'var(--node-arbiter)', icon: 'var(--stone-light)' },
    draft: { bg: 'var(--node-draft)', icon: 'var(--stone-light)' },
    meta_evaluation: { bg: 'var(--node-meta-eval)', icon: 'var(--stone-light)' },
    fact_check: { bg: 'var(--node-fact-check)', icon: 'var(--stone-light)' },
    fact_check_pipeline: { bg: 'var(--node-fact-check)', icon: 'var(--stone-light)' },
    external_fact_check: { bg: 'var(--node-fact-check)', icon: 'var(--stone-light)' },
    fact_check_pipeline_gate: { bg: 'var(--node-gate)', icon: 'var(--stone-light)' },
    citation_source_generation: { bg: 'var(--node-strategy)', icon: 'var(--stone-light)' },
    citation_write: { bg: 'var(--node-fact-check)', icon: 'var(--stone-light)' },
    citation_fetch: { bg: 'var(--node-fact-check)', icon: 'var(--stone-light)' },
    citation_verify: { bg: 'var(--node-fact-check)', icon: 'var(--stone-light)' },
    citation_apply: { bg: 'var(--node-draft)', icon: 'var(--stone-light)' },
    citation_quality: { bg: 'var(--node-meta-eval)', icon: 'var(--stone-light)' },
    memory_recall: { bg: 'var(--node-fact-check)', icon: 'var(--stone-light)' },
    impact_prediction: { bg: 'var(--node-impact)', icon: 'var(--stone-light)' },
    revision: { bg: 'var(--node-draft)', icon: 'var(--stone-light)' },
    revise: { bg: 'var(--node-draft)', icon: 'var(--stone-light)' },
    response_strategy: { bg: 'var(--node-strategy)', icon: 'var(--stone-light)' },
    adversary_critique: { bg: 'var(--node-adversary)', icon: 'var(--stone-light)' },
    evaluate: { bg: 'var(--node-meta-eval)', icon: 'var(--stone-light)' },
    strategy_evaluation: { bg: 'var(--node-strategy)', icon: 'var(--stone-light)' },
    convergence: { bg: 'var(--node-convergence)', icon: 'var(--accent-light)' },
    convergence_check: { bg: 'var(--node-convergence)', icon: 'var(--accent-light)' },
    strategy_gate: { bg: 'var(--node-gate)', icon: 'var(--stone-light)' },
    exit: { bg: 'var(--node-exit)', icon: 'var(--accent-light)' },
  };
  return colors[type] || { bg: 'var(--stone)', icon: 'var(--stone-light)' };
};

// Node types that have a dedicated chat component. Keep this in
// sync with the dispatch block at the bottom of the trace render
// loop — if you add a new <SomethingChat> there, add the type here
// so the meta-summary box wrapper renders.
const RENDERED_NODE_TYPES = new Set([
  'clarify', 'clarification_gate', 'false_premise_gate',
  'draft', 'fact_check', 'fact_check_pipeline', 'external_fact_check',
  'fact_check_pipeline_gate',
  'citation_source_generation', 'citation_write', 'citation_fetch', 'citation_verify',
  'citation_apply', 'citation_quality',
  'memory_recall',
  'impact_prediction',
  'revision', 'revise',
  'convergence', 'convergence_check',
  'response_strategy', 'adversary_critique',
  'evaluate', 'strategy_evaluation',
  'strategy', 'adversary', 'arbiter',
  'strategy_gate', 'meta_evaluation', 'assessor',
  'case_classification', 'case_recall',
]);

// Reusable markdown components configuration
const markdownComponents = {
  h1: ({ node, ...props }: any) => <h1 style={{ color: 'var(--ink)', marginTop: '1.5rem', marginBottom: '1rem', fontFamily: 'var(--serif)', fontSize: '1.5rem', fontWeight: 500 }} {...props} />,
  h2: ({ node, ...props }: any) => <h2 style={{ color: 'var(--ink)', marginTop: '1.25rem', marginBottom: '0.75rem', fontFamily: 'var(--serif)', fontSize: '1.25rem', fontWeight: 500 }} {...props} />,
  h3: ({ node, ...props }: any) => <h3 style={{ color: 'var(--ink)', marginTop: '1rem', marginBottom: '0.5rem', fontFamily: 'var(--serif)', fontSize: '1.1rem', fontWeight: 500 }} {...props} />,
  h4: ({ node, ...props }: any) => <h4 style={{ color: 'var(--ink)', marginTop: '0.75rem', marginBottom: '0.5rem', fontFamily: 'var(--serif)', fontSize: '1rem', fontWeight: 500 }} {...props} />,
  h5: ({ node, ...props }: any) => <h5 style={{ color: 'var(--ink)', marginTop: '0.5rem', marginBottom: '0.25rem', fontFamily: 'var(--serif)', fontSize: '0.95rem', fontWeight: 500 }} {...props} />,
  h6: ({ node, ...props }: any) => <h6 style={{ color: 'var(--ink)', marginTop: '0.5rem', marginBottom: '0.25rem', fontFamily: 'var(--serif)', fontSize: '0.9rem', fontWeight: 500 }} {...props} />,
  p: ({ node, ...props }: any) => <p style={{ color: 'var(--ink)', marginBottom: '0.5rem', lineHeight: 1.6 }} {...props} />,
  ul: ({ node, ...props }: any) => <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', marginBottom: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }} {...props} />,
  ol: ({ node, ...props }: any) => <ol style={{ listStyleType: 'decimal', marginLeft: '1.5rem', color: 'var(--ink)', marginBottom: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }} {...props} />,
  li: ({ node, ...props }: any) => <li style={{ color: 'var(--ink)' }} {...props} />,
  blockquote: ({ node, ...props }: any) => <blockquote style={{ borderLeft: '4px solid var(--rule)', paddingLeft: '1rem', fontStyle: 'italic', color: 'var(--stone)', margin: '0.5rem 0' }} {...props} />,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--rule)', margin: '1rem 0', opacity: 0.5 }} />,
  code: ({ node, inline, ...props }: any) =>
    inline ? (
      <code style={{ background: 'var(--code-bg)', color: 'var(--code-string)', padding: '0.25rem 0.5rem', borderRadius: '2px', fontSize: '0.85rem', fontFamily: 'var(--mono)' }} {...props} />
    ) : (
      <code style={{ background: 'var(--code-bg)', color: 'var(--code-text)', padding: '0.5rem', borderRadius: '2px', display: 'block', fontSize: '0.85rem', fontFamily: 'var(--mono)', overflowX: 'auto', margin: '0.5rem 0' }} {...props} />
    ),
  a: ({ node, ...props }: any) => <a style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }} {...props} />,
  strong: ({ node, ...props }: any) => <strong style={{ fontWeight: 'bold', color: 'var(--ink)', background: 'var(--paper-warm)', padding: '0.25rem', borderRadius: '2px' }} {...props} />,
  em: ({ node, ...props }: any) => <em style={{ fontStyle: 'italic', color: 'var(--stone)' }} {...props} />,
  del: ({ node, ...props }: any) => <del style={{ textDecoration: 'line-through', color: 'var(--ink)', background: 'var(--code-keyword)', opacity: 0.3, padding: '0.25rem', borderRadius: '2px' }} {...props} />,
  ins: ({ node, ...props }: any) => <ins style={{ textDecoration: 'none', color: 'var(--ink)', background: 'var(--accent)', opacity: 0.2, padding: '0.25rem', borderRadius: '2px', fontWeight: 'bold' }} {...props} />,
};

// ---------------------------------------------------------------------------
// Citations (Citation_Application.md §9)
// ---------------------------------------------------------------------------

const verdictColor = (verdict: string): string =>
  verdict === 'refuted' ? 'var(--code-keyword)' : 'var(--accent)';

const verdictLabel = (verdict: string): string =>
  verdict === 'refuted' ? 'contradicts' : 'supports';

// Build a `citation` markdown component bound to a uuid→reference lookup.
// The resolved tag is <citation ref="<uuid…>" seq="<int…>">span</citation>;
// we read ref/seq off the hast node (React reserves the `ref` prop, so it is
// NOT available via component props — only via node.properties).
const makeCitationMark = (refsByUuid: Record<string, any>) =>
  ({ node, children }: any) => {
    const props = node?.properties || {};
    const seqRaw = props.seq != null ? String(props.seq) : '';
    const refRaw = props.ref != null ? String(props.ref) : '';
    const seqs = seqRaw.split(/\s+/).filter(Boolean);
    const uuids = refRaw.split(/\s+/).filter(Boolean);
    const refs = uuids.map((u) => refsByUuid[u]).filter(Boolean);
    const primary = refs[0];
    const marker = seqs.length ? `[${seqs.join(',')}]` : '';

    const tooltip = refs
      .map((r) => {
        const conf = typeof r.verification_confidence === 'number'
          ? ` (${(r.verification_confidence * 100).toFixed(0)}%)`
          : '';
        const src = r.sources?.[0];
        const srcLine = src?.title ? `\n${src.title}` : '';
        const span = src?.supporting_span || src?.excerpt;
        const spanLine = span ? `\n“${span}”` : '';
        return `${r.claim_text}\n${verdictLabel(r.verdict)}${conf}${srcLine}${spanLine}`;
      })
      .join('\n\n');

    const url = primary?.sources?.find((s: any) => s?.url)?.url;
    const color = primary ? verdictColor(primary.verdict) : 'var(--accent)';

    return (
      <span>
        {children}
        <sup
          title={tooltip}
          onClick={() => { if (url) window.open(url, '_blank', 'noopener,noreferrer'); }}
          style={{
            color,
            fontWeight: 700,
            cursor: url ? 'pointer' : 'help',
            marginLeft: '1px',
            fontSize: '0.75em',
          }}
        >
          {marker}
        </sup>
      </span>
    );
  };

const ReferencesSection = ({ references }: { references: any[] }) => (
  <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--rule)', marginTop: '0.75rem' }}>
    <p style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: '0.5rem', fontFamily: 'var(--serif)' }}>References</p>
    <ol style={{ listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {references.map((r) => (
        <li key={r.uuid} style={{ display: 'flex', gap: '0.5rem', fontSize: '15px', lineHeight: 1.5 }}>
          <span style={{ color: verdictColor(r.verdict), fontWeight: 700, minWidth: '1.6rem' }}>[{r.seq}]</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <span style={{ color: 'var(--ink)' }}>
              {r.claim_text}{' '}
              <span style={{ color: verdictColor(r.verdict), fontWeight: 600, textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.04em' }}>
                {r.verdict}
              </span>
              {typeof r.verification_confidence === 'number' && (
                <span style={{ color: 'var(--stone)', fontSize: '0.8rem' }}> · {(r.verification_confidence * 100).toFixed(0)}%</span>
              )}
            </span>
            {(r.sources || []).map((s: any, i: number) => (
              <span key={i} style={{ color: 'var(--stone)', fontSize: '0.85rem' }}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                    {s.title || s.url}
                  </a>
                ) : (s.title || '')}
                {(s.supporting_span || s.excerpt) && (
                  <span style={{ fontStyle: 'italic' }}> — “{s.supporting_span || s.excerpt}”</span>
                )}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ol>
  </div>
);

const CitationApplyChat = ({ content }: { content: any }) => {
  const references = Array.isArray(content?.references) ? content.references : [];
  const refsByUuid: Record<string, any> = {};
  references.forEach((r: any) => { refsByUuid[r.uuid] = r; });

  const rawResponse = content?.response || '';
  const response = typeof rawResponse === 'string'
    ? rawResponse.replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
    : '';

  const components = { ...markdownComponents, citation: makeCitationMark(refsByUuid) };

  const found = content?.tags_found ?? 0;
  const validated = content?.tags_validated ?? 0;
  const dropped = content?.refs_dropped ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
        <p style={{ fontWeight: 600, color: 'var(--accent)' }}>Citations applied</p>
        <p style={{ color: 'var(--ink)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Tags found: {found} · validated: {validated} · dropped (invalid): {dropped} · references: {references.length}
        </p>
      </div>

      {response && (
        <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--accent-light)' }}>
          <p style={{ fontWeight: 600, color: 'var(--accent-light)', marginBottom: '0.75rem' }}>Cited Answer:</p>
          <div className={styles.markdownContent}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={safeRawRehypePlugins as any} components={components}>
              {response}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {references.length > 0 && <ReferencesSection references={references} />}

      {references.length === 0 && (
        <p style={{ color: 'var(--stone)', fontSize: '0.9rem' }}>No verified citations were available for this response.</p>
      )}
    </div>
  );
};

const QualityGauge = ({ label, value }: { label: string; value: number | null }) => {
  const pct = typeof value === 'number' ? Math.round(value * 100) : null;
  const color = pct == null ? 'var(--stone)' : pct >= 80 ? 'var(--accent)' : pct >= 50 ? 'var(--code-func)' : 'var(--code-keyword)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: '5.5rem' }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--stone)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: '1.5rem', fontWeight: 700, color, fontFamily: 'var(--serif)' }}>
        {pct == null ? 'N/A' : `${pct}%`}
      </span>
    </div>
  );
};

const CitationQualityChat = ({ content }: { content: any }) => {
  const c = content || {};
  const counts = c.counts || {};
  const sentences = Array.isArray(c.sentences) ? c.sentences : [];

  if (c.evaluated === false) {
    return (
      <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.75rem', borderLeft: '4px solid var(--rule)' }}>
        <p style={{ fontWeight: 600, color: 'var(--ink)' }}>Citation Quality</p>
        <p style={{ color: 'var(--stone)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Not scored — {c.reason || 'no citations to evaluate'}.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--accent)' }}>
        <p style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '0.75rem' }}>Citation Quality (ALCE-style)</p>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <QualityGauge label="Recall" value={c.citation_recall} />
          <QualityGauge label="Precision" value={c.citation_precision} />
          <QualityGauge label="F1" value={c.citation_f1} />
        </div>
        <p style={{ color: 'var(--stone)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
          {counts.claim_bearing ?? 0} claim-bearing · {counts.claim_bearing_supported ?? 0} backed ·{' '}
          {counts.uncited_claims ?? 0} uncited · {counts.misattributed_citations ?? 0} misattributed
        </p>
      </div>

      {sentences.length > 0 && (
        <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--rule)' }}>
          <p style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: '0.5rem' }}>Per-sentence audit</p>
          <ul style={{ listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {sentences.map((s: any, i: number) => {
              const flagColor = !s.claim_bearing
                ? 'var(--stone)'
                : s.has_citation && s.citation_supports
                  ? 'var(--accent)'
                  : 'var(--code-keyword)';
              const tag = !s.claim_bearing
                ? 'non-claim'
                : !s.has_citation
                  ? 'uncited claim'
                  : s.citation_supports
                    ? `cited [${(s.cited_seqs || []).join(',')}]`
                    : 'misattributed';
              return (
                <li key={i} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.9rem', lineHeight: 1.4 }}>
                  <span style={{ color: flagColor, fontWeight: 600, minWidth: '7rem', fontSize: '0.75rem', textTransform: 'uppercase' }}>{tag}</span>
                  <span style={{ color: 'var(--ink)' }}>{s.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

// Helper function to create consistent box styles
const createBoxStyle = (borderColor: string) => ({
  background: 'var(--paper-warm)',
  borderRadius: '3px',
  padding: '0.75rem',
  borderLeft: `4px solid ${borderColor}`,
});

const createBoxTitleStyle = (color: string) => ({
  fontWeight: 600,
  color: color,
  marginBottom: '0.5rem',
});

const renderStructuredOutline = (items: StructuredOutlineItem[], depth = 0): ReactNode => {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul style={{ listStyleType: 'disc', marginLeft: depth === 0 ? '1.5rem' : '1.25rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {items.map((item, index) => (
        <li key={`${depth}-${index}`} style={{ fontSize: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{item.title}</span>
            {item.content && (
              <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {item.content}
              </p>
            )}
            {item.children.length > 0 && renderStructuredOutline(item.children, depth + 1)}
          </div>
        </li>
      ))}
    </ul>
  );
};

const extractMeaningfulText = (node: any): string => {
  const content = node.content || {};

  switch (node.type) {
    case 'input':
      return content.originalQuery || 'Input received';

    case 'clarify':
      if (content.ambiguities?.length > 0) {
        return `Ambiguities: ${content.ambiguities.join(', ')}`;
      }
      return content.reasoning || 'Clarification analysis';

    case 'clarification_gate':
      if (content.triggered) {
        const questionCount = content.questions?.length || 0;
        return `Early exit: Requesting clarification (${questionCount} question${questionCount !== 1 ? 's' : ''})`;
      }
      return 'Clarification gate check';

    case 'false_premise_gate':
      if (content.triggered) {
        const premiseCount = content.false_premises?.length || 0;
        return `Early exit: Correcting false premise${premiseCount !== 1 ? 's' : ''} (${premiseCount} identified)`;
      }
      return 'False premise check';

    case 'draft':
      if (content.draft_response || content.response) {
        return content.draft_response || content.response;
      }
      return 'Draft generated';

    case 'fact_check': {
      const claimCount = Array.isArray(content.critical_claims) ? content.critical_claims.length : 0;
      const confidenceLabel = isFiniteConfidence(content.confidence)
        ? ` | Confidence: ${(content.confidence * 100).toFixed(0)}%`
        : '';
      return `Claims: ${claimCount}${confidenceLabel}`;
    }

    case 'fact_check_pipeline': {
      const artifactMetadata = getFactCheckArtifactMetadata(content);
      if (artifactMetadata) {
        const claimCount = artifactMetadata.criticalClaimCount ?? 0;
        const confidenceLabel = isFiniteConfidence(artifactMetadata.confidence)
          ? ` | Confidence: ${(artifactMetadata.confidence * 100).toFixed(0)}%`
          : '';
        return `Claims: ${claimCount} | Artifact stored${confidenceLabel}`;
      }
      return 'Fact check pipeline';
    }

    case 'external_fact_check': {
      const summary = content.summary || {};
      return `Cache hits: ${summary.cache_hits ?? 0} | Pending: ${summary.pending_verification ?? 0} | Confidence: ${isFiniteConfidence(content.confidence) ? (content.confidence * 100).toFixed(0) : 'N/A'}%`;
    }

    case 'fact_check_pipeline_gate':
      return `Pipeline: ${content.decision || 'N/A'} | Pending claims: ${content.pending_claim_count ?? 0}`;

    case 'citation_source_generation':
      return `Source plans: ${content.claims?.length || 0} | Confidence: ${isFiniteConfidence(content.confidence) ? (content.confidence * 100).toFixed(0) : 'N/A'}%`;

    case 'citation_write': {
      const written = content.summary?.written_citations ?? content.citations?.length ?? 0;
      const totalClaims = content.summary?.total_claims ?? content.claims?.length ?? 0;
      return `Citations written: ${written} / ${totalClaims}`;
    }

    case 'citation_fetch': {
      const fetched = content.sources_fetched ?? 0;
      const failed = content.sources_failed ?? 0;
      const ms = content.duration_ms ?? 0;
      return `Sources fetched: ${fetched} | Failed: ${failed} | ${ms}ms`;
    }

    case 'citation_verify': {
      const sup = content.supported ?? 0;
      const ref = content.refuted ?? 0;
      const inc = content.inconclusive ?? 0;
      const calls = content.llm_calls ?? 0;
      return `Supported: ${sup} | Refuted: ${ref} | Inconclusive: ${inc} | LLM calls: ${calls}`;
    }

    case 'memory_recall': {
      const checked = content.claims_checked ?? 0;
      const seen = content.previously_seen ?? 0;
      const hit = content.recalled ?? 0;
      const verified = content.recalled_verified ?? 0;
      const neighbors = content.semantic_neighbors_found ?? 0;
      const semanticTail = neighbors > 0 ? ` | Semantic: ${neighbors}` : '';
      return `Checked: ${checked} | Prior: ${seen} | Cited: ${hit} | Verified: ${verified}${semanticTail}`;
    }

    case 'citation_apply': {
      const built = content.references_built ?? (Array.isArray(content.references) ? content.references.length : 0);
      const found = content.tags_found ?? 0;
      const dropped = content.refs_dropped ?? 0;
      return `Citations: ${built} | Tags: ${found} | Dropped: ${dropped}`;
    }

    case 'citation_quality': {
      if (content.evaluated === false) return 'Citation quality: not scored (no citations)';
      const pct = (v: number | null | undefined) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : 'N/A');
      return `Recall: ${pct(content.citation_recall)} | Precision: ${pct(content.citation_precision)} | F1: ${pct(content.citation_f1)}`;
    }

    case 'impact_prediction':
      return `Risk: ${content.overall_risk ? (content.overall_risk * 100).toFixed(0) : 'N/A'}% | Reaction: ${content.predicted_user_reaction || 'N/A'}`;

    case 'revision':
      if (content.changes_made?.length > 0) {
        return `${content.changes_made.length} changes made`;
      }
      return 'Revisions applied';

    case 'convergence':
    case 'convergence_check':
      const confidence = isFiniteConfidence(content.confidence) ? content.confidence : content.metrics?.confidence;
      const confidenceStr = isFiniteConfidence(confidence) ? (confidence * 100).toFixed(0) : 'N/A';
      return `Decision: ${content.decision || 'N/A'} | Confidence: ${confidenceStr}%`;

    case 'response_strategy':
      return `Strategy Type: ${content.response_type || 'N/A'} | Confidence: ${content.confidence_level || 'N/A'}`;

    case 'adversary_critique':
      const problemCount = content.problems?.length || 0;
      return `Problems identified: ${problemCount} | Reframed: ${content.reframed_question ? 'Yes' : 'No'}`;

    case 'evaluate':
      return `Quality: ${content.overall_quality_score ? content.overall_quality_score : 'N/A'} | Recommendation: ${content.recommendation || 'N/A'}`;

    case 'strategy_evaluation':
      return `Adherence: ${content.strategy_adherence_score ? content.strategy_adherence_score : 'N/A'} | Issues: ${content.identified_issues?.length || 0}`;

    case 'strategy':
      if (content.key_points?.length > 0) {
        return `Strategy: ${content.key_points.length} key points | Confidence: ${isFiniteConfidence(content.confidence) ? (content.confidence * 100).toFixed(0) : 'N/A'}%`;
      }
      return 'Strategy elaboration';

    case 'adversary':
      if (content.weak_assumptions?.length > 0) {
        return `Adversary: ${content.weak_assumptions.length} weak assumptions identified | Confidence: ${isFiniteConfidence(content.confidence) ? (content.confidence * 100).toFixed(0) : 'N/A'}%`;
      }
      return 'Adversary critique';

    case 'strategy_gate':
      const canProceed = content.decision === 'approved' ? 'Yes' : 'No';
      const isAnswerable = content.unanswerable ? 'No' : 'Yes';
      return `Can we answer this? ${canProceed} | Have enough info? ${isAnswerable} | Policy: ${content.response_contract?.response_policy?.policy || 'N/A'}`;

    // (fact_check and fact_check_pipeline summary cases handled above)

    case 'impact_prediction':
      if (content.implications?.length > 0) {
        return `Impact: ${content.implications.length} implications | Confidence: ${isFiniteConfidence(content.confidence) ? (content.confidence * 100).toFixed(0) : 'N/A'}%`;
      }
      return 'Impact prediction';

    default:
      return 'Processing...';
  }
};

const RevisionChat = ({ content, traceArray, nodeId }: { content: any; traceArray: any[]; nodeId: string }) => {
  const [showComparison, setShowComparison] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Find the previous draft node to compare
  const currentNodeIndex = traceArray.findIndex((n: any) => n.id === nodeId);
  const previousDraftNode = traceArray
    .slice(0, currentNodeIndex)
    .reverse()
    .find((n: any) => n.type === 'draft');

  // Ensure responses are strings (handle cases where they might be objects)
  // Try multiple possible field names for the original response
  let originalResponse = '';
  if (previousDraftNode?.content) {
    const contentObj = previousDraftNode.content;
    // Try different field names
    if (typeof contentObj.draft_response === 'string') {
      originalResponse = contentObj.draft_response;
    } else if (typeof contentObj.response === 'string') {
      originalResponse = contentObj.response;
    } else if (typeof contentObj.content === 'string') {
      originalResponse = contentObj.content;
    }
  }
  originalResponse = originalResponse.replace(/\\n/g, '\n').replace(/\\\\/g, '\\');

  // Extract just the markdown content (skip metadata like sources_needed, caveats, etc.)
  originalResponse = extractMeaningfulContent(originalResponse);

  // Try multiple possible field names for the revised response
  let revisedResponse = '';
  if (typeof content?.revised_response === 'string') {
    revisedResponse = content.revised_response;
  } else if (typeof content?.response === 'string') {
    revisedResponse = content.response;
  } else if (typeof content?.content === 'string') {
    revisedResponse = content.content;
  }
  revisedResponse = revisedResponse.replace(/\\n/g, '\n').replace(/\\\\/g, '\\');

  // Extract just the markdown content (skip metadata)
  revisedResponse = extractMeaningfulContent(revisedResponse);

  // Debug: Log the actual strings
  if (typeof window !== 'undefined') {
    console.log('=== NODE DATA ===');
    console.log('previousDraftNode:', JSON.stringify(previousDraftNode, null, 2).substring(0, 500));
    console.log('content:', JSON.stringify(content, null, 2).substring(0, 500));
  }

  // Calculate diff using the utility function
  const diffResult = calculateDiff(originalResponse, revisedResponse);
  const originalVersion = diffResult.originalWithMarkup;
  const revisedVersion = diffResult.revisedClean;

  // Debug: Log the diff result
  if (typeof window !== 'undefined') {
    console.log('=== DIFF RESULT ===');
    console.log('Has changes:', diffResult.hasChanges);
    console.log('Change count:', diffResult.changeCount);
    console.log('Original version length:', originalVersion.length);
    console.log('Contains <del>:', originalVersion.includes('<del>'));
    console.log('Contains <ins>:', originalVersion.includes('<ins>'));
  }

  // Count changes for summary
  const changeCount = content.changes_made?.length || 0;

  // Render the side-by-side comparison content
  const ComparisonContent = () => {
    return (
      <>
        <p style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: '1rem' }}>✏️ Side-by-Side Comparison:</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          {/* Original Version - shows deletions */}
          <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', border: '1px solid var(--rule)' }}>
            <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '0.75rem' }}>Original</p>
            <div style={{ color: 'var(--ink)', lineHeight: 1.6, fontSize: '16px', fontWeight: 400, maxHeight: '60vh', overflowY: 'auto', maxWidth: '100%' }} className={styles.markdownContent}>
              <DiffRenderer html={originalVersion} components={markdownComponents} />
            </div>
          </div>

          {/* Revised Version - shows insertions */}
          <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', border: '1px solid var(--rule)' }}>
            <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '0.75rem' }}>✅ Revised</p>
            <div style={{ color: 'var(--ink)', lineHeight: 1.6, fontSize: '16px', fontWeight: 400, maxHeight: '60vh', overflowY: 'auto', maxWidth: '100%' }} className={styles.markdownContent}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={safeRawRehypePlugins as any} components={markdownComponents}>
                {revisedVersion}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}
    >
      {revisedResponse && (
        <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--accent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <p style={{ fontWeight: 600, color: 'var(--accent)' }}>✨ Revised Draft</p>
            <button
              onClick={() => setShowComparison(!showComparison)}
              style={{
                padding: '0.25rem 0.75rem',
                borderRadius: '2px',
                fontSize: '16px',
                fontWeight: 600,
                background: 'var(--accent)',
                color: 'var(--paper)',
                border: 'none',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--accent-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--accent)';
              }}
            >
              {showComparison ? 'Hide Comparison' : 'Show Comparison'}
            </button>
          </div>

          {!showComparison && (
            // Compact view: Render the full revised markdown
            <div className={styles.markdownContent}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {revisedResponse}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {/* Modal Overlay for Expanded Comparison */}
      {showComparison && (
        <>
          {/* Background Overlay */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'var(--overlay-strong)',
              zIndex: 40,
            }}
            onClick={() => setShowComparison(false)}
          />

          {/* Modal Content */}
          <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem', pointerEvents: 'none' }}>
            <div
              style={{
                background: 'var(--paper)',
                borderRadius: '4px',
                border: '1px solid var(--rule)',
                width: '100%',
                maxWidth: '90vw',
                maxHeight: '85vh',
                overflowY: 'auto',
                boxShadow: 'var(--shadow-strong)',
                pointerEvents: 'auto',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div style={{ position: 'sticky', top: 0, background: 'var(--paper)', borderBottom: '1px solid var(--rule)', padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--ink)', fontFamily: 'var(--serif)' }}>Revision Comparison</h3>
                <button
                  onClick={() => setShowComparison(false)}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '2px',
                    fontSize: '16px',
                    fontWeight: 600,
                    background: 'var(--paper-warm)',
                    color: 'var(--ink)',
                    border: '1px solid var(--rule)',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--rule)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--paper-warm)';
                  }}
                >
                  Close
                </button>
              </div>

              {/* Modal Content */}
              <div style={{ padding: '1.5rem' }}>
                <ComparisonContent />
              </div>
            </div>
          </div>
        </>
      )}

      {Array.isArray(content.changes_made) && content.changes_made.length > 0 && (
        <button
          onClick={() => setShowComparison(true)}
          style={{
            width: '100%',
            textAlign: 'left',
            background: 'var(--paper-warm)',
            borderRadius: '3px',
            padding: '0.75rem',
            borderLeft: '4px solid var(--accent)',
            cursor: 'pointer',
            transition: 'background 0.2s',
            border: '1px solid var(--rule)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--code-bg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--paper-warm)';
          }}
        >
          <p style={{ fontWeight: 600, color: 'var(--accent)' }}>{content.changes_made.length} Change{content.changes_made.length !== 1 ? 's' : ''} Made</p>
          <p style={{ color: 'var(--stone)', fontSize: '16px', marginTop: '0.25rem' }}>Click to view detailed comparison →</p>
        </button>
      )}

      {content.new_confidence !== undefined && (
        <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
          <p style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '0.5rem' }}>New Confidence:</p>
          <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)' }}>{(content.new_confidence * 100).toFixed(0)}%</p>
        </div>
      )}
    </div>
  );
};

const renderListBox = (title: string, items: any[], color: string) => {
  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <div style={createBoxStyle(color)}>
      <p style={createBoxTitleStyle(color)}>{title}:</p>
      <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {items.map((item: any, i: number) => (
          <li key={i} style={{ fontSize: '16px' }}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
        ))}
      </ul>
    </div>
  );
};

const renderResponsePolicyBox = (policy: any, title = 'Response Policy') => {
  if (!policy || typeof policy !== 'object') return null;
  const hasContent = policy.policy || policy.rationale || policy.delivery_goal || policy.delivery_variant;
  if (!hasContent) return null;

  return (
    <div style={createBoxStyle('var(--accent)')}>
      <p style={createBoxTitleStyle('var(--accent)')}>{title}:</p>
      {policy.policy && <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '16px', fontWeight: 600, marginBottom: '0.35rem' }}>{policy.policy}</p>}
      {policy.rationale && <p style={{ color: 'var(--ink)', fontSize: '16px', marginBottom: '0.35rem' }}>{policy.rationale}</p>}
      {policy.delivery_goal && <p style={{ color: 'var(--stone)', fontSize: '15px', marginBottom: '0.25rem' }}><strong>Delivery goal:</strong> {policy.delivery_goal}</p>}
      {policy.delivery_variant && <p style={{ color: 'var(--stone)', fontSize: '15px' }}><strong>Delivery variant:</strong> {policy.delivery_variant}</p>}
    </div>
  );
};

const renderSectionPlanBox = (sectionPlan: any[], title = 'Section Plan') => {
  if (!Array.isArray(sectionPlan) || sectionPlan.length === 0) return null;

  return (
    <div style={createBoxStyle('var(--code-type)')}>
      <p style={createBoxTitleStyle('var(--code-type)')}>{title}:</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {sectionPlan.map((section: any, i: number) => (
          <div key={i} style={{ background: 'var(--paper)', borderRadius: '2px', padding: '0.75rem', border: '1px solid var(--rule)' }}>
            <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '15px', fontWeight: 600, marginBottom: '0.35rem' }}>{section?.tag || `Section ${i + 1}`}</p>
            {section?.goal && <p style={{ color: 'var(--ink)', fontSize: '15px', marginBottom: '0.25rem' }}><strong>Goal:</strong> {section.goal}</p>}
            {section?.instruction && <p style={{ color: 'var(--ink)', fontSize: '15px', marginBottom: '0.25rem' }}><strong>Instruction:</strong> {section.instruction}</p>}
            {section?.reasoning && <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.25rem' }}><strong>Why:</strong> {section.reasoning}</p>}
            {Array.isArray(section?.preferred_content) && section.preferred_content.length > 0 && (
              <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.25rem' }}><strong>Preferred:</strong> {section.preferred_content.join(' • ')}</p>
            )}
            {Array.isArray(section?.forbidden_content) && section.forbidden_content.length > 0 && (
              <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.25rem' }}><strong>Avoid:</strong> {section.forbidden_content.join(' • ')}</p>
            )}
            {section?.tone_notes && <p style={{ color: 'var(--stone)', fontSize: '14px' }}><strong>Tone:</strong> {section.tone_notes}</p>}
          </div>
        ))}
      </div>
    </div>
  );
};

const renderSectionLikeValue = (title: string, value: any, color: string) => {
  if (!value) return null;

  if (typeof value === 'string') {
    return (
      <div style={createBoxStyle(color)}>
        <p style={createBoxTitleStyle(color)}>{title}:</p>
        <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{value}</p>
      </div>
    );
  }

  if (Array.isArray(value)) {
    return renderSectionPlanBox(value, title);
  }

  if (typeof value === 'object') {
    const looksLikeSection = (
      'tag' in value
      || 'goal' in value
      || 'instruction' in value
      || 'reasoning' in value
    );

    if (looksLikeSection) {
      return renderSectionPlanBox([value], title);
    }

    return (
      <div style={createBoxStyle(color)}>
        <p style={createBoxTitleStyle(color)}>{title}:</p>
        <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{JSON.stringify(value)}</p>
      </div>
    );
  }

  return (
    <div style={createBoxStyle(color)}>
      <p style={createBoxTitleStyle(color)}>{title}:</p>
      <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{String(value)}</p>
    </div>
  );
};

const renderStatGrid = (items: Array<{ label: string; value: any }>, color = 'var(--accent)', title = 'Summary') => {
  const filteredItems = items.filter((item) => item.value !== undefined && item.value !== null && item.value !== '');
  if (filteredItems.length === 0) return null;

  return (
    <div style={createBoxStyle(color)}>
      <p style={createBoxTitleStyle(color)}>{title}:</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
        {filteredItems.map((item, index) => (
          <div key={`${item.label}-${index}`}>
            <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.2rem' }}>{item.label}</p>
            <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '16px', margin: 0, wordBreak: 'break-word' }}>
              {String(item.value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

const DraftChat = ({ content }: { content: any }) => {
  // Handle both 'response' and 'draft_response' field names
  const rawResponse = content.draft_response || content.response || '';

  // Handle escaped newlines in draft_response
  const draftResponse = typeof rawResponse === 'string'
    ? rawResponse.replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
    : '';

  // Check if this is a clarification request
  const isClarificationRequest = content.clarification_request === true;

  return (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
    {/* Clarification Request Badge */}
    {isClarificationRequest && (
      <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.75rem', borderLeft: '4px solid var(--code-keyword)' }}>
        <p style={{ fontWeight: 600, color: 'var(--code-keyword)' }}>Clarification Needed</p>
        <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, marginTop: '0.25rem' }}>This query requires clarification before a full response can be provided.</p>
      </div>
    )}

    {draftResponse && (
      <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--accent-light)' }}>
        <p style={{ fontWeight: 600, color: 'var(--accent-light)', marginBottom: '0.75rem' }}>{isClarificationRequest ? 'Clarification Request' : 'Draft Response'}:</p>
        <div className={styles.markdownContent}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {draftResponse}
          </ReactMarkdown>
        </div>
      </div>
    )}

    {renderResponsePolicyBox(content.execution_contract?.response_policy, 'Applied Response Policy')}
    {renderListBox('Required Moves', content.execution_contract?.required_moves, 'var(--code-string)')}
    {renderListBox('Forbidden Moves', content.execution_contract?.forbidden_moves, 'var(--code-keyword)')}
    {renderSectionPlanBox(content.execution_contract?.section_plan, 'Applied Section Plan')}
    {renderListBox('Dangerous Terms', content.execution_contract?.dangerous_terms, 'var(--code-keyword)')}
    {renderListBox('Invalid Components', content.execution_contract?.invalid_components, 'var(--code-func)')}

    {Array.isArray(content.key_claims) && content.key_claims.length > 0 && (
      <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
        <p style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '0.5rem' }}>Key Claims:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.key_claims.map((claim: any, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof claim === 'string' ? claim : JSON.stringify(claim)}</li>
          ))}
        </ul>
      </div>
    )}

    {Array.isArray(content.sources_needed) && content.sources_needed.length > 0 && (
      <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.75rem', borderLeft: '4px solid var(--code-string)' }}>
        <p style={{ fontWeight: 600, color: 'var(--code-string)', marginBottom: '0.5rem' }}>Sources Needed:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.sources_needed.map((source: any, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof source === 'string' ? source : JSON.stringify(source)}</li>
          ))}
        </ul>
      </div>
    )}

    {Array.isArray(content.caveats) && content.caveats.length > 0 && (
      <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.75rem', borderLeft: '4px solid var(--code-keyword)' }}>
        <p style={{ fontWeight: 600, color: 'var(--code-keyword)', marginBottom: '0.5rem' }}>Caveats:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.caveats.map((caveat: any, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof caveat === 'string' ? caveat : JSON.stringify(caveat)}</li>
          ))}
        </ul>
      </div>
    )}

    {Array.isArray(content.assumptions) && content.assumptions.length > 0 && (
      <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.75rem', borderLeft: '4px solid var(--code-func)' }}>
        <p style={{ fontWeight: 600, color: 'var(--code-func)', marginBottom: '0.5rem' }}>Assumptions Made:</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {content.assumptions.map((assumption: any, i: number) => (
            <div key={i} style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, background: 'var(--code-bg)', borderRadius: '2px', padding: '0.5rem' }}>
              {typeof assumption === 'string' ? (
                <p>{assumption}</p>
              ) : (
                <>
                  {assumption.assumption && (
                    <p style={{ fontWeight: 600, color: 'var(--code-keyword)' }}>• {assumption.assumption}</p>
                  )}
                  {assumption.rationale && (
                    <p style={{ color: 'var(--stone)', marginLeft: '0.75rem', marginTop: '0.25rem' }}>Rationale: {assumption.rationale}</p>
                  )}
                  {assumption.impact && (
                    <p style={{ color: 'var(--stone-light)', marginLeft: '0.75rem', fontStyle: 'italic' }}>Impact if wrong: {assumption.impact}</p>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    )}

    {content.overall_confidence !== undefined && (
      <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
        <p style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '0.5rem' }}>Confidence:</p>
        <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)' }}>{(content.overall_confidence * 100).toFixed(0)}%</p>
      </div>
    )}
  </div>
);
};

// Shared helper: extract claims/sources from the node's raw_output as a fallback
// when structured fields aren't directly present on `content`.
const parseFactCheckRawOutput = (rawOutput?: string, content?: any) => {
  const outputStr = rawOutput || content?.raw_output;
  if (!outputStr || typeof outputStr !== 'string') {
    return { claims: [] as any[], sources: [] as any[], artifactMetadata: null as ReturnType<typeof getFactCheckArtifactMetadata> };
  }

  const allClaims: any[] = [];
  const allSources: any[] = [];
  let artifactMetadata: ReturnType<typeof getFactCheckArtifactMetadata> = null;

  const collectParsedObject = (obj: any) => {
    artifactMetadata = artifactMetadata || getFactCheckArtifactMetadata(obj);
    const claims = obj?.critical_claims || obj?.claims_checked || [];
    if (Array.isArray(claims)) {
      allClaims.push(...claims);
      if (obj?.sources && Array.isArray(obj.sources)) {
        allSources.push(...obj.sources);
      }
    }
  };

  try {
    collectParsedObject(JSON.parse(outputStr));
    return { claims: allClaims, sources: allSources, artifactMetadata };
  } catch (e) {
    // Fall through to the older multi-object format.
  }

  const jsonObjects = outputStr.split('\n\n').filter((s: string) => s.trim());
  for (const jsonStr of jsonObjects) {
    try {
      collectParsedObject(JSON.parse(jsonStr));
    } catch (e) {
      // Skip malformed JSON objects
    }
  }
  return { claims: allClaims, sources: allSources, artifactMetadata };
};

// Pipeline mode: claims persisted to disk, downstream fact-check pipeline nodes
// rehydrate them. Renders artifact metadata + the claims themselves.
const FactCheckPipelineChat = ({ content, rawOutput }: { content: any; rawOutput?: string }) => {
  const { claims: rawClaims, sources: rawSources, artifactMetadata: rawArtifactMetadata } = parseFactCheckRawOutput(rawOutput, content);
  const artifactMetadata = getFactCheckArtifactMetadata(content) || rawArtifactMetadata;

  const hasCriticalClaims = Array.isArray(content.critical_claims) && content.critical_claims.length > 0;
  const hasOldFormat = Array.isArray(content.claims_checked) && content.claims_checked.length > 0;
  const claimsToDisplay = hasCriticalClaims ? content.critical_claims : hasOldFormat ? content.claims_checked : rawClaims;
  const sourcesToDisplay = (hasCriticalClaims || hasOldFormat) ? (content.sources || []) : rawSources;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {artifactMetadata && (
        <div style={createBoxStyle('var(--node-fact-check)')}>
          <p style={createBoxTitleStyle('var(--node-fact-check)')}>Persisted Claims Artifact</p>
          {artifactMetadata.summary && (
            <p style={{ color: 'var(--ink)', fontSize: '16px', lineHeight: 1.6, marginBottom: '0.75rem' }}>
              {artifactMetadata.summary}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
            <div>
              <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.2rem' }}>Critical Claims</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '16px', margin: 0 }}>{artifactMetadata.criticalClaimCount ?? 'N/A'}</p>
            </div>
            <div>
              <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.2rem' }}>Confidence</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '16px', margin: 0 }}>
                {isFiniteConfidence(artifactMetadata.confidence) ? `${(artifactMetadata.confidence * 100).toFixed(0)}%` : 'N/A'}
              </p>
            </div>
            <div>
              <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.2rem' }}>Generated At</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '16px', margin: 0 }}>
                {artifactMetadata.generatedAt ? new Date(artifactMetadata.generatedAt).toLocaleString() : 'N/A'}
              </p>
            </div>
            <div>
              <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.2rem' }}>Source Node</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '16px', margin: 0 }}>{artifactMetadata.sourceNode || 'N/A'}</p>
            </div>
          </div>
          {artifactMetadata.artifactPath && (
            <p style={{ color: 'var(--stone)', fontSize: '14px', marginTop: '0.75rem', marginBottom: '0.25rem' }}>
              Artifact Path
            </p>
          )}
          {artifactMetadata.artifactPath && (
            <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '14px', margin: 0, wordBreak: 'break-all' }}>
              {artifactMetadata.artifactPath}
            </p>
          )}
          {artifactMetadata.factStoreRoot && (
            <>
              <p style={{ color: 'var(--stone)', fontSize: '14px', marginTop: '0.75rem', marginBottom: '0.25rem' }}>
                Fact Store Root
              </p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '14px', margin: 0, wordBreak: 'break-all' }}>
                {artifactMetadata.factStoreRoot}
              </p>
            </>
          )}
          <p style={{ color: 'var(--stone)', fontSize: '14px', marginTop: '0.75rem', fontStyle: 'italic' }}>
            Claims are persisted to disk and rehydrated by downstream fact-check pipeline nodes.
          </p>
        </div>
      )}

      {claimsToDisplay.length > 0 && (
        <div style={createBoxStyle('var(--code-func)')}>
          <p style={createBoxTitleStyle('var(--code-func)')}>Critical Factual Claims:</p>
          <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '16px', fontWeight: 400 }}>
            {claimsToDisplay.map((claim: any, i: number) => {
              const claimText = typeof claim === 'string' ? claim : claim.claim || JSON.stringify(claim);
              const importance = typeof claim === 'object' && claim.importance ? claim.importance : '';
              return (
                <li key={i} style={{ fontSize: '16px' }}>
                  <p style={{ color: 'var(--ink)', marginBottom: '0.25rem' }}>{claimText}</p>
                  {importance && (
                    <p style={{ color: 'var(--stone)', fontSize: '14px', marginLeft: '0.5rem', marginTop: '0.25rem', fontStyle: 'italic' }}>
                      Why critical: {importance}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(() => {
        const uniqueSources: string[] = Array.from(new Set(
          sourcesToDisplay
            .filter((s: any) => s !== null && (typeof s === 'string' ? s.trim().length > 0 : true))
            .map((s: any) => typeof s === 'string' ? s : JSON.stringify(s))
        )) as string[];
        return uniqueSources.length > 0 ? (
          <div style={createBoxStyle('var(--code-string)')}>
            <p style={createBoxTitleStyle('var(--code-string)')}>Sources (Unverified):</p>
            <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {uniqueSources.map((source: string, i: number) => (
                <li key={i} style={{ fontSize: '16px' }}>{source}</li>
              ))}
            </ul>
          </div>
        ) : null;
      })()}
    </div>
  );
};

// Normal mode: clean inline claim extraction. No persistence, no artifact metadata.
const FactCheckChat = ({ content, rawOutput }: { content: any; rawOutput?: string }) => {
  const { claims: rawClaims, sources: rawSources } = parseFactCheckRawOutput(rawOutput, content);

  const hasCriticalClaims = Array.isArray(content.critical_claims) && content.critical_claims.length > 0;
  const hasOldFormat = Array.isArray(content.claims_checked) && content.claims_checked.length > 0;
  const hasStructuredData = hasCriticalClaims || hasOldFormat;

  const claimsToDisplay = hasCriticalClaims ? content.critical_claims : hasOldFormat ? content.claims_checked : rawClaims;
  const sourcesToDisplay = hasStructuredData ? (content.sources || []) : rawSources;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {/* Summary + confidence header */}
      {(content.summary || isFiniteConfidence(content.confidence)) && (
        <div style={createBoxStyle('var(--node-fact-check)')}>
          {content.summary && (
            <p style={{ color: 'var(--ink)', fontSize: '16px', lineHeight: 1.6, marginBottom: '0.5rem' }}>
              {content.summary}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
            <div>
              <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.2rem' }}>Critical Claims</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '16px', margin: 0 }}>{claimsToDisplay.length}</p>
            </div>
            {isFiniteConfidence(content.confidence) && (
              <div>
                <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.2rem' }}>Confidence</p>
                <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '16px', margin: 0 }}>
                  {(content.confidence * 100).toFixed(0)}%
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Handle critical_claims (new format) */}
      {claimsToDisplay.length > 0 && (
        <div style={createBoxStyle('var(--code-func)')}>
          <p style={createBoxTitleStyle('var(--code-func)')}>Critical Factual Claims:</p>
          <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '16px', fontWeight: 400 }}>
            {claimsToDisplay.map((claim: any, i: number) => {
              // Handle both new format (object with claim/importance/source) and old format (string)
              const claimText = typeof claim === 'string' ? claim : claim.claim || JSON.stringify(claim);
              const importance = typeof claim === 'object' && claim.importance ? claim.importance : '';
              return (
                <li key={i} style={{ fontSize: '16px' }}>
                  <p style={{ color: 'var(--ink)', marginBottom: '0.25rem' }}>{claimText}</p>
                  {importance && (
                    <p style={{ color: 'var(--stone)', fontSize: '14px', marginLeft: '0.5rem', marginTop: '0.25rem', fontStyle: 'italic' }}>
                      Why critical: {importance}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p style={{ color: 'var(--stone)', fontSize: '14px', marginTop: '0.5rem', fontStyle: 'italic' }}>
            Note: These claims require external verification. Verification service coming in future release.
          </p>
        </div>
      )}

      {/* Handle sources if available - filter out empty strings and null values, and deduplicate */}
      {(() => {
        const uniqueSources: string[] = Array.from(new Set(
          sourcesToDisplay
            .filter((s: any) => s !== null && (typeof s === 'string' ? s.trim().length > 0 : true))
            .map((s: any) => typeof s === 'string' ? s : JSON.stringify(s))
        )) as string[];
        return uniqueSources.length > 0 ? (
          <div style={createBoxStyle('var(--code-string)')}>
            <p style={createBoxTitleStyle('var(--code-string)')}>Sources (Unverified):</p>
            <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {uniqueSources.map((source: string, i: number) => (
                <li key={i} style={{ fontSize: '16px' }}>{source}</li>
              ))}
            </ul>
            <p style={{ color: 'var(--stone)', fontSize: '14px', marginTop: '0.5rem', fontStyle: 'italic' }}>
              All sources are unverified. External verification service coming in future release.
            </p>
          </div>
        ) : null;
      })()}

    {Array.isArray(content.factual_errors) && content.factual_errors.length > 0 && (
      <div style={createBoxStyle('var(--code-keyword)')}>
        <p style={createBoxTitleStyle('var(--code-keyword)')}>Factual Errors:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {content.factual_errors.map((item: any, i: number) => {
            if (typeof item === 'string') {
              return <li key={i} style={{ fontSize: '16px' }}>{item}</li>;
            }
            if (typeof item === 'object' && item !== null) {
              return (
                <li key={i} style={{ fontSize: '16px' }}>
                  {item.claim && <p style={{ fontFamily: 'var(--mono)', color: 'var(--code-keyword)' }}>"{item.claim}"</p>}
                  {item.issue && <p style={{ color: 'var(--stone)', marginLeft: '0.5rem' }}>Issue: {item.issue}</p>}
                  {item.correction && <p style={{ color: 'var(--stone)', marginLeft: '0.5rem' }}>Correction: {item.correction}</p>}
                  {item.severity && <p style={{ color: 'var(--stone-light)', marginLeft: '0.5rem', fontSize: '0.7rem' }}>Severity: {item.severity}</p>}
                </li>
              );
            }
            return <li key={i} style={{ fontSize: '16px' }}>{JSON.stringify(item)}</li>;
          })}
        </ul>
      </div>
    )}

    {Array.isArray(content.unverifiable_claims) && content.unverifiable_claims.length > 0 && (
      <div style={createBoxStyle('var(--code-string)')}>
        <p style={createBoxTitleStyle('var(--code-string)')}>Unverifiable Claims:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {content.unverifiable_claims.map((item: any, i: number) => {
            if (typeof item === 'string') {
              return <li key={i} style={{ fontSize: '16px' }}>{item}</li>;
            }
            if (typeof item === 'object' && item !== null) {
              return (
                <li key={i} style={{ fontSize: '16px' }}>
                  {item.claim && <p style={{ fontFamily: 'var(--mono)', color: 'var(--code-string)' }}>"{item.claim}"</p>}
                  {item.issue && <p style={{ color: 'var(--stone)', marginLeft: '0.5rem' }}>{item.issue}</p>}
                </li>
              );
            }
            return <li key={i} style={{ fontSize: '16px' }}>{JSON.stringify(item)}</li>;
          })}
        </ul>
      </div>
    )}

    {Array.isArray(content.misleading_statements) && content.misleading_statements.length > 0 && (
      <div style={createBoxStyle('var(--code-func)')}>
        <p style={createBoxTitleStyle('var(--code-func)')}>Misleading Statements:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {content.misleading_statements.map((item: any, i: number) => {
            if (typeof item === 'string') {
              return <li key={i} style={{ fontSize: '16px' }}>{item}</li>;
            }
            if (typeof item === 'object' && item !== null) {
              return (
                <li key={i} style={{ fontSize: '16px' }}>
                  {item.claim && <p style={{ fontFamily: 'var(--mono)', color: 'var(--code-func)' }}>"{item.claim}"</p>}
                  {item.issue && <p style={{ color: 'var(--stone)', marginLeft: '0.5rem' }}>{item.issue}</p>}
                </li>
              );
            }
            return <li key={i} style={{ fontSize: '16px' }}>{JSON.stringify(item)}</li>;
          })}
        </ul>
      </div>
    )}

    {Array.isArray(content.missing_qualifications) && content.missing_qualifications.length > 0 && (
      <div style={createBoxStyle('var(--accent)')}>
        <p style={createBoxTitleStyle('var(--accent)')}>Missing Qualifications:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {content.missing_qualifications.map((item: any, i: number) => {
            if (typeof item === 'string') {
              return <li key={i} style={{ fontSize: '16px' }}>{item}</li>;
            }
            if (typeof item === 'object' && item !== null) {
              return (
                <li key={i} style={{ fontSize: '16px' }}>
                  {item.claim && <p style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>"{item.claim}"</p>}
                  {item.issue && <p style={{ color: 'var(--stone)', marginLeft: '0.5rem' }}>{item.issue}</p>}
                </li>
              );
            }
            return <li key={i} style={{ fontSize: '16px' }}>{JSON.stringify(item)}</li>;
          })}
        </ul>
      </div>
    )}

    {Array.isArray(content.confidence_issues) && content.confidence_issues.length > 0 && (
      <div style={createBoxStyle('var(--code-type)')}>
        <p style={createBoxTitleStyle('var(--code-type)')}>Confidence Issues:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {content.confidence_issues.map((item: any, i: number) => {
            if (typeof item === 'string') {
              return <li key={i} style={{ fontSize: '16px' }}>{item}</li>;
            }
            if (typeof item === 'object' && item !== null) {
              return (
                <li key={i} style={{ fontSize: '16px' }}>
                  {item.claim && <p style={{ fontFamily: 'var(--mono)', color: 'var(--code-type)' }}>"{item.claim}"</p>}
                  {item.issue && <p style={{ color: 'var(--stone)', marginLeft: '0.5rem' }}>{item.issue}</p>}
                </li>
              );
            }
            return <li key={i} style={{ fontSize: '16px' }}>{JSON.stringify(item)}</li>;
          })}
        </ul>
      </div>
    )}

    {content.overall_assessment && (
      <div style={createBoxStyle('var(--accent-light)')}>
        <p style={createBoxTitleStyle('var(--accent-light)')}>Overall Assessment:</p>
        <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{content.overall_assessment}</p>
      </div>
    )}

    {content.has_critical_errors && (
      <div style={createBoxStyle('var(--code-keyword)')}>
        <p style={createBoxTitleStyle('var(--code-keyword)')}>Critical Errors Found</p>
        <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>This response contains critical factual errors that need correction.</p>
      </div>
    )}

    {content.has_any_issues && !content.has_critical_errors && (
      <div style={createBoxStyle('var(--code-string)')}>
        <p style={createBoxTitleStyle('var(--code-string)')}>Issues Found</p>
        <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>This response has some issues that should be addressed.</p>
      </div>
    )}
    </div>
  );
};

const ExternalFactCheckChat = ({ content }: { content: any }) => {
  const claims = Array.isArray(content?.claims) ? content.claims : [];
  const summary = content?.summary || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {renderStatGrid([
        { label: 'Retrieval Mode', value: content?.retrieval_mode },
        { label: 'Claims', value: summary.total_claims ?? claims.length },
        { label: 'Cache Hits', value: summary.cache_hits ?? 0 },
        { label: 'Cache Misses', value: summary.cache_misses ?? 0 },
        { label: 'Pending Verification', value: summary.pending_verification ?? 0 },
        { label: 'Confidence', value: isFiniteConfidence(content?.confidence) ? `${(content.confidence * 100).toFixed(0)}%` : 'N/A' },
      ], 'var(--node-fact-check)', 'External Fact Check Summary')}

      {renderStatGrid([
        { label: 'Exact Hits', value: summary.exact_hits ?? 0 },
        { label: 'Partial Hits', value: summary.partial_hits ?? 0 },
        { label: 'Fuzzy Hits', value: summary.fuzzy_hits ?? 0 },
        { label: 'Provisional Hits', value: summary.provisional_hits ?? 0 },
        { label: 'Expired Hits', value: summary.expired_hits ?? 0 },
        { label: 'Generated At', value: content?.generated_at ? new Date(content.generated_at).toLocaleString() : null },
      ], 'var(--code-string)', 'Cache Match Breakdown')}

      {renderSectionLikeValue('Fact Store Root', content?.fact_store_root, 'var(--code-type)')}

      {claims.length > 0 && (
        <div style={createBoxStyle('var(--code-func)')}>
          <p style={createBoxTitleStyle('var(--code-func)')}>Claim Results:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {claims.map((claim: any, index: number) => (
              <div key={claim?.claim_key || index} style={{ background: 'var(--paper)', borderRadius: '2px', padding: '0.75rem', border: '1px solid var(--rule)' }}>
                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 600, marginBottom: '0.4rem' }}>{claim?.claim_text || 'Unknown claim'}</p>
                <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.25rem' }}><strong>Status:</strong> {claim?.verification_status || 'N/A'}</p>
                {claim?.match_type && <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.25rem' }}><strong>Match Type:</strong> {claim.match_type}</p>}
                {claim?.cache_file && <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.25rem', wordBreak: 'break-all' }}><strong>Citation File:</strong> {claim.cache_file}</p>}
                {claim?.notes && <p style={{ color: 'var(--ink)', fontSize: '15px', marginBottom: '0.25rem' }}>{claim.notes}</p>}
                {claim?.citation?.verdict && <p style={{ color: 'var(--ink)', fontSize: '14px', marginBottom: '0.25rem' }}><strong>Verdict:</strong> {claim.citation.verdict}</p>}
                {Array.isArray(claim?.citation?.sources) && claim.citation.sources.length > 0 && (
                  <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem' }}>
                    {claim.citation.sources.slice(0, 3).map((source: any, sourceIndex: number) => (
                      <li key={sourceIndex} style={{ fontSize: '14px' }}>
                        {source?.title || source?.url || JSON.stringify(source)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const FactCheckPipelineGateChat = ({ content }: { content: any }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
    {renderStatGrid([
      { label: 'Pipeline Enabled', value: content?.enabled ? 'Yes' : 'No' },
      { label: 'Decision', value: content?.decision },
      { label: 'Reason', value: content?.reason },
      { label: 'Pending Claims', value: content?.pending_claim_count ?? 0 },
    ], 'var(--node-gate)', 'Pipeline Gate Decision')}
    {renderListBox(
      'Pending Claims',
      (Array.isArray(content?.pending_claims) ? content.pending_claims : []).map((claim: any) => `${claim.claim_text} (${claim.verification_status})`),
      'var(--code-keyword)'
    )}
  </div>
);

const CitationSourceGenerationChat = ({ content }: { content: any }) => {
  const claims = Array.isArray(content?.claims) ? content.claims : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {renderStatGrid([
        { label: 'Generated Plans', value: claims.length },
        { label: 'Retrieval Mode', value: content?.retrieval_mode },
        { label: 'Deferred', value: content?.retrieval_deferred ? 'Yes' : 'No' },
        { label: 'Confidence', value: isFiniteConfidence(content?.confidence) ? `${(content.confidence * 100).toFixed(0)}%` : 'N/A' },
        { label: 'Generated At', value: content?.generated_at ? new Date(content.generated_at).toLocaleString() : null },
      ], 'var(--node-strategy)', 'Candidate Source Generation')}

      {renderSectionLikeValue('Summary', content?.summary, 'var(--accent)')}

      {claims.length > 0 && (
        <div style={createBoxStyle('var(--code-func)')}>
          <p style={createBoxTitleStyle('var(--code-func)')}>Generated Claim Plans:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {claims.map((claim: any, index: number) => (
              <div key={claim?.claim_key || index} style={{ background: 'var(--paper)', borderRadius: '2px', padding: '0.75rem', border: '1px solid var(--rule)' }}>
                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 600, marginBottom: '0.4rem' }}>{claim?.claim_text || 'Unknown claim'}</p>
                {claim?.research_direction && <p style={{ color: 'var(--ink)', fontSize: '15px', marginBottom: '0.35rem' }}>{claim.research_direction}</p>}
                {Array.isArray(claim?.search_queries) && claim.search_queries.length > 0 && (
                  <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.35rem' }}><strong>Search Queries:</strong> {claim.search_queries.join(' • ')}</p>
                )}
                {Array.isArray(claim?.candidate_sources) && claim.candidate_sources.length > 0 && (
                  <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {claim.candidate_sources.map((source: any, sourceIndex: number) => (
                      <li key={sourceIndex} style={{ fontSize: '14px' }}>
                        {source?.title || source?.url || 'Untitled source'}{source?.why ? ` — ${source.why}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const CitationWriteChat = ({ content }: { content: any }) => {
  const claims = Array.isArray(content?.claims) ? content.claims : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {renderStatGrid([
        { label: 'Claims Processed', value: content?.summary?.total_claims ?? claims.length },
        { label: 'Citations Written', value: content?.summary?.written_citations ?? 0 },
        { label: 'Skipped Claims', value: content?.summary?.skipped_claims ?? 0 },
        { label: 'Candidate Sources', value: content?.summary?.total_candidate_sources ?? 0 },
        { label: 'Retrieval Log Entries', value: content?.summary?.retrieval_log_entries ?? 0 },
        { label: 'Generated At', value: content?.generated_at ? new Date(content.generated_at).toLocaleString() : null },
      ], 'var(--node-fact-check)', 'Citation Artifact Write Summary')}

      {renderSectionLikeValue('Fact Store Root', content?.fact_store_root, 'var(--code-type)')}
      {renderSectionLikeValue('Retrieval Mode', content?.retrieval_mode, 'var(--accent-light)')}

      {claims.length > 0 && (
        <div style={createBoxStyle('var(--code-func)')}>
          <p style={createBoxTitleStyle('var(--code-func)')}>Written Claim Records:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {claims.map((claim: any, index: number) => (
              <div key={claim?.claim_key || index} style={{ background: 'var(--paper)', borderRadius: '2px', padding: '0.75rem', border: '1px solid var(--rule)' }}>
                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 600, marginBottom: '0.4rem' }}>{claim?.claim_text || 'Unknown claim'}</p>
                <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.25rem' }}><strong>Status:</strong> {claim?.verification_status || 'N/A'}</p>
                {claim?.citation_file && <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.25rem', wordBreak: 'break-all' }}><strong>Citation File:</strong> {claim.citation_file}</p>}
                {claim?.candidate_sources_count !== undefined && <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.25rem' }}><strong>Candidate Sources:</strong> {claim.candidate_sources_count}</p>}
                {Array.isArray(claim?.search_queries) && claim.search_queries.length > 0 && (
                  <p style={{ color: 'var(--stone)', fontSize: '14px', marginBottom: '0.25rem' }}><strong>Search Queries:</strong> {claim.search_queries.join(' • ')}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const CitationFetchChat = ({ content }: { content: any }) => {
  const results = Array.isArray(content?.results) ? content.results : [];
  const allSources = results.flatMap((r: any) => Array.isArray(r?.sources) ? r.sources : []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {renderStatGrid([
        { label: 'Citations Processed', value: content?.citations_processed ?? results.length },
        { label: 'Sources Fetched',     value: content?.sources_fetched ?? 0 },
        { label: 'Sources Failed',      value: content?.sources_failed ?? 0 },
        { label: 'Sources Skipped',     value: content?.sources_skipped ?? 0 },
        { label: 'Citation Errors',     value: content?.citation_errors ?? 0 },
        { label: 'Duration',            value: content?.duration_ms !== undefined ? `${content.duration_ms}ms` : null },
      ], 'var(--node-fact-check)', 'Citation Fetch Summary')}

      {allSources.length > 0 && (
        <div style={createBoxStyle('var(--code-func)')}>
          <p style={createBoxTitleStyle('var(--code-func)')}>Fetched Sources:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {allSources.map((s: any, i: number) => {
              const failed = !!s?.error;
              return (
                <div
                  key={i}
                  style={{
                    background: 'var(--paper)',
                    borderRadius: '2px',
                    padding: '0.6rem 0.75rem',
                    borderLeft: `3px solid ${failed ? 'var(--code-keyword)' : 'var(--accent)'}`,
                    border: '1px solid var(--rule)',
                  }}
                >
                  {s?.extracted_title && (
                    <p style={{ color: 'var(--ink)', fontWeight: 600, marginBottom: '0.2rem' }}>{s.extracted_title}</p>
                  )}
                  <p style={{ color: 'var(--stone)', fontSize: '14px', fontFamily: 'var(--mono)', wordBreak: 'break-all', marginBottom: '0.2rem' }}>
                    {s?.url}
                  </p>
                  <p style={{ color: 'var(--stone)', fontSize: '13px', marginBottom: '0.2rem' }}>
                    {failed
                      ? <span style={{ color: 'var(--code-keyword)' }}>Error: {s.error}</span>
                      : (
                        <>
                          <strong>Status:</strong> {s?.status_code ?? '-'} •
                          {' '}<strong>HTML:</strong> {s?.source_file ? '✓' : '—'} •
                          {' '}<strong>Markdown:</strong> {s?.markdown_file ? '✓' : '—'} •
                          {' '}<strong>Retrieved:</strong> {s?.retrieved_at ? new Date(s.retrieved_at).toLocaleString() : '—'}
                        </>
                      )
                    }
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const VERDICT_COLOR: Record<string, string> = {
  supported:    'var(--accent)',
  refuted:      'var(--code-keyword)',
  inconclusive: 'var(--stone)',
  off_topic:    'var(--stone-light)',
  unreachable:  'var(--stone-light)',
  contested:    'var(--code-string)',
  unverified:   'var(--stone-light)',
};

const CitationVerifyChat = ({ content }: { content: any }) => {
  const results = Array.isArray(content?.results) ? content.results : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {renderStatGrid([
        { label: 'Citations Processed', value: content?.citations_processed ?? results.length },
        { label: 'Supported',           value: content?.supported ?? 0 },
        { label: 'Refuted',             value: content?.refuted ?? 0 },
        { label: 'Inconclusive',        value: content?.inconclusive ?? 0 },
        { label: 'Off-Topic',           value: content?.off_topic ?? 0 },
        { label: 'Unreachable',         value: content?.unreachable ?? 0 },
        { label: 'LLM Calls',           value: content?.llm_calls ?? 0 },
        { label: 'Duration',            value: content?.duration_ms !== undefined ? `${content.duration_ms}ms` : null },
      ], 'var(--node-fact-check)', 'Citation Verify Summary')}

      {results.length > 0 && (
        <div style={createBoxStyle('var(--code-func)')}>
          <p style={createBoxTitleStyle('var(--code-func)')}>Per-Citation Verdicts:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {results.map((r: any, i: number) => {
              const verdict = r?.verdict || 'unverified';
              const color = VERDICT_COLOR[verdict] || 'var(--stone)';
              return (
                <div key={i} style={{ background: 'var(--paper)', borderRadius: '2px', padding: '0.75rem', border: '1px solid var(--rule)', borderLeft: `3px solid ${color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.35rem' }}>
                    <p style={{ color, fontWeight: 600, margin: 0, fontSize: '16px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {verdict}
                    </p>
                    {r?.claim_key && (
                      <p style={{ color: 'var(--stone)', fontFamily: 'var(--mono)', fontSize: '12px', margin: 0 }}>
                        {String(r.claim_key).slice(0, 12)}…
                      </p>
                    )}
                  </div>
                  {r?.breakdown && (
                    <p style={{ color: 'var(--stone)', fontSize: '13px', marginBottom: '0.4rem' }}>
                      <strong>Sources:</strong> {r.breakdown.supported || 0} supported,
                      {' '}{r.breakdown.refuted || 0} refuted,
                      {' '}{r.breakdown.inconclusive || 0} inconclusive,
                      {' '}{r.breakdown.off_topic || 0} off-topic,
                      {' '}{r.breakdown.unreachable || 0} unreachable
                    </p>
                  )}
                  {Array.isArray(r?.sources) && r.sources.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.4rem' }}>
                      {r.sources.map((s: any, j: number) => {
                        const v = s?.verification?.verdict || 'unreachable';
                        const c = VERDICT_COLOR[v] || 'var(--stone)';
                        return (
                          <div key={j} style={{ paddingLeft: '0.5rem', borderLeft: `2px solid ${c}` }}>
                            {s?.extracted_title && (
                              <p style={{ color: 'var(--ink)', fontSize: '14px', fontWeight: 500, margin: 0 }}>{s.extracted_title}</p>
                            )}
                            <p style={{ color: 'var(--stone)', fontFamily: 'var(--mono)', fontSize: '12px', wordBreak: 'break-all', margin: 0 }}>{s?.url}</p>
                            <p style={{ color: c, fontSize: '13px', margin: '0.2rem 0 0 0' }}>
                              <strong>{v}</strong>
                              {typeof s?.verification?.confidence === 'number' && (
                                <span style={{ color: 'var(--stone)' }}>{' '}· {(s.verification.confidence * 100).toFixed(0)}% confidence</span>
                              )}
                              {s?.verification?.reasoning && (
                                <span style={{ color: 'var(--stone)' }}> — {s.verification.reasoning}</span>
                              )}
                            </p>
                            {s?.verification?.quoted_excerpt && (
                              <p style={{ color: 'var(--ink)', fontStyle: 'italic', fontSize: '13px', margin: '0.2rem 0 0 0', borderLeft: '2px solid var(--rule)', paddingLeft: '0.5rem' }}>
                                “{s.verification.quoted_excerpt}”
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const MemoryRecallChat = ({ content }: { content: any }) => {
  const results = Array.isArray(content?.results) ? content.results : [];
  const hits = results.filter((r: any) => r?.recall?.hit);
  const priorSeenItems = results.filter((r: any) => r?.previously_seen);
  const neighborGroups = results.filter((r: any) => Array.isArray(r?.semantic_neighbors) && r.semantic_neighbors.length > 0);
  const provider = content?.embedding_provider || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {renderStatGrid([
        { label: 'Claims Checked',     value: content?.claims_checked ?? results.length },
        { label: 'Previously Seen',    value: content?.previously_seen ?? 0 },
        { label: 'Cited (any)',        value: content?.recalled ?? 0 },
        { label: 'Verified Citations', value: content?.recalled_verified ?? 0 },
        { label: 'Semantic Neighbors', value: content?.semantic_neighbors_found ?? 0 },
        { label: 'Embedding Model',    value: provider },
      ], 'var(--node-fact-check)', 'Memory Recall Summary')}

      {priorSeenItems.length > 0 && hits.length === 0 && (
        <div style={createBoxStyle('var(--accent-light)')}>
          <p style={createBoxTitleStyle('var(--accent-light)')}>Previously seen — exact matches in prior sessions:</p>
          <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.3rem', margin: 0, paddingLeft: '1.5rem' }}>
            {priorSeenItems.map((r: any, i: number) => (
              <li key={i} style={{ fontSize: '14px', color: 'var(--ink)' }}>{r.claim_text}</li>
            ))}
          </ul>
          <p style={{ color: 'var(--stone)', fontSize: '12px', marginTop: '0.5rem', fontStyle: 'italic' }}>
            These claims have been persisted before. Run <code>irg-external-facts</code> on a query
            covering them to write verified citations.
          </p>
        </div>
      )}

      {results.length === 0 && (
        <div style={createBoxStyle('var(--stone-light)')}>
          <p style={{ color: 'var(--stone)', margin: 0 }}>No claims were available to look up in memory.</p>
        </div>
      )}

      {hits.length > 0 && (
        <div style={createBoxStyle('var(--accent)')}>
          <p style={createBoxTitleStyle('var(--accent)')}>Hits — prior evidence found:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {hits.map((r: any, i: number) => {
              const v = r?.recall?.verdict || 'unknown';
              const c = VERDICT_COLOR[v] || 'var(--stone)';
              return (
                <div key={i} style={{ background: 'var(--paper)', borderRadius: '2px', padding: '0.6rem 0.75rem', border: '1px solid var(--rule)', borderLeft: `3px solid ${c}` }}>
                  <p style={{ color: 'var(--ink)', fontSize: '14px', fontWeight: 500, margin: 0, marginBottom: '0.2rem' }}>{r.claim_text}</p>
                  <p style={{ color: c, fontSize: '13px', margin: 0 }}>
                    <strong>{v}</strong>
                    {r?.recall?.verification_level && (
                      <span style={{ color: 'var(--stone)' }}> · {r.recall.verification_level}</span>
                    )}
                    {r?.recall?.source_count !== undefined && (
                      <span style={{ color: 'var(--stone)' }}> · {r.recall.source_count} source{r.recall.source_count === 1 ? '' : 's'}</span>
                    )}
                    {r?.recall?.created_at && (
                      <span style={{ color: 'var(--stone)' }}> · cached {new Date(r.recall.created_at).toLocaleDateString()}</span>
                    )}
                  </p>
                  {r?.recall?.citation_path && (
                    <p style={{ color: 'var(--stone)', fontFamily: 'var(--mono)', fontSize: '12px', wordBreak: 'break-all', margin: '0.2rem 0 0 0' }}>{r.recall.citation_path}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {neighborGroups.length > 0 && (
        <div style={createBoxStyle('var(--code-string)')}>
          <p style={createBoxTitleStyle('var(--code-string)')}>Semantic Neighbors — related prior claims:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {neighborGroups.map((r: any, i: number) => (
              <div key={i} style={{ background: 'var(--paper)', borderRadius: '2px', padding: '0.6rem 0.75rem', border: '1px solid var(--rule)' }}>
                <p style={{ color: 'var(--stone)', fontSize: '13px', margin: 0, marginBottom: '0.3rem' }}>
                  Current claim:
                </p>
                <p style={{ color: 'var(--ink)', fontSize: '14px', fontWeight: 500, margin: 0, marginBottom: '0.4rem' }}>
                  {r.claim_text}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', paddingLeft: '0.75rem', borderLeft: '2px solid var(--rule)' }}>
                  {r.semantic_neighbors.map((n: any, j: number) => (
                    <div key={j}>
                      <p style={{ color: 'var(--ink)', fontSize: '13px', margin: 0 }}>
                        {n.claim_text}
                      </p>
                      <p style={{ color: 'var(--stone)', fontSize: '12px', fontFamily: 'var(--mono)', margin: 0 }}>
                        similarity {(n.similarity || 0).toFixed(3)}
                        {n.domain && <> · {n.domain}</>}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.length > 0 && hits.length === 0 && neighborGroups.length === 0 && (
        <div style={createBoxStyle('var(--stone-light)')}>
          <p style={{ color: 'var(--stone)', margin: 0 }}>
            No prior evidence found for these claims — exact or semantic. The fact-store will accrue
            claims as queries are processed; once citations are written via <code>irg-external-facts</code>,
            future runs will recall them here.
          </p>
        </div>
      )}
    </div>
  );
};

const ImpactPredictionChat = ({ content }: { content: any }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
    {/* Handle implications (potential impacts) */}
    {Array.isArray(content.implications) && content.implications.length > 0 && (
      <div style={createBoxStyle('var(--code-string)')}>
        <p style={createBoxTitleStyle('var(--code-string)')}>💡 Potential Implications:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.implications.map((item: any, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
          ))}
        </ul>
      </div>
    )}

    {/* Handle limitations */}
    {Array.isArray(content.limitations) && content.limitations.length > 0 && (
      <div style={createBoxStyle('var(--code-keyword)')}>
        <p style={createBoxTitleStyle('var(--code-keyword)')}>Limitations:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.limitations.map((item: any, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
          ))}
        </ul>
      </div>
    )}

    {/* Fallback for predicted_user_reaction if it exists */}
    {content.predicted_user_reaction && (
      <div style={createBoxStyle('var(--code-string)')}>
        <p style={createBoxTitleStyle('var(--code-string)')}>Predicted User Reaction:</p>
        <p style={{ color: 'var(--ink)' }}>{content.predicted_user_reaction}</p>
        {content.satisfaction_likelihood !== undefined && (
          <p style={{ color: 'var(--stone)', marginTop: '0.5rem' }}>Satisfaction likelihood: <span style={{ fontFamily: 'var(--mono)' }}>{(content.satisfaction_likelihood * 100).toFixed(0)}%</span></p>
        )}
      </div>
    )}

    {/* Fallback for misunderstanding_risks if it exists */}
    {Array.isArray(content.misunderstanding_risks) && content.misunderstanding_risks.length > 0 && (
      <div style={createBoxStyle('var(--code-keyword)')}>
        <p style={createBoxTitleStyle('var(--code-keyword)')}>Misunderstanding Risks:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.misunderstanding_risks.map((item: any, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
          ))}
        </ul>
      </div>
    )}

    {content.harm_assessment && (
      <div style={createBoxStyle('var(--code-func)')}>
        <p style={createBoxTitleStyle('var(--code-func)')}>🛡️ Harm Assessment:</p>
        <p style={{ color: 'var(--ink)' }}>Level: <span style={{ fontWeight: 600 }}>{content.harm_assessment.level}</span></p>
        {Array.isArray(content.harm_assessment.concerns) && content.harm_assessment.concerns.length > 0 && (
          <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.5rem' }}>
            {content.harm_assessment.concerns.map((concern: any, i: number) => (
              <li key={i} style={{ fontSize: '16px' }}>{typeof concern === 'string' ? concern : JSON.stringify(concern)}</li>
            ))}
          </ul>
        )}
      </div>
    )}

    {Array.isArray(content.positive_impacts) && content.positive_impacts.length > 0 && (
      <div style={createBoxStyle('var(--accent)')}>
        <p style={createBoxTitleStyle('var(--accent)')}>✨ Positive Impacts:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.positive_impacts.map((impact: any, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof impact === 'string' ? impact : JSON.stringify(impact)}</li>
          ))}
        </ul>
      </div>
    )}

    {Array.isArray(content.stakeholder_effects) && content.stakeholder_effects.length > 0 && (
      <div style={createBoxStyle('var(--accent-light)')}>
        <p style={createBoxTitleStyle('var(--accent-light)')}>👥 Stakeholder Effects:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.stakeholder_effects.map((effect: any, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof effect === 'string' ? effect : JSON.stringify(effect)}</li>
          ))}
        </ul>
      </div>
    )}

    {Array.isArray(content.mitigation_strategies) && content.mitigation_strategies.length > 0 && (
      <div style={createBoxStyle('var(--code-type)')}>
        <p style={createBoxTitleStyle('var(--code-type)')}>🛠️ Mitigation Strategies:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.mitigation_strategies.map((strategy: any, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof strategy === 'string' ? strategy : JSON.stringify(strategy)}</li>
          ))}
        </ul>
      </div>
    )}

    {content.overall_risk !== undefined && (
      <div style={createBoxStyle('var(--code-string)')}>
        <p style={createBoxTitleStyle('var(--code-string)')}>📈 Overall Risk:</p>
        <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)' }}>{(content.overall_risk * 100).toFixed(0)}%</p>
      </div>
    )}
  </div>
);

const ResponseStrategyChat = ({ content }: { content: any }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
    {content.outline && Array.isArray(content.outline) && content.outline.length > 0 && (
      <div style={createBoxStyle('var(--accent)')}>
        <p style={createBoxTitleStyle('var(--accent)')}>Strategy Outline:</p>
        <ol style={{ listStyleType: 'decimal', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.outline.map((item: string, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{item}</li>
          ))}
        </ol>
      </div>
    )}

    {content.confidence_level && (
      <div style={createBoxStyle('var(--code-string)')}>
        <p style={createBoxTitleStyle('var(--code-string)')}>Confidence Level:</p>
        <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)' }}>{content.confidence_level}</p>
        {content.confidence_basis && (
          <p style={{ color: 'var(--stone)', fontSize: '16px', marginTop: '0.5rem' }}>{content.confidence_basis}</p>
        )}
      </div>
    )}

    {content.response_type && (
      <div style={createBoxStyle('var(--code-type)')}>
        <p style={createBoxTitleStyle('var(--code-type)')}>Response Type:</p>
        <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)' }}>{content.response_type}</p>
      </div>
    )}

    {content.metadata && Array.isArray(content.metadata) && content.metadata.length > 0 && (
      <div style={createBoxStyle('var(--accent)')}>
        <p style={createBoxTitleStyle('var(--accent)')}>Strategy Metadata:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {content.metadata.map((item: any, i: number) => {
            // Handle both string and object metadata items
            if (typeof item === 'string') {
              return <li key={i} style={{ fontSize: '16px' }}>{item}</li>;
            }

            // Handle object metadata with text and tags
            if (typeof item === 'object' && item !== null) {
              const text = item.text || item.item_number || '';
              const tags = item.tags || {};
              const tagList = Object.keys(tags).filter(tag => tags[tag]);

              return (
                <li key={i} style={{ fontSize: '16px' }}>
                  <div style={{ marginBottom: '0.25rem' }}>{text}</div>
                  {tagList.length > 0 && (
                    <div style={{ marginLeft: '1rem', color: 'var(--stone)', fontSize: '0.7rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {tagList.map((tag, j) => (
                        <span key={j} style={{ display: 'inline-block', padding: '0.25rem 0.5rem', background: 'var(--paper-warm)', borderRadius: '2px', border: '1px solid var(--rule)' }}>
                          [{tag}]
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            }

            return <li key={i} style={{ fontSize: '16px' }}>Invalid metadata item</li>;
          })}
        </ul>
      </div>
    )}
  </div>
);

const AdversaryCritiqueChat = ({ content }: { content: any }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
    {content.problems && Array.isArray(content.problems) && content.problems.length > 0 && (
      <div style={createBoxStyle('var(--code-keyword)')}>
        <p style={createBoxTitleStyle('var(--code-keyword)')}>Problems Identified:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.problems.map((problem: string, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{problem}</li>
          ))}
        </ul>
      </div>
    )}

    {content.reframed_question && (
      <div style={createBoxStyle('var(--accent)')}>
        <p style={createBoxTitleStyle('var(--accent)')}>Reframed Question:</p>
        <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, fontStyle: 'italic' }}>{content.reframed_question}</p>
      </div>
    )}

    {content.reframe_rationale && (
      <div style={createBoxStyle('var(--accent-light)')}>
        <p style={createBoxTitleStyle('var(--accent-light)')}>💡 Rationale:</p>
        <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{content.reframe_rationale}</p>
      </div>
    )}

    {content.clarification_needed && Array.isArray(content.clarification_needed) && content.clarification_needed.length > 0 && (
      <div style={createBoxStyle('var(--code-string)')}>
        <p style={createBoxTitleStyle('var(--code-string)')}>Clarification Needed:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.clarification_needed.map((item: string, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{item}</li>
          ))}
        </ul>
      </div>
    )}

    {content.early_exit_recommended && (
      <div style={createBoxStyle('var(--code-keyword)')}>
        <p style={createBoxTitleStyle('var(--code-keyword)')}>Early Exit Recommended</p>
        {content.early_exit_reason && (
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{content.early_exit_reason}</p>
        )}
      </div>
    )}
  </div>
);

const EvaluateChat = ({ content }: { content: any }) => {
  // Handle both structured and flat YAML-parsed content
  const getFieldValue = (key: string) => content[key] || content[`- ${key}`];
  const score = getFieldValue('Score') || content.overall_quality_score;
  const recommendation = getFieldValue('Recommendation') || content.recommendation;
  const reasoning = getFieldValue('Reasoning') || content.reasoning;
  const factualErrors = getFieldValue('Factual errors') || getFieldValue('Factual Errors');
  const overallAssessment = getFieldValue('Overall assessment');
  const potentialHarms = getFieldValue('Potential harms');
  const clarityAndStructure = getFieldValue('Clarity and structure');
  const concerns = Object.entries(content)
    .filter(([key]) => key.startsWith('- Concern'))
    .map(([, value]) => value);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {content.formatting_issues && (
        <div style={createBoxStyle('var(--code-keyword)')}>
          <p style={createBoxTitleStyle('var(--code-keyword)')}>Formatting Issues:</p>
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{content.formatting_issues}</p>
        </div>
      )}

      {factualErrors && (
        <div style={createBoxStyle('var(--accent)')}>
          <p style={createBoxTitleStyle('var(--accent)')}>Factual Errors:</p>
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{factualErrors}</p>
        </div>
      )}

      {overallAssessment && (
        <div style={createBoxStyle('var(--accent-light)')}>
          <p style={createBoxTitleStyle('var(--accent-light)')}>Overall Assessment:</p>
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{overallAssessment}</p>
        </div>
      )}

      {potentialHarms && (
        <div style={createBoxStyle('var(--code-func)')}>
          <p style={createBoxTitleStyle('var(--code-func)')}>Potential Harms:</p>
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{potentialHarms}</p>
        </div>
      )}

      {clarityAndStructure && (
        <div style={createBoxStyle('var(--code-type)')}>
          <p style={createBoxTitleStyle('var(--code-type)')}>Clarity & Structure:</p>
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{clarityAndStructure}</p>
        </div>
      )}

      {score && (
        <div style={createBoxStyle('var(--code-string)')}>
          <p style={createBoxTitleStyle('var(--code-string)')}>⭐ Overall Quality Score:</p>
          <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1rem' }}>{score}</p>
        </div>
      )}

      {recommendation && (
        <div style={{
          ...createBoxStyle(
            String(recommendation || '').toLowerCase() === 'accept'
              ? 'var(--accent)'
              : String(recommendation || '').toLowerCase() === 'revise'
              ? 'var(--code-string)'
              : 'var(--accent-light)'
          )
        }}>
          <p style={{
            ...createBoxTitleStyle(
              String(recommendation || '').toLowerCase() === 'accept'
                ? 'var(--accent)'
                : String(recommendation || '').toLowerCase() === 'revise'
                ? 'var(--code-string)'
                : 'var(--accent-light)'
            )
          }}>
            Recommendation: {String(recommendation || '').toUpperCase()}
          </p>
          {reasoning && (
            <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{reasoning}</p>
          )}
        </div>
      )}

      {concerns.length > 0 && (
        <div style={createBoxStyle('var(--code-keyword)')}>
          <p style={createBoxTitleStyle('var(--code-keyword)')}>Key Concerns:</p>
          <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {concerns.map((concern: any, i: number) => (
              <li key={i} style={{ fontSize: '16px' }}>{String(concern)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const StrategyEvaluationChat = ({ content }: { content: any }) => {
  // Handle both structured and flat YAML-parsed content
  const getFieldValue = (key: string) => content[key] || content[`- ${key}`];
  const score = getFieldValue('Score') || content.strategy_adherence_score;
  const adherenceScore = getFieldValue('STRATEGY ADHERENCE') || score;
  const issues = getFieldValue('Issues') || getFieldValue('Identified Issues') || content.identified_issues;
  const recommendations = getFieldValue('Recommendations') || getFieldValue('Recommendations for Improvement') || content.recommendations_for_improvement;
  const strengths = getFieldValue('Strengths') || content.strengths;
  const assessment = getFieldValue('Overall Assessment') || getFieldValue('Assessment') || content.overall_assessment;

  // Extract any text content that looks like evaluation results
  const textContent = Object.entries(content)
    .filter(([key, value]) => typeof value === 'string' && !key.startsWith('_') && key !== 'Based on the provided data, here is the evaluation of the draft response against the strategy outline')
    .map(([key, value]) => ({ key, value }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {adherenceScore && (
        <div style={createBoxStyle('var(--accent)')}>
          <p style={createBoxTitleStyle('var(--accent)')}>Strategy Adherence:</p>
          <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '16px', fontWeight: 400 }}>{adherenceScore}%</p>
        </div>
      )}

      {issues && (
        <div style={createBoxStyle('var(--code-keyword)')}>
          <p style={createBoxTitleStyle('var(--code-keyword)')}>Issues:</p>
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{String(issues)}</p>
        </div>
      )}

      {recommendations && (
        <div style={createBoxStyle('var(--code-string)')}>
          <p style={createBoxTitleStyle('var(--code-string)')}>Recommendations:</p>
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{String(recommendations)}</p>
        </div>
      )}

      {strengths && (
        <div style={createBoxStyle('var(--accent-light)')}>
          <p style={createBoxTitleStyle('var(--accent-light)')}>Strengths:</p>
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{String(strengths)}</p>
        </div>
      )}

      {assessment && (
        <div style={createBoxStyle('var(--code-type)')}>
          <p style={createBoxTitleStyle('var(--code-type)')}>Overall Assessment:</p>
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{String(assessment)}</p>
        </div>
      )}

      {textContent.length > 0 && !adherenceScore && !assessment && (
        <div style={createBoxStyle('var(--code-func)')}>
          <p style={createBoxTitleStyle('var(--code-func)')}>Evaluation Results:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>
            {textContent.slice(0, 5).map(({ key, value }, i) => (
              <div key={i}>
                <p style={{ fontWeight: 600, color: 'var(--code-func)' }}>{key}:</p>
                <p style={{ color: 'var(--stone)', marginLeft: '0.5rem' }}>{String(value).substring(0, 200)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const AssessorChat = ({ content }: { content: any }) => {
  const dimensionNames: { [key: string]: string } = {
    claim_evidence_alignment: 'Claim-Evidence Alignment',
    confidence_calibration: 'Confidence Calibration',
    scope_discipline: 'Scope Discipline',
    omission_awareness: 'Omission Awareness',
    internal_consistency: 'Internal Consistency',
    reasoning_transparency: 'Reasoning Transparency',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '14px' }}>
      {/* Assessor Decision - Leading Section */}
      {(content.assessor_decision || content.release_decision) && (
        <div style={createBoxStyle('var(--code-string)')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={createBoxTitleStyle('var(--code-string)')}>Assessor Decision:</p>
            <p style={{ color: 'var(--ink)', fontWeight: 400, fontSize: '16px', textAlign: 'right' }}>{normalizeAssessorDecision(content.assessor_decision || content.release_decision).toUpperCase()}</p>
          </div>
        </div>
      )}

      {/* Overall Assessor Score */}
      {content.overall_eie_score !== undefined && (
        <div style={createBoxStyle('var(--accent)')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={createBoxTitleStyle('var(--accent)')}>Overall Assessor Score:</p>
            <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, fontFamily: 'var(--mono)', textAlign: 'right' }}>
              {(content.overall_eie_score * 100).toFixed(0)}%
            </p>
          </div>
        </div>
      )}

      {/* EIE Dimensions with Justifications */}
      {content.eie_dimensions && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {Object.entries(content.eie_dimensions).map(([dimKey, dimData]: [string, any]) => {
            const score = typeof dimData === 'object' ? dimData.score : dimData;
            const justification = typeof dimData === 'object' ? dimData.justification : '';
            const examples = typeof dimData === 'object' ? dimData.supporting_examples : [];
            const improvements = typeof dimData === 'object' ? dimData.improvement_areas : '';

            return (
              <div key={dimKey} style={createBoxStyle('var(--code-func)')}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <p style={{ ...createBoxTitleStyle('var(--code-func)'), textAlign: 'left' }}>{dimensionNames[dimKey] || dimKey}:</p>
                  <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, fontFamily: 'var(--mono)', textAlign: 'right' }}>
                    {(score * 100).toFixed(0)}%
                  </p>
                </div>

                {justification && (
                  <div style={{ marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--rule)' }}>
                    <p style={{ color: 'var(--stone)', fontSize: '16px', fontWeight: 600, marginBottom: '0.25rem' }}>Justification:</p>
                    <p style={{ color: 'var(--ink)', fontSize: '14px', lineHeight: 1.5 }}>{justification}</p>
                  </div>
                )}

                {examples && examples.length > 0 && (
                  <div style={{ marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--rule)' }}>
                    <p style={{ color: 'var(--stone)', fontSize: '16px', fontWeight: 600, marginBottom: '0.25rem' }}>Supporting Examples:</p>
                    <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {examples.map((example: string, i: number) => (
                        <li key={i} style={{ fontSize: '14px' }}>{example}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {improvements && score < 0.8 && (
                  <div>
                    <p style={{ color: 'var(--stone)', fontSize: '16px', fontWeight: 600, marginBottom: '0.25rem' }}>Areas for Improvement:</p>
                    <p style={{ color: 'var(--ink)', fontSize: '14px', lineHeight: 1.5 }}>{improvements}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Verification Confidence */}
      {content.verification_confidence !== undefined && (
        <div style={createBoxStyle('var(--code-type)')}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={createBoxTitleStyle('var(--code-type)')}>Verification Confidence:</p>
            <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, fontFamily: 'var(--mono)', textAlign: 'right' }}>
              {(content.verification_confidence * 100).toFixed(0)}%
            </p>
          </div>
        </div>
      )}

      {/* Reasoning */}
      {content.reasoning && (
        <div style={createBoxStyle('var(--accent-light)')}>
          <p style={createBoxTitleStyle('var(--accent-light)')}>Assessment Reasoning:</p>
          <p style={{ color: 'var(--ink)', fontSize: '14px', lineHeight: 1.6 }}>{content.reasoning}</p>
        </div>
      )}

      {/* Risk Flags */}
      {content.risk_flags && Array.isArray(content.risk_flags) && content.risk_flags.length > 0 && (
        <div style={createBoxStyle('var(--code-keyword)')}>
          <p style={createBoxTitleStyle('var(--code-keyword)')}>Risk Flags:</p>
          <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {content.risk_flags.map((flag: any, i: number) => (
              <li key={i} style={{ fontSize: '14px' }}>
                <p style={{ fontWeight: 600, marginBottom: '0.25rem', fontSize: '16px' }}>
                  {flag.dimension?.replace(/_/g, ' ')} ({flag.severity})
                </p>
                <p style={{ color: 'var(--stone)', marginLeft: '0.5rem', fontSize: '14px' }}>{flag.description}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Remediation Guidance */}
      {content.remediation_guidance && (
        <div style={createBoxStyle('var(--code-keyword)')}>
          <p style={createBoxTitleStyle('var(--code-keyword)')}>Remediation Guidance:</p>
          <p style={{ color: 'var(--ink)', fontSize: '14px', lineHeight: 1.6 }}>{content.remediation_guidance}</p>
        </div>
      )}
    </div>
  );
};

const ConvergenceCheckChat = ({ content, traceArray, nodeId }: { content: any; traceArray?: any[]; nodeId?: string }) => {
  const { metaDecision, assessorDecision } = resolveConvergenceDecisions(traceArray, nodeId, content);

  // Determine final decision (whichever wins)
  let finalDecision = content.decision || 'unknown';
  let explanation = '';

  // Generate explanation based on decisions
  if (metaDecision === 'iterate' || assessorDecision === 'iterate') {
    explanation = 'Iteration required because either Meta Evaluation or Assessor requested it';
  } else if (metaDecision === 'exit' && assessorDecision === 'exit') {
    explanation = 'Both Meta Evaluation and Assessor agree: exit with current response';
  } else {
    // Handle reason field - skip if it's [object Object]
    const reason = content.reason;
    if (typeof reason === 'string' && !reason.includes('[object')) {
      explanation = reason;
    } else if (content.assessor_gate) {
      // If reason is malformed, try to generate explanation from assessor_gate data
      const assessorScore = content.assessor_gate.overall_eie_score;
      if (assessorScore !== undefined) {
        const scorePercent = (assessorScore * 100).toFixed(0);
        explanation = `Decision based on Assessor evaluation (Score: ${scorePercent}%)`;
      } else {
        explanation = 'Decision made based on convergence criteria';
      }
    } else {
      explanation = 'Decision made based on convergence criteria';
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '14px' }}>
      {/* 1. Final Decision */}
      {finalDecision && (
        <div style={createBoxStyle('var(--accent)')}>
          <p style={createBoxTitleStyle('var(--accent)')}>Final Decision:</p>
          <p style={{ color: 'var(--ink)', fontWeight: 600, fontSize: '1rem' }}>{String(finalDecision || '').toUpperCase()}</p>
        </div>
      )}

      {/* 2. Explanation */}
      {explanation && (
        <div style={createBoxStyle('var(--code-type)')}>
          <p style={createBoxTitleStyle('var(--code-type)')}>Explanation:</p>
          <p style={{ color: 'var(--ink)', fontSize: '14px', lineHeight: 1.5 }}>{explanation}</p>
        </div>
      )}

      {/* 3. Meta Evaluation Decision */}
      {metaDecision && metaDecision !== 'unknown' && (
        <div style={createBoxStyle('var(--code-func)')}>
          <p style={createBoxTitleStyle('var(--code-func)')}>Meta Evaluation Decision:</p>
          <p style={{ color: 'var(--ink)', fontWeight: 600, fontSize: '14px' }}>{String(metaDecision).toUpperCase()}</p>
        </div>
      )}

      {/* 4. Assessor Decision */}
      {assessorDecision && assessorDecision !== 'unknown' && (
        <div style={createBoxStyle('var(--code-string)')}>
          <p style={createBoxTitleStyle('var(--code-string)')}>Assessor Decision:</p>
          <p style={{ color: 'var(--ink)', fontWeight: 400, fontSize: '14px' }}>{String(assessorDecision).toUpperCase()}</p>
        </div>
      )}

      {/* Additional Details */}
      {content.assessor_gate && (
        <div style={createBoxStyle('var(--code-keyword)')}>
          <p style={createBoxTitleStyle('var(--code-keyword)')}>Assessor Gate (EIE Evaluation):</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', color: 'var(--ink)', fontSize: '14px', fontWeight: 400 }}>
            {content.assessor_gate.override_applied && (
              <p style={{ fontWeight: 400, color: 'var(--code-error)' }}>Override Applied: Yes</p>
            )}
            <p>Overall Assessor Score: <span style={{ fontFamily: 'var(--mono)' }}>{(content.assessor_gate.overall_eie_score * 100).toFixed(0)}%</span></p>
            {content.assessor_gate.verification_confidence !== undefined && (
              <p>Verification Confidence: <span style={{ fontFamily: 'var(--mono)' }}>{(content.assessor_gate.verification_confidence * 100).toFixed(0)}%</span></p>
            )}
            {content.assessor_gate.risk_flags && content.assessor_gate.risk_flags.length > 0 && (
              <div style={{ marginLeft: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <p style={{ fontWeight: 400, marginBottom: '0.25rem' }}>Risk Flags:</p>
                {content.assessor_gate.risk_flags.map((flag: any, i: number) => (
                  <p key={i} style={{ marginLeft: '0.5rem', fontSize: '14px' }}>
                    {flag.dimension} ({flag.severity}): {flag.description}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {content.metrics && (
        <div style={createBoxStyle('var(--accent-light)')}>
          <p style={createBoxTitleStyle('var(--accent-light)')}>Metrics:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', color: 'var(--ink)', fontSize: '14px', fontWeight: 400 }}>
            {content.metrics.confidence !== undefined && (
              <p>Confidence: <span style={{ fontFamily: 'var(--mono)' }}>{(content.metrics.confidence * 100).toFixed(0)}%</span> (threshold: {(content.metrics.confidence_threshold * 100).toFixed(0)}%)</p>
            )}
            {content.metrics.grounding_score !== undefined && (
              <p>Grounding Score: <span style={{ fontFamily: 'var(--mono)' }}>{(content.metrics.grounding_score * 100).toFixed(0)}%</span></p>
            )}
            {content.metrics.harm_level && (
              <p>Harm Level: <span style={{ fontFamily: 'var(--mono)' }}>{content.metrics.harm_level}</span></p>
            )}
            {content.metrics.blocking_issues !== undefined && (
              <p>Blocking Issues: <span style={{ fontFamily: 'var(--mono)' }}>{content.metrics.blocking_issues}</span></p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ClarificationGateChat = ({ content }: { content: any }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
    {content.triggered && (
      <div style={createBoxStyle('var(--code-keyword)')}>
        <p style={createBoxTitleStyle('var(--code-keyword)')}>Early Exit Triggered</p>
        <p style={{ color: 'var(--ink)' }}>{content.reason || 'Clarification needed before proceeding'}</p>
      </div>
    )}

    {content.scope_assessment && (
      <div style={createBoxStyle('var(--code-func)')}>
        <p style={createBoxTitleStyle('var(--code-func)')}>Scope Assessment:</p>
        <p style={{ color: 'var(--ink)' }}>{content.scope_assessment}</p>
      </div>
    )}

    {Array.isArray(content.questions) && content.questions.length > 0 && (
      <div style={createBoxStyle('var(--code-type)')}>
        <p style={createBoxTitleStyle('var(--code-type)')}>Clarification Questions:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.questions.map((q: string, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof q === 'string' ? q : JSON.stringify(q)}</li>
          ))}
        </ul>
      </div>
    )}

    {content.response && (
      <div style={createBoxStyle('var(--accent)')}>
        <p style={createBoxTitleStyle('var(--accent)')}>💬 Response Type:</p>
        <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '16px', fontWeight: 400 }}>{content.response}</p>
      </div>
    )}
  </div>
);

const FalsePremiseGateChat = ({ content }: { content: any }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
    {content.triggered && (
      <div style={createBoxStyle('var(--code-func)')}>
        <p style={createBoxTitleStyle('var(--code-func)')}>False Premise Detected</p>
        <p style={{ color: 'var(--ink)' }}>Query contains incorrect assumptions that need correction</p>
      </div>
    )}

    {Array.isArray(content.false_premises) && content.false_premises.length > 0 && (
      <div style={createBoxStyle('var(--code-keyword)')}>
        <p style={createBoxTitleStyle('var(--code-keyword)')}>False Premises:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.false_premises.map((premise: string, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof premise === 'string' ? premise : JSON.stringify(premise)}</li>
          ))}
        </ul>
      </div>
    )}

    {Array.isArray(content.premise_corrections) && content.premise_corrections.length > 0 && (
      <div style={createBoxStyle('var(--accent-light)')}>
        <p style={createBoxTitleStyle('var(--accent-light)')}>✅ Corrections:</p>
        <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {content.premise_corrections.map((correction: string, i: number) => (
            <li key={i} style={{ fontSize: '16px' }}>{typeof correction === 'string' ? correction : JSON.stringify(correction)}</li>
          ))}
        </ul>
      </div>
    )}

    {content.response_type && (
      <div style={createBoxStyle('var(--accent)')}>
        <p style={createBoxTitleStyle('var(--accent)')}>💬 Response Type:</p>
        <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '16px', fontWeight: 400 }}>{content.response_type}</p>
      </div>
    )}
  </div>
);

const ClarifyChat = ({ content }: { content: any }) => {
  // If content is a string, it's likely JSON that needs to be parsed
  let parsedContent = content;
  if (typeof content === 'string') {
    try {
      parsedContent = JSON.parse(content);
    } catch (e) {
      // If parsing fails, return error message
      return <div className="text-slate-400 text-sm italic">Error parsing content</div>;
    }
  }



  // Helper function to check if a value is an error message
  const isErrorMessage = (value: any): boolean => {
    if (typeof value === 'string') {
      return value.includes('Parse error') || value.includes('Error') || value.includes('error');
    }
    if (Array.isArray(value)) {
      return value.length > 0 && typeof value[0] === 'string' && (value[0].includes('Parse error') || value[0].includes('Error'));
    }
    return false;
  };

  // Helper function to safely get array items, filtering out error messages
  const getSafeArray = (arr: any[]): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr.filter((item: any) => {
      if (typeof item === 'string') {
        return !item.includes('Parse error') && !item.includes('Error');
      }
      return true;
    });
  };

  const ambiguities = getSafeArray(parsedContent?.ambiguities || []);
  const missingContext = getSafeArray(parsedContent?.missing_context || []);
  const assumptions = getSafeArray(parsedContent?.assumptions || []);
  const clarificationQuestions = getSafeArray(parsedContent?.clarification_questions || []);

  // Check if there's any content to display
  const hasContent = ambiguities.length > 0 || missingContext.length > 0 || assumptions.length > 0 ||
                     clarificationQuestions.length > 0 || (parsedContent?.scope_assessment && !isErrorMessage(parsedContent.scope_assessment)) ||
                     (parsedContent?.reasoning && !isErrorMessage(parsedContent.reasoning));



  if (!hasContent) {
    return <div style={{ color: 'var(--stone)', fontSize: '16px', fontStyle: 'italic' }}>No insights available</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
      {ambiguities.length > 0 && (
        <div style={createBoxStyle('var(--code-string)')}>
          <p style={createBoxTitleStyle('var(--code-string)')}>Ambiguities Identified:</p>
          <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {ambiguities.map((item: string, i: number) => (
              <li key={i} style={{ fontSize: '16px' }}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {missingContext.length > 0 && (
        <div style={createBoxStyle('var(--code-func)')}>
          <p style={createBoxTitleStyle('var(--code-func)')}>Missing Context:</p>
          <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {missingContext.map((item: string, i: number) => (
              <li key={i} style={{ fontSize: '16px' }}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {assumptions.length > 0 && (
        <div style={createBoxStyle('var(--accent)')}>
          <p style={createBoxTitleStyle('var(--accent)')}>Assumptions:</p>
          <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {assumptions.map((item: string, i: number) => (
              <li key={i} style={{ fontSize: '16px' }}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {parsedContent.scope_assessment && !isErrorMessage(parsedContent.scope_assessment) && (
        <div style={createBoxStyle('var(--code-type)')}>
          <p style={createBoxTitleStyle('var(--code-type)')}>Scope Assessment:</p>
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{parsedContent.scope_assessment}</p>
        </div>
      )}

      {clarificationQuestions.length > 0 && (
        <div style={createBoxStyle('var(--accent-light)')}>
          <p style={createBoxTitleStyle('var(--accent-light)')}>Clarification Questions:</p>
          <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {clarificationQuestions.map((item: string, i: number) => (
              <li key={i} style={{ fontSize: '16px' }}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {parsedContent.reasoning && !isErrorMessage(parsedContent.reasoning) && (
        <div style={createBoxStyle('var(--accent-light)')}>
          <p style={createBoxTitleStyle('var(--accent-light)')}>Reasoning:</p>
          <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{parsedContent.reasoning}</p>
        </div>
      )}
    </div>
  );
};

// Reg E adjudication outcome — rendered on traces produced by the
// `irg-reg-e-adjudication` runner. Surfaces the structured decision artifact
// (issue, rule, application findings, recourse) and the consumer notice
// letter alongside the reasoning trace, so the UI is the demo, not the CLI.
const AdjudicationOutcomeSection = ({ adjudication }: { adjudication: any }) => {
  const decision = adjudication?.decision || {};
  const notice = typeof adjudication?.notice_letter === 'string' ? adjudication.notice_letter : '';
  const findings = Array.isArray(decision.application_findings) ? decision.application_findings : [];
  const recourse = Array.isArray(decision.consumer_recourse) ? decision.consumer_recourse : [];
  const nextSteps = Array.isArray(decision.regulatory_next_steps) ? decision.regulatory_next_steps : [];
  const ruleList = Array.isArray(decision.rule) ? decision.rule : (decision.rule ? [decision.rule] : []);

  const decisionBadge =
    decision.decision === 'accept' ? { bg: 'var(--accent)', label: 'ACCEPT' } :
    decision.decision === 'deny' ? { bg: 'var(--code-keyword)', label: 'DENY' } :
    decision.decision === 'partial' ? { bg: 'var(--code-func)', label: 'PARTIAL' } :
    { bg: 'var(--stone)', label: String(decision.decision || 'PENDING').toUpperCase() };

  const supportColor = (s: string) =>
    s === 'accept' ? 'var(--accent)' :
    s === 'deny' ? 'var(--code-keyword)' :
    'var(--stone)';

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--serif)', marginBottom: '1rem' }}>
        Adjudication Outcome
        {adjudication?.case_id && (
          <span style={{ marginLeft: '0.75rem', fontSize: '0.85rem', color: 'var(--stone)', fontFamily: 'var(--mono)', fontWeight: 400 }}>
            · {adjudication.case_id}
          </span>
        )}
      </h3>

      {/* Decision card */}
      <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1.5rem', borderLeft: `4px solid ${decisionBadge.bg}`, marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ padding: '0.35rem 0.75rem', borderRadius: '3px', background: decisionBadge.bg, color: 'var(--paper)', fontWeight: 700, fontSize: '0.95rem', letterSpacing: '0.05em' }}>
            {decisionBadge.label}
          </span>
          {typeof decision.refund_amount_usd === 'number' && (
            <span style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1rem' }}>
              refund <strong>${decision.refund_amount_usd}</strong>
            </span>
          )}
          {decision.liability_tier && (
            <span style={{ color: 'var(--stone)', fontSize: '0.9rem' }}>
              liability tier · <span style={{ color: 'var(--ink)', fontFamily: 'var(--mono)' }}>{decision.liability_tier}</span>
            </span>
          )}
        </div>

        {decision.issue && (
          <div style={{ marginBottom: '0.75rem' }}>
            <p style={{ color: 'var(--stone)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Issue</p>
            <p style={{ color: 'var(--ink)', fontSize: '1rem', lineHeight: 1.5 }}>{decision.issue}</p>
          </div>
        )}

        {ruleList.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <p style={{ color: 'var(--stone)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Rule</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {ruleList.map((r: string, i: number) => (
                <span key={i} style={{ padding: '0.2rem 0.5rem', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: '2px', fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--ink)' }}>{r}</span>
              ))}
            </div>
          </div>
        )}

        {decision.conclusion && (
          <div>
            <p style={{ color: 'var(--stone)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Conclusion</p>
            <p style={{ color: 'var(--ink)', fontSize: '1rem', lineHeight: 1.6 }}>{decision.conclusion}</p>
          </div>
        )}
      </div>

      {/* Application findings */}
      {findings.length > 0 && (
        <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1.5rem', borderLeft: '4px solid var(--code-type)', marginBottom: '1rem' }}>
          <p style={{ color: 'var(--code-type)', fontWeight: 600, marginBottom: '0.75rem' }}>Application Findings</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {findings.map((f: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <span style={{ padding: '0.15rem 0.45rem', borderRadius: '2px', fontSize: '0.7rem', fontWeight: 700, background: supportColor(f.supports), color: 'var(--paper)', textTransform: 'uppercase', whiteSpace: 'nowrap', marginTop: '0.1rem' }}>
                  {f.supports || 'context'}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ color: 'var(--ink)', fontSize: '0.95rem', lineHeight: 1.5, margin: 0 }}>{f.finding}</p>
                  {Array.isArray(f.evidence) && f.evidence.length > 0 && (
                    <div style={{ marginTop: '0.25rem', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {f.evidence.map((e: string, j: number) => (
                        <span key={j} style={{ padding: '0.1rem 0.4rem', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: '2px', fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--stone)' }}>{e}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recourse + Next Steps */}
      {(recourse.length > 0 || nextSteps.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          {recourse.length > 0 && (
            <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--code-string)' }}>
              <p style={{ color: 'var(--code-string)', fontWeight: 600, marginBottom: '0.5rem' }}>Consumer Recourse</p>
              <ul style={{ listStyleType: 'disc', marginLeft: '1.25rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {recourse.map((r: string, i: number) => <li key={i} style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{r}</li>)}
              </ul>
            </div>
          )}
          {nextSteps.length > 0 && (
            <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--code-func)' }}>
              <p style={{ color: 'var(--code-func)', fontWeight: 600, marginBottom: '0.5rem' }}>Regulatory Next Steps</p>
              <ul style={{ listStyleType: 'disc', marginLeft: '1.25rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {nextSteps.map((r: string, i: number) => <li key={i} style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{r}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Notice letter — the consumer-facing artifact */}
      {notice && (
        <details open style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: '3px', padding: '0', marginBottom: '0.75rem' }}>
          <summary style={{ padding: '0.85rem 1.25rem', cursor: 'pointer', fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--serif)', fontSize: '1rem', borderBottom: '1px solid var(--rule)' }}>
            Consumer Notice Letter (§1005.11(d)/(e))
          </summary>
          <div style={{ padding: '1.25rem 1.5rem' }} className={styles.markdownContent}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={safeRawRehypePlugins as any} components={markdownComponents}>
              {notice}
            </ReactMarkdown>
          </div>
        </details>
      )}

    </div>
  );
};

// ---------------------------------------------------------------------------
// Submitted Evidence — the input side of the trace.
//
// The adjudication runner attaches the actual files the IRG received as
// `adjudication.artifacts: [{ id, name, type, role, size_bytes, content }]`.
// This section renders them as inspectable documents near the Prompt so a
// reviewer (or a regulator) can see the inputs alongside the determination.
// Generalized for N artifacts so future multi-document submissions
// (transaction CSVs, consumer chat logs, ID photos) plug in by type.
// ---------------------------------------------------------------------------

function parseEvidenceIndex(md: string): Array<{ id: string; fact: string }> {
  const idxStart = md.indexOf('## Evidence Index');
  if (idxStart === -1) return [];
  const block = md.slice(idxStart);
  const items: Array<{ id: string; fact: string }> = [];
  const re = /^- \[([EeRr]\d+)\]\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    items.push({ id: m[1].toUpperCase(), fact: m[2].trim() });
  }
  return items;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const ArtifactCard = ({ artifact }: { artifact: any }) => {
  const name = artifact?.name || 'untitled';
  const type = String(artifact?.type || 'unknown');
  const role = artifact?.role || null;
  const size = typeof artifact?.size_bytes === 'number' ? artifact.size_bytes : 0;
  const content = typeof artifact?.content === 'string' ? artifact.content : '';
  const evidenceIndex = type === 'markdown' ? parseEvidenceIndex(content) : [];
  const mime = type === 'markdown' ? 'text/markdown' : type === 'csv' ? 'text/csv' : 'text/plain';
  const dataUri = content
    ? `data:${mime};charset=utf-8,${encodeURIComponent(content)}`
    : null;

  return (
    <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '1.1rem' }} aria-hidden>📄</span>
        <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)', fontSize: '1rem', fontWeight: 600 }}>{name}</span>
        <span style={{ padding: '0.15rem 0.45rem', borderRadius: '2px', background: 'var(--paper)', border: '1px solid var(--rule)', fontSize: '0.7rem', fontFamily: 'var(--mono)', color: 'var(--stone)', textTransform: 'uppercase' }}>{type}</span>
        {role && (
          <span style={{ padding: '0.15rem 0.45rem', borderRadius: '2px', background: 'var(--accent)', color: 'var(--paper)', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{String(role).replace(/-/g, ' ')}</span>
        )}
        <span style={{ color: 'var(--stone)', fontSize: '0.85rem', fontFamily: 'var(--mono)' }}>{formatBytes(size)}</span>
        {evidenceIndex.length > 0 && (
          <span style={{ color: 'var(--stone)', fontSize: '0.85rem' }}>· {evidenceIndex.length} indexed items</span>
        )}
        {dataUri && (
          <a
            href={dataUri}
            download={name}
            style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
          >
            ↓ Download
          </a>
        )}
      </div>

      {/* Quick-glance evidence index (markdown artifacts only) */}
      {evidenceIndex.length > 0 && (
        <div style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: '2px', padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
          <p style={{ color: 'var(--stone)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Evidence Index</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {evidenceIndex.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.85rem' }}>
                <span style={{ padding: '0.1rem 0.4rem', background: 'var(--paper-warm)', border: '1px solid var(--rule)', borderRadius: '2px', fontFamily: 'var(--mono)', color: 'var(--ink)', fontWeight: 600, flexShrink: 0 }}>{e.id}</span>
                <span style={{ color: 'var(--ink)', lineHeight: 1.4 }}>{e.fact}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full document */}
      {content && (
        <details style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: '2px' }}>
          <summary style={{ padding: '0.65rem 1rem', cursor: 'pointer', fontWeight: 600, color: 'var(--stone)', fontSize: '0.9rem' }}>
            View full document
          </summary>
          <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--rule)' }} className={styles.markdownContent}>
            {type === 'markdown' ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={safeRawRehypePlugins as any} components={markdownComponents}>
                {content}
              </ReactMarkdown>
            ) : (
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '0.85rem', margin: 0 }}>{content}</pre>
            )}
          </div>
        </details>
      )}
    </div>
  );
};

const SubmittedEvidenceSection = ({ artifacts }: { artifacts: any[] }) => {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--serif)', marginBottom: '1rem' }}>
        Submitted Evidence
        <span style={{ marginLeft: '0.75rem', fontSize: '0.85rem', color: 'var(--stone)', fontFamily: 'var(--mono)', fontWeight: 400 }}>
          {artifacts.length} artifact{artifacts.length === 1 ? '' : 's'}
        </span>
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {artifacts.map((a, i) => <ArtifactCard key={a?.id || i} artifact={a} />)}
      </div>
    </div>
  );
};

export default function TraceNavigator({ trace }: TraceNavigatorProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const traceArray = trace.trace || [];
  const query = trace.query || 'N/A';

  // Citation rendering for the top-level Response (and the exit-node response):
  // the LLM-emitted <citation ref seq> markup must render as inline UI markers
  // (CitationMark) rather than escaping to literal text in the page. References
  // live at the trace top level; build a uuid -> reference lookup once.
  const topReferences = Array.isArray((trace as any).references) ? (trace as any).references : [];
  const responseRefsByUuid: Record<string, any> = {};
  topReferences.forEach((r: any) => { if (r && r.uuid) responseRefsByUuid[r.uuid] = r; });
  const responseComponents = { ...markdownComponents, citation: makeCitationMark(responseRefsByUuid) };

  // Find the exit node to get actual metrics
  const exitNode = traceArray.find((node: any) => node?.type === 'exit');

  // Debug: log the exit node to see what data it contains
  if (exitNode) {
    console.log('Exit node found:', exitNode);
    console.log('Exit node content:', exitNode.content);
    console.log('Exit node iteration_count:', exitNode.content?.iteration_count);
    console.log('Trace nodes_executed:', trace.nodes_executed);
    console.log('Trace iterations:', trace.iterations);
    console.log('Trace array length:', traceArray.length);
  }

  // Calculate metrics
  const nonExitNodes = traceArray.filter((n: any) => n?.type !== 'exit');
  const totalSteps = traceArray.length;
  const reasoningSteps = nonExitNodes.length;

  // Get iterations from exit node - should be 0 if no iterations occurred
  const iterations = exitNode?.content?.iterations ?? 0;
  const isEarlyExit = isEarlyExitTrace(trace, exitNode);
  const finalConfidence = getDisplayFinalConfidence(trace, exitNode);
  const metricColumnCount = isEarlyExit ? 4 : 5;

  // Get total tokens used - calculate from nodes if not provided
  let totalTokens = trace.total_tokens_used || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  // If total_tokens is still 0, try to calculate from individual node tokens
  if (totalTokens.total_tokens === 0) {
    let inputTokens = 0;
    let outputTokens = 0;
    traceArray.forEach((node: any) => {
      if (node?.tokens) {
        inputTokens += node.tokens.input_tokens || 0;
        outputTokens += node.tokens.output_tokens || 0;
      }
    });

    // Debug logging
    console.log('Calculated tokens from nodes:', { inputTokens, outputTokens });
    console.log('Trace total_tokens_used:', trace.total_tokens_used);
    console.log('First few nodes:', traceArray.slice(0, 3).map((n: any) => ({ type: n?.type, tokens: n?.tokens })));

    // Only update if we found tokens in nodes
    if (inputTokens > 0 || outputTokens > 0) {
      totalTokens = {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens
      };
    }
  }

  // Calculate total time to respond from timestamps
  let totalTimeMs = 0;
  if (traceArray.length > 0) {
    const firstNode = traceArray[0];
    const lastNode = traceArray[traceArray.length - 1];
    const firstTimestamp = firstNode?.timestamp || firstNode?.node_id?.timestamp;
    const lastTimestamp = lastNode?.timestamp || lastNode?.node_id?.timestamp;

    if (firstTimestamp && lastTimestamp) {
      const firstTime = new Date(firstTimestamp).getTime();
      const lastTime = new Date(lastTimestamp).getTime();
      totalTimeMs = lastTime - firstTime;
    }
  }

  // Format time for display
  const formatTime = (ms: number) => {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(0);
      return `${minutes}m ${seconds}s`;
    }
  };

  const convergenceReason = trace.convergenceReason || trace.final_decision || 'N/A';
  const rootConfig = trace.rootConfig || trace.config || {};
  const model = rootConfig.model || rootConfig.config?.model || trace.config?.model || 'Unknown';

  const toggleNodeExpand = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  // Clean up response by removing unwanted sections
  const cleanResponse = (text: any): string => {
    // Ensure text is a string
    if (typeof text !== 'string') {
      return typeof text === 'object' ? JSON.stringify(text, null, 2) : String(text || '');
    }
    // Remove "Horizontal Divider" section and everything after it
    const horizontalDividerRegex = /##\s+Horizontal\s+Divider\s*\n\s*---\s*$/gm;
    return text.replace(horizontalDividerRegex, '').trim();
  };

  // Extract the final response from the last draft or revision node
  const getResponse = () => {
  let rawResponse: any = extractTraceResponse(trace);

    // Convert to string if it's an object
    if (typeof rawResponse === 'object' && rawResponse !== null) {
      rawResponse = JSON.stringify(rawResponse, null, 2);
    }

    // Handle escaped newlines and backslashes
    if (typeof rawResponse === 'string') {
      rawResponse = rawResponse.replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    }

    // Clean up the response
    return rawResponse ? cleanResponse(rawResponse) : 'No response generated';
  };

  const response = getResponse();
  const sessionId = trace.sessionId || trace.session_id || 'Unknown';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Navigation */}
      <Navigation />

      {/* Main Content */}
      <div style={{ background: 'var(--paper)', borderRadius: '4px', padding: '3rem 2rem 2rem 2rem' }}>
        {/* Configuration Section */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--serif)', marginBottom: '1rem' }}>Configuration</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
            <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--accent)' }}>
              <p style={{ color: 'var(--stone)', fontSize: '16px', marginBottom: '0.5rem' }}>Model</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1rem' }}>{model}</p>
            </div>
            <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--code-func)' }}>
              <p style={{ color: 'var(--stone)', fontSize: '16px', marginBottom: '0.5rem' }}>Session ID</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1rem', wordBreak: 'break-all' }}>{sessionId}</p>
            </div>
            <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--accent-light)' }}>
              <p style={{ color: 'var(--stone)', fontSize: '16px', marginBottom: '0.5rem' }}>Convergence Result</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1rem' }}>{convergenceReason}</p>
            </div>
            {rootConfig.config?.maxIterations && (
              <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--code-string)' }}>
                <p style={{ color: 'var(--stone)', fontSize: '16px', marginBottom: '0.5rem' }}>Max Iterations</p>
                <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1rem' }}>{rootConfig.config.maxIterations}</p>
              </div>
            )}
            {rootConfig.config?.confidenceThreshold !== undefined && (
              <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--code-type)' }}>
                <p style={{ color: 'var(--stone)', fontSize: '16px', marginBottom: '0.5rem' }}>Confidence Threshold</p>
                <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1rem' }}>{(rootConfig.config.confidenceThreshold * 100).toFixed(0)}%</p>
              </div>
            )}
          </div>
        </div>

        {/* Query Section */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--serif)', marginBottom: '1rem' }}>Prompt</h3>
          <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.4, fontFamily: 'var(--serif)', margin: 0 }}>{query}</h2>
          </div>
        </div>

        {/* Submitted Evidence — input artifacts the IRG received (adjudication traces). */}
        {Array.isArray((trace as any).adjudication?.artifacts) && (
          <SubmittedEvidenceSection artifacts={(trace as any).adjudication.artifacts} />
        )}

        {/* Response Section */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--serif)', marginBottom: '1rem' }}>Response</h3>
          <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
            <div className={styles.markdownContent}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={safeRawRehypePlugins as any} components={responseComponents}>
                {response}
              </ReactMarkdown>
            </div>
          </div>
          {topReferences.length > 0 && <ReferencesSection references={topReferences} />}
        </div>

        {/* Adjudication Outcome — present only on adjudication-graph traces.
            Renders the structured decision artifact and the consumer notice
            letter alongside the reasoning trace. */}
        {(trace as any).adjudication && (
          <AdjudicationOutcomeSection adjudication={(trace as any).adjudication} />
        )}

        {/* Metrics Section */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '1rem', fontFamily: 'var(--serif)' }}>Metrics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${metricColumnCount}, 1fr)`, gap: '1.5rem' }}>
            {!isEarlyExit && finalConfidence !== null && (
              <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--accent)' }}>
                <p style={{ color: 'var(--stone)', fontSize: '16px', marginBottom: '0.5rem' }}>Final Confidence</p>
                <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1.5rem', fontWeight: 700 }}>
                  {(finalConfidence * 100).toFixed(1)}%
                </p>
              </div>
            )}
            <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--code-type)' }}>
              <p style={{ color: 'var(--stone)', fontSize: '16px', marginBottom: '0.5rem' }}>Iterations</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1.5rem', fontWeight: 700 }}>{iterations}</p>
            </div>
            <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--code-string)' }}>
              <p style={{ color: 'var(--stone)', fontSize: '16px', marginBottom: '0.5rem' }}>Reasoning Steps</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1.5rem', fontWeight: 700 }}>{reasoningSteps}</p>
            </div>
            <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--code-keyword)' }}>
              <p style={{ color: 'var(--stone)', fontSize: '16px', marginBottom: '0.5rem' }}>Total Tokens</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1.5rem', fontWeight: 700 }}>{totalTokens.total_tokens}</p>
            </div>
            <div style={{ background: 'var(--paper-warm)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--code-func)' }}>
              <p style={{ color: 'var(--stone)', fontSize: '16px', marginBottom: '0.5rem' }}>Total Time</p>
              <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1.5rem', fontWeight: 700 }}>{formatTime(totalTimeMs)}</p>
            </div>
          </div>
        </div>

        {/* Horizontal Rule */}
        <div style={{ borderTop: '1px solid var(--rule)', margin: '2rem 0' }}></div>
      </div>

      {/* Timeline Section */}
      <div style={{ background: 'var(--paper)', borderRadius: '4px', padding: '2rem', marginTop: '-2.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '2rem', fontFamily: 'var(--serif)' }}>Reasoning Steps</h2>
        {traceArray.length === 0 ? (
          <p style={{ color: 'var(--stone)' }}>No reasoning steps recorded</p>
        ) : (
          <VerticalTimeline layout="1-column-left">
            {traceArray.map((node: any, index: number) => {
              const colors = getNodeColor(node?.type || 'unknown');
              const timestamp = node?.timestamp ? new Date(node.timestamp).toLocaleTimeString() : 'N/A';
              const isExitNode = node?.type === 'exit';

              return (
                <VerticalTimelineElement
                  key={`${node?.id || index}-${index}`}
                  className="vertical-timeline-element--work"
                  contentStyle={{
                    background: 'var(--paper-warm)',
                    color: 'var(--ink)',
                    border: isExitNode ? `3px solid var(--accent)` : `2px solid ${colors.bg}`,
                    borderRadius: '4px',
                    // Single-column-left layout: cards fill the column (the old
                    // 45% width was for the alternating two-column layout).
                    maxWidth: '100%',
                    width: undefined,
                    marginLeft: isExitNode ? 'auto' : undefined,
                    marginRight: isExitNode ? 'auto' : undefined,
                    boxShadow: isExitNode ? 'var(--shadow-strong)' : 'var(--shadow-soft)',
                    padding: isExitNode ? '2rem' : undefined,
                  }}
                  contentArrowStyle={{
                    borderRight: isExitNode ? 'none' : `7px solid ${colors.bg}`,
                    display: isExitNode ? 'none' : undefined,
                  }}
                  date={isExitNode ? '' : timestamp}
                  dateClassName="custom-timeline-date"
                  dateStyle={{
                    color: 'var(--ink) !important',
                    fontSize: '16px',
                    fontWeight: 500,
                    display: isExitNode ? 'none' : 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: 'translateY(-10px)',
                    position: 'relative',
                    top: '-8px',
                  }}
                  icon={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRadius: '50%', color: 'var(--paper)', fontWeight: 700, fontSize: '16px', background: colors.bg }}>{index + 1}</div>}
                  iconStyle={{
                    background: colors.bg,
                    color: 'var(--paper)',
                    boxShadow: `0 0 0 4px var(--paper), 0 0 0 6px ${colors.bg}`,
                    width: '40px',
                    height: '40px',
                    minWidth: '40px',
                    top: '8px',
                    display: isExitNode ? 'none' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{ padding: '0.25rem 0.5rem', borderRadius: '2px', fontSize: '16px', fontWeight: 600, background: colors.bg, color: 'var(--paper)' }}>
                          {formatNodeType(node.type || '')}
                        </span>
                        <span style={{ color: 'var(--stone)', fontSize: '16px' }}>ID: {node?.id || 'N/A'}</span>
                      </div>
                      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--serif)' }}>{typeof node?.goal === 'string' ? node.goal : typeof node?.goal === 'object' ? JSON.stringify(node.goal) : 'Unknown'}</h3>
                    </div>

                    {/* Exit Node - Special Rendering */}
                    {node?.type === 'exit' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {/* Question Section */}
                        <div style={{ background: 'var(--paper)', borderRadius: '3px', padding: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
                          <p style={{ color: 'var(--stone)', fontSize: '16px', fontWeight: 600, marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Question</p>
                          <p style={{ color: 'var(--ink)', fontSize: '1rem', lineHeight: 1.6, fontWeight: 500 }}>{node?.content?.question || 'N/A'}</p>
                        </div>

                        {/* Response Section */}
                        <div style={{ background: 'var(--paper)', borderRadius: '3px', padding: '1.25rem', borderLeft: '4px solid var(--accent-light)' }}>
                          <p style={{ color: 'var(--stone)', fontSize: '16px', fontWeight: 600, marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Response</p>
                          <div style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, lineHeight: 1.7 }} className={styles.markdownContent}>
                            <ReactMarkdown components={responseComponents} remarkPlugins={[remarkGfm]} rehypePlugins={safeRawRehypePlugins as any}>
                              {node?.content?.response || 'No response available'}
                            </ReactMarkdown>
                          </div>
                        </div>

                        {/* Metadata Section */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div style={{ background: 'var(--paper)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--code-type)' }}>
                            <p style={{ color: 'var(--stone)', fontSize: '16px', fontWeight: 600, marginBottom: '0.5rem' }}>Confidence</p>
                            <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1.25rem', fontWeight: 700 }}>{((node?.content?.confidence || 0) * 100).toFixed(0)}%</p>
                          </div>
                          <div style={{ background: 'var(--paper)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--code-string)' }}>
                            <p style={{ color: 'var(--stone)', fontSize: '16px', fontWeight: 600, marginBottom: '0.5rem' }}>Iterations</p>
                            <p style={{ color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '1.25rem', fontWeight: 700 }}>{node?.content?.iterations || 0}</p>
                          </div>
                        </div>

                        {/* Decision Info */}
                        {node?.content?.convergenceDecision && (
                          <div style={{ background: 'var(--paper)', borderRadius: '3px', padding: '1rem', borderLeft: '4px solid var(--accent)' }}>
                            <p style={{ color: 'var(--stone)', fontSize: '16px', fontWeight: 600, marginBottom: '0.5rem' }}>Decision</p>
                            <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, marginBottom: '0.5rem' }}><strong>{typeof node.content.convergenceDecision === 'string' ? node.content.convergenceDecision : JSON.stringify(node.content.convergenceDecision)}</strong></p>
                            {node?.content?.convergenceReason && (
                              <p style={{ color: 'var(--stone)', fontSize: '16px', lineHeight: 1.5 }}>{typeof node.content.convergenceReason === 'string' ? node.content.convergenceReason : JSON.stringify(node.content.convergenceReason)}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Meaningful Text Summary or Chat Format */}
            {RENDERED_NODE_TYPES.has(node?.type) ? (
                      <>
                        {node?.type === 'clarify' && <ClarifyChat content={node?.content} />}
                        {node?.type === 'case_classification' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
                            <div style={createBoxStyle('var(--accent)')}>
                              <p style={createBoxTitleStyle('var(--accent)')}>Locked Category:</p>
                              <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>
                                <strong>{node?.content?.label || node?.content?.category || '—'}</strong>
                                {node?.content?.section_anchor ? ` · ${node.content.section_anchor}` : ''}
                              </p>
                            </div>
                            {node?.content?.reason && (
                              <div style={createBoxStyle('var(--code-type)')}>
                                <p style={createBoxTitleStyle('var(--code-type)')}>Rationale:</p>
                                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, lineHeight: 1.5 }}>{node.content.reason}</p>
                              </div>
                            )}
                          </div>
                        )}
                        {node?.type === 'case_recall' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
                            <div style={createBoxStyle('var(--code-string)')}>
                              <p style={createBoxTitleStyle('var(--code-string)')}>Citable Set Assembled:</p>
                              <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <li style={{ fontSize: '16px' }}>{node?.content?.evidence_items ?? 0} evidence item(s) from the case packet</li>
                                <li style={{ fontSize: '16px' }}>{node?.content?.regulation_rules_selected ?? 0} regulation rule(s) selected</li>
                              </ul>
                            </div>
                            {Array.isArray(node?.content?.regulation_rule_ids) && node.content.regulation_rule_ids.length > 0 && (
                              <div style={createBoxStyle('var(--code-func)')}>
                                <p style={createBoxTitleStyle('var(--code-func)')}>Rules cited:</p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                  {node.content.regulation_rule_ids.map((id: string, i: number) => (
                                    <span key={i} style={{ padding: '0.15rem 0.5rem', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: '2px', fontFamily: 'var(--mono)', fontSize: '0.78rem' }}>{id}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {node?.type === 'clarification_gate' && <ClarificationGateChat content={node?.content} />}
                        {node?.type === 'false_premise_gate' && <FalsePremiseGateChat content={node?.content} />}
                        {node?.type === 'draft' && <DraftChat content={node?.content} />}
                        {node?.type === 'fact_check' && <FactCheckChat content={node?.content} rawOutput={node?.raw_output} />}
                        {node?.type === 'fact_check_pipeline' && <FactCheckPipelineChat content={node?.content} rawOutput={node?.raw_output} />}
                {node?.type === 'external_fact_check' && <ExternalFactCheckChat content={node?.content} />}
                {node?.type === 'fact_check_pipeline_gate' && <FactCheckPipelineGateChat content={node?.content} />}
                {node?.type === 'citation_source_generation' && <CitationSourceGenerationChat content={node?.content} />}
                {node?.type === 'citation_write' && <CitationWriteChat content={node?.content} />}
                {node?.type === 'citation_fetch' && <CitationFetchChat content={node?.content} />}
                {node?.type === 'citation_verify' && <CitationVerifyChat content={node?.content} />}
                {node?.type === 'memory_recall' && <MemoryRecallChat content={node?.content} />}
                {node?.type === 'citation_apply' && <CitationApplyChat content={node?.content} />}
                {node?.type === 'citation_quality' && <CitationQualityChat content={node?.content} />}
                        {node?.type === 'impact_prediction' && <ImpactPredictionChat content={node?.content} />}
                        {(node?.type === 'revision' || node?.type === 'revise') && <RevisionChat content={node?.content} traceArray={traceArray} nodeId={node?.id} />}
                        {(node?.type === 'convergence' || node?.type === 'convergence_check') && <ConvergenceCheckChat content={node?.content} traceArray={traceArray} nodeId={node?.id} />}
                        {node?.type === 'assessor' && <AssessorChat content={node?.content} />}
                        {node?.type === 'response_strategy' && <ResponseStrategyChat content={node?.content} />}
                        {node?.type === 'adversary_critique' && <AdversaryCritiqueChat content={node?.content} />}
                        {node?.type === 'evaluate' && <EvaluateChat content={node?.content} />}
                        {node?.type === 'strategy_evaluation' && <StrategyEvaluationChat content={node?.content} />}
                        {node?.type === 'strategy' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
                            {renderResponsePolicyBox(node?.content?.response_policy)}
                            {node?.content?.key_points && Array.isArray(node.content.key_points) && (
                              <div style={createBoxStyle('var(--code-func)')}>
                                <p style={createBoxTitleStyle('var(--code-func)')}>Key Points:</p>
                                <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  {node.content.key_points.map((point: any, i: number) => (
                                    <li key={i} style={{ fontSize: '16px' }}>{typeof point === 'string' ? point : JSON.stringify(point)}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {node?.content?.structure && Array.isArray(node.content.structure) && (
                              <div style={createBoxStyle('var(--code-string)')}>
                                <p style={createBoxTitleStyle('var(--code-string)')}>Response Structure:</p>
                                {renderStructuredOutline(normalizeStructuredOutline(node.content.structure))}
                              </div>
                            )}
                            {node?.content?.reasoning_approach && (
                              <div style={createBoxStyle('var(--code-type)')}>
                                <p style={createBoxTitleStyle('var(--code-type)')}>Reasoning Approach:</p>
                                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, lineHeight: 1.5 }}>{typeof node.content.reasoning_approach === 'string' ? node.content.reasoning_approach : JSON.stringify(node.content.reasoning_approach)}</p>
                              </div>
                            )}
                            {node?.content?.evidence_types && Array.isArray(node.content.evidence_types) && (
                              <div style={createBoxStyle('var(--code-keyword)')}>
                                <p style={createBoxTitleStyle('var(--code-keyword)')}>Evidence Types:</p>
                                <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  {node.content.evidence_types.map((evidence: any, i: number) => (
                                    <li key={i} style={{ fontSize: '16px' }}>{typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                    {renderSectionLikeValue('Opening Act', node?.content?.blueprint?.opening_act, 'var(--accent-light)')}
                    {renderSectionLikeValue('Salvageable Core', node?.content?.blueprint?.salvageable_core, 'var(--code-type)')}
                    {renderSectionLikeValue('Closest Legitimate Frame', node?.content?.blueprint?.closest_legitimate_frame, 'var(--code-func)')}
                            {renderListBox('Required Moves', node?.content?.blueprint?.required_moves, 'var(--code-string)')}
                            {renderListBox('Forbidden Moves', node?.content?.blueprint?.forbidden_moves, 'var(--code-keyword)')}
                            {renderSectionPlanBox(node?.content?.blueprint?.section_plan)}
                            {node?.content?.confidence !== undefined && node?.content?.confidence !== null && (
                              <div style={createBoxStyle('var(--accent-light)')}>
                                <p style={createBoxTitleStyle('var(--accent-light)')}>Confidence:</p>
                                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{(node.content.confidence * 100).toFixed(0)}%</p>
                              </div>
                            )}
                            {/* Full Details (YAML) */}
                            <details style={{ marginTop: '0.5rem' }}>
                              <summary style={{ cursor: 'pointer', color: 'var(--stone)', fontSize: '16px', fontWeight: 600, padding: '0.5rem', background: 'var(--paper-warm)', borderRadius: '2px', userSelect: 'none' }}>
                                ▼ Full Details (YAML)
                              </summary>
                              <pre style={{ background: 'var(--code-bg)', color: 'var(--code-text)', padding: '0.75rem', borderRadius: '2px', fontSize: '12px', overflow: 'auto', marginTop: '0.5rem', fontFamily: 'var(--mono)', lineHeight: 1.4 }}>
                                {YAML.dump(node.content, { indent: 2 })}
                              </pre>
                            </details>
                          </div>
                        )}
                        {node?.type === 'adversary' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
                            {node?.content?.weak_assumptions && Array.isArray(node.content.weak_assumptions) && node.content.weak_assumptions.length > 0 && (
                              <div style={createBoxStyle('var(--code-keyword)')}>
                                <p style={createBoxTitleStyle('var(--code-keyword)')}>Weak Assumptions:</p>
                                <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  {node.content.weak_assumptions.map((assumption: any, i: number) => (
                                    <li key={i} style={{ fontSize: '16px' }}>{typeof assumption === 'string' ? assumption : JSON.stringify(assumption)}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {node?.content?.strategy_flaws && Array.isArray(node.content.strategy_flaws) && node.content.strategy_flaws.length > 0 && (
                              <div style={createBoxStyle('var(--code-keyword)')}>
                                <p style={createBoxTitleStyle('var(--code-keyword)')}>Strategy Flaws:</p>
                                <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  {node.content.strategy_flaws.map((flaw: any, i: number) => (
                                    <li key={i} style={{ fontSize: '16px' }}>{typeof flaw === 'string' ? flaw : JSON.stringify(flaw)}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {node?.content?.recommended_strategy && (
                              <div style={createBoxStyle('var(--code-type)')}>
                                <p style={createBoxTitleStyle('var(--code-type)')}>Recommended Strategy:</p>
                                {typeof node.content.recommended_strategy === 'string' ? (
                                  <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{node.content.recommended_strategy}</p>
                                ) : typeof node.content.recommended_strategy === 'object' ? (
                                  <div style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>
                                    {Object.entries(node.content.recommended_strategy).map(([key, value]: [string, any], i: number) => (
                                      <div key={i} style={{ marginBottom: '0.5rem' }}>
                                        <strong style={{ textTransform: 'capitalize' }}>{key}:</strong>
                                        <p style={{ marginTop: '0.25rem', marginBottom: 0 }}>{typeof value === 'string' ? value : JSON.stringify(value)}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{JSON.stringify(node.content.recommended_strategy)}</p>
                                )}
                              </div>
                            )}
                            {node?.content?.unanswerable !== undefined && (
                              <div style={createBoxStyle('var(--accent-light)')}>
                                <p style={createBoxTitleStyle('var(--accent-light)')}>Answerable:</p>
                                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{node.content.unanswerable ? 'No - question may be unanswerable' : 'Yes - question is answerable'}</p>
                              </div>
                            )}
                            {node?.content?.confidence !== undefined && (
                              <div style={createBoxStyle('var(--accent-light)')}>
                                <p style={createBoxTitleStyle('var(--accent-light)')}>Confidence:</p>
                                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{(node.content.confidence * 100).toFixed(0)}%</p>
                              </div>
                            )}
                          </div>
                        )}
                        {node?.type === 'arbiter' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
                            {node?.content?.synthesis && (
                              <div style={createBoxStyle('var(--accent)')}>
                                <p style={createBoxTitleStyle('var(--accent)')}>Synthesis:</p>
                                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{typeof node.content.synthesis === 'string' ? node.content.synthesis : JSON.stringify(node.content.synthesis)}</p>
                              </div>
                            )}
                            {node?.content?.final_strategy?.response_policy && (
                              renderResponsePolicyBox(node.content.final_strategy.response_policy, 'Final Response Policy')
                            )}
                            {node?.content?.final_strategy && (
                              <div style={createBoxStyle('var(--code-func)')}>
                                <p style={createBoxTitleStyle('var(--code-func)')}>Final Strategy:</p>
                                {node.content.final_strategy.structure && (
                                  <div style={{ marginBottom: '0.5rem' }}>
                                    <p style={{ color: 'var(--stone)', fontSize: '14px !important', fontWeight: 600, marginBottom: '0.25rem' }}>Structure:</p>
                                    {Array.isArray(node.content.final_strategy.structure) ? (
                                      renderStructuredOutline(normalizeStructuredOutline(node.content.final_strategy.structure))
                                    ) : (
                                      <p style={{ color: 'var(--ink)', fontSize: '14px !important', fontWeight: 400 }}>{String(node.content.final_strategy.structure)}</p>
                                    )}
                                  </div>
                                )}
                                {node.content.final_strategy.reasoning_approach && (
                                  <div style={{ marginBottom: '0.5rem' }}>
                                    <p style={{ color: 'var(--stone)', fontSize: '14px !important', fontWeight: 600, marginBottom: '0.25rem' }}>Reasoning Approach:</p>
                                    <p style={{ color: 'var(--ink)', fontSize: '14px !important', fontWeight: 400 }}>{node.content.final_strategy.reasoning_approach}</p>
                                  </div>
                                )}
                                {node.content.final_strategy.evidence_types && Array.isArray(node.content.final_strategy.evidence_types) && (
                                  <div style={{ marginBottom: '0.5rem' }}>
                                    <p style={{ color: 'var(--stone)', fontSize: '14px !important', fontWeight: 600, marginBottom: '0.25rem' }}>Evidence Types:</p>
                                    <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                      {node.content.final_strategy.evidence_types.map((evidence: any, i: number) => (
                                        <li key={i} style={{ fontSize: '14px !important' }}>{typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {node.content.final_strategy.key_points && Array.isArray(node.content.final_strategy.key_points) && (
                                  <div style={{ marginBottom: '0.5rem' }}>
                                    <p style={{ color: 'var(--stone)', fontSize: '14px !important', fontWeight: 600, marginBottom: '0.25rem' }}>Key Points:</p>
                                    <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                      {node.content.final_strategy.key_points.map((point: string, i: number) => (
                                        <li key={i} style={{ fontSize: '14px !important' }}>{point}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                            {renderListBox('Required Moves', node?.content?.final_strategy?.required_moves, 'var(--code-string)')}
                            {renderListBox('Forbidden Moves', node?.content?.final_strategy?.forbidden_moves, 'var(--code-keyword)')}
                            {renderSectionPlanBox(node?.content?.final_strategy?.section_plan, 'Final Section Plan')}
                            {node?.content?.addressed_concerns && Array.isArray(node.content.addressed_concerns) && node.content.addressed_concerns.length > 0 && (
                              <div style={createBoxStyle('var(--code-string)')}>
                                <p style={createBoxTitleStyle('var(--code-string)')}>Addressed Concerns:</p>
                                <ul style={{ listStyleType: 'disc', marginLeft: '1.5rem', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                  {node.content.addressed_concerns.map((concern: string, i: number) => (
                                    <li key={i} style={{ fontSize: '16px' }}>{concern}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {renderListBox('Resolved Laundering Risks', node?.content?.laundering_risks_resolved, 'var(--accent-light)')}
                            {node?.content?.confidence !== undefined && node?.content?.confidence !== null && (
                              <div style={createBoxStyle('var(--accent-light)')}>
                                <p style={createBoxTitleStyle('var(--accent-light)')}>Confidence:</p>
                                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{(node.content.confidence * 100).toFixed(0)}%</p>
                              </div>
                            )}
                          </div>
                        )}
                        {node?.type === 'strategy_gate' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
                            <div style={createBoxStyle('var(--code-type)')}>
                              <p style={createBoxTitleStyle('var(--code-type)')}>Proceed with Response:</p>
                              <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 600 }}>
                                {node?.content?.decision === 'approved' ? 'Yes, we can answer this' : 'No, we cannot answer this'}
                              </p>
                            </div>
                            {node?.content?.unanswerable !== undefined && (
                              <div style={createBoxStyle('var(--accent-light)')}>
                                <p style={createBoxTitleStyle('var(--accent-light)')}>Question is Answerable:</p>
                                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{node.content.unanswerable ? 'No - question cannot be answered' : 'Yes - we have enough information'}</p>
                              </div>
                            )}
                            {renderResponsePolicyBox(node?.content?.response_contract?.response_policy)}
                            {renderListBox('Exit Reasons', node?.content?.exit_reasons, 'var(--accent)')}
                            {renderListBox('Required Moves', node?.content?.response_contract?.required_moves, 'var(--code-string)')}
                            {renderListBox('Forbidden Moves', node?.content?.response_contract?.forbidden_moves, 'var(--code-keyword)')}
                            {renderSectionPlanBox(node?.content?.response_contract?.section_plan)}
                            {renderListBox('Dangerous Terms', node?.content?.response_contract?.dangerous_terms, 'var(--code-keyword)')}
                            {renderListBox('Invalid Components', node?.content?.response_contract?.invalid_components, 'var(--code-func)')}
                            {renderListBox('Failure Modes', node?.content?.response_contract?.failure_modes, 'var(--accent-light)')}
                            {renderListBox('Laundering Risks', node?.content?.response_contract?.laundering_risks, 'var(--accent-light)')}
                          </div>
                        )}
                        {node?.type === 'meta_evaluation' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '16px' }}>
                            {node?.content?.recommendation && (
                              <div style={createBoxStyle('var(--accent)')}>
                                <p style={createBoxTitleStyle('var(--accent)')}>Recommendation:</p>
                                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 600 }}>
                                  {node.content.recommendation === 'exit' ? 'Exit - Response is good enough' : 'Iterate - Needs improvement'}
                                </p>
                              </div>
                            )}
                            {node?.content?.iteration_learnings && (
                              <div style={createBoxStyle('var(--code-keyword)')}>
                                <p style={createBoxTitleStyle('var(--code-keyword)')}>Learnings for Next Iteration:</p>
                                {typeof node.content.iteration_learnings === 'string' ? (
                                  <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{node.content.iteration_learnings}</p>
                                ) : typeof node.content.iteration_learnings === 'object' ? (
                                  <div style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>
                                    {Object.entries(node.content.iteration_learnings).map(([key, value]: [string, any], i: number) => (
                                      <div key={i} style={{ marginBottom: '0.5rem' }}>
                                        <strong style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}:</strong>
                                        <p style={{ marginTop: '0.25rem', marginBottom: 0, whiteSpace: 'pre-wrap' }}>{typeof value === 'string' ? value : JSON.stringify(value)}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{JSON.stringify(node.content.iteration_learnings)}</p>
                                )}
                              </div>
                            )}
                            {(() => {
                              // Helper to extract score from either new format (object) or old format (number)
                              const getScore = (metric: any) => {
                                if (typeof metric === 'object' && metric?.score !== undefined) {
                                  return metric.score;
                                }
                                return typeof metric === 'number' ? metric : undefined;
                              };

                              const executionQualityScore = getScore(node.content.execution_quality);
                              const completenessScore = getScore(node.content.completeness);
                              const clarityScore = getScore(node.content.clarity);

                              return (
                                <>
                                  {executionQualityScore !== undefined && (
                                    <div style={createBoxStyle('var(--code-func)')}>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                        <p style={{ ...createBoxTitleStyle('var(--code-func)'), textAlign: 'left' }}>Execution Quality:</p>
                                        <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, fontFamily: 'var(--mono)', textAlign: 'right' }}>
                                          {(executionQualityScore * 100).toFixed(0)}%
                                        </p>
                                      </div>
                                      {typeof node.content.execution_quality === 'object' && node.content.execution_quality?.justification && (
                                        <p style={{ color: 'var(--ink)', fontSize: '14px', fontWeight: 400 }}>{node.content.execution_quality.justification}</p>
                                      )}
                                    </div>
                                  )}
                                  {completenessScore !== undefined && (
                                    <div style={createBoxStyle('var(--code-type)')}>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                        <p style={{ ...createBoxTitleStyle('var(--code-type)'), textAlign: 'left' }}>Completeness:</p>
                                        <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, fontFamily: 'var(--mono)', textAlign: 'right' }}>
                                          {(completenessScore * 100).toFixed(0)}%
                                        </p>
                                      </div>
                                      {typeof node.content.completeness === 'object' && node.content.completeness?.justification && (
                                        <p style={{ color: 'var(--ink)', fontSize: '14px', fontWeight: 400 }}>{node.content.completeness.justification}</p>
                                      )}
                                    </div>
                                  )}
                                  {clarityScore !== undefined && (
                                    <div style={createBoxStyle('var(--code-string)')}>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                        <p style={{ ...createBoxTitleStyle('var(--code-string)'), textAlign: 'left' }}>Clarity:</p>
                                        <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400, fontFamily: 'var(--mono)', textAlign: 'right' }}>
                                          {(clarityScore * 100).toFixed(0)}%
                                        </p>
                                      </div>
                                      {typeof node.content.clarity === 'object' && node.content.clarity?.justification && (
                                        <p style={{ color: 'var(--ink)', fontSize: '14px', fontWeight: 400 }}>{node.content.clarity.justification}</p>
                                      )}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                            {node?.content?.confidence !== undefined && node?.content?.confidence !== null && (
                              <div style={createBoxStyle('var(--accent-light)')}>
                                <p style={createBoxTitleStyle('var(--accent-light)')}>Confidence:</p>
                                <p style={{ color: 'var(--ink)', fontSize: '16px', fontWeight: 400 }}>{(node.content.confidence * 100).toFixed(0)}%</p>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : isExitNode ? null : (
                      <div style={{ background: 'var(--paper)', borderRadius: '3px', padding: '0.75rem', fontSize: '16px', color: 'var(--ink)', fontWeight: 400, borderLeft: `2px solid ${colors.bg}` }}>
                        {extractMeaningfulText(node)}
                      </div>
                    )}

                    {node?.status && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'var(--stone)', fontSize: '16px' }}>Status:</span>
                        <span style={{ padding: '0.25rem 0.5rem', borderRadius: '2px', fontSize: '16px', fontWeight: 600, background: node?.status === 'completed' ? 'var(--status-completed)' : 'var(--code-string)', color: 'var(--paper)' }}>
                          {node?.status}
                        </span>
                      </div>
                    )}

                    {node?.confidence !== undefined && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'var(--stone)', fontSize: '16px' }}>Confidence:</span>
                        <div style={{ flex: 1, background: 'var(--rule)', borderRadius: '9999px', height: '8px', maxWidth: '200px' }}>
                          <div
                            style={{ background: 'var(--accent)', height: '8px', borderRadius: '9999px', width: `${(node?.confidence || 0) * 100}%`, transition: 'width 0.3s' }}
                          />
                        </div>
                        <span style={{ color: 'var(--stone)', fontSize: '16px', fontFamily: 'var(--mono)' }}>{((node?.confidence || 0) * 100).toFixed(0)}%</span>
                      </div>
                    )}

                    {/* Collapsible YAML Details - Skip for strategy_gate since boxes already show all info */}
                    {node?.content && node?.type !== 'strategy_gate' && (
                      <div style={{ border: `1px solid var(--rule)`, borderRadius: '3px' }}>
                        <button
                          onClick={() => toggleNodeExpand(node?.id || '')}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 0.2s' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--paper-warm)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--stone)' }}>
                            {expandedNodes.has(node?.id || '') ? '▼' : '▶'} Full Details (YAML)
                          </span>
                        </button>
                        {expandedNodes.has(node?.id || '') && (
                          <div style={{ background: 'var(--code-bg)', borderBottomLeftRadius: '3px', borderBottomRightRadius: '3px', padding: '0.75rem', fontSize: '12px', color: 'var(--code-text)', fontFamily: 'var(--mono)', overflow: 'auto', maxHeight: '192px', borderTop: `1px solid var(--rule)` }}>
                            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {YAML.dump(
                                node?.content || {},
                                { lineWidth: -1 }
                              )}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {node?.inputs && node?.inputs.length > 0 && (
                      <div style={{ fontSize: '16px', color: 'var(--stone)' }}>
                        <span style={{ fontWeight: 600 }}>Inputs:</span> {node?.inputs.join(', ')}
                      </div>
                    )}
                  </div>
                </VerticalTimelineElement>
              );
            })}
          </VerticalTimeline>
        )}
      </div>
    </div>
  );
}
