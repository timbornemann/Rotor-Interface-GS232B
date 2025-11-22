class CalibrationWizard {
  constructor(options) {
    this.rotor = options.rotor;
    this.getConfig = options.getConfig;
    this.saveConfig = options.saveConfig;
    this.applyLimits = options.applyLimits;
    this.applyOffsets = options.applyOffsets;
    this.isConnected = options.isConnected;
    this.reportError = options.reportError || ((msg) => console.error('[CalibrationWizard]', msg));
    this.onConfigUpdated = options.onConfigUpdated || (() => {});

    this.statusElements = {
      rawAz: document.getElementById('calibrationRawAz'),
      rawEl: document.getElementById('calibrationRawEl'),
      offsetAz: document.getElementById('calibrationOffsetAz'),
      offsetEl: document.getElementById('calibrationOffsetEl'),
      limitAz: document.getElementById('calibrationLimitAz'),
      limitEl: document.getElementById('calibrationLimitEl'),
      directionAzMin: document.getElementById('calibrationAzMinDirection'),
      directionAzMax: document.getElementById('calibrationAzMaxDirection'),
      directionElMin: document.getElementById('calibrationElMinDirection'),
      directionElMax: document.getElementById('calibrationElMaxDirection'),
      message: document.getElementById('calibrationMessage')
    };

    this.buttons = {
      readRaw: document.getElementById('calibrationReadRawBtn'),
      setOffset: document.getElementById('calibrationSetOffsetBtn'),
      test: document.getElementById('calibrationTestBtn'),
      goAzMin: document.getElementById('calibrationGoAzMinBtn'),
      goAzMax: document.getElementById('calibrationGoAzMaxBtn'),
      goElMin: document.getElementById('calibrationGoElMinBtn'),
      goElMax: document.getElementById('calibrationGoElMaxBtn'),
      setAzMin: document.getElementById('calibrationSetAzMinBtn'),
      setAzMax: document.getElementById('calibrationSetAzMaxBtn'),
      setElMin: document.getElementById('calibrationSetElMinBtn'),
      setElMax: document.getElementById('calibrationSetElMaxBtn')
    };

    this.directionNotes = this.loadDirectionNotes();
    this.attachEvents();
    this.updateConfig(this.getConfig());
  }

  attachEvents() {
    if (this.buttons.readRaw) {
      this.buttons.readRaw.addEventListener('click', () => void this.readRawValues());
    }
    if (this.buttons.setOffset) {
      this.buttons.setOffset.addEventListener('click', () => void this.setOffsetFromCurrent());
    }
    if (this.buttons.test) {
      this.buttons.test.addEventListener('click', () => void this.testCalibration());
    }

    if (this.buttons.goAzMin) {
      this.buttons.goAzMin.addEventListener('click', () => void this.moveToLimit('azimuthMinLimit'));
    }
    if (this.buttons.goAzMax) {
      this.buttons.goAzMax.addEventListener('click', () => void this.moveToLimit('azimuthMaxLimit'));
    }
    if (this.buttons.goElMin) {
      this.buttons.goElMin.addEventListener('click', () => void this.moveToLimit('elevationMinLimit'));
    }
    if (this.buttons.goElMax) {
      this.buttons.goElMax.addEventListener('click', () => void this.moveToLimit('elevationMaxLimit'));
    }

    if (this.buttons.setAzMin) {
      this.buttons.setAzMin.addEventListener('click', () => void this.captureLimitFromCurrent('azimuthMinLimit'));
    }
    if (this.buttons.setAzMax) {
      this.buttons.setAzMax.addEventListener('click', () => void this.captureLimitFromCurrent('azimuthMaxLimit'));
    }
    if (this.buttons.setElMin) {
      this.buttons.setElMin.addEventListener('click', () => void this.captureLimitFromCurrent('elevationMinLimit'));
    }
    if (this.buttons.setElMax) {
      this.buttons.setElMax.addEventListener('click', () => void this.captureLimitFromCurrent('elevationMaxLimit'));
    }

    ['directionAzMin', 'directionAzMax', 'directionElMin', 'directionElMax'].forEach((key) => {
      const input = this.statusElements[key];
      if (!input) return;
      const noteKey = input.dataset.noteKey;
      input.value = this.directionNotes[noteKey] || '';
      input.addEventListener('input', () => {
        this.directionNotes[noteKey] = input.value;
        this.saveDirectionNotes();
      });
    });
  }

  updateConfig(config) {
    if (!config) return;
    if (this.statusElements.offsetAz) {
      this.statusElements.offsetAz.textContent = `${Number(config.azimuthOffset || 0).toFixed(2)}°`;
    }
    if (this.statusElements.offsetEl) {
      this.statusElements.offsetEl.textContent = `${Number(config.elevationOffset || 0).toFixed(2)}°`;
    }
    if (this.statusElements.limitAz) {
      this.statusElements.limitAz.textContent = `${config.azimuthMinLimit}° … ${config.azimuthMaxLimit}°`;
    }
    if (this.statusElements.limitEl) {
      this.statusElements.limitEl.textContent = `${config.elevationMinLimit}° … ${config.elevationMaxLimit}°`;
    }
  }

  showMessage(text, variant = 'info') {
    if (!this.statusElements.message) return;
    this.statusElements.message.textContent = text || '';
    this.statusElements.message.dataset.variant = variant;
  }

  requireConnection() {
    if (!this.isConnected()) {
      this.showMessage('Bitte zuerst verbinden, um den Assistenten zu nutzen.', 'warning');
      return false;
    }
    return true;
  }

  async readRawValues() {
    if (!this.requireConnection()) return;
    const status = this.rotor.getCurrentStatus();
    if (!status || typeof status.azimuthRaw !== 'number' || typeof status.elevationRaw !== 'number') {
      this.reportError('Keine Positionsdaten verfügbar.');
      this.showMessage('Keine Rohwerte verfügbar – bitte erneut versuchen, wenn Daten ankommen.', 'error');
      return;
    }
    if (this.statusElements.rawAz) {
      this.statusElements.rawAz.textContent = `${status.azimuthRaw.toFixed(0)}° (raw)`;
    }
    if (this.statusElements.rawEl) {
      this.statusElements.rawEl.textContent = `${status.elevationRaw.toFixed(0)}° (raw)`;
    }
    this.showMessage('Rohwerte gelesen. Du kannst jetzt die Offsets setzen.', 'success');
  }

  async setOffsetFromCurrent() {
    if (!this.requireConnection()) return;
    const status = this.rotor.getCurrentStatus();
    if (!status || typeof status.azimuthRaw !== 'number' || typeof status.elevationRaw !== 'number') {
      this.reportError('Keine Positionsdaten verfügbar.');
      this.showMessage('Offsets konnten nicht gesetzt werden – keine Daten.', 'error');
      return;
    }

    const newOffsets = {
      azimuthOffset: 0 - status.azimuthRaw,
      elevationOffset: 0 - status.elevationRaw
    };

    const updated = await this.saveConfig(newOffsets);
    this.updateConfig(updated);
    this.applyOffsets();
    this.showMessage(
      `Offsets gespeichert (Az: ${newOffsets.azimuthOffset.toFixed(2)}°, El: ${newOffsets.elevationOffset.toFixed(2)}°).`,
      'success'
    );
  }

  async captureLimitFromCurrent(limitKey) {
    if (!this.requireConnection()) return;
    const status = this.rotor.getCurrentStatus();
    if (!status) {
      this.showMessage('Keine Positionsdaten vorhanden.', 'error');
      return;
    }

    const partial = {};
    if (limitKey === 'azimuthMinLimit' || limitKey === 'azimuthMaxLimit') {
      if (typeof status.azimuth !== 'number') {
        this.showMessage('Aktueller Azimut nicht verfügbar.', 'error');
        return;
      }
      partial[limitKey] = Number(status.azimuth.toFixed(1));
    } else if (limitKey === 'elevationMinLimit' || limitKey === 'elevationMaxLimit') {
      if (typeof status.elevation !== 'number') {
        this.showMessage('Aktuelle Elevation nicht verfügbar.', 'error');
        return;
      }
      partial[limitKey] = Number(status.elevation.toFixed(1));
    }

    const updated = await this.saveConfig(partial);
    this.updateConfig(updated);
    this.applyLimits();
    this.onConfigUpdated(updated);
    this.showMessage(`Grenze ${limitKey.includes('azimuth') ? 'Azimut' : 'Elevation'} aktualisiert.`, 'success');
  }

  async moveToLimit(limitKey) {
    if (!this.requireConnection()) return;
    const config = this.getConfig();
    const status = this.rotor.getCurrentStatus();
    const target = {};

    const currentAz = typeof status?.azimuth === 'number' ? status.azimuth : config.azimuthMinLimit;
    const currentEl = typeof status?.elevation === 'number' ? status.elevation : config.elevationMinLimit;

    if (limitKey === 'azimuthMinLimit' || limitKey === 'azimuthMaxLimit') {
      target.az = config[limitKey];
      target.el = currentEl;
    } else {
      target.az = currentAz;
      target.el = config[limitKey];
    }

    try {
      await this.rotor.setAzEl(target);
      this.showMessage('Rotor fährt zum ausgewählten Limit. Bitte Ausrichtung notieren.', 'info');
    } catch (error) {
      this.reportError(error);
      this.showMessage('Fahrt zum Limit fehlgeschlagen.', 'error');
    }
  }

  async testCalibration() {
    if (!this.requireConnection()) return;
    try {
      await this.rotor.setAzEl({ az: 0, el: 0 });
      this.showMessage('Testfahrt zu 0°/0° gestartet. Prüfe, ob der Aufbau jetzt Richtung Nord/Horizontal zeigt.', 'info');
    } catch (error) {
      this.reportError(error);
      this.showMessage('Kalibrierungstest fehlgeschlagen.', 'error');
    }
  }

  loadDirectionNotes() {
    try {
      const stored = window.localStorage.getItem('rotor-calibration-directions');
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.warn('[CalibrationWizard] Konnte Notizen nicht laden', error);
      return {};
    }
  }

  saveDirectionNotes() {
    try {
      window.localStorage.setItem('rotor-calibration-directions', JSON.stringify(this.directionNotes));
    } catch (error) {
      console.warn('[CalibrationWizard] Konnte Notizen nicht speichern', error);
    }
  }
}

