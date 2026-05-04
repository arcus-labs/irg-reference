/**
 * IRG Interpreter — Linear Format
 *
 * Executes the linear graph format with support for:
 *   - Sequential execution
 *   - Branching (gate nodes)
 *   - Parallel execution (concurrent nodes)
 *   - Looping (goto: syntax)
 *   - Cycle detection
 */

'use strict';

async function runLinearGraph(graph, initialState, llmClient, prompts, nodeRegistry) {
  let state = { ...initialState, nodes: [], iteration: 0 };
  let currentIndex = 0;
  const visited = new Set();
  const maxIterations = state.config?.maxIterations || 5;

  while (currentIndex < graph.length) {
    const step = graph[currentIndex];
    if (!step) break;

    const stepKey = JSON.stringify(step);

    // Note: iteration counter is managed by convergence node, not here
    // This prevents double-incrementing when looping back
    visited.add(stepKey);

    if (typeof step === 'string') {
      if (step === 'exit') {
        console.log('Executing exit node');
        const node = nodeRegistry.get('exit');
        if (node) {
          state = await executeNode(node, state, llmClient, prompts);
        }
        break;
      }

      if (step.startsWith('goto:')) {
        const targetNode = step.substring(5);
        currentIndex = findNodeIndex(graph, targetNode);
        if (currentIndex === -1) {
          throw new Error(`Goto target not found: ${targetNode}`);
        }
        continue;
      }

      const node = nodeRegistry.get(step);
      if (!node) throw new Error(`Node not found: ${step}`);

      state = await executeNode(node, state, llmClient, prompts);
      currentIndex++;

    } else if (step.gate) {
      const node = nodeRegistry.get(step.gate);
      if (!node) throw new Error(`Gate node not found: ${step.gate}`);

      state = await executeNode(node, state, llmClient, prompts);
      const decision = state._nodeDecision;
      const nextStep = step.on[decision];

      if (!nextStep) {
        throw new Error(`No routing for decision: ${decision}`);
      }

      if (nextStep === 'proceed') {
        // 'proceed' means continue to next step in graph
        currentIndex++;
      } else if (nextStep.startsWith('goto:')) {
        currentIndex = findNodeIndex(graph, nextStep.substring(5));
      } else if (nextStep === 'exit') {
        console.log('Executing exit node from gate');
        const exitNode = nodeRegistry.get('exit');
        if (exitNode) {
          state = await executeNode(exitNode, state, llmClient, prompts);
        }
        break;
      } else {
        currentIndex = findNodeIndex(graph, nextStep);
      }

    } else if (step.parallel) {
      const nodes = step.parallel.map(id => nodeRegistry.get(id));
      const results = await Promise.all(
        nodes.map(node => executeNode(node, state, llmClient, prompts))
      );
      // Merge all parallel results into a single state
      // Each result includes all previous nodes plus its own node
      // We need to extract only the new nodes from each result
      const baseNodeCount = state.nodes?.length || 0;
      const newNodes = [];
      for (const result of results) {
        const resultNodes = result.nodes || [];
        if (resultNodes.length > baseNodeCount) {
          // Add only the new nodes (those added by this parallel node)
          newNodes.push(...resultNodes.slice(baseNodeCount));
        }
      }
      // Merge all results, keeping only the new nodes
      state = results.reduce((merged, result) => ({
        ...merged,
        ...result,
      }), state);
      // Replace nodes array with base nodes + new nodes from all parallel executions
      state.nodes = [...(state.nodes || []).slice(0, baseNodeCount), ...newNodes];
      currentIndex++;

    } else if (step.converge) {
      const node = nodeRegistry.get(step.converge);
      if (!node) throw new Error(`Converge node not found: ${step.converge}`);

      state = await executeNode(node, state, llmClient, prompts);
      const decision = state._nodeDecision;
      const nextStep = step.on[decision];

      if (!nextStep) {
        throw new Error(`No routing for decision: ${decision}`);
      }

      // Check if we've reached max iterations before looping back
      if (nextStep.startsWith('goto:') && state.iteration >= maxIterations) {
        console.log(`Max iterations (${maxIterations}) reached, exiting`);
        break;
      }

      if (nextStep.startsWith('goto:')) {
        currentIndex = findNodeIndex(graph, nextStep.substring(5));
      } else if (nextStep === 'exit') {
        console.log('Executing exit node from convergence');
        const exitNode = nodeRegistry.get('exit');
        if (exitNode) {
          state = await executeNode(exitNode, state, llmClient, prompts);
        }
        break;
      } else {
        currentIndex = findNodeIndex(graph, nextStep);
      }
    }
  }

  // Execute exit node if it hasn't been executed yet
  const hasExitNode = state.nodes?.some(n => n.type === 'exit');
  if (!hasExitNode) {
    console.log('Executing exit node at end of graph');
    const exitNode = nodeRegistry.get('exit');
    if (exitNode) {
      state = await executeNode(exitNode, state, llmClient, prompts);
    }
  }

  return state;
}

async function executeNode(node, state, llmClient, prompts) {
  const prepared = node.prepare(state, prompts);
  let llmResult = null;
  if (node.llmCall) {
    llmResult = await node.llmCall(prepared, llmClient);
  }

  // Pass the full llmResult to the node's process function
  // The node will handle extracting content and tokens
  const newState = node.process(prepared, llmResult);

  return newState;
}

function findNodeIndex(graph, nodeId) {
  for (let i = 0; i < graph.length; i++) {
    const step = graph[i];
    if (typeof step === 'string' && step === nodeId) return i;
    if (step.gate === nodeId || step.converge === nodeId) return i;
    if (step.parallel?.includes(nodeId)) return i;
  }
  return -1;
}

module.exports = {
  runLinearGraph,
};
