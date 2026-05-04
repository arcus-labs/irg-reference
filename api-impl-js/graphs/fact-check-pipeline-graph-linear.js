'use strict';

const factCheckPipelineGraphLinear = [
  'externalFactCheck',
  {
    gate: 'factCheckPipelineGate',
    on: {
      run: 'citationSourceGeneration',
      skip: 'exit',
    },
  },
  'citationSourceGeneration',
  'citationWrite',
  'exit',
];

module.exports = {
  factCheckPipelineGraphLinear,
};