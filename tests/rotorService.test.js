const { test, beforeEach } = require('node:test');
const assert = require('assert');

// Minimal browser-like globals for the service module
const createMockStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
};

global.window = {
  location: { origin: 'http://localhost', protocol: 'http:' },
  localStorage: createMockStorage()
};

global.navigator = {};

global.TextEncoder = global.TextEncoder || require('util').TextEncoder;
global.TextDecoder = global.TextDecoder || require('util').TextDecoder;

const { RotorService } = require('../src/renderer/services/rotorService.js');

beforeEach(() => {
  window.localStorage.clear();
});

test('planAzimuthTarget picks shortest wrap-around path in 450° mode', () => {
  const rotor = new RotorService();
  rotor.maxAzimuthRange = 450;
  rotor.softLimits.azimuthMax = 450;
  rotor.currentStatus = { azimuth: 440 };

  const plan = rotor.planAzimuthTarget(10);

  assert.strictEqual(plan.calibrated, 10);
  assert.strictEqual(plan.commandValue, 10);
});


test('planAzimuthTarget prefers CW wrap when crossing 0° in 360° mode', () => {
  const rotor = new RotorService();
  rotor.maxAzimuthRange = 360;
  rotor.softLimits.azimuthMax = 360;
  rotor.currentStatus = { azimuth: 359 };

  const plan = rotor.planAzimuthTarget(1);

  assert.strictEqual(plan.direction, 'CW');
  assert.strictEqual(plan.usesWrap, true);
  assert.strictEqual(plan.commandValue, 1);
});

test('planAzimuthTarget reports wrap usage for targets over 360° in 450° mode', () => {
  const rotor = new RotorService();
  rotor.maxAzimuthRange = 450;
  rotor.softLimits.azimuthMax = 450;
  rotor.currentStatus = { azimuth: 10 };

  const plan = rotor.planAzimuthTarget(380);

  assert.strictEqual(plan.calibrated, 380);
  assert.strictEqual(plan.direction, 'CCW');
  assert.strictEqual(plan.usesWrap, true);
});
