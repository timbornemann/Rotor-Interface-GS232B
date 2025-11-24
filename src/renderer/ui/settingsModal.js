class SettingsModal {
  constructor() {
    this.modal = document.getElementById('settingsModal');
    this.closeBtn = document.getElementById('closeSettingsBtn');
    this.saveBtn = document.getElementById('settingsSaveBtn');
    this.cancelBtn = document.getElementById('settingsCancelBtn');
    this.tabButtons = document.querySelectorAll('.tab-button');
    this.tabContents = document.querySelectorAll('.tab-content');
    this.currentConfig = null;
    this.onSaveCallback = null;
    
    // Only init if all required elements exist
    if (this.modal && this.closeBtn && this.saveBtn && this.cancelBtn) {
      this.init();
    } else {
      console.warn('[SettingsModal] Some required elements not found, initialization delayed');
      // Try again when DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init());
      } else {
        // DOM already loaded, try init after a short delay
        setTimeout(() => {
          if (this.modal && this.closeBtn && this.saveBtn && this.cancelBtn) {
            this.init();
          } else {
            console.error('[SettingsModal] Required elements still not found after delay');
          }
        }, 100);
      }
    }
  }

  init() {
    // Check if required elements exist
    if (!this.modal || !this.closeBtn || !this.saveBtn || !this.cancelBtn) {
      console.error('[SettingsModal] Cannot initialize - required elements missing');
      return;
    }

    // Tab switching
    if (this.tabButtons && this.tabButtons.length > 0) {
      this.tabButtons.forEach(button => {
        button.addEventListener('click', () => {
          const tabName = button.dataset.tab;
          this.switchTab(tabName);
        });
      });
    }

    // Close handlers
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }
    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => this.close());
    }
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.close();
        }
      });
    }

    // Save handler
    if (this.saveBtn) {
      this.saveBtn.addEventListener('click', () => this.save());
    }

    // Speed range sync
    const azSpeedRange = document.getElementById('settingsAzSpeedRange');
    const azSpeedInput = document.getElementById('settingsAzSpeedInput');
    const elSpeedRange = document.getElementById('settingsElSpeedRange');
    const elSpeedInput = document.getElementById('settingsElSpeedInput');

    if (azSpeedRange && azSpeedInput) {
      azSpeedRange.addEventListener('input', () => {
        azSpeedInput.value = azSpeedRange.value;
      });
      azSpeedInput.addEventListener('input', () => {
        azSpeedRange.value = azSpeedInput.value;
      });
    }

    if (elSpeedRange && elSpeedInput) {
      elSpeedRange.addEventListener('input', () => {
        elSpeedInput.value = elSpeedRange.value;
      });
      elSpeedInput.addEventListener('input', () => {
        elSpeedRange.value = elSpeedInput.value;
      });
    }

    // Port refresh handlers
    const settingsRequestPortBtn = document.getElementById('settingsRequestPortBtn');
    const settingsRefreshPortsBtn = document.getElementById('settingsRefreshPortsBtn');

    if (settingsRequestPortBtn) {
      settingsRequestPortBtn.addEventListener('click', async () => {
        try {
          // Access rotor from global scope (set in main.js)
          if (typeof window.rotorService !== 'undefined') {
            await window.rotorService.requestPortAccess();
            await this.refreshPorts();
          }
        } catch (error) {
          console.error('[SettingsModal] Error requesting port:', error);
        }
      });
    }

    if (settingsRefreshPortsBtn) {
      settingsRefreshPortsBtn.addEventListener('click', () => this.refreshPorts());
    }

    // Map load handler
    const settingsLoadMapBtn = document.getElementById('settingsLoadMapBtn');
    if (settingsLoadMapBtn) {
      settingsLoadMapBtn.addEventListener('click', () => {
        const input = document.getElementById('settingsMapCoordinatesInput');
        if (input && input.value.trim()) {
          // This will be handled by the save callback
        }
      });
    }
  }

  async refreshPorts() {
    const settingsPortSelect = document.getElementById('settingsPortSelect');
    if (!settingsPortSelect) return;

    try {
      // Access rotor from global scope (set in main.js)
      if (typeof window.rotorService === 'undefined') {
        console.warn('[SettingsModal] Rotor service not available');
        return;
      }

      const ports = await window.rotorService.listPorts();
      settingsPortSelect.innerHTML = '';
      
      ports.forEach((port) => {
        const option = document.createElement('option');
        option.value = port.path;
        option.textContent = port.friendlyName || port.path;
        if (port.simulated) {
          option.dataset.simulated = 'true';
        }
        if (port.serverPort) {
          option.dataset.serverPort = 'true';
        }
        settingsPortSelect.appendChild(option);
      });
    } catch (error) {
      console.error('[SettingsModal] Error refreshing ports:', error);
    }
  }

  switchTab(tabName) {
    // Update buttons
    this.tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update content
    this.tabContents.forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
  }

  async open(config, onSave) {
    this.currentConfig = { ...config };
    this.onSaveCallback = onSave;
    this.loadConfigIntoModal(config);
    
    // Refresh ports in modal
    await this.refreshPorts();
    
    // Set selected port if available
    const settingsPortSelect = document.getElementById('settingsPortSelect');
    if (settingsPortSelect && config.portPath) {
      const option = Array.from(settingsPortSelect.options).find(opt => opt.value === config.portPath);
      if (option) {
        settingsPortSelect.value = config.portPath;
      }
    }
    
    this.modal.classList.remove('hidden');
  }

  close() {
    this.modal.classList.add('hidden');
    this.currentConfig = null;
    this.onSaveCallback = null;
  }

  loadConfigIntoModal(config) {
    // Connection tab
    const settingsBaudInput = document.getElementById('settingsBaudInput');
    const settingsPollingInput = document.getElementById('settingsPollingInput');
    const settingsSimulationToggle = document.getElementById('settingsSimulationToggle');
    const settingsSimulationModeSelect = document.getElementById('settingsSimulationModeSelect');
    const settingsConnectionModeSelect = document.getElementById('settingsConnectionModeSelect');

    if (settingsBaudInput) settingsBaudInput.value = config.baudRate || 9600;
    if (settingsPollingInput) settingsPollingInput.value = config.pollingIntervalMs || 1000;
    if (settingsSimulationToggle) settingsSimulationToggle.checked = config.simulation || false;
    if (settingsSimulationModeSelect) settingsSimulationModeSelect.value = config.simulationAzimuthMode || 360;
    if (settingsConnectionModeSelect) settingsConnectionModeSelect.value = config.connectionMode || 'local';

    // Coordinates tab
    const settingsMapCoordinatesInput = document.getElementById('settingsMapCoordinatesInput');
    const settingsSatelliteMapToggle = document.getElementById('settingsSatelliteMapToggle');
    
    if (settingsMapCoordinatesInput) {
      if (config.mapLatitude !== null && config.mapLatitude !== undefined &&
          config.mapLongitude !== null && config.mapLongitude !== undefined) {
        settingsMapCoordinatesInput.value = `${config.mapLatitude}, ${config.mapLongitude}`;
      } else {
        settingsMapCoordinatesInput.value = '';
      }
    }
    if (settingsSatelliteMapToggle) settingsSatelliteMapToggle.checked = config.satelliteMapEnabled || false;

    // Cone tab
    const settingsConeAngleInput = document.getElementById('settingsConeAngleInput');
    const settingsConeLengthInput = document.getElementById('settingsConeLengthInput');
    const settingsAzimuthDisplayOffsetInput = document.getElementById('settingsAzimuthDisplayOffsetInput');

    if (settingsConeAngleInput) settingsConeAngleInput.value = config.coneAngle || 10;
    if (settingsConeLengthInput) settingsConeLengthInput.value = config.coneLength || 1000;
    if (settingsAzimuthDisplayOffsetInput) settingsAzimuthDisplayOffsetInput.value = config.azimuthDisplayOffset || 0;

    // Speed tab
    const settingsAzSpeedRange = document.getElementById('settingsAzSpeedRange');
    const settingsAzSpeedInput = document.getElementById('settingsAzSpeedInput');
    const settingsElSpeedRange = document.getElementById('settingsElSpeedRange');
    const settingsElSpeedInput = document.getElementById('settingsElSpeedInput');
    const settingsAzLowSpeedSelect = document.getElementById('settingsAzLowSpeedSelect');
    const settingsAzHighSpeedSelect = document.getElementById('settingsAzHighSpeedSelect');
    const settingsElLowSpeedSelect = document.getElementById('settingsElLowSpeedSelect');
    const settingsElHighSpeedSelect = document.getElementById('settingsElHighSpeedSelect');
    const settingsAzSpeedAngleSelect = document.getElementById('settingsAzSpeedAngleSelect');
    const settingsElSpeedAngleSelect = document.getElementById('settingsElSpeedAngleSelect');

    if (settingsAzSpeedRange) settingsAzSpeedRange.value = config.azimuthSpeedDegPerSec || 4;
    if (settingsAzSpeedInput) settingsAzSpeedInput.value = config.azimuthSpeedDegPerSec || 4;
    if (settingsElSpeedRange) settingsElSpeedRange.value = config.elevationSpeedDegPerSec || 2;
    if (settingsElSpeedInput) settingsElSpeedInput.value = config.elevationSpeedDegPerSec || 2;
    if (settingsAzLowSpeedSelect) settingsAzLowSpeedSelect.value = config.azimuthLowSpeedStage || 3;
    if (settingsAzHighSpeedSelect) settingsAzHighSpeedSelect.value = config.azimuthHighSpeedStage || 4;
    if (settingsElLowSpeedSelect) settingsElLowSpeedSelect.value = config.elevationLowSpeedStage || 3;
    if (settingsElHighSpeedSelect) settingsElHighSpeedSelect.value = config.elevationHighSpeedStage || 4;
    if (settingsAzSpeedAngleSelect) settingsAzSpeedAngleSelect.value = config.azimuthSpeedAngleCode ?? 3;
    if (settingsElSpeedAngleSelect) settingsElSpeedAngleSelect.value = config.elevationSpeedAngleCode ?? 3;

    // Ramp tab
    const settingsRampEnabledToggle = document.getElementById('settingsRampEnabledToggle');
    const settingsRampKpInput = document.getElementById('settingsRampKpInput');
    const settingsRampKiInput = document.getElementById('settingsRampKiInput');
    const settingsRampSampleInput = document.getElementById('settingsRampSampleInput');
    const settingsRampMaxStepInput = document.getElementById('settingsRampMaxStepInput');
    const settingsRampToleranceInput = document.getElementById('settingsRampToleranceInput');

    if (settingsRampEnabledToggle) settingsRampEnabledToggle.checked = config.rampEnabled || false;
    if (settingsRampKpInput) settingsRampKpInput.value = config.rampKp || 0.4;
    if (settingsRampKiInput) settingsRampKiInput.value = config.rampKi || 0.05;
    if (settingsRampSampleInput) settingsRampSampleInput.value = config.rampSampleTimeMs || 400;
    if (settingsRampMaxStepInput) settingsRampMaxStepInput.value = config.rampMaxStepDeg || 8;
    if (settingsRampToleranceInput) settingsRampToleranceInput.value = config.rampToleranceDeg || 1.5;

    // Calibration tab
    const settingsAzOffsetInput = document.getElementById('settingsAzOffsetInput');
    const settingsElOffsetInput = document.getElementById('settingsElOffsetInput');
    const settingsAzScaleFactorInput = document.getElementById('settingsAzScaleFactorInput');
    const settingsElScaleFactorInput = document.getElementById('settingsElScaleFactorInput');

    if (settingsAzOffsetInput) settingsAzOffsetInput.value = config.azimuthOffset || 0;
    if (settingsElOffsetInput) settingsElOffsetInput.value = config.elevationOffset || 0;
    if (settingsAzScaleFactorInput) settingsAzScaleFactorInput.value = config.azimuthScaleFactor ?? 1.0;
    if (settingsElScaleFactorInput) settingsElScaleFactorInput.value = config.elevationScaleFactor ?? 1.0;

    // Mode tab
    const settingsModeSelect = document.getElementById('settingsModeSelect');
    const settingsElevationDisplayToggle = document.getElementById('settingsElevationDisplayToggle');
    if (settingsModeSelect) settingsModeSelect.value = config.azimuthMode || 360;
    if (settingsElevationDisplayToggle) settingsElevationDisplayToggle.checked = config.elevationDisplayEnabled !== false;
  }

  getConfigFromModal() {
    const config = {};

    // Connection tab
    const settingsBaudInput = document.getElementById('settingsBaudInput');
    const settingsPollingInput = document.getElementById('settingsPollingInput');
    const settingsSimulationToggle = document.getElementById('settingsSimulationToggle');
    const settingsSimulationModeSelect = document.getElementById('settingsSimulationModeSelect');
    const settingsConnectionModeSelect = document.getElementById('settingsConnectionModeSelect');
    const settingsPortSelect = document.getElementById('settingsPortSelect');

    if (settingsBaudInput) config.baudRate = Number(settingsBaudInput.value) || 9600;
    if (settingsPollingInput) config.pollingIntervalMs = Number(settingsPollingInput.value) || 1000;
    if (settingsSimulationToggle) config.simulation = settingsSimulationToggle.checked;
    if (settingsSimulationModeSelect) config.simulationAzimuthMode = Number(settingsSimulationModeSelect.value) || 360;
    if (settingsConnectionModeSelect) config.connectionMode = settingsConnectionModeSelect.value;
    if (settingsPortSelect && settingsPortSelect.value) {
      const selectedOption = settingsPortSelect.selectedOptions[0];
      if (selectedOption) {
        config.portPath = settingsPortSelect.value;
        if (selectedOption.dataset.simulated === 'true') {
          config.simulation = true;
        }
      }
    }

    // Coordinates tab
    const settingsMapCoordinatesInput = document.getElementById('settingsMapCoordinatesInput');
    const settingsSatelliteMapToggle = document.getElementById('settingsSatelliteMapToggle');

    if (settingsMapCoordinatesInput && settingsMapCoordinatesInput.value.trim()) {
      const parts = settingsMapCoordinatesInput.value.split(',').map(part => part.trim());
      if (parts.length === 2) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lon)) {
          config.mapLatitude = lat;
          config.mapLongitude = lon;
        }
      }
    }
    if (settingsSatelliteMapToggle) config.satelliteMapEnabled = settingsSatelliteMapToggle.checked;

    // Cone tab
    const settingsConeAngleInput = document.getElementById('settingsConeAngleInput');
    const settingsConeLengthInput = document.getElementById('settingsConeLengthInput');
    const settingsAzimuthDisplayOffsetInput = document.getElementById('settingsAzimuthDisplayOffsetInput');

    if (settingsConeAngleInput) config.coneAngle = Number(settingsConeAngleInput.value) || 10;
    if (settingsConeLengthInput) config.coneLength = Number(settingsConeLengthInput.value) || 1000;
    if (settingsAzimuthDisplayOffsetInput) config.azimuthDisplayOffset = Number(settingsAzimuthDisplayOffsetInput.value) || 0;

    // Speed tab
    const settingsAzSpeedInput = document.getElementById('settingsAzSpeedInput');
    const settingsElSpeedInput = document.getElementById('settingsElSpeedInput');
    const settingsAzLowSpeedSelect = document.getElementById('settingsAzLowSpeedSelect');
    const settingsAzHighSpeedSelect = document.getElementById('settingsAzHighSpeedSelect');
    const settingsElLowSpeedSelect = document.getElementById('settingsElLowSpeedSelect');
    const settingsElHighSpeedSelect = document.getElementById('settingsElHighSpeedSelect');
    const settingsAzSpeedAngleSelect = document.getElementById('settingsAzSpeedAngleSelect');
    const settingsElSpeedAngleSelect = document.getElementById('settingsElSpeedAngleSelect');

    if (settingsAzSpeedInput) config.azimuthSpeedDegPerSec = Number(settingsAzSpeedInput.value) || 4;
    if (settingsElSpeedInput) config.elevationSpeedDegPerSec = Number(settingsElSpeedInput.value) || 2;
    if (settingsAzLowSpeedSelect) config.azimuthLowSpeedStage = Number(settingsAzLowSpeedSelect.value) || 3;
    if (settingsAzHighSpeedSelect) config.azimuthHighSpeedStage = Number(settingsAzHighSpeedSelect.value) || 4;
    if (settingsElLowSpeedSelect) config.elevationLowSpeedStage = Number(settingsElLowSpeedSelect.value) || 3;
    if (settingsElHighSpeedSelect) config.elevationHighSpeedStage = Number(settingsElHighSpeedSelect.value) || 4;
    if (settingsAzSpeedAngleSelect) config.azimuthSpeedAngleCode = Number(settingsAzSpeedAngleSelect.value);
    if (settingsElSpeedAngleSelect) config.elevationSpeedAngleCode = Number(settingsElSpeedAngleSelect.value);

    // Ramp tab
    const settingsRampEnabledToggle = document.getElementById('settingsRampEnabledToggle');
    const settingsRampKpInput = document.getElementById('settingsRampKpInput');
    const settingsRampKiInput = document.getElementById('settingsRampKiInput');
    const settingsRampSampleInput = document.getElementById('settingsRampSampleInput');
    const settingsRampMaxStepInput = document.getElementById('settingsRampMaxStepInput');
    const settingsRampToleranceInput = document.getElementById('settingsRampToleranceInput');

    if (settingsRampEnabledToggle) config.rampEnabled = settingsRampEnabledToggle.checked;
    if (settingsRampKpInput) config.rampKp = Number(settingsRampKpInput.value) || 0.4;
    if (settingsRampKiInput) config.rampKi = Number(settingsRampKiInput.value) || 0.05;
    if (settingsRampSampleInput) config.rampSampleTimeMs = Number(settingsRampSampleInput.value) || 400;
    if (settingsRampMaxStepInput) config.rampMaxStepDeg = Number(settingsRampMaxStepInput.value) || 8;
    if (settingsRampToleranceInput) config.rampToleranceDeg = Number(settingsRampToleranceInput.value) || 1.5;

    // Calibration tab
    const settingsAzOffsetInput = document.getElementById('settingsAzOffsetInput');
    const settingsElOffsetInput = document.getElementById('settingsElOffsetInput');
    const settingsAzScaleFactorInput = document.getElementById('settingsAzScaleFactorInput');
    const settingsElScaleFactorInput = document.getElementById('settingsElScaleFactorInput');

    if (settingsAzOffsetInput) config.azimuthOffset = Number(settingsAzOffsetInput.value) || 0;
    if (settingsElOffsetInput) config.elevationOffset = Number(settingsElOffsetInput.value) || 0;
    if (settingsAzScaleFactorInput) config.azimuthScaleFactor = Number(settingsAzScaleFactorInput.value) || 1.0;
    if (settingsElScaleFactorInput) config.elevationScaleFactor = Number(settingsElScaleFactorInput.value) || 1.0;

    // Mode tab
    const settingsModeSelect = document.getElementById('settingsModeSelect');
    const settingsElevationDisplayToggle = document.getElementById('settingsElevationDisplayToggle');
    if (settingsModeSelect) config.azimuthMode = Number(settingsModeSelect.value) || 360;
    if (settingsElevationDisplayToggle) config.elevationDisplayEnabled = settingsElevationDisplayToggle.checked;

    return config;
  }

  save() {
    const config = this.getConfigFromModal();
    if (this.onSaveCallback) {
      this.onSaveCallback(config);
    }
    this.close();
  }
}

