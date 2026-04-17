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

const createJsonResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null)
  },
  json: async () => payload,
  text: async () => JSON.stringify(payload)
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

test('setAzElRaw throws on non-ok backend response', async () => {
  const rotor = new RotorService();
  rotor.isConnected = true;
  global.fetch = async () => createJsonResponse(500, { error: 'Internal failure' });

  await assert.rejects(
    () => rotor.setAzElRaw({ az: 180, el: 45 }),
    /Internal failure/
  );

  assert.strictEqual(rotor.isConnected, true);
});

test('setAzElRaw marks disconnected on ROTOR_DISCONNECTED response', async () => {
  const rotor = new RotorService();
  rotor.isConnected = true;
  const events = [];
  rotor.onConnectionStateChange((state) => events.push(state));

  global.fetch = async () => createJsonResponse(400, {
    error: 'Not connected to rotor',
    code: 'ROTOR_DISCONNECTED'
  });

  await assert.rejects(
    () => rotor.setAzElRaw({ az: 120, el: 30 }),
    /Not connected to rotor/
  );

  assert.strictEqual(rotor.isConnected, false);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].connected, false);
  assert.strictEqual(events[0].reason, 'api_disconnect');
});
