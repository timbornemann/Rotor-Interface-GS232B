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
    if (this.gotoAzBtn) this.gotoAzBtn.disabled = !enabled;
    if (this.gotoAzElBtn) this.gotoAzElBtn.disabled = !enabled;
    if (this.gotoAzInput) this.gotoAzInput.disabled = !enabled;
    if (this.gotoElInput) this.gotoElInput.disabled = !enabled;
  }

  setSpeedValues({ azimuthSpeedDegPerSec, elevationSpeedDegPerSec }) {
    if (typeof azimuthSpeedDegPerSec === 'number') {
      if (this.azSpeedRange) this.azSpeedRange.value = azimuthSpeedDegPerSec;
      if (this.azSpeedInput) this.azSpeedInput.value = azimuthSpeedDegPerSec;
    }
    if (typeof elevationSpeedDegPerSec === 'number') {
      if (this.elSpeedRange) this.elSpeedRange.value = elevationSpeedDegPerSec;
      if (this.elSpeedInput) this.elSpeedInput.value = elevationSpeedDegPerSec;
    }
  }

  bindEvents() {
    this.buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const cmd = button.dataset.command;
        void this.callbacks.onCommand(cmd);
      });
    });

    if (this.gotoAzBtn && this.gotoAzInput) {
      this.gotoAzBtn.addEventListener('click', (event) => {
        event.preventDefault();
        const az = Number(this.gotoAzInput.value);
        if (Number.isFinite(az)) {
          void this.callbacks.onGotoAzimuth(az);
        }
      });
    }

    if (this.gotoAzElBtn && this.gotoAzInput && this.gotoElInput) {
      this.gotoAzElBtn.addEventListener('click', (event) => {
        event.preventDefault();
        const az = Number(this.gotoAzInput.value);
        const el = Number(this.gotoElInput.value);
        if (Number.isFinite(az) && Number.isFinite(el)) {
          void this.callbacks.onGotoAzimuthElevation(az, el);
        }
      });
    }

    // Speed inputs are now in settings modal, so only bind if they exist
    if (this.azSpeedRange && this.azSpeedInput) {
      this.bindSpeedInputs(this.azSpeedRange, this.azSpeedInput);
    }
    if (this.elSpeedRange && this.elSpeedInput) {
      this.bindSpeedInputs(this.elSpeedRange, this.elSpeedInput);
    }
  }

  bindSpeedInputs(rangeInput, numberInput) {
    if (!rangeInput || !numberInput) {
      return; // Elements don't exist (moved to settings modal)
    }

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
    // Speed inputs are now in settings modal, so this may not be called
    if (!this.azSpeedInput || !this.elSpeedInput) {
      return;
    }
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
