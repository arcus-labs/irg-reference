'use strict';

const assert = require('assert');
const runtimeDefaults = require('../../shared/runtime-defaults.json');
const ecosystemConfig = require('../../ecosystem.config.cjs');

function runTest() {
  assert.equal(runtimeDefaults.servicePorts.traceNavigator, 3000);
  assert.equal(runtimeDefaults.servicePorts.irgApi, 2100);

  assert.equal(runtimeDefaults.traceNavigatorRequestDefaults.model, 'llama-3.1-8b-instant');
  assert.equal(runtimeDefaults.irgApiRequestDefaults.model, 'llama-3.3-70b-versatile');
  assert.equal(runtimeDefaults.irgApiRequestDefaults.enableFactCheckPipeline, false);
  assert.equal(runtimeDefaults.factCheckPipelineRequestDefaults.enableFactCheckPipeline, true);

  const traceApp = ecosystemConfig.apps.find((app) => app.name === 'trace-navigator');
  const apiApp = ecosystemConfig.apps.find((app) => app.name === 'irg-api');

  assert.ok(traceApp);
  assert.ok(apiApp);
  assert.equal(traceApp.env.PORT, String(runtimeDefaults.servicePorts.traceNavigator));
  assert.equal(apiApp.env.IRG_API_PORT, String(runtimeDefaults.servicePorts.irgApi));

  console.log('runtime defaults test passed');
}

runTest();