const { test } = require('node:test');
const assert = require('node:assert/strict');

const overlayUtils = require('../src/renderer/services/mapOverlayUtils.js');

test('sanitizeOverlayRingRadii sorts, deduplicates and clamps values', () => {
  const result = overlayUtils.sanitizeOverlayRingRadii([5000, 1000, 5000, -1, '10000', 0, 20000.4]);
  assert.deepEqual(result, [1000, 5000, 10000, 20000]);
});

test('sanitizeOverlayRingRadii falls back to defaults on invalid list', () => {
  const result = overlayUtils.sanitizeOverlayRingRadii(['abc', -1, 0]);
  assert.deepEqual(result, overlayUtils.DEFAULT_OVERLAY_RING_RADII);
});

test('sanitizeOverlaySettings normalizes label mode and ring list', () => {
  const normalized = overlayUtils.sanitizeOverlaySettings({
    mapOverlayEnabled: 0,
    mapOverlayLabelMode: 'HOURS',
    mapOverlayAutoContrast: 1,
    mapOverlayRingRadiiMeters: [2000, '1000', 2000]
  });

  assert.equal(normalized.mapOverlayEnabled, false);
  assert.equal(normalized.mapOverlayLabelMode, 'hours');
  assert.equal(normalized.mapOverlayAutoContrast, true);
  assert.deepEqual(normalized.mapOverlayRingRadiiMeters, [1000, 2000]);
});

test('getOverlayLabels returns expected sets for each mode', () => {
  const both = overlayUtils.getOverlayLabels('both');
  const directions = overlayUtils.getOverlayLabels('directions');
  const hours = overlayUtils.getOverlayLabels('hours');

  assert.equal(both.length, 12);
  assert.equal(directions.length, 4);
  assert.equal(hours.length, 12);

  const directionTexts = directions.map((label) => label.text);
  assert.deepEqual(directionTexts, ['N', 'O', 'S', 'W']);

  const hourTexts = hours.map((label) => label.text);
  assert.deepEqual(hourTexts, ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
});

test('chooseOverlayStyleForLuminance picks dark style on bright backgrounds', () => {
  const bright = overlayUtils.chooseOverlayStyleForLuminance(0.9);
  const dark = overlayUtils.chooseOverlayStyleForLuminance(0.2);

  assert.notEqual(bright.lineColor, dark.lineColor);
  assert.match(bright.lineColor, /15, 19, 25/);
  assert.match(dark.lineColor, /255, 255, 255/);
});
