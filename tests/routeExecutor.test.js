const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRouteExecutor() {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/renderer/services/routeExecutor.js'),
    'utf8'
  ) + '\nmodule.exports = RouteExecutor;';

  const context = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise
  };

  vm.runInNewContext(source, context, { filename: 'routeExecutor.js' });
  return context.module.exports;
}

test('manual wait cleanup clears interval after continue', async () => {
  const RouteExecutor = loadRouteExecutor();
  const executor = new RouteExecutor({});

  const waitPromise = executor.waitForManualContinue();

  assert.ok(executor.manualWaitCheckInterval);
  executor.continueFromManualWait();
  await waitPromise;

  assert.equal(executor.manualContinueResolve, null);
  assert.equal(executor.manualWaitCheckInterval, null);
});

test('waitForArrival tolerates invalid status values until timeout', async () => {
  const RouteExecutor = loadRouteExecutor();
  const executor = new RouteExecutor({
    currentStatus: {
      azimuthRaw: 'invalid',
      elevationRaw: null
    }
  });

  executor.positionTimeout = 20;

  await executor.waitForArrival(90, 45);
});
