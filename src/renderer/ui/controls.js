class Controls {
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.gotoAzInput = root.querySelector('#gotoAzInput');
    this.gotoElInput = root.querySelector('#gotoElInput');
    this.gotoAzBtn = root.querySelector('#gotoAzBtn');
    this.gotoAzElBtn = root.querySelector('#gotoAzElBtn');
    this.azSpeedRange = root.querySelector('#azSpeedRange');
    this.azSpeedInput = root.querySelector('#azSpeedInput');
    this.elSpeedRange = root.querySelector('#elSpeedRange');
    this.elSpeedInput = root.querySelector('#elSpeedInput');

    this.buttons = Array.from(root.querySelectorAll('[data-command]'));
    this.bindEvents();
  }

  setEnabled(enabled) {
    this.buttons.forEach((btn) => {
      btn.disabled = !enabled;
    });
    this.gotoAzBtn.disabled = !enabled;
    this.gotoAzElBtn.disabled = !enabled;
    this.gotoAzInput.disabled = !enabled;
    this.gotoElInput.disabled = !enabled;
  }

  setSpeedValues({ azimuthSpeedDegPerSec, elevationSpeedDegPerSec }) {
    if (typeof azimuthSpeedDegPerSec === 'number') {
      this.azSpeedRange.value = azimuthSpeedDegPerSec;
      this.azSpeedInput.value = azimuthSpeedDegPerSec;
    }
    if (typeof elevationSpeedDegPerSec === 'number') {
      this.elSpeedRange.value = elevationSpeedDegPerSec;
      this.elSpeedInput.value = elevationSpeedDegPerSec;
    }
  }

  bindEvents() {
    this.buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const cmd = button.dataset.command;
        void this.callbacks.onCommand(cmd);
      });
    });

    this.gotoAzBtn.addEventListener('click', (event) => {
      event.preventDefault();
      const az = Number(this.gotoAzInput.value);
      if (Number.isFinite(az)) {
        void this.callbacks.onGotoAzimuth(az);
      }
    });

    this.gotoAzElBtn.addEventListener('click', (event) => {
      event.preventDefault();
      const az = Number(this.gotoAzInput.value);
      const el = Number(this.gotoElInput.value);
      if (Number.isFinite(az) && Number.isFinite(el)) {
        void this.callbacks.onGotoAzimuthElevation(az, el);
      }
    });

    this.bindSpeedInputs(this.azSpeedRange, this.azSpeedInput);
    this.bindSpeedInputs(this.elSpeedRange, this.elSpeedInput);
  }

  bindSpeedInputs(rangeInput, numberInput) {
    const syncFromRange = () => {
      numberInput.value = rangeInput.value;
      this.emitSpeedChange();
    };
    const syncFromNumber = () => {
      rangeInput.value = numberInput.value;
      this.emitSpeedChange();
    };

    rangeInput.addEventListener('input', syncFromRange);
    numberInput.addEventListener('change', syncFromNumber);
  }

  emitSpeedChange() {
    const az = Number(this.azSpeedInput.value);
    const el = Number(this.elSpeedInput.value);
    if (!Number.isFinite(az) || !Number.isFinite(el)) {
      return;
    }
    void this.callbacks.onSpeedChange({
      azimuthSpeedDegPerSec: az,
      elevationSpeedDegPerSec: el
    });
  }
}
