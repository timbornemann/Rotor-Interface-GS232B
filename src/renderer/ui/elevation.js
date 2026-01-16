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
    
    // Erstelle Skalen-Markierungen für 0° bis 90° (Viertelkreis)
    const scaleGroup = this.scale;
    scaleGroup.innerHTML = '';
    
    const radius = 120;
    const centerX = 100;
    const centerY = 180;
    
    // Viertelkreis-Bogen: von rechts (0°) nach oben (90°)
    // Nach außen gewölbt (konvex) - der Bogen wölbt sich vom Pivot-Punkt weg
    // Start: rechts (centerX + radius, centerY)
    // Ende: oben (centerX, centerY - radius)
    // Der Bogen wird um den Pivot-Punkt (centerX, centerY) gezeichnet
    const arcStartX = centerX + radius; // Rechts (0°)
    const arcStartY = centerY;
    const arcEndX = centerX; // Oben (90°)
    const arcEndY = centerY - radius;
    
    // Arc-Parameter: large-arc-flag=0 (kleiner Bogen), sweep-flag=0 (gegen Uhrzeigersinn)
    // Dies erzeugt einen nach außen gewölbten Bogen
    const arcPath = `M ${arcStartX} ${arcStartY} A ${radius} ${radius} 0 0 0 ${arcEndX} ${arcEndY}`;
    
    // Mehrschichtige Hintergrund-Bögen für professionelle Tiefe (nur Viertelkreis)
    // Tiefste Schicht - sehr subtil
    const bgArc1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    bgArc1.setAttribute('d', arcPath);
    bgArc1.setAttribute('fill', 'none');
    bgArc1.setAttribute('stroke', 'rgba(47, 212, 255, 0.08)');
    bgArc1.setAttribute('stroke-width', '4');
    scaleGroup.appendChild(bgArc1);
    
    // Mittlere Schicht
    const bgArc2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    bgArc2.setAttribute('d', arcPath);
    bgArc2.setAttribute('fill', 'none');
    bgArc2.setAttribute('stroke', 'rgba(47, 212, 255, 0.12)');
    bgArc2.setAttribute('stroke-width', '3');
    scaleGroup.appendChild(bgArc2);
    
    // Haupt-Bogen mit Gradient und Schatten (Viertelkreis)
    const mainArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    mainArc.setAttribute('d', arcPath);
    mainArc.setAttribute('fill', 'none');
    mainArc.setAttribute('stroke', 'url(#elevationArcGradient)');
    mainArc.setAttribute('stroke-width', '3');
    mainArc.setAttribute('opacity', '0.85');
    mainArc.setAttribute('filter', 'url(#elevationShadow)');
    scaleGroup.appendChild(mainArc);
    
    // Innerer Bogen für zusätzliche Tiefe (Viertelkreis)
    const innerRadius = radius - 8;
    const innerStartX = centerX + innerRadius;
    const innerStartY = centerY;
    const innerEndX = centerX;
    const innerEndY = centerY - innerRadius;
    const innerArcPath = `M ${innerStartX} ${innerStartY} A ${innerRadius} ${innerRadius} 0 0 0 ${innerEndX} ${innerEndY}`;
    const innerArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    innerArc.setAttribute('d', innerArcPath);
    innerArc.setAttribute('fill', 'none');
    innerArc.setAttribute('stroke', 'rgba(47, 212, 255, 0.25)');
    innerArc.setAttribute('stroke-width', '1');
    innerArc.setAttribute('stroke-dasharray', '2,3');
    scaleGroup.appendChild(innerArc);
    
    // Erstelle Markierungen für alle Winkel von 0° bis 90°
    for (let angle = 0; angle <= 90; angle += 5) {
      const rad = (angle * Math.PI) / 180;
      const x = centerX + Math.cos(rad) * radius;
      const y = centerY - Math.sin(rad) * radius;
      
      // Bestimme ob Major (15° Schritte) oder Minor (5° Schritte)
      const isMajor = angle % 15 === 0;
      const isLabeled = angle % 15 === 0;
      
      // Markierungslinie - länger und professioneller
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const lineLength = isMajor ? 16 : 8;
      const lineX = x - Math.cos(rad) * lineLength;
      const lineY = y + Math.sin(rad) * lineLength;
      line.setAttribute('x1', lineX.toString());
      line.setAttribute('y1', lineY.toString());
      line.setAttribute('x2', x.toString());
      line.setAttribute('y2', y.toString());
      line.setAttribute('stroke', isMajor ? 'rgba(47, 212, 255, 0.85)' : 'rgba(47, 212, 255, 0.5)');
      line.setAttribute('stroke-width', isMajor ? '3' : '2');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('class', isMajor ? 'scale-major' : 'scale-minor');
      if (isMajor) {
        line.setAttribute('filter', 'url(#elevationShadow)');
      }
      scaleGroup.appendChild(line);
      
      // Text-Label außen (nur ein Label pro Winkel)
      if (isLabeled) {
        const textOuter = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const outerOffset = 30;
        const textOuterX = x - Math.cos(rad) * outerOffset;
        const textOuterY = y + Math.sin(rad) * outerOffset;
        textOuter.setAttribute('x', textOuterX.toString());
        textOuter.setAttribute('y', textOuterY.toString());
        textOuter.setAttribute('text-anchor', 'middle');
        textOuter.setAttribute('dominant-baseline', 'middle');
        textOuter.setAttribute('fill', 'rgba(255, 255, 255, 0.9)');
        textOuter.setAttribute('font-size', '14');
        textOuter.setAttribute('font-weight', '700');
        textOuter.setAttribute('class', 'scale-label scale-label-outer');
        textOuter.textContent = `${angle}°`;
        scaleGroup.appendChild(textOuter);
      }
    }
  }

  update(elevation) {
    if (!this.indicator || typeof elevation !== 'number' || Number.isNaN(elevation)) {
      return;
    }

    // Normalisiere Elevation auf 0-90 Grad
    const normalized = Math.max(0, Math.min(90, elevation));
    this.currentValue = normalized;
    
    // Berechne Winkel für die Anzeige - gegen den Uhrzeigersinn
    // SVG-Koordinaten: 0° = rechts, 90° = oben, 180° = links
    // Der Indikator startet vertikal nach oben (90° im SVG)
    // 0° Elevation = Indikator zeigt nach rechts (0° im SVG) → Rotation: 90°
    // 90° Elevation = Indikator zeigt nach oben (90° im SVG) → Rotation: 0°
    // Von 0° zu 90° elevation: Rotation geht von 90° zu 0° = gegen den Uhrzeigersinn
    // Formel: angle = 90 - elevation
    const angle = 90 - normalized;
    
    // Rotiere den Indikator (Transform-Origin ist bei 100, 180 = unten Mitte)
    this.indicator.style.transform = `rotate(${angle}deg)`;
  }
}

