/**
 * X-Ray IRG Node Index
 *
 * Central export point for all X-ray IRG nodes.
 */

'use strict';

const clinicalContextNode       = require('./clinical-context-node');
const imageObservationNode      = require('./image-observation-node');
const imageQualityGateNode      = require('./image-quality-gate-node');
const hypothesisNode            = require('./hypothesis-node');
const differentialExpansionNode = require('./differential-expansion-node');
const adversaryNode             = require('./adversary-node');
const targetedReanalysisNode    = require('./targeted-reanalysis-node');
const evidenceLinkNode          = require('./evidence-link-node');
const convergenceCheckNode      = require('./convergence-check-node');
const triageNode                = require('./triage-node');
const terminationNode           = require('./termination-node');
const recordFinalNode           = require('./record-node');

module.exports = {
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
};

