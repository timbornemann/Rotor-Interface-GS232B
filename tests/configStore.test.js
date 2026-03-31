const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadConfigStore() {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/renderer/services/configStore.js'),
    'utf8'
  ) + '\nmodule.exports = { ConfigStore, defaultConfig };';

  const context = {
    module: { exports: {} },
    exports: {},
    console,
    fetch: async () => {
      throw new Error('fetch not implemented in test');
    },
    window: {
      location: { origin: 'http://localhost' },
      MapOverlayUtils: null
    },
    setTimeout,
    clearTimeout,
    Promise
  };

  vm.runInNewContext(source, context, { filename: 'configStore.js' });
  return context.module.exports;
}

test('sanitizeConfig swaps inverted azimuth, elevation and zoom ranges', () => {
  const { ConfigStore } = loadConfigStore();
  const store = new ConfigStore();

  const sanitized = store.sanitizeConfig({
    azimuthMode: 450,
    azimuthMinLimit: 400,
    azimuthMaxLimit: 120,
    elevationMinLimit: 80,
    elevationMaxLimit: 10,
    mapZoomMin: 20,
    mapZoomMax: 6,
    mapZoomLevel: 40
  });

  assert.equal(sanitized.azimuthMinLimit, 120);
  assert.equal(sanitized.azimuthMaxLimit, 400);
  assert.equal(sanitized.elevationMinLimit, 10);
  assert.equal(sanitized.elevationMaxLimit, 80);
  assert.equal(sanitized.mapZoomMin, 6);
  assert.equal(sanitized.mapZoomMax, 20);
  assert.equal(sanitized.mapZoomLevel, 20);
});
