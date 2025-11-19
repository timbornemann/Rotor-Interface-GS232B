class Compass {
  constructor(root) {
    this.root = root;
    this.needle = this.root.querySelector('#compassNeedle');
  }

  update(azimuth) {
    if (!this.needle || typeof azimuth !== 'number' || Number.isNaN(azimuth)) {
      return;
    }

    const normalized = ((azimuth % 360) + 360) % 360;
    this.needle.style.transform = `rotate(${normalized}deg)`;
  }
}
