'use strict';

const path = require('path');

const EXPIRY_DEFAULTS = {
  science: 365,
  technology: 90,
  finance: 30,
  law: 180,
  politics: 30,
  history: 365 * 5,
  geography: 365,
  health: 180,
  other: 90,
};

function getFactStoreRoot() {
  return process.env.FACT_STORE_ROOT
    || path.resolve(__dirname, '../../../_fact-store');
}

function getFactStorePaths() {
  const factStoreRoot = getFactStoreRoot();
  return {
    factStoreRoot,
    claimsDir: path.join(factStoreRoot, 'claims'),
    citationDir: path.join(factStoreRoot, 'citations'),
    htmlDir: path.join(factStoreRoot, 'sources', 'html'),
    markdownDir: path.join(factStoreRoot, 'sources', 'markdown'),
    metadataDir: path.join(factStoreRoot, 'metadata'),
    factCheckLog: path.join(factStoreRoot, 'metadata', 'fact_check_log.jsonl'),
    retrievalLog: path.join(factStoreRoot, 'metadata', 'retrieval_log.jsonl'),
  };
}

module.exports = {
  EXPIRY_DEFAULTS,
  getFactStoreRoot,
  getFactStorePaths,
};