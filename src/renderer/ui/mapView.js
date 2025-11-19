class MapView {
  constructor(canvas) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas context nicht verfuegbar');
    }
    this.canvas = canvas;
    this.ctx = context;
    this.size = canvas.width;
    this.radius = this.size / 2 - 20;
    this.latitude = null;
    this.longitude = null;
    this.satelliteMapEnabled = false;
    this.mapImage = null;
    this.mapLoading = false;
    this.drawBase();
  }

  setCoordinates(latitude, longitude) {
    this.latitude = latitude;
    this.longitude = longitude;
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

  async loadMap() {
    if (this.mapLoading || this.latitude === null || this.longitude === null) {
      return;
    }

    this.mapLoading = true;
    try {
      // Verwende OpenStreetMap mit Satelliten-Layer (via Esri World Imagery)
      // Zoom-Level basierend auf Canvas-Größe
      const zoom = 15;
      const tileSize = 256;
      
      // Berechne Tile-Koordinaten
      const n = Math.pow(2, zoom);
      const latRad = (this.latitude * Math.PI) / 180;
      const tileX = Math.floor(((this.longitude + 180) / 360) * n);
      const tileY = Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
      );

      // Lade das zentrale Tile
      const tileUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY}/${tileX}`;
      
      // Für bessere Qualität: Lade mehrere Tiles und kombiniere sie
      const tilesToLoad = 3; // 3x3 Grid
      const tiles = [];
      
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = tileX + dx;
          const ty = tileY + dy;
          if (tx >= 0 && tx < n && ty >= 0 && ty < n) {
            const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
            tiles.push({ url, dx, dy });
          }
        }
      }

      // Lade alle Tiles mit Timeout
      const tileImages = await Promise.all(
        tiles.map(({ url }) => {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            const timeout = setTimeout(() => {
              reject(new Error('Timeout beim Laden des Karten-Tiles'));
            }, 10000);
            
            img.onload = () => {
              clearTimeout(timeout);
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

      // Erstelle kombiniertes Bild
      const combinedCanvas = document.createElement('canvas');
      combinedCanvas.width = tileSize * 3;
      combinedCanvas.height = tileSize * 3;
      const combinedCtx = combinedCanvas.getContext('2d');

      tiles.forEach(({ dx, dy }, index) => {
        const x = (dx + 1) * tileSize;
        const y = (dy + 1) * tileSize;
        combinedCtx.drawImage(tileImages[index], x, y);
      });

      // Skaliere auf Canvas-Größe
      this.mapImage = new Image();
      this.mapImage.src = combinedCanvas.toDataURL();
      this.mapImage.onload = () => {
        this.update(this.lastAzimuth || 0, this.lastElevation || 0);
        this.mapLoading = false;
      };
    } catch (error) {
      console.error('Fehler beim Laden der Karte:', error);
      this.mapLoading = false;
      this.mapImage = null;
      // Zeige Standard-Ansicht ohne Karte
      this.update(this.lastAzimuth || 0, this.lastElevation || 0);
      throw error; // Weiterwerfen für Fehlerbehandlung in main.js
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
    if (this.satelliteMapEnabled && this.mapImage && this.mapImage.complete) {
      ctx.save();
      // Zeichne Karte zentriert und skaliert
      const centerX = this.canvas.width / 2;
      const centerY = this.canvas.height / 2;
      const mapSize = Math.min(this.canvas.width, this.canvas.height) * 0.9;
      
      // Clip auf Kreis
      ctx.beginPath();
      ctx.arc(centerX, centerY, this.radius + 10, 0, Math.PI * 2);
      ctx.clip();
      
      // Zeichne Karte
      const mapX = centerX - mapSize / 2;
      const mapY = centerY - mapSize / 2;
      ctx.drawImage(this.mapImage, mapX, mapY, mapSize, mapSize);
      ctx.restore();
    }
    
    ctx.save();
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);

    // Zeichne Radar-Gitter (mit angepasster Transparenz wenn Karte aktiv)
    const gridOpacity = this.satelliteMapEnabled ? 0.3 : 0.1;
    ctx.strokeStyle = `rgba(255,255,255,${gridOpacity})`;
    ctx.lineWidth = 1;
    for (let r = this.radius; r > 0; r -= this.radius / 4) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let angle = 0; angle < 360; angle += 30) {
      const rad = (angle * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(rad) * this.radius, Math.sin(rad) * this.radius);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawDirection(azimuth, elevation) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);

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
