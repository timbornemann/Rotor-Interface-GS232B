class Elevation {
  constructor(root) {
    this.root = root;
    this.indicator = this.root.querySelector('#elevationIndicator');
    this.scale = this.root.querySelector('#elevationScale');
    this.svg = this.root.querySelector('#elevationSvg');
    this.currentValue = 0;
    this.initScale();
  }

  initScale() {
    if (!this.scale) {
      return;
    }
    
    // Erstelle Skalen-Markierungen für 0° bis 90°
    const scaleGroup = this.scale;
    scaleGroup.innerHTML = '';
    
    // Zeichne Halbkreis-Bogen (größerer Radius für bessere Sichtbarkeit)
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const radius = 120;
    path.setAttribute('d', `M ${100 - radius} 180 A ${radius} ${radius} 0 0 1 ${100 + radius} 180`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'rgba(47, 212, 255, 0.3)');
    path.setAttribute('stroke-width', '2');
    scaleGroup.appendChild(path);
    
    // Markierungen für 0°, 15°, 30°, 45°, 60°, 75°, 90°
    const marks = [0, 15, 30, 45, 60, 75, 90];
    marks.forEach((angle) => {
      // Berechne Winkel im Bogen (0° = rechts, 90° = oben)
      // Im SVG: 0° = rechts, 90° = oben
      const rad = (angle * Math.PI) / 180;
      const x = 100 + Math.cos(rad) * radius;
      const y = 180 - Math.sin(rad) * radius;
      
      // Markierungslinie
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const lineLength = angle % 30 === 0 ? 10 : 5; // Längere Linien für 30°-Schritte
      const lineX = x - Math.cos(rad) * lineLength;
      const lineY = y + Math.sin(rad) * lineLength;
      line.setAttribute('x1', lineX.toString());
      line.setAttribute('y1', lineY.toString());
      line.setAttribute('x2', x.toString());
      line.setAttribute('y2', y.toString());
      line.setAttribute('stroke', 'rgba(47, 212, 255, 0.5)');
      line.setAttribute('stroke-width', '2');
      scaleGroup.appendChild(line);
      
      // Text-Label
      if (angle % 30 === 0 || angle === 90) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const textX = x - Math.cos(rad) * 20;
        const textY = y + Math.sin(rad) * 20;
        text.setAttribute('x', textX.toString());
        text.setAttribute('y', textY.toString());
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', 'rgba(255, 255, 255, 0.7)');
        text.setAttribute('font-size', '14');
        text.setAttribute('font-weight', '600');
        text.textContent = `${angle}°`;
        scaleGroup.appendChild(text);
      }
    });
  }

  update(elevation) {
    if (!this.indicator || typeof elevation !== 'number' || Number.isNaN(elevation)) {
      return;
    }

    // Normalisiere Elevation auf 0-90 Grad
    const normalized = Math.max(0, Math.min(90, elevation));
    this.currentValue = normalized;
    
    // Berechne Winkel für die Anzeige
    // 0° Elevation = Indikator zeigt nach rechts (0° im SVG)
    // 90° Elevation = Indikator zeigt nach oben (90° im SVG)
    const angle = normalized;
    
    // Rotiere den Indikator (Transform-Origin ist bei 100, 180 = unten Mitte)
    this.indicator.style.transform = `rotate(${angle}deg)`;
  }
}

