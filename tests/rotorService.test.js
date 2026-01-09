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

// Note: planAzimuthTarget is now a stub - the actual planning logic
// has been moved to the server-side (rotor_logic.py)
test('planAzimuthTarget returns stub response', async () => {
  const rotor = new RotorService();
  
  const plan = await rotor.planAzimuthTarget(180);
  
  // Should return simple stub format
  assert.strictEqual(plan.commandValue, 180);
  assert.strictEqual(plan.distance, 0);
});
