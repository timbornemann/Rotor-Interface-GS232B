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
  }

  setSatelliteMapEnabled(enabled) {
    this.satelliteMapEnabled = enabled;
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
        this.update(this.lastAzimuth || 0, this.lastElevation || 0);
        this.mapLoading = false;
      };
    } catch (error) {
      console.error('Fehler beim Laden der Karte:', error);
      this.mapLoading = false;
      this.mapImage = null;
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
      // Zeichne Karte so, dass sie den gesamten Canvas ausfüllt
      // Die Koordinaten bleiben in der Mitte
      const { image, sourceWidth, sourceHeight, targetWidth, targetHeight, sourceCenterX, sourceCenterY, targetCenterX, targetCenterY } = this.mapImageData;
      
      // Berechne Skalierung, um den Canvas vollständig auszufüllen
      const scaleX = targetWidth / sourceWidth;
      const scaleY = targetHeight / sourceHeight;
      const scale = Math.max(scaleX, scaleY); // Verwende größere Skalierung, um vollständig zu füllen
      
      // Berechne die neue Größe nach Skalierung
      const scaledWidth = sourceWidth * scale;
      const scaledHeight = sourceHeight * scale;
      
      // Berechne Position, damit die Zentren übereinstimmen
      // Die Zentren müssen exakt übereinstimmen, damit die Koordinaten in der Mitte sind
      const drawX = targetCenterX - (sourceCenterX * scale);
      const drawY = targetCenterY - (sourceCenterY * scale);
      
      // Zeichne die skalierte Karte, die den gesamten Canvas ausfüllt
      ctx.drawImage(
        image,
        0, 0, sourceWidth, sourceHeight,
        drawX, drawY, scaledWidth, scaledHeight
      );
      
      ctx.restore();
    }
    
    ctx.save();
    ctx.translate(this.centerX, this.centerY);

    // Zeichne Radar-Gitter (mit angepasster Transparenz wenn Karte aktiv)
    const gridOpacity = this.satelliteMapEnabled ? 0.4 : 0.15;
    ctx.strokeStyle = `rgba(255,255,255,${gridOpacity})`;
    ctx.lineWidth = 1;
    
    // Konzentrische Kreise
    for (let r = this.radius; r > 0; r -= this.radius / 4) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Radiallinien (alle 30 Grad)
    for (let angle = 0; angle < 360; angle += 30) {
      const rad = (angle * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(rad) * this.radius, Math.sin(rad) * this.radius);
      ctx.stroke();
    }

    // Zeichne Uhrzeiten und Himmelsrichtungen
    this.drawLabels();

    ctx.restore();
  }

  drawLabels() {
    const { ctx } = this;
    const labelRadius = this.radius + 15;
    const fontSize = 12;
    
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Alle Labels: Himmelsrichtungen und Uhrzeiten 1-12
    // 0° = Nord (oben), 90° = Ost (rechts), 180° = Süd (unten), 270° = West (links)
    // Uhrzeiten: 12 = Nord, 3 = Ost, 6 = Süd, 9 = West
    const labels = [
      { angle: 0, text: 'N', isDirection: true },      // Nord / 12 Uhr
      { angle: 30, text: '1' },
      { angle: 60, text: '2' },
      { angle: 90, text: 'O', isDirection: true },     // Ost / 3 Uhr
      { angle: 120, text: '4' },
      { angle: 150, text: '5' },
      { angle: 180, text: 'S', isDirection: true },    // Süd / 6 Uhr
      { angle: 210, text: '7' },
      { angle: 240, text: '8' },
      { angle: 270, text: 'W', isDirection: true },    // West / 9 Uhr
      { angle: 300, text: '10' },
      { angle: 330, text: '11' }
    ];

    // Zeichne alle Labels
    labels.forEach(({ angle, text, isDirection }) => {
      // -90 weil Canvas 0° = rechts, wir wollen 0° = oben (Nord)
      const rad = ((angle - 90) * Math.PI) / 180;
      const x = Math.cos(rad) * labelRadius;
      const y = Math.sin(rad) * labelRadius;
      
      // Größere Schrift für Himmelsrichtungen
      if (isDirection) {
        ctx.font = `bold ${fontSize + 3}px 'Segoe UI', Roboto, sans-serif`;
      } else {
        ctx.font = `bold ${fontSize}px 'Segoe UI', Roboto, sans-serif`;
      }
      
      // Text mit Outline für bessere Lesbarkeit
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
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
    
    // Zeichne Kegel (als gefülltes Dreieck)
    ctx.fillStyle = 'rgba(47, 212, 255, 0.3)'; // Transparentes Blau
    ctx.beginPath();
    ctx.moveTo(0, 0); // Spitze am Zentrum
    ctx.lineTo(leftX, leftY); // Linke Kante
    ctx.lineTo(rightX, rightY); // Rechte Kante
    ctx.closePath();
    ctx.fill();
    
    // Zeichne Kegel-Outline
    ctx.strokeStyle = '#2fd4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(leftX, leftY); // Linke Kante
    ctx.lineTo(rightX, rightY); // Rechte Kante
    ctx.closePath();
    ctx.stroke();
    
    // Zeichne Mittelstrich (vom Zentrum zur Spitze)
    ctx.strokeStyle = '#2fd4ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Zeichne Spitze (Kreis)
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(tipX, tipY, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
