/**
 * Settings Modal Controller
 * Handles all settings UI interactions and data management.
 */
class SettingsModal {
  constructor() {
    this.modal = document.getElementById('settingsModal');
    this.closeBtn = document.getElementById('closeSettingsBtn');
    this.saveBtn = document.getElementById('settingsSaveBtn');
    this.cancelBtn = document.getElementById('settingsCancelBtn');
    this.navItems = document.querySelectorAll('.settings-nav-item');
    this.sections = document.querySelectorAll('.settings-section');
    this.currentConfig = null;
    this.onSaveCallback = null;
    
    // Settings field definitions for easy maintenance
    this.settingsFields = {
      // Connection
      portPath: { id: 'settingsPortSelect', type: 'select' },
      baudRate: { id: 'settingsBaudInput', type: 'select', parse: Number },
      pollingIntervalMs: { id: 'settingsPollingInput', type: 'number' },
      
      // Display/Mode
      azimuthMode: { id: 'settingsModeSelect', type: 'select', parse: Number },
      elevationDisplayEnabled: { id: 'settingsElevationDisplayToggle', type: 'checkbox' },
      coneAngle: { id: 'settingsConeAngleInput', type: 'number' },
      coneLength: { id: 'settingsConeLengthInput', type: 'number' },
      azimuthDisplayOffset: { id: 'settingsAzimuthDisplayOffsetInput', type: 'number' },
      
      // Map
      satelliteMapEnabled: { id: 'settingsSatelliteMapToggle', type: 'checkbox' },
      mapZoomLevel: { id: 'settingsMapZoomLevel', type: 'number' },
      mapZoomMin: { id: 'settingsMapZoomMin', type: 'number' },
      mapZoomMax: { id: 'settingsMapZoomMax', type: 'number' },
      
      // Speed
      azimuthSpeedDegPerSec: { id: 'settingsAzSpeedInput', type: 'number' },
      elevationSpeedDegPerSec: { id: 'settingsElSpeedInput', type: 'number' },
      azimuthLowSpeedStage: { id: 'settingsAzLowSpeedSelect', type: 'select', parse: Number },
      azimuthHighSpeedStage: { id: 'settingsAzHighSpeedSelect', type: 'select', parse: Number },
      elevationLowSpeedStage: { id: 'settingsElLowSpeedSelect', type: 'select', parse: Number },
      elevationHighSpeedStage: { id: 'settingsElHighSpeedSelect', type: 'select', parse: Number },
      azimuthSpeedAngleCode: { id: 'settingsAzSpeedAngleSelect', type: 'select', parse: Number },
      elevationSpeedAngleCode: { id: 'settingsElSpeedAngleSelect', type: 'select', parse: Number },
      
      // Ramp
      rampEnabled: { id: 'settingsRampEnabledToggle', type: 'checkbox' },
      rampKp: { id: 'settingsRampKpInput', type: 'number' },
      rampKi: { id: 'settingsRampKiInput', type: 'number' },
      rampSampleTimeMs: { id: 'settingsRampSampleInput', type: 'number' },
      rampMaxStepDeg: { id: 'settingsRampMaxStepInput', type: 'number' },
      rampToleranceDeg: { id: 'settingsRampToleranceInput', type: 'number' },
      
      // Calibration
      azimuthOffset: { id: 'settingsAzOffsetInput', type: 'number' },
      elevationOffset: { id: 'settingsElOffsetInput', type: 'number' },
      azimuthScaleFactor: { id: 'settingsAzScaleFactorInput', type: 'number' },
      elevationScaleFactor: { id: 'settingsElScaleFactorInput', type: 'number' },
      
      // Limits
      azimuthMinLimit: { id: 'settingsAzMinLimit', type: 'number' },
      azimuthMaxLimit: { id: 'settingsAzMaxLimit', type: 'number' },
      elevationMinLimit: { id: 'settingsElMinLimit', type: 'number' },
      elevationMaxLimit: { id: 'settingsElMaxLimit', type: 'number' },
    };
    
    // Initialize when DOM is ready
    if (this.modal && this.closeBtn && this.saveBtn && this.cancelBtn) {
      this.init();
    } else {
      console.warn('[SettingsModal] Some required elements not found, initialization delayed');
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.init());
      } else {
        setTimeout(() => this.init(), 100);
      }
    }
  }

  init() {
    if (!this.modal || !this.closeBtn || !this.saveBtn || !this.cancelBtn) {
      console.error('[SettingsModal] Cannot initialize - required elements missing');
      return;
    }

    // Navigation switching
    this.navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tabName = item.dataset.tab;
        this.switchSection(tabName);
      });
    });

    // Close handlers
    this.closeBtn.addEventListener('click', () => this.close());
    this.cancelBtn.addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });

    // Save handler
    this.saveBtn.addEventListener('click', () => this.save());

    // Range/Number sync for speed inputs
    this.setupRangeSync('settingsAzSpeedRange', 'settingsAzSpeedInput');
    this.setupRangeSync('settingsElSpeedRange', 'settingsElSpeedInput');

    // Port refresh button
    const refreshBtn = document.getElementById('settingsRefreshPortsBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshPorts());
    }

    // Keyboard handling
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
        this.close();
      }
    });

    console.log('[SettingsModal] Initialized successfully');
  }

  setupRangeSync(rangeId, inputId) {
    const range = document.getElementById(rangeId);
    const input = document.getElementById(inputId);
    
    if (range && input) {
      range.addEventListener('input', () => {
        input.value = range.value;
      });
      input.addEventListener('input', () => {
        range.value = input.value;
      });
    }
  }

  switchSection(tabName) {
    // Update nav items
    this.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabName);
    });

    // Update sections
    this.sections.forEach(section => {
      section.classList.toggle('active', section.id === `tab-${tabName}`);
    });
  }

  async refreshPorts() {
    const portSelect = document.getElementById('settingsPortSelect');
    if (!portSelect) return;

    try {
      if (typeof window.rotorService === 'undefined') {
        console.warn('[SettingsModal] Rotor service not available');
        return;
      }

      const ports = await window.rotorService.listPorts();
      portSelect.innerHTML = '';
      
      ports.forEach((port) => {
        const option = document.createElement('option');
        option.value = port.path;
        option.textContent = port.friendlyName || port.path;
        if (port.simulated) option.dataset.simulated = 'true';
        if (port.serverPort) option.dataset.serverPort = 'true';
        portSelect.appendChild(option);
      });

      // Restore selected port
      if (this.currentConfig && this.currentConfig.portPath) {
        const option = Array.from(portSelect.options).find(opt => opt.value === this.currentConfig.portPath);
        if (option) {
          portSelect.value = this.currentConfig.portPath;
        }
      }
    } catch (error) {
      console.error('[SettingsModal] Error refreshing ports:', error);
    }
  }

  async open(config, onSave) {
    this.currentConfig = { ...config };
    this.onSaveCallback = onSave;
    
    // Load config into form fields
    this.loadConfigIntoForm(config);
    
    // Refresh ports
    await this.refreshPorts();
    
    // Reset to first section
    this.switchSection('connection');
    
    // Show modal
    this.modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.modal.classList.add('hidden');
    document.body.style.overflow = '';
    this.currentConfig = null;
    this.onSaveCallback = null;
  }

  loadConfigIntoForm(config) {
    // Handle coordinates specially (combined field)
    const coordsInput = document.getElementById('settingsMapCoordinatesInput');
    if (coordsInput) {
      if (config.mapLatitude != null && config.mapLongitude != null) {
        coordsInput.value = `${config.mapLatitude}, ${config.mapLongitude}`;
      } else {
        coordsInput.value = '';
      }
    }

    // Load all other fields from definition
    for (const [key, field] of Object.entries(this.settingsFields)) {
      const element = document.getElementById(field.id);
      if (!element) continue;

      const value = config[key];
      if (value === undefined || value === null) continue;

      if (field.type === 'checkbox') {
        element.checked = Boolean(value);
      } else if (field.type === 'select') {
        element.value = String(value);
      } else {
        element.value = value;
      }
    }

    // Sync range inputs with their number inputs
    const azSpeedRange = document.getElementById('settingsAzSpeedRange');
    const elSpeedRange = document.getElementById('settingsElSpeedRange');
    if (azSpeedRange && config.azimuthSpeedDegPerSec != null) {
      azSpeedRange.value = config.azimuthSpeedDegPerSec;
    }
    if (elSpeedRange && config.elevationSpeedDegPerSec != null) {
      elSpeedRange.value = config.elevationSpeedDegPerSec;
    }
  }

  getConfigFromForm() {
    const config = {};

    // Handle coordinates specially
    const coordsInput = document.getElementById('settingsMapCoordinatesInput');
    if (coordsInput && coordsInput.value.trim()) {
      const parts = coordsInput.value.split(',').map(part => part.trim());
      if (parts.length === 2) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lon)) {
          config.mapLatitude = lat;
          config.mapLongitude = lon;
        }
      }
    }

    // Extract all fields from definition
    for (const [key, field] of Object.entries(this.settingsFields)) {
      const element = document.getElementById(field.id);
      if (!element) continue;

      let value;
      if (field.type === 'checkbox') {
        value = element.checked;
      } else if (field.type === 'select') {
        value = field.parse ? field.parse(element.value) : element.value;
      } else if (field.type === 'number') {
        value = Number(element.value);
        if (isNaN(value)) continue;
      } else {
        value = element.value;
      }

      config[key] = value;
    }

    return config;
  }

  validate(config) {
    const errors = [];

    // Validate zoom levels
    if (config.mapZoomMin > config.mapZoomMax) {
      errors.push('Minimum Zoom darf nicht größer als Maximum sein');
    }
    if (config.mapZoomLevel < config.mapZoomMin || config.mapZoomLevel > config.mapZoomMax) {
      errors.push('Standard-Zoom muss zwischen Min und Max liegen');
    }

    // Validate limits
    if (config.azimuthMinLimit > config.azimuthMaxLimit) {
      errors.push('Azimut-Minimum darf nicht größer als Maximum sein');
    }
    if (config.elevationMinLimit > config.elevationMaxLimit) {
      errors.push('Elevation-Minimum darf nicht größer als Maximum sein');
    }

    // Validate speed settings
    if (config.azimuthLowSpeedStage > config.azimuthHighSpeedStage) {
      errors.push('Azimut Low-Speed darf nicht größer als High-Speed sein');
    }
    if (config.elevationLowSpeedStage > config.elevationHighSpeedStage) {
      errors.push('Elevation Low-Speed darf nicht größer als High-Speed sein');
    }

    return errors;
  }

  showError(message) {
    // Simple error display - could be enhanced with a toast system
    alert(message);
  }

  save() {
    const config = this.getConfigFromForm();
    
    // Validate
    const errors = this.validate(config);
    if (errors.length > 0) {
      this.showError('Validierungsfehler:\n' + errors.join('\n'));
      return;
    }

    // Merge with current config to preserve any unedited values
    const mergedConfig = { ...this.currentConfig, ...config };

    if (this.onSaveCallback) {
      this.onSaveCallback(mergedConfig);
    }
    this.close();
  }
}
