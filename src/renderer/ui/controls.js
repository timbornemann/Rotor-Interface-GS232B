class Controls {
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.gotoAzInput = root.querySelector('#gotoAzInput');
    this.gotoElInput = root.querySelector('#gotoElInput');
    this.gotoAzBtn = root.querySelector('#gotoAzBtn');
    this.gotoAzElBtn = root.querySelector('#gotoAzElBtn');

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
  }
}
