function firstNonEmptyString(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
}

export function isFiniteConfidence(value: any): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export interface FactCheckArtifactMetadata {
  artifactType: string;
  storage: string;
  generatedAt?: string;
  sourceNode?: string;
  iteration?: number;
  factStoreRoot?: string;
  artifactPath?: string;
  criticalClaimCount?: number;
  summary?: string;
  confidence?: number;
}

export function getFactCheckArtifactMetadata(value: any): FactCheckArtifactMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const artifactType = firstNonEmptyString(value.artifact_type);
  const storage = firstNonEmptyString(value.storage);
  const artifactPath = firstNonEmptyString(value.artifact_path);
  const summary = firstNonEmptyString(value.summary);
  const factStoreRoot = firstNonEmptyString(value.fact_store_root);
  const generatedAt = firstNonEmptyString(value.generated_at);
  const sourceNode = firstNonEmptyString(value.source_node);
  const criticalClaimCount = typeof value.critical_claim_count === 'number'
    ? value.critical_claim_count
    : undefined;
  const iteration = typeof value.iteration === 'number' ? value.iteration : undefined;
  const confidence = isFiniteConfidence(value.confidence) ? value.confidence : undefined;

  const looksLikeArtifact = artifactType === 'fact_check_claims'
    || storage === 'filesystem_artifact'
    || !!artifactPath
    || criticalClaimCount !== undefined
    || !!factStoreRoot;

  if (!looksLikeArtifact) {
    return null;
  }

  return {
    artifactType,
    storage,
    generatedAt: generatedAt || undefined,
    sourceNode: sourceNode || undefined,
    iteration,
    factStoreRoot: factStoreRoot || undefined,
    artifactPath: artifactPath || undefined,
    criticalClaimCount,
    summary: summary || undefined,
    confidence,
  };
}

export function isEarlyExitTrace(trace: any, exitNode?: any): boolean {
  return (
    exitNode?.content?.convergenceDecision === 'unanswerable'
    || trace?.final_decision === 'unanswerable'
  );
}

export function getDisplayFinalConfidence(trace: any, exitNode?: any): number | null {
  if (isEarlyExitTrace(trace, exitNode)) {
    return null;
  }

  const candidates = [
    exitNode?.confidence,
    exitNode?.content?.confidence,
    trace?.finalConfidence,
    trace?.draft_response?.confidence,
  ];

  for (const candidate of candidates) {
    if (isFiniteConfidence(candidate)) {
      return candidate;
    }
  }

  return null;
}

function unwrapTraceNode(node: any): any {
  return node?.node_id || node;
}

function normalizeDecisionAlias(value: any, exitAliases: string[], iterateAliases: string[]): string {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized || normalized === '[object object]' || normalized.startsWith('[object')) {
    return 'unknown';
  }

  if (exitAliases.includes(normalized)) {
    return 'exit';
  }

  if (iterateAliases.includes(normalized)) {
    return 'iterate';
  }

  return normalized;
}

export function normalizeMetaDecision(value: any): string {
  const raw = typeof value === 'object' && value !== null ? value.recommendation : value;

  return normalizeDecisionAlias(
    raw,
    ['exit', 'accept', 'approved', 'release'],
    ['iterate', 'revise', 'retry']
  );
}

export function normalizeAssessorDecision(value: any): string {
  return normalizeDecisionAlias(
    value,
    ['exit', 'accept', 'approved', 'release'],
    ['iterate', 'refuse', 'revise', 'retry', 'reject']
  );
}

export function resolveConvergenceDecisions(traceArray: any[] = [], nodeId?: string, fallbackContent: any = {}) {
  if (!Array.isArray(traceArray) || traceArray.length === 0) {
    return {
      metaDecision: normalizeMetaDecision(fallbackContent.meta_evaluation_decision || fallbackContent.recommendation),
      assessorDecision: normalizeAssessorDecision(fallbackContent.assessor_decision || fallbackContent.release_decision),
    };
  }

  const currentNodeIndex = nodeId
    ? traceArray.findIndex((entry: any) => unwrapTraceNode(entry)?.id === nodeId)
    : traceArray.length - 1;

  const searchEnd = currentNodeIndex >= 0 ? currentNodeIndex - 1 : traceArray.length - 1;
  let windowStart = -1;

  for (let i = searchEnd; i >= 0; i--) {
    const node = unwrapTraceNode(traceArray[i]);
    if (node?.type === 'convergence' || node?.type === 'convergence_check') {
      windowStart = i;
      break;
    }
  }

  let metaDecision = 'unknown';
  let assessorDecision = 'unknown';

  for (let i = searchEnd; i > windowStart; i--) {
    const node = unwrapTraceNode(traceArray[i]);

    if (metaDecision === 'unknown' && node?.type === 'meta_evaluation') {
      metaDecision = normalizeMetaDecision(node?.content?.recommendation);
    }

    if (assessorDecision === 'unknown' && node?.type === 'assessor') {
      assessorDecision = normalizeAssessorDecision(node?.content?.assessor_decision || node?.content?.release_decision);
    }

    if (metaDecision !== 'unknown' && assessorDecision !== 'unknown') {
      break;
    }
  }

  if (metaDecision === 'unknown') {
    metaDecision = normalizeMetaDecision(fallbackContent.meta_evaluation_decision || fallbackContent.recommendation);
  }

  if (assessorDecision === 'unknown') {
    assessorDecision = normalizeAssessorDecision(fallbackContent.assessor_decision || fallbackContent.release_decision);
  }

  return { metaDecision, assessorDecision };
}

export interface StructuredOutlineItem {
  title: string;
  content?: string;
  children: StructuredOutlineItem[];
}

function normalizeOutlineItem(item: any, fallbackTitle: string): StructuredOutlineItem {
  if (typeof item === 'string') {
    return { title: item, children: [] };
  }

  if (!item || typeof item !== 'object') {
    return { title: fallbackTitle, content: String(item), children: [] };
  }

  const title = firstNonEmptyString(
    item.section,
    item.subsection,
    item.title,
    item.heading,
    item.label
  ) || fallbackTitle;

  const content = firstNonEmptyString(
    item.content,
    item.description,
    item.body,
    item.text,
    item.details
  );

  const rawChildren = Array.isArray(item.subsections)
    ? item.subsections
    : Array.isArray(item.children)
      ? item.children
      : Array.isArray(item.items)
        ? item.items
        : [];

  if (!content && rawChildren.length === 0) {
    const extraFields = Object.entries(item).filter(([key]) => ![
      'section',
      'subsection',
      'title',
      'heading',
      'label',
      'content',
      'description',
      'body',
      'text',
      'details',
      'subsections',
      'children',
      'items',
    ].includes(key));

    if (extraFields.length > 0) {
      return {
        title,
        content: JSON.stringify(Object.fromEntries(extraFields)),
        children: [],
      };
    }
  }

  return {
    title,
    content: content || undefined,
    children: rawChildren.map((child: any, index: number) => (
      normalizeOutlineItem(child, `Item ${index + 1}`)
    )),
  };
}

export function normalizeStructuredOutline(structure: any): StructuredOutlineItem[] {
  if (!Array.isArray(structure)) {
    return [];
  }

  return structure.map((item, index) => normalizeOutlineItem(item, `Section ${index + 1}`));
}