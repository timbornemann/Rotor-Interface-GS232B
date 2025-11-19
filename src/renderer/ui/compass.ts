export class Compass {
  private needle: SVGGElement | null;

  constructor(private root: HTMLElement) {
    this.needle = this.root.querySelector('#compassNeedle');
  }

  update(azimuth?: number): void {
    if (!this.needle || typeof azimuth !== 'number' || Number.isNaN(azimuth)) {
      return;
    }

    const normalized = ((azimuth % 360) + 360) % 360;
    (this.needle as SVGGElement).style.transform = `rotate(${normalized}deg)`;
  }
}
