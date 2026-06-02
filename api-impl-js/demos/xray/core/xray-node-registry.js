/**
 * X-Ray IRG Node Registry
 *
 * Maintains a registry of all available X-ray IRG nodes,
 * decoupling node definitions from graph definitions.
 */

'use strict';

const {
  clinicalContextNode,
  imageObservationNode,
  imageQualityGateNode,
  hypothesisNode,
  differentialExpansionNode,
  adversaryNode,
  targetedReanalysisNode,
  evidenceLinkNode,
  convergenceCheckNode,
  triageNode,
  terminationNode,
  recordFinalNode,
} = require('./nodes');

const nodeRegistry = {
  nodes: {
    clinicalContext:       clinicalContextNode,
    imageObservation:      imageObservationNode,
    imageQualityGate:      imageQualityGateNode,
    hypothesis:            hypothesisNode,
    differentialExpansion: differentialExpansionNode,
    adversary:             adversaryNode,
    targetedReanalysis:    targetedReanalysisNode,
    evidenceLink:          evidenceLinkNode,
    convergenceCheck:      convergenceCheckNode,
    triage:                triageNode,
    termination:           terminationNode,
    record:                recordFinalNode,
  },

  getNode(nodeId) {
    const node = this.nodes[nodeId];
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    return node;
  },

  getAllNodes() {
    return { ...this.nodes };
  },

  registerNode(nodeId, nodeDefinition) {
    if (!nodeDefinition.id || !nodeDefinition.prepare || !nodeDefinition.process) {
      throw new Error(`Invalid node definition for ${nodeId}`);
    }
    this.nodes[nodeId] = nodeDefinition;
  },

  hasNode(nodeId) {
    return nodeId in this.nodes;
  },

  getNodeIds() {
    return Object.keys(this.nodes);
  },
};

module.exports = nodeRegistry;

