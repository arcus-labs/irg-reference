function getNode(entry: any): any {
  if (entry?.node_id && typeof entry.node_id === 'object') {
    return entry.node_id;
  }
  return entry;
}

function getString(value: any): string {
  return typeof value === 'string' ? value : '';
}

export function extractTraceResponse(trace: any): string {
  const traceArray = Array.isArray(trace?.trace) ? trace.trace : [];

  const topLevelResponse =
    getString(trace?.draft_response?.response) ||
    getString(trace?.draft_response) ||
    getString(trace?.response) ||
    getString(trace?.response?.revised_response);

  if (topLevelResponse) {
    return topLevelResponse;
  }

  const lastRevision = [...traceArray].reverse().find((entry: any) => {
    const node = getNode(entry);
    return node?.type === 'revision' || node?.type === 'revise';
  });
  const revisionNode = getNode(lastRevision);
  const revisionResponse =
    getString(revisionNode?.content?.revised_response) ||
    getString(revisionNode?.content?.response);

  if (revisionResponse) {
    return revisionResponse;
  }

  const lastDraft = [...traceArray].reverse().find((entry: any) => getNode(entry)?.type === 'draft');
  const draftNode = getNode(lastDraft);
  const draftResponse =
    getString(draftNode?.content?.draft_response) ||
    getString(draftNode?.content?.response);

  if (draftResponse) {
    return draftResponse;
  }

  const lastTerminalNode = [...traceArray].reverse().find((entry: any) => {
    const node = getNode(entry);
    return node?.type === 'exit' || node?.type === 'record';
  });
  const terminalNode = getNode(lastTerminalNode);

  return (
    getString(terminalNode?.content?.response) ||
    getString(terminalNode?.content?.finalResponse) ||
    ''
  );
}