/**
 * IRG Node Registry
 *
 * Maintains a registry of all available nodes, decoupling node definitions
 * from graph definitions. Allows dynamic node lookup and swapping.
 *
 * Usage:
 *   const registry = require('./core/execution/irg-node-registry');
 *   const node = registry.getNode('clarify');
 *   const allNodes = registry.getAllNodes();
 */

'use strict';

const {
  clarifyNode,
  adversaryNode,
  strategyNode,
  arbiterNode,
  strategyGateNode,
  factCheckNode,
  externalFactCheckNode,
  factCheckPipelineGateNode,
  citationSourceGenerationNode,
  citationWriteNode,
  impactNode,
  draftNode,
  metaEvaluationNode,
  assessorNode,
  convergenceNode,
  recordFinalNode,
  exitNode,
} = require('../nodes');

// ---------------------------------------------------------------------------
// Node Registry
// ---------------------------------------------------------------------------

const nodeRegistry = {
  // Map of node ID to node definition
  nodes: {
    clarify: clarifyNode,
    adversary: adversaryNode,
    strategy: strategyNode,
    arbiter: arbiterNode,
    strategyGate: strategyGateNode,
    factCheck: factCheckNode,
    externalFactCheck: externalFactCheckNode,
    factCheckPipelineGate: factCheckPipelineGateNode,
    citationSourceGeneration: citationSourceGenerationNode,
    citationWrite: citationWriteNode,
    impact: impactNode,
    draft: draftNode,
    metaEvaluation: metaEvaluationNode,
    assessor: assessorNode,
    convergence: convergenceNode,
    record: recordFinalNode,
    exit: exitNode,
  },

  /**
   * Get a node by ID
   * @param {string} nodeId - The node ID
   * @returns {Object} The node definition
   * @throws {Error} If node not found
   */
  getNode(nodeId) {
    const node = this.nodes[nodeId];
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    return node;
  },

  /**
   * Get all registered nodes
   * @returns {Object} Map of all nodes
   */
  getAllNodes() {
    return { ...this.nodes };
  },

  /**
   * Register a new node or override existing
   * @param {string} nodeId - The node ID
   * @param {Object} nodeDefinition - The node definition
   */
  registerNode(nodeId, nodeDefinition) {
    if (!nodeDefinition.id || !nodeDefinition.prepare || !nodeDefinition.process) {
      throw new Error(`Invalid node definition for ${nodeId}`);
    }
    this.nodes[nodeId] = nodeDefinition;
  },

  /**
   * Check if a node exists
   * @param {string} nodeId - The node ID
   * @returns {boolean}
   */
  hasNode(nodeId) {
    return nodeId in this.nodes;
  },

  /**
   * Get list of all node IDs
   * @returns {string[]}
   */
  getNodeIds() {
    return Object.keys(this.nodes);
  },
};

module.exports = nodeRegistry;

