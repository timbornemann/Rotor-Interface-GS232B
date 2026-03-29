/**
 * Shared map overlay utilities used by UI, rendering and tests.
 */

const OVERLAY_LABEL_MODE_BOTH = 'both';
const OVERLAY_LABEL_MODE_DIRECTIONS = 'directions';
const OVERLAY_LABEL_MODE_HOURS = 'hours';

const OVERLAY_LABEL_MODES = [
  OVERLAY_LABEL_MODE_BOTH,
  OVERLAY_LABEL_MODE_DIRECTIONS,
  OVERLAY_LABEL_MODE_HOURS
];

const DEFAULT_OVERLAY_RING_RADII = [1000, 5000, 10000, 20000];
const MIN_OVERLAY_RINGS = 1;
const MAX_OVERLAY_RINGS = 8;

function sanitizeOverlayRingRadii(radii, fallback = DEFAULT_OVERLAY_RING_RADII) {
  const source = Array.isArray(radii) ? radii : fallback;
  const unique = new Set();
  const result = [];

  for (const raw of source) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    const normalized = Math.round(numeric);
    if (normalized <= 0 || unique.has(normalized)) {
      continue;
    }
    unique.add(normalized);
    result.push(normalized);
  }

  result.sort((a, b) => a - b);
  const limited = result.slice(0, MAX_OVERLAY_RINGS);
  if (limited.length >= MIN_OVERLAY_RINGS) {
    return limited;
  }

  // Last fallback to canonical defaults
  return DEFAULT_OVERLAY_RING_RADII.slice();
}

function sanitizeOverlayLabelMode(mode) {
  const value = String(mode || '').toLowerCase();
  if (OVERLAY_LABEL_MODES.includes(value)) {
    return value;
  }
  return OVERLAY_LABEL_MODE_BOTH;
}

function sanitizeOverlaySettings(config = {}) {
  return {
    mapOverlayEnabled: config.mapOverlayEnabled !== undefined ? Boolean(config.mapOverlayEnabled) : true,
    mapOverlayLabelMode: sanitizeOverlayLabelMode(config.mapOverlayLabelMode),
    mapOverlayAutoContrast: config.mapOverlayAutoContrast !== undefined ? Boolean(config.mapOverlayAutoContrast) : true,
    mapOverlayRingRadiiMeters: sanitizeOverlayRingRadii(config.mapOverlayRingRadiiMeters, DEFAULT_OVERLAY_RING_RADII)
  };
}

function getOverlayLabels(mode = OVERLAY_LABEL_MODE_BOTH) {
  const normalizedMode = sanitizeOverlayLabelMode(mode);
  if (normalizedMode === OVERLAY_LABEL_MODE_DIRECTIONS) {
    return [
      { angle: 0, text: 'N', isDirection: true },
      { angle: 90, text: 'O', isDirection: true },
      { angle: 180, text: 'S', isDirection: true },
      { angle: 270, text: 'W', isDirection: true }
    ];
  }

  if (normalizedMode === OVERLAY_LABEL_MODE_HOURS) {
    return [
      { angle: 0, text: '12' },
      { angle: 30, text: '1' },
      { angle: 60, text: '2' },
      { angle: 90, text: '3' },
      { angle: 120, text: '4' },
      { angle: 150, text: '5' },
      { angle: 180, text: '6' },
      { angle: 210, text: '7' },
      { angle: 240, text: '8' },
      { angle: 270, text: '9' },
      { angle: 300, text: '10' },
      { angle: 330, text: '11' }
    ];
  }

  return [
    { angle: 0, text: 'N', isDirection: true },
    { angle: 30, text: '1' },
    { angle: 60, text: '2' },
    { angle: 90, text: 'O', isDirection: true },
    { angle: 120, text: '4' },
    { angle: 150, text: '5' },
    { angle: 180, text: 'S', isDirection: true },
    { angle: 210, text: '7' },
    { angle: 240, text: '8' },
    { angle: 270, text: 'W', isDirection: true },
    { angle: 300, text: '10' },
    { angle: 330, text: '11' }
  ];
}

function chooseOverlayStyleForLuminance(luminance) {
  const normalized = Number(luminance);
  if (Number.isFinite(normalized) && normalized > 0.58) {
    // Bright background -> use darker foreground with bright halo.
    return {
      lineColor: 'rgba(15, 19, 25, 0.68)',
      textColor: 'rgba(8, 10, 14, 0.96)',
      haloPrimary: 'rgba(255, 255, 255, 0.9)',
      haloSecondary: 'rgba(0, 0, 0, 0.45)'
    };
  }

  // Dark/unknown background -> light foreground with dark halo.
  return {
    lineColor: 'rgba(255, 255, 255, 0.72)',
    textColor: 'rgba(255, 255, 255, 0.94)',
    haloPrimary: 'rgba(0, 0, 0, 0.82)',
    haloSecondary: 'rgba(255, 255, 255, 0.4)'
  };
}

const MapOverlayUtils = {
  OVERLAY_LABEL_MODE_BOTH,
  OVERLAY_LABEL_MODE_DIRECTIONS,
  OVERLAY_LABEL_MODE_HOURS,
  OVERLAY_LABEL_MODES,
  DEFAULT_OVERLAY_RING_RADII,
  MIN_OVERLAY_RINGS,
  MAX_OVERLAY_RINGS,
  sanitizeOverlayRingRadii,
  sanitizeOverlayLabelMode,
  sanitizeOverlaySettings,
  getOverlayLabels,
  chooseOverlayStyleForLuminance
};

if (typeof window !== 'undefined') {
  window.MapOverlayUtils = MapOverlayUtils;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MapOverlayUtils;
}
