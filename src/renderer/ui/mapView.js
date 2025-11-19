export class MapView {
  constructor(canvas) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas context nicht verfuegbar');
    }
    this.canvas = canvas;
    this.ctx = context;
    this.size = canvas.width;
    this.radius = this.size / 2 - 20;
    this.drawBase();
  }

  update(azimuth, elevation) {
    const az = typeof azimuth === 'number' ? azimuth : 0;
    const el = typeof elevation === 'number' ? elevation : 0;
    this.drawBase();
    this.drawDirection(az, el);
  }

  drawBase() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
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
