/**
 * Node Index
 *
 * Central export point for all IRG nodes.
 * Each node is in its own file for better organization and maintainability.
 */

'use strict';

const clarifyNode = require('./clarify-node');
const adversaryNode = require('./adversary-node');
const strategyNode = require('./strategy-node');
const arbiterNode = require('./arbiter-node');
const strategyGateNode = require('./strategy-gate-node');
const factCheckNode = require('./fact-check-node');
const externalFactCheckNode = require('./external-fact-check-node');
const factCheckPipelineGateNode = require('./fact-check-pipeline-gate-node');
const citationSourceGenerationNode = require('./citation-source-generation-node');
const citationWriteNode = require('./citation-write-node');
const impactNode = require('./impact-node');
const draftNode = require('./draft-node');
const metaEvaluationNode = require('./meta-evaluation-node');
const assessorNode = require('./assessor-node');
const convergenceNode = require('./convergence-node');
const recordFinalNode = require('./record-node');
const exitNode = require('./exit-node');

module.exports = {
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
};

