const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRouteExecutor() {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/renderer/services/routeExecutor.js'),
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

test('position step waits for applied target when backend clamps command', async () => {
  const RouteExecutor = loadRouteExecutor();
  const calls = [];
  const executor = new RouteExecutor({
    setAzElRaw: async (target) => {
      calls.push(target);
      return { appliedTarget: { azimuth: 100, elevation: 45 } };
    }
  });
  let waitedFor = null;
  executor.waitForArrival = async (azimuth, elevation) => {
    waitedFor = { azimuth, elevation };
  };

  await executor.executePositionStep({ type: 'position', azimuth: 20, elevation: 45 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].az, 20);
  assert.equal(calls[0].el, 45);
  assert.deepEqual(waitedFor, { azimuth: 100, elevation: 45 });
});
