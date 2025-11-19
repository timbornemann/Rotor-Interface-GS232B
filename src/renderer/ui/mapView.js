class MapView {
  constructor(canvas) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas context nicht verfuegbar');
    }
    this.canvas = canvas;
    this.ctx = context;
    this.width = canvas.width;
    this.height = canvas.height;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
    this.radius = Math.min(this.width, this.height) / 2 - 30;
    this.latitude = null;
    this.longitude = null;
    this.satelliteMapEnabled = false;
    this.mapImage = null;
    this.mapLoading = false;
    this.zoomLevel = 16;
    this.minZoom = 1;
    this.maxZoom = 20;
    this.tileCache = new Map();
    this.lastAzimuth = 0;
    this.lastElevation = 0;
    
    // Event-Handler für Zoom
    this.setupZoomHandlers();
    this.drawBase();
  }

  setupZoomHandlers() {
    // Mausrad-Zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      this.setZoom(this.zoomLevel + delta);
    });
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
      const neededTilesX = Math.ceil(this.canvas.width / pixelsPerTile) + 2; // +2 für Puffer
      const neededTilesY = Math.ceil(this.canvas.height / pixelsPerTile) + 2;
      const gridSize = Math.max(neededTilesX, neededTilesY, zoom >= 16 ? 5 : 3);
      const tiles = [];
      
      const offset = Math.floor(gridSize / 2);
      for (let dy = -offset; dy <= offset; dy++) {
        for (let dx = -offset; dx <= offset; dx++) {
          const tx = centerTileXFloor + dx;
          const ty = centerTileYFloor + dy;
          if (tx >= 0 && tx < n && ty >= 0 && ty < n) {
            const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
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
      const neededWidth = this.canvas.width + tileSize * 2;
      const neededHeight = this.canvas.height + tileSize * 2;
      combinedCanvas.width = neededWidth;
      combinedCanvas.height = neededHeight;
      const combinedCtx = combinedCanvas.getContext('2d');

      // Berechne die Position der Koordinaten im zentralen Tile (in Pixeln)
      const centerTilePixelX = pixelPos.pixelX;
      const centerTilePixelY = pixelPos.pixelY;
      
      // Die Koordinaten sollen in der Mitte des Ziel-Canvas sein
      const targetCenterX = this.canvas.width / 2;
      const targetCenterY = this.canvas.height / 2;
      
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
        targetWidth: this.canvas.width,
        targetHeight: this.canvas.height,
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

    const rad = ((azimuth - 90) * Math.PI) / 180;
    const length = this.radius * (0.4 + 0.6 * Math.min(elevation, 90) / 90);

    ctx.strokeStyle = '#2fd4ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(rad) * length, Math.sin(rad) * length);
    ctx.stroke();

    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(Math.cos(rad) * length, Math.sin(rad) * length, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
