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

const { RotorService, SimulationSerialConnection } = require('../src/renderer/services/rotorService.js');

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

test('SimulationSerialConnection clamps azimuth targets to 450° soft limit', () => {
  const sim = new SimulationSerialConnection({ modeMaxAz: 450 });
  sim.setSoftLimits({ azimuthMin: 0, azimuthMax: 450 });
  sim.azimuthRaw = 430;

  const target = sim.planRawAzimuthTarget(470);

  assert.strictEqual(target, 450);
});
