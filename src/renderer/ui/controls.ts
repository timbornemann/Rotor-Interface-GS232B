import { RotorControlCommand } from '../../common/types';

interface ControlCallbacks {
  onCommand: (command: RotorControlCommand) => Promise<void> | void;
  onGotoAzimuth: (azimuth: number) => Promise<void> | void;
  onGotoAzimuthElevation: (azimuth: number, elevation: number) => Promise<void> | void;
}

export class Controls {
  private buttons: HTMLButtonElement[] = [];
  private gotoAzInput: HTMLInputElement;
  private gotoElInput: HTMLInputElement;
  private gotoAzBtn: HTMLButtonElement;
  private gotoAzElBtn: HTMLButtonElement;

  constructor(private root: HTMLElement, private callbacks: ControlCallbacks) {
    this.gotoAzInput = root.querySelector('#gotoAzInput') as HTMLInputElement;
    this.gotoElInput = root.querySelector('#gotoElInput') as HTMLInputElement;
    this.gotoAzBtn = root.querySelector('#gotoAzBtn') as HTMLButtonElement;
    this.gotoAzElBtn = root.querySelector('#gotoAzElBtn') as HTMLButtonElement;

    this.buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-command]'));
    this.bindEvents();
  }

  setEnabled(enabled: boolean): void {
    this.buttons.forEach((btn) => {
      btn.disabled = !enabled;
    });
    this.gotoAzBtn.disabled = !enabled;
    this.gotoAzElBtn.disabled = !enabled;
    this.gotoAzInput.disabled = !enabled;
    this.gotoElInput.disabled = !enabled;
  }

  private bindEvents(): void {
    this.buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const cmd = button.dataset.command as RotorControlCommand;
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
