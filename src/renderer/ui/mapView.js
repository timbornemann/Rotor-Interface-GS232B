const mapOverlayUtils = (typeof window !== 'undefined' && window.MapOverlayUtils)
  ? window.MapOverlayUtils
  : {
      OVERLAY_LABEL_MODE_BOTH: 'both',
      DEFAULT_OVERLAY_RING_RADII: [1000, 5000, 10000, 20000],
      sanitizeOverlaySettings(config = {}) {
        const mode = String(config.mapOverlayLabelMode || '').toLowerCase();
        const list = Array.isArray(config.mapOverlayRingRadiiMeters) ? config.mapOverlayRingRadiiMeters : [1000, 5000, 10000, 20000];
        const unique = new Set();
        const radii = [];
        for (const raw of list) {
          const parsed = Math.round(Number(raw));
          if (!Number.isFinite(parsed) || parsed <= 0 || unique.has(parsed)) {
            continue;
          }
          unique.add(parsed);
          radii.push(parsed);
        }
        radii.sort((a, b) => a - b);
        return {
          mapOverlayEnabled: config.mapOverlayEnabled !== undefined ? Boolean(config.mapOverlayEnabled) : true,
          mapOverlayLabelMode: ['both', 'directions', 'hours'].includes(mode) ? mode : 'both',
          mapOverlayAutoContrast: config.mapOverlayAutoContrast !== undefined ? Boolean(config.mapOverlayAutoContrast) : true,
          mapOverlayRingRadiiMeters: radii.length ? radii.slice(0, 8) : [1000, 5000, 10000, 20000]
        };
      },
      getOverlayLabels(mode = 'both') {
        if (mode === 'directions') {
          return [
            { angle: 0, text: 'N', isDirection: true },
            { angle: 90, text: 'O', isDirection: true },
            { angle: 180, text: 'S', isDirection: true },
            { angle: 270, text: 'W', isDirection: true }
          ];
        }
        if (mode === 'hours') {
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
      },
      chooseOverlayStyleForLuminance(luminance) {
        if (Number.isFinite(luminance) && luminance > 0.58) {
          return {
            lineColor: 'rgba(15, 19, 25, 0.68)',
            textColor: 'rgba(8, 10, 14, 0.96)',
            haloPrimary: 'rgba(255, 255, 255, 0.9)',
            haloSecondary: 'rgba(0, 0, 0, 0.45)'
          };
        }
        return {
          lineColor: 'rgba(255, 255, 255, 0.72)',
          textColor: 'rgba(255, 255, 255, 0.94)',
          haloPrimary: 'rgba(0, 0, 0, 0.82)',
          haloSecondary: 'rgba(255, 255, 255, 0.4)'
        };
      }
    };

class MapView {
  constructor(canvas) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas context nicht verfuegbar');
    }
    this.canvas = canvas;
    this.ctx = context;
    this.container = canvas.parentElement;
    this.latitude = null;
    this.longitude = null;
    this.satelliteMapEnabled = false;
    this.mapSource = 'arcgis'; // 'arcgis', 'osm', 'google'
    this.mapType = 'satellite'; // 'satellite', 'terrain', 'standard'
    this.mapImage = null;
    this.mapLoading = false;
    this.zoomLevel = 15;
    this.minZoom = 10;
    this.maxZoom = 18;
    this.tileCache = new Map();
    this.lastAzimuth = 0;
    this.lastElevation = 0;
    this.coneAngle = 10; // Kegel-Winkel in Grad
    this.coneLength = 1000; // Kegel-Länge in Metern
    this.azimuthDisplayOffset = 0; // Azimut-Korrektur für Anzeige (Grad)
    this.onClickCallback = null; // Callback für Klick-Events
    this.mapOverlayEnabled = true;
    this.mapOverlayLabelMode = mapOverlayUtils.OVERLAY_LABEL_MODE_BOTH || 'both';
    this.mapOverlayAutoContrast = true;
    this.mapOverlayRingRadiiMeters = (mapOverlayUtils.DEFAULT_OVERLAY_RING_RADII || [1000, 5000, 10000, 20000]).slice();
    this.overlayStyleDirty = true;
    this.overlayStyleCache = null;
    this.overlaySamplingFallback = false;
    this.devicePixelRatio = window.devicePixelRatio || 1;
    
    // Initialisiere Canvas-Größe
    this.resizeCanvas();
    
    // Event-Handler für Zoom und Resize
    this.setupZoomHandlers();
    this.setupResizeHandler();
    this.setupClickHandler();
    this.drawBase();
  }

  setOnClick(callback) {
    this.onClickCallback = callback;
  }

  setZoomLimits(minZoom, maxZoom, preferredZoom = this.zoomLevel) {
    const parsedMin = Number(minZoom);
    const parsedMax = Number(maxZoom);
    this.minZoom = Number.isFinite(parsedMin) ? Math.max(0, Math.round(parsedMin)) : this.minZoom;
    this.maxZoom = Number.isFinite(parsedMax)
      ? Math.max(this.minZoom, Math.round(Math.min(25, parsedMax)))
      : Math.max(this.minZoom, this.maxZoom);

    const targetZoom = Number.isFinite(preferredZoom) ? preferredZoom : this.zoomLevel;
    this.setZoom(targetZoom);
  }

  setConeSettings(angle, length, azimuthOffset = 0) {
    this.coneAngle = Math.max(1, Math.min(90, angle || 10));
    this.coneLength = Math.max(0, length || 1000); // Länge in Metern
    this.azimuthDisplayOffset = Number(azimuthOffset) || 0; // Azimut-Korrektur
    // Aktualisiere die Anzeige
    this.update(this.lastAzimuth, this.lastElevation);
  }

  // Berechne Meter pro Pixel basierend auf Zoom-Level und Breitengrad
  markOverlayStyleDirty() {
    this.overlayStyleDirty = true;
    this.overlayStyleCache = null;
  }

  setOverlaySettings(settings = {}) {
    const sanitizeOverlay = typeof mapOverlayUtils.sanitizeOverlaySettings === 'function'
      ? mapOverlayUtils.sanitizeOverlaySettings
      : (raw) => ({
          mapOverlayEnabled: raw.mapOverlayEnabled !== undefined ? Boolean(raw.mapOverlayEnabled) : true,
          mapOverlayLabelMode: ['both', 'directions', 'hours'].includes(String(raw.mapOverlayLabelMode))
            ? String(raw.mapOverlayLabelMode)
            : 'both',
          mapOverlayAutoContrast: raw.mapOverlayAutoContrast !== undefined ? Boolean(raw.mapOverlayAutoContrast) : true,
          mapOverlayRingRadiiMeters: [1000, 5000, 10000, 20000]
        });

    const normalized = sanitizeOverlay({
      mapOverlayEnabled: settings.mapOverlayEnabled,
      mapOverlayLabelMode: settings.mapOverlayLabelMode,
      mapOverlayAutoContrast: settings.mapOverlayAutoContrast,
      mapOverlayRingRadiiMeters: settings.mapOverlayRingRadiiMeters
    });

    const currentRadii = Array.isArray(this.mapOverlayRingRadiiMeters) ? this.mapOverlayRingRadiiMeters : [];
    const nextRadii = Array.isArray(normalized.mapOverlayRingRadiiMeters) ? normalized.mapOverlayRingRadiiMeters : [];
    const ringListChanged = currentRadii.length !== nextRadii.length
      || currentRadii.some((value, index) => value !== nextRadii[index]);

    const changed = this.mapOverlayEnabled !== normalized.mapOverlayEnabled
      || this.mapOverlayLabelMode !== normalized.mapOverlayLabelMode
      || this.mapOverlayAutoContrast !== normalized.mapOverlayAutoContrast
      || ringListChanged;

    if (!changed) {
      return;
    }

    this.mapOverlayEnabled = normalized.mapOverlayEnabled;
    this.mapOverlayLabelMode = normalized.mapOverlayLabelMode;
    this.mapOverlayAutoContrast = normalized.mapOverlayAutoContrast;
    this.mapOverlayRingRadiiMeters = nextRadii.slice();
    this.markOverlayStyleDirty();
    this.update(this.lastAzimuth, this.lastElevation);
  }

  getOverlayRingPixelRadii() {
    const source = Array.isArray(this.mapOverlayRingRadiiMeters) && this.mapOverlayRingRadiiMeters.length
      ? this.mapOverlayRingRadiiMeters
      : (mapOverlayUtils.DEFAULT_OVERLAY_RING_RADII || [1000, 5000, 10000, 20000]);

    return source
      .map((meters) => this.metersToPixels(meters))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
  }

  getOverlayLabels() {
    if (typeof mapOverlayUtils.getOverlayLabels === 'function') {
      return mapOverlayUtils.getOverlayLabels(this.mapOverlayLabelMode);
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

  getOverlayBaseStyle() {
    const chooser = typeof mapOverlayUtils.chooseOverlayStyleForLuminance === 'function'
      ? mapOverlayUtils.chooseOverlayStyleForLuminance
      : () => ({
          lineColor: 'rgba(255, 255, 255, 0.72)',
          textColor: 'rgba(255, 255, 255, 0.94)',
          haloPrimary: 'rgba(0, 0, 0, 0.82)',
          haloSecondary: 'rgba(255, 255, 255, 0.4)'
        });
    return { ...chooser(Number.NaN), useDualHalo: false };
  }

  getOverlayFallbackStyle() {
    return {
      lineColor: 'rgba(255, 255, 255, 0.95)',
      textColor: 'rgba(255, 255, 255, 0.98)',
      haloPrimary: 'rgba(0, 0, 0, 0.9)',
      haloSecondary: 'rgba(255, 255, 255, 0.7)',
      useDualHalo: true
    };
  }

  cloneOverlayStyle(style) {
    return {
      lineColor: style.lineColor,
      textColor: style.textColor,
      haloPrimary: style.haloPrimary,
      haloSecondary: style.haloSecondary,
      useDualHalo: Boolean(style.useDualHalo)
    };
  }

  captureOverlayImageData() {
    const widthPx = Math.max(1, Math.round(this.width * this.devicePixelRatio));
    const heightPx = Math.max(1, Math.round(this.height * this.devicePixelRatio));
    try {
      const imageData = this.ctx.getImageData(0, 0, widthPx, heightPx);
      this.overlaySamplingFallback = false;
      return imageData;
    } catch (error) {
      if (!this.overlaySamplingFallback) {
        console.warn('[MapView] Auto-contrast fallback aktiv (Pixel-Sampling nicht verfuegbar):', error.message);
      }
      this.overlaySamplingFallback = true;
      return null;
    }
  }

  sampleLuminanceAtPoints(imageData, points, sampleRadiusDisplay = 2) {
    if (!imageData || !Array.isArray(points) || !points.length) {
      return null;
    }

    const data = imageData.data;
    const widthPx = imageData.width;
    const heightPx = imageData.height;
    const radiusPx = Math.max(1, Math.round(sampleRadiusDisplay * this.devicePixelRatio));
    let luminanceSum = 0;
    let sampleCount = 0;

    for (const point of points) {
      const baseX = Math.round(point.x * this.devicePixelRatio);
      const baseY = Math.round(point.y * this.devicePixelRatio);

      for (let dy = -radiusPx; dy <= radiusPx; dy++) {
        const py = baseY + dy;
        if (py < 0 || py >= heightPx) {
          continue;
        }
        for (let dx = -radiusPx; dx <= radiusPx; dx++) {
          const px = baseX + dx;
          if (px < 0 || px >= widthPx) {
            continue;
          }
          const idx = (py * widthPx + px) * 4;
          const alpha = data[idx + 3] / 255;
          if (alpha <= 0) {
            continue;
          }
          const red = data[idx] / 255;
          const green = data[idx + 1] / 255;
          const blue = data[idx + 2] / 255;
          const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha;
          luminanceSum += luminance;
          sampleCount += 1;
        }
      }
    }

    if (!sampleCount) {
      return null;
    }

    return luminanceSum / sampleCount;
  }

  getStyleForLuminance(luminance) {
    if (!Number.isFinite(luminance)) {
      return this.getOverlayFallbackStyle();
    }
    const chooser = typeof mapOverlayUtils.chooseOverlayStyleForLuminance === 'function'
      ? mapOverlayUtils.chooseOverlayStyleForLuminance
      : () => this.getOverlayBaseStyle();
    return { ...chooser(luminance), useDualHalo: false };
  }

  buildOverlayStylePack(ringPixelRadii, labels, radialAngles, labelRadius, radialExtent) {
    const baseStyle = this.getOverlayBaseStyle();
    const fallbackStyle = this.getOverlayFallbackStyle();

    if (!this.mapOverlayAutoContrast) {
      return {
        ringStyles: ringPixelRadii.map(() => this.cloneOverlayStyle(baseStyle)),
        radialStyles: radialAngles.map(() => this.cloneOverlayStyle(baseStyle)),
        labelStyles: labels.map(() => this.cloneOverlayStyle(baseStyle))
      };
    }

    const imageData = this.captureOverlayImageData();
    if (!imageData) {
      return {
        ringStyles: ringPixelRadii.map(() => this.cloneOverlayStyle(fallbackStyle)),
        radialStyles: radialAngles.map(() => this.cloneOverlayStyle(fallbackStyle)),
        labelStyles: labels.map(() => this.cloneOverlayStyle(fallbackStyle))
      };
    }

    const ringStyles = ringPixelRadii.map((radiusPx) => {
      const circleLength = 2 * Math.PI * radiusPx;
      const sampleCount = Math.max(10, Math.min(36, Math.round(circleLength / 90)));
      const points = [];
      for (let i = 0; i < sampleCount; i++) {
        const angle = (Math.PI * 2 * i) / sampleCount;
        points.push({
          x: this.centerX + Math.cos(angle) * radiusPx,
          y: this.centerY + Math.sin(angle) * radiusPx
        });
      }
      return this.getStyleForLuminance(this.sampleLuminanceAtPoints(imageData, points, 2));
    });

    const radialStyles = radialAngles.map((angleDeg) => {
      const angleRad = (angleDeg * Math.PI) / 180;
      const points = [
        {
          x: this.centerX + Math.cos(angleRad) * radialExtent * 0.45,
          y: this.centerY + Math.sin(angleRad) * radialExtent * 0.45
        },
        {
          x: this.centerX + Math.cos(angleRad) * radialExtent * 0.8,
          y: this.centerY + Math.sin(angleRad) * radialExtent * 0.8
        }
      ];
      return this.getStyleForLuminance(this.sampleLuminanceAtPoints(imageData, points, 2));
    });

    const labelStyles = labels.map(({ angle }) => {
      const rad = ((angle - 90) * Math.PI) / 180;
      const x = this.centerX + Math.cos(rad) * labelRadius;
      const y = this.centerY + Math.sin(rad) * labelRadius;
      return this.getStyleForLuminance(this.sampleLuminanceAtPoints(imageData, [{ x, y }], 6));
    });

    return { ringStyles, radialStyles, labelStyles };
  }

  getOverlayStylePack(ringPixelRadii, labels, radialAngles, labelRadius, radialExtent) {
    if (!this.overlayStyleDirty && this.overlayStyleCache) {
      return this.overlayStyleCache;
    }

    this.overlayStyleCache = this.buildOverlayStylePack(
      ringPixelRadii,
      labels,
      radialAngles,
      labelRadius,
      radialExtent
    );
    this.overlayStyleDirty = false;
    return this.overlayStyleCache;
  }

  getMetersPerPixel() {
    if (this.latitude === null) {
      // Fallback: Verwende Standard-Wert wenn keine Koordinaten gesetzt
      return this.getMetersPerPixelForZoom(this.zoomLevel, 51.0); // ~Mitte Deutschland
    }
    return this.getMetersPerPixelForZoom(this.zoomLevel, this.latitude);
  }

  getMetersPerPixelForZoom(zoom, latitude) {
    // Formel für Web Mercator: Meter pro Pixel = (156543.03392 * cos(lat)) / (2^zoom)
    // Quelle: https://wiki.openstreetmap.org/wiki/Zoom_levels
    const latRad = (latitude * Math.PI) / 180;
    const metersPerPixel = (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);
    return metersPerPixel;
  }

  // Konvertiere Meter in Pixel basierend auf aktueller Karten-Skalierung
  metersToPixels(meters) {
    const metersPerPixel = this.getMetersPerPixel();
    return meters / metersPerPixel;
  }

  resizeCanvas() {
    if (!this.container) {
      return;
    }
    
    const rect = this.container.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    
    if (width <= 0 || height <= 0) {
      return;
    }
    
    // Setze Canvas-Größe (devicePixelRatio für Retina-Displays)
    const dpr = window.devicePixelRatio || 1;
    this.devicePixelRatio = dpr;
    const displayWidth = width;
    const displayHeight = height;
    
    // Nur ändern, wenn sich die Größe geändert hat
    if (this.canvas.width !== displayWidth * dpr || this.canvas.height !== displayHeight * dpr) {
      this.canvas.width = displayWidth * dpr;
      this.canvas.height = displayHeight * dpr;
      this.canvas.style.width = `${displayWidth}px`;
      this.canvas.style.height = `${displayHeight}px`;
      
      // Reset Transform und skaliere für Retina
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(dpr, dpr);
    }
    
    // Aktualisiere Dimensionen
    this.width = displayWidth;
    this.height = displayHeight;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
    this.radius = Math.min(this.width, this.height) / 2 - 30;
    this.markOverlayStyleDirty();
    
    // Lade Karte neu, falls aktiviert
    if (this.satelliteMapEnabled && this.latitude !== null && this.longitude !== null) {
      this.loadMap();
    } else {
      this.update(this.lastAzimuth, this.lastElevation);
    }
  }

  setupResizeHandler() {
    // ResizeObserver für Container-Größenänderungen
    if (window.ResizeObserver && this.container) {
      this.resizeObserver = new ResizeObserver(() => {
        this.resizeCanvas();
      });
      this.resizeObserver.observe(this.container);
    } else {
      // Fallback: Window-Resize-Event
      window.addEventListener('resize', () => {
        this.resizeCanvas();
      });
    }
  }

  setupZoomHandlers() {
    // Mausrad-Zoom deaktiviert - nur Plus/Minus-Buttons werden verwendet
    // this.canvas.addEventListener('wheel', (e) => {
    //   e.preventDefault();
    //   const delta = e.deltaY > 0 ? -1 : 1;
    //   this.setZoom(this.zoomLevel + delta);
    // });
  }

  setupClickHandler() {
    // Click-Handler für Rotor-Steuerung
    this.canvas.addEventListener('click', (e) => {
      if (!this.onClickCallback) {
        return;
      }

      // Hole Canvas-Position relativ zum Viewport
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      
      // Berechne Click-Position relativ zum Canvas (mit devicePixelRatio berücksichtigen)
      const clickX = (e.clientX - rect.left) * dpr;
      const clickY = (e.clientY - rect.top) * dpr;
      
      // Konvertiere zu Display-Koordinaten (ohne devicePixelRatio für Berechnungen)
      const displayX = e.clientX - rect.left;
      const displayY = e.clientY - rect.top;
      
      // Berechne relative Position zum Zentrum
      const relX = displayX - this.centerX;
      const relY = displayY - this.centerY;
      
      // Berechne Entfernung vom Zentrum
      const distance = Math.sqrt(relX * relX + relY * relY);
      
      // Berechne Azimut (Winkel vom Norden, im Uhrzeigersinn)
      // Canvas-Koordinaten: relX = rechts (positiv), relY = unten (positiv)
      // atan2(relY, relX): 0° = rechts, 90° = unten, 180° = links, -90° = oben
      // Rotor-Koordinaten: 0° = Norden (oben), 90° = Osten (rechts), 180° = Süden (unten), 270° = Westen (links)
      // 
      // Die Anzeige verwendet: rad = ((correctedAzimuth - 90) * Math.PI) / 180
      // Das bedeutet: correctedAzimuth = 0° → rad = -90° = oben (Norden) ✓
      //               correctedAzimuth = 90° → rad = 0° = rechts (Osten) ✓
      // 
      // Für den Click: Wir müssen den Canvas-Winkel in Rotor-Azimut umrechnen
      // Canvas: 0° = rechts (Osten), 90° = unten (Süden), 180° = links (Westen), 270° = oben (Norden)
      // Rotor: 0° = Norden, 90° = Osten, 180° = Süden, 270° = Westen
      // 
      // Test: Klick rechts (Osten)
      // Canvas: relX > 0, relY = 0 → atan2(0, pos) = 0°
      // Rotor sollte sein: 90° (Osten)
      // Formel: Rotor = (Canvas + 90) % 360 = (0 + 90) % 360 = 90° ✓
      // 
      // Test: Klick oben (Norden)
      // Canvas: relX = 0, relY < 0 → atan2(neg, 0) = -90° = 270°
      // Rotor sollte sein: 0° (Norden)
      // Formel: Rotor = (270 + 90) % 360 = 360 % 360 = 0° ✓
      // 
      // ABER: Wenn es gespiegelt ist, dann ist vielleicht die X-Achse invertiert?
      // Versuchen wir: Rotor = (90 - Canvas + 360) % 360
      // Canvas 0° → (90 - 0) % 360 = 90° ✓
      // Canvas 270° → (90 - 270 + 360) % 360 = 180° ✗ sollte 0° sein
      //
      // Berechne Winkel - versuchen wir verschiedene Ansätze
      // Option 1: Standard (relY wie es ist)
      // Option 2: Y invertiert (-relY) - für gespiegelte Y-Achse
      // Option 3: X invertiert (-relX)
      // Option 4: Beide invertiert
      
      // Problem-Analyse:
      // - Osten/Westen funktionieren richtig → X-Achse ist korrekt
      // - Norden/Süden sind 180° vertauscht → Y-Achse muss korrigiert werden
      // 
      // Mit atan2(-relY, relX):
      // - Klick oben (Norden): relX=0, relY<0 → atan2(pos, 0) = 90° → (90+90)%360 = 180° ✗ (sollte 0° sein)
      // - Klick unten (Süden): relX=0, relY>0 → atan2(neg, 0) = -90° = 270° → (270+90)%360 = 0° ✗ (sollte 180° sein)
      //
      // Mit atan2(relY, relX):
      // - Klick oben (Norden): relX=0, relY<0 → atan2(neg, 0) = -90° = 270° → (270+90)%360 = 0° ✓
      // - Klick unten (Süden): relX=0, relY>0 → atan2(pos, 0) = 90° → (90+90)%360 = 180° ✓
      // - Klick rechts (Osten): relX>0, relY=0 → atan2(0, pos) = 0° → (0+90)%360 = 90° ✓
      // - Klick links (Westen): relX<0, relY=0 → atan2(0, neg) = 180° → (180+90)%360 = 270° ✓
      //
      // Also: Verwende atan2(relY, relX) OHNE Y-Invertierung
      let canvasAngle = Math.atan2(relY, relX) * 180 / Math.PI;
      // Konvertiere zu 0-360° Bereich
      if (canvasAngle < 0) {
        canvasAngle += 360;
      }
      // Umrechnung: Rotor = (Canvas + 90) % 360
      let azimuth = (canvasAngle + 90) % 360;
      
      // Subtrahiere die Display-Korrektur, um den echten Rotor-Azimut zu bekommen
      // Die Anzeige zeigt: azimuth + azimuthDisplayOffset
      // Also müssen wir die Korrektur rückgängig machen
      azimuth = azimuth - this.azimuthDisplayOffset;
      if (azimuth < 0) {
        azimuth += 360;
      }
      if (azimuth >= 360) {
        azimuth -= 360;
      }
      
      // Berechne Elevation basierend auf Entfernung
      // Maximale Entfernung = Radius
      // 0° Elevation = am Rand, 90° Elevation = im Zentrum
      // Oder: Entfernung proportional zu Elevation (umgekehrt)
      const maxDistance = this.radius;
      const normalizedDistance = Math.min(1, distance / maxDistance);
      // Elevation: 90° im Zentrum, 0° am Rand
      const elevation = 90 * (1 - normalizedDistance);
      
      // Rufe Callback auf
      this.onClickCallback(azimuth, elevation);
    });
    
    // Cursor-Styling für bessere UX
    this.canvas.style.cursor = 'crosshair';
  }

  setZoom(level) {
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.round(level)));
    if (newZoom !== this.zoomLevel) {
      this.zoomLevel = newZoom;
      this.tileCache.clear();
      this.markOverlayStyleDirty();
      if (this.satelliteMapEnabled && this.latitude !== null && this.longitude !== null) {
        this.loadMap();
      } else {
        this.update(this.lastAzimuth, this.lastElevation);
      }
      this.updateZoomDisplay();
    }
  }

  updateZoomDisplay() {
    const zoomDisplay = document.getElementById('zoomLevel');
    if (zoomDisplay) {
      zoomDisplay.textContent = `Zoom: ${this.zoomLevel}`;
    }
  }

  setCoordinates(latitude, longitude) {
    this.latitude = latitude;
    this.longitude = longitude;
    this.tileCache.clear();
    this.markOverlayStyleDirty();
    if (!this.satelliteMapEnabled) {
      this.update(this.lastAzimuth || 0, this.lastElevation || 0);
    }
  }

  setSatelliteMapEnabled(enabled) {
    this.satelliteMapEnabled = enabled;
    this.markOverlayStyleDirty();
    if (enabled && this.latitude !== null && this.longitude !== null) {
      this.loadMap();
    } else {
      this.mapImage = null;
      this.update(this.lastAzimuth || 0, this.lastElevation || 0);
    }
  }

  setMapConfig(enabled, source = 'arcgis', type = 'satellite') {
    this.satelliteMapEnabled = enabled;
    this.mapSource = source;
    this.mapType = type;
    this.markOverlayStyleDirty();
    if (enabled && this.latitude !== null && this.longitude !== null) {
      this.tileCache.clear();
      this.loadMap();
    } else {
      this.mapImage = null;
      this.update(this.lastAzimuth || 0, this.lastElevation || 0);
    }
  }

  // Generiere Tile-URL basierend auf Quelle und Typ
  getTileUrl(zoom, tileX, tileY) {
    if (this.mapSource === 'osm') {
      // OpenStreetMap - nur Standard-Karten (ignoriert mapType)
      return `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`;
    } else if (this.mapSource === 'google') {
      // Google Maps - verschiedene Typen
      // Hinweis: Google Maps Tiles können ohne API-Key rate-limited sein
      if (this.mapType === 'satellite') {
        return `https://mt0.google.com/vt/lyrs=s&x=${tileX}&y=${tileY}&z=${zoom}`;
      } else if (this.mapType === 'terrain') {
        return `https://mt0.google.com/vt/lyrs=t&x=${tileX}&y=${tileY}&z=${zoom}`;
      } else {
        // Standard/Roadmap
        return `https://mt0.google.com/vt/lyrs=m&x=${tileX}&y=${tileY}&z=${zoom}`;
      }
    } else {
      // ArcGIS (Standard)
      if (this.mapType === 'satellite') {
        return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}/${tileX}`;
      } else if (this.mapType === 'terrain') {
        return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${zoom}/${tileY}/${tileX}`;
      } else {
        // Standard/Street
        return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${zoom}/${tileY}/${tileX}`;
      }
    }
  }

  // Berechne Pixel-Position innerhalb eines Tiles für gegebene Koordinaten
  getPixelPositionInTile(lat, lon, zoom, tileX, tileY) {
    const n = Math.pow(2, zoom);
    const tileSize = 256;
    
    // Berechne genaue Tile-Koordinaten (mit Nachkommastellen)
    const exactTileX = ((lon + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const exactTileY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    
    // Berechne Pixel-Position innerhalb des Tiles
    const pixelX = (exactTileX - tileX) * tileSize;
    const pixelY = (exactTileY - tileY) * tileSize;
    
    return { pixelX, pixelY, exactTileX, exactTileY };
  }

  async loadMap() {
    if (this.mapLoading || this.latitude === null || this.longitude === null) {
      return;
    }

    this.mapLoading = true;
    try {
      const zoom = this.zoomLevel;
      const tileSize = 256;
      
      // Berechne Tile-Koordinaten für die Zentrumskoordinaten
      const n = Math.pow(2, zoom);
      const latRad = (this.latitude * Math.PI) / 180;
      const centerTileX = ((this.longitude + 180) / 360) * n;
      const centerTileY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
      
      // Berechne Pixel-Position der Koordinaten im zentralen Tile
      const centerTileXFloor = Math.floor(centerTileX);
      const centerTileYFloor = Math.floor(centerTileY);
      const pixelPos = this.getPixelPositionInTile(
        this.latitude, 
        this.longitude, 
        zoom, 
        centerTileXFloor, 
        centerTileYFloor
      );

      // Berechne benötigte Anzahl Tiles, um den Canvas vollständig zu füllen
      // Berücksichtige auch die Pixel-Position der Koordinaten im zentralen Tile
      const pixelsPerTile = tileSize;
      const neededTilesX = Math.ceil(this.width / pixelsPerTile) + 2; // +2 für Puffer
      const neededTilesY = Math.ceil(this.height / pixelsPerTile) + 2;
      const gridSize = Math.max(neededTilesX, neededTilesY, zoom >= 16 ? 5 : 3);
      const tiles = [];
      
      const offset = Math.floor(gridSize / 2);
      for (let dy = -offset; dy <= offset; dy++) {
        for (let dx = -offset; dx <= offset; dx++) {
          const tx = centerTileXFloor + dx;
          const ty = centerTileYFloor + dy;
          if (tx >= 0 && tx < n && ty >= 0 && ty < n) {
            const url = this.getTileUrl(zoom, tx, ty);
            tiles.push({ url, dx, dy, tx, ty });
          }
        }
      }

      // Lade alle Tiles mit Timeout
      const tileImages = await Promise.all(
        tiles.map(({ url }) => {
          // Cache-Check
          if (this.tileCache.has(url)) {
            return Promise.resolve(this.tileCache.get(url));
          }
          
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            const timeout = setTimeout(() => {
              reject(new Error('Timeout beim Laden des Karten-Tiles'));
            }, 10000);
            
            img.onload = () => {
              clearTimeout(timeout);
              this.tileCache.set(url, img);
              resolve(img);
            };
            img.onerror = (err) => {
              clearTimeout(timeout);
              reject(new Error(`Fehler beim Laden des Karten-Tiles: ${url}`));
            };
            img.src = url;
          });
        })
      );

      // Erstelle kombiniertes Bild mit Zentrierung auf die Koordinaten
      // Das Canvas muss groß genug sein, um den Ziel-Canvas zu füllen
      const combinedCanvas = document.createElement('canvas');
      // Berechne benötigte Größe: Canvas-Größe + Puffer für Zentrierung
      const neededWidth = this.width + tileSize * 2;
      const neededHeight = this.height + tileSize * 2;
      combinedCanvas.width = neededWidth;
      combinedCanvas.height = neededHeight;
      const combinedCtx = combinedCanvas.getContext('2d');

      // Berechne die Position der Koordinaten im zentralen Tile (in Pixeln)
      const centerTilePixelX = pixelPos.pixelX;
      const centerTilePixelY = pixelPos.pixelY;
      
      // Die Koordinaten sollen in der Mitte des Ziel-Canvas sein
      const targetCenterX = this.width / 2;
      const targetCenterY = this.height / 2;
      
      // Position im combined Canvas (mit Puffer)
      const combinedCenterX = neededWidth / 2;
      const combinedCenterY = neededHeight / 2;
      
      // Berechne, wo das zentrale Tile gezeichnet werden muss
      // Die Koordinaten-Position im zentralen Tile muss zur Canvas-Mitte passen
      const centerTileDrawX = combinedCenterX - centerTilePixelX;
      const centerTileDrawY = combinedCenterY - centerTilePixelY;
      
      // Zeichne alle Tiles relativ zum zentralen Tile
      tiles.forEach(({ dx, dy }, index) => {
        const x = centerTileDrawX + (dx * tileSize);
        const y = centerTileDrawY + (dy * tileSize);
        combinedCtx.drawImage(tileImages[index], x, y);
      });

      // Speichere die Zentrierungs-Informationen für das Rendering
      this.mapImageData = {
        image: null,
        sourceWidth: neededWidth,
        sourceHeight: neededHeight,
        targetWidth: this.width,
        targetHeight: this.height,
        sourceCenterX: combinedCenterX,
        sourceCenterY: combinedCenterY,
        targetCenterX: targetCenterX,
        targetCenterY: targetCenterY
      };

      // Erstelle Bild aus Canvas
      const img = new Image();
      img.src = combinedCanvas.toDataURL();
      img.onload = () => {
        this.mapImageData.image = img;
        this.mapImage = img; // Für Kompatibilität
        this.markOverlayStyleDirty();
        this.update(this.lastAzimuth || 0, this.lastElevation || 0);
        this.mapLoading = false;
      };
    } catch (error) {
      console.error('Fehler beim Laden der Karte:', error);
      this.mapLoading = false;
      this.mapImage = null;
      this.markOverlayStyleDirty();
      this.update(this.lastAzimuth || 0, this.lastElevation || 0);
      throw error;
    }
  }

  update(azimuth, elevation) {
    const az = typeof azimuth === 'number' ? azimuth : 0;
    const el = typeof elevation === 'number' ? elevation : 0;
    this.lastAzimuth = az;
    this.lastElevation = el;
    this.drawBase();
    this.drawDirection(az, el);
  }

  drawBase() {
    const { ctx } = this;
    // clearRect verwendet die internen Canvas-Dimensionen (mit devicePixelRatio)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Zeichne Satellitenkarte als Hintergrund, falls aktiviert
    if (this.satelliteMapEnabled && this.mapImageData && this.mapImageData.image && this.mapImageData.image.complete) {
      ctx.save();
      // Zeichne Karte so, dass sie den gesamten Canvas ausfuellt
      // Die Koordinaten bleiben in der Mitte
      const { image, sourceWidth, sourceHeight, targetWidth, targetHeight, sourceCenterX, sourceCenterY, targetCenterX, targetCenterY } = this.mapImageData;

      // Berechne Skalierung, um den Canvas vollstaendig auszufuellen
      const scaleX = targetWidth / sourceWidth;
      const scaleY = targetHeight / sourceHeight;
      const scale = Math.max(scaleX, scaleY); // Verwende groessere Skalierung, um vollstaendig zu fuellen

      // Berechne die neue Groesse nach Skalierung
      const scaledWidth = sourceWidth * scale;
      const scaledHeight = sourceHeight * scale;

      // Berechne Position, damit die Zentren uebereinstimmen
      // Die Zentren muessen exakt uebereinstimmen, damit die Koordinaten in der Mitte sind
      const drawX = targetCenterX - (sourceCenterX * scale);
      const drawY = targetCenterY - (sourceCenterY * scale);

      // Zeichne die skalierte Karte, die den gesamten Canvas ausfuellt
      ctx.drawImage(
        image,
        0, 0, sourceWidth, sourceHeight,
        drawX, drawY, scaledWidth, scaledHeight
      );

      ctx.restore();
    }

    if (!this.mapOverlayEnabled) {
      return;
    }

    let ringPixelRadii = this.getOverlayRingPixelRadii();
    if (!ringPixelRadii.length) {
      ringPixelRadii = [this.radius * 0.25, this.radius * 0.5, this.radius * 0.75, this.radius];
    }

    const radialAngles = [];
    for (let angle = 0; angle < 360; angle += 30) {
      radialAngles.push(angle);
    }

    const labels = this.getOverlayLabels();
    const labelRadius = this.radius + 15;
    const radialExtent = Math.max(this.radius, ringPixelRadii[ringPixelRadii.length - 1] || this.radius);
    const stylePack = this.getOverlayStylePack(ringPixelRadii, labels, radialAngles, labelRadius, radialExtent);
    const fallbackStyle = this.getOverlayFallbackStyle();

    ctx.save();
    ctx.translate(this.centerX, this.centerY);

    ringPixelRadii.forEach((radiusPx, index) => {
      const style = stylePack.ringStyles[index] || fallbackStyle;
      this.drawOverlayCircle(radiusPx, style);
    });

    radialAngles.forEach((angle, index) => {
      const rad = (angle * Math.PI) / 180;
      const style = stylePack.radialStyles[index] || fallbackStyle;
      this.drawOverlayLine(0, 0, Math.cos(rad) * radialExtent, Math.sin(rad) * radialExtent, style);
    });

    this.drawLabels(labels, labelRadius, stylePack.labelStyles || []);
    ctx.restore();
  }

  drawOverlayCircle(radius, style) {
    const { ctx } = this;
    const drawArc = (strokeStyle, lineWidth) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
    };

    if (style.useDualHalo) {
      drawArc(style.haloSecondary || 'rgba(255, 255, 255, 0.65)', 4.2);
      drawArc(style.haloPrimary || 'rgba(0, 0, 0, 0.88)', 2.8);
    } else {
      drawArc(style.haloPrimary || 'rgba(0, 0, 0, 0.72)', 2.3);
    }
    drawArc(style.lineColor || 'rgba(255, 255, 255, 0.8)', 1.1);
  }

  drawOverlayLine(fromX, fromY, toX, toY, style) {
    const { ctx } = this;
    const drawLine = (strokeStyle, lineWidth) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
    };

    if (style.useDualHalo) {
      drawLine(style.haloSecondary || 'rgba(255, 255, 255, 0.6)', 3.2);
      drawLine(style.haloPrimary || 'rgba(0, 0, 0, 0.9)', 2);
    } else {
      drawLine(style.haloPrimary || 'rgba(0, 0, 0, 0.75)', 1.8);
    }
    drawLine(style.lineColor || 'rgba(255, 255, 255, 0.8)', 1);
  }

  drawRoundedRectPath(x, y, width, height, radius) {
    const { ctx } = this;
    const r = Math.max(1, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  drawOverlayLabel(text, x, y, isDirection, style) {
    const { ctx } = this;
    const fontSize = 12;
    const activeFontSize = isDirection ? (fontSize + 3) : fontSize;
    ctx.font = `bold ${activeFontSize}px 'Segoe UI', Roboto, sans-serif`;

    // Zeichne zuerst eine kontrastreiche Kapsel hinter den Labels, damit Linien
    // beim Hineinzoomen nicht mit Textfarbe verschmelzen.
    const metrics = ctx.measureText(text);
    const paddingX = isDirection ? 8 : 7;
    const backgroundWidth = Math.max(metrics.width + paddingX * 2, isDirection ? 30 : 24);
    const backgroundHeight = activeFontSize + (isDirection ? 8 : 7);
    const bgX = x - (backgroundWidth / 2);
    const bgY = y - (backgroundHeight / 2);
    const bgRadius = Math.max(6, Math.min(10, backgroundHeight / 2));

    const backgroundFill = style.haloPrimary || 'rgba(0, 0, 0, 0.82)';
    const backgroundStroke = style.haloSecondary || style.lineColor || 'rgba(255, 255, 255, 0.45)';

    ctx.save();
    ctx.globalAlpha = style.useDualHalo ? 0.9 : 0.82;
    ctx.fillStyle = backgroundFill;
    this.drawRoundedRectPath(bgX, bgY, backgroundWidth, backgroundHeight, bgRadius);
    ctx.fill();
    ctx.globalAlpha = style.useDualHalo ? 0.9 : 0.72;
    ctx.strokeStyle = backgroundStroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    if (style.useDualHalo) {
      ctx.strokeStyle = style.haloSecondary || 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 4.2;
      ctx.strokeText(text, x, y);
      ctx.strokeStyle = style.haloPrimary || 'rgba(0, 0, 0, 0.9)';
      ctx.lineWidth = 2.6;
      ctx.strokeText(text, x, y);
    } else {
      ctx.strokeStyle = style.haloPrimary || 'rgba(0, 0, 0, 0.78)';
      ctx.lineWidth = 2.4;
      ctx.strokeText(text, x, y);
    }

    ctx.fillStyle = style.textColor || 'rgba(255, 255, 255, 0.95)';
    ctx.fillText(text, x, y);
  }

  drawLabels(labels, labelRadius, labelStyles = []) {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fallbackStyle = this.getOverlayFallbackStyle();

    labels.forEach(({ angle, text, isDirection }, index) => {
      const rad = ((angle - 90) * Math.PI) / 180;
      const x = Math.cos(rad) * labelRadius;
      const y = Math.sin(rad) * labelRadius;
      const style = labelStyles[index] || fallbackStyle;
      this.drawOverlayLabel(text, x, y, isDirection, style);
    });

    ctx.restore();
  }

  drawDirection(azimuth, elevation) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(this.centerX, this.centerY);

    // Wende Azimut-Korrektur für die Anzeige an
    const correctedAzimuth = azimuth + this.azimuthDisplayOffset;
    const rad = ((correctedAzimuth - 90) * Math.PI) / 180;
    
    // Berechne Länge in Pixeln basierend auf Metern und aktueller Skalierung
    let lengthInPixels;
    if (this.satelliteMapEnabled && this.latitude !== null) {
      // Wenn Karte aktiv: Verwende exakte Skalierung basierend auf Zoom-Level
      lengthInPixels = this.metersToPixels(this.coneLength);
    } else {
      // Wenn keine Karte: Verwende relative Skalierung basierend auf Radius
      // Fallback: 1 Meter = 1 Pixel bei Zoom 15, skaliert mit Radius
      const baseMetersPerPixel = this.getMetersPerPixelForZoom(15, 51.0); // Standard
      const currentMetersPerPixel = this.getMetersPerPixelForZoom(this.zoomLevel, 51.0);
      const scaleFactor = baseMetersPerPixel / currentMetersPerPixel;
      lengthInPixels = (this.coneLength / baseMetersPerPixel) * scaleFactor;
      
      // Begrenze auf maximalen Radius (mit Elevation-Berücksichtigung)
      const maxLength = this.radius * (0.4 + 0.6 * Math.min(elevation, 90) / 90);
      if (lengthInPixels > maxLength) {
        lengthInPixels = maxLength;
      }
    }
    
    // Kegel-Winkel in Radiant
    const coneAngleRad = (this.coneAngle * Math.PI) / 180;
    
    // Berechne Kegel-Spitze (am Ende der Länge)
    const tipX = Math.cos(rad) * lengthInPixels;
    const tipY = Math.sin(rad) * lengthInPixels;
    
    // Berechne linke und rechte Kante des Kegels
    const leftRad = rad - coneAngleRad / 2;
    const rightRad = rad + coneAngleRad / 2;
    const leftX = Math.cos(leftRad) * lengthInPixels;
    const leftY = Math.sin(leftRad) * lengthInPixels;
    const rightX = Math.cos(rightRad) * lengthInPixels;
    const rightY = Math.sin(rightRad) * lengthInPixels;

    
    // ===== RADAR-STRAHL DESIGN =====
    
    // 1. Basis-Füllung mit Gradient (vom Zentrum zur Spitze)
    const baseGradient = ctx.createLinearGradient(0, 0, tipX, tipY);
    baseGradient.addColorStop(0, 'rgba(47, 212, 255, 0.54)');
    baseGradient.addColorStop(0.5, 'rgba(47, 212, 255, 0.36)');
    baseGradient.addColorStop(1, 'rgba(47, 212, 255, 0.14)');
    
    ctx.fillStyle = baseGradient;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
    
    // 2. Radar-Scan-Linien (konzentrische Bögen im Kegel)
    const scanSteps = 8;
    for (let i = 1; i <= scanSteps; i++) {
      const progress = i / scanSteps;
      const scanLength = lengthInPixels * progress;
      
      // Berechne Punkte auf linker und rechter Kante
      const scanLeftX = Math.cos(leftRad) * scanLength;
      const scanLeftY = Math.sin(leftRad) * scanLength;
      const scanRightX = Math.cos(rightRad) * scanLength;
      const scanRightY = Math.sin(rightRad) * scanLength;
      
      // Zeichne Bogen zwischen den Punkten
      ctx.strokeStyle = `rgba(47, 212, 255, ${0.66 - progress * 0.3})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(scanLeftX, scanLeftY);
      
      // Zeichne mehrere Segmente für einen glatten Bogen
      const segments = 12;
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const currentRad = leftRad + (rightRad - leftRad) * t;
        const x = Math.cos(currentRad) * scanLength;
        const y = Math.sin(currentRad) * scanLength;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    
    // 3. Radiale Scan-Linien (vom Zentrum nach außen)
    const radialLines = 5;
    for (let i = 0; i <= radialLines; i++) {
      const t = i / radialLines;
      const currentRad = leftRad + (rightRad - leftRad) * t;
      const endX = Math.cos(currentRad) * lengthInPixels;
      const endY = Math.sin(currentRad) * lengthInPixels;
      
      // Gestrichelte Linie mit abnehmendem Alpha
      ctx.strokeStyle = `rgba(47, 212, 255, ${0.54 - Math.abs(t - 0.5) * 0.24})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    
    // 4. Haupt-Kanten (scharf und präzise)
    ctx.strokeStyle = 'rgba(47, 212, 255, 0.95)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(leftX, leftY);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(rightX, rightY);
    ctx.stroke();
    
    // 5. Äußerer Bogen an der Spitze
    ctx.strokeStyle = 'rgba(47, 212, 255, 0.9)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      const currentRad = leftRad + (rightRad - leftRad) * t;
      const x = Math.cos(currentRad) * lengthInPixels;
      const y = Math.sin(currentRad) * lengthInPixels;
      if (s === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    
    // 6. Mittel-Achse (Ziellinie)
    ctx.strokeStyle = 'rgba(47, 212, 255, 0.78)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Overlay mit voller Linie für Highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.36)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    
    if (this.mapOverlayEnabled) {
      // 7. Reichweiten-Markierungen
      const rangeMarkers = [0.25, 0.5, 0.75, 1.0];
      rangeMarkers.forEach((progress, index) => {
        const markerLength = lengthInPixels * progress;
        
        // Zeichne kurze Markierungen auf der Mittelachse
        const markerX = Math.cos(rad) * markerLength;
        const markerY = Math.sin(rad) * markerLength;
        
        // Kleiner Kreis als Marker
        ctx.fillStyle = index === rangeMarkers.length - 1 
          ? 'rgba(255, 179, 71, 0.9)' 
          : 'rgba(47, 212, 255, 0.72)';
        ctx.beginPath();
        ctx.arc(markerX, markerY, 3, 0, Math.PI * 2);
        ctx.fill();
        
        // Ring um den Marker
        ctx.strokeStyle = index === rangeMarkers.length - 1
          ? 'rgba(255, 179, 71, 0.95)'
          : 'rgba(47, 212, 255, 0.84)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(markerX, markerY, 4.8, 0, Math.PI * 2);
        ctx.stroke();
      });
      
      // 8. Ziel-Punkt an der Spitze (Target)
      // Äußerer Ring
      ctx.strokeStyle = 'rgba(255, 179, 71, 0.72)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 8, 0, Math.PI * 2);
      ctx.stroke();
      
      // Mittlerer Ring
      ctx.strokeStyle = 'rgba(255, 179, 71, 0.9)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 5, 0, Math.PI * 2);
      ctx.stroke();
      
      // Zentraler Punkt
      ctx.fillStyle = 'rgba(255, 179, 71, 1.0)';
      ctx.beginPath();
      ctx.arc(tipX, tipY, 3.5, 0, Math.PI * 2);
      ctx.fill();
      
      // Highlight-Punkt
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(tipX, tipY, 1.8, 0, Math.PI * 2);
      ctx.fill();
      
      // 9. Fadenkreuz am Ziel
      const crosshairSize = 12;
      ctx.strokeStyle = 'rgba(255, 179, 71, 0.84)';
      ctx.lineWidth = 1.2;
      
      // Horizontal
      ctx.beginPath();
      ctx.moveTo(tipX - crosshairSize, tipY);
      ctx.lineTo(tipX - 6, tipY);
      ctx.moveTo(tipX + 6, tipY);
      ctx.lineTo(tipX + crosshairSize, tipY);
      ctx.stroke();
      
      // Vertikal
      ctx.beginPath();
      ctx.moveTo(tipX, tipY - crosshairSize);
      ctx.lineTo(tipX, tipY - 6);
      ctx.moveTo(tipX, tipY + 6);
      ctx.lineTo(tipX, tipY + crosshairSize);
      ctx.stroke();
      
      // 10. Zentrum-Ursprung
      ctx.fillStyle = 'rgba(47, 212, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = 'rgba(47, 212, 255, 1.0)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.stroke();
      
      // Zentraler Punkt
      ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
