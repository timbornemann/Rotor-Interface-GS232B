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
    this.resetBtn = document.getElementById('settingsResetBtn');
    this.navItems = document.querySelectorAll('.settings-nav-item');
    this.sections = document.querySelectorAll('.settings-section');
    this.currentConfig = null;
    this.onSaveCallback = null;
    this.clientsRefreshTimer = null;
    this.wsUnsubscribers = [];
    this.locationMap = null;
    this.locationMarker = null;
    this.locationSearchAbort = null;
    this.pendingLocation = null;
    this.locationMapReady = false;
    
    // Settings field definitions for easy maintenance
    this.settingsFields = {
      // Connection
      portPath: { id: 'settingsPortSelect', type: 'select' },
      baudRate: { id: 'settingsBaudInput', type: 'select', parse: Number },
      pollingIntervalMs: { id: 'settingsPollingInput', type: 'number' },
      
      // Display/Mode
      azimuthMode: { id: 'settingsModeSelect', type: 'select', parse: Number },
      coneAngle: { id: 'settingsConeAngleInput', type: 'number' },
      coneLength: { id: 'settingsConeLengthInput', type: 'number' },
      azimuthDisplayOffset: { id: 'settingsAzimuthDisplayOffsetInput', type: 'number' },
      
      // Map
      satelliteMapEnabled: { id: 'settingsSatelliteMapToggle', type: 'checkbox' },
      mapSource: { id: 'settingsMapSourceSelect', type: 'select' },
      mapType: { id: 'settingsMapTypeSelect', type: 'select' },
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

      // Presets
      parkPositionsEnabled: { id: 'settingsParkPositionsEnabled', type: 'checkbox' },
      homeAzimuth: { id: 'settingsHomeAzInput', type: 'number' },
      homeElevation: { id: 'settingsHomeElInput', type: 'number' },
      parkAzimuth: { id: 'settingsParkAzInput', type: 'number' },
      parkElevation: { id: 'settingsParkElInput', type: 'number' },
      autoParkOnDisconnect: { id: 'settingsAutoParkOnDisconnect', type: 'checkbox' },
      
      // Server Settings
      serverHttpPort: { id: 'settingsServerHttpPort', type: 'number' },
      serverWebSocketPort: { id: 'settingsServerWebSocketPort', type: 'number' },
      serverPollingIntervalMs: { id: 'settingsServerPollingInterval', type: 'number' },
      serverSessionTimeoutS: { id: 'settingsServerSessionTimeout', type: 'number' },
      serverMaxClients: { id: 'settingsServerMaxClients', type: 'number' },
      serverLoggingLevel: { id: 'settingsServerLoggingLevel', type: 'select' },
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
    
    // Reset handler
    if (this.resetBtn) {
      this.resetBtn.addEventListener('click', () => this.handleReset());
    }

    // Range/Number sync for speed inputs
    this.setupRangeSync('settingsAzSpeedRange', 'settingsAzSpeedInput');
    this.setupRangeSync('settingsElSpeedRange', 'settingsElSpeedInput');
    this.setupLocationSearch();
    this.setupCoordinateSync();
    this.setupPresetToggle();
    this.setupMapSourceTypeSync();

    // Port refresh button
    const refreshBtn = document.getElementById('settingsRefreshPortsBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshPorts());
    }
    
    // Restart server button
    const restartBtn = document.getElementById('restartServerBtn');
    if (restartBtn) {
      restartBtn.addEventListener('click', () => this.handleServerRestart());
    }

    // Calibration wizard buttons
    const startAzCalibBtn = document.getElementById('startAzimuthCalibrationBtn');
    if (startAzCalibBtn) {
      startAzCalibBtn.addEventListener('click', () => this.startCalibration('azimuth'));
    }

    const startElCalibBtn = document.getElementById('startElevationCalibrationBtn');
    if (startElCalibBtn) {
      startElCalibBtn.addEventListener('click', () => this.startCalibration('elevation'));
    }

    // Clear calibration points buttons
    const clearAzPointsBtn = document.getElementById('clearAzimuthPointsBtn');
    if (clearAzPointsBtn) {
      clearAzPointsBtn.addEventListener('click', () => this.clearCalibrationPoints('azimuth'));
    }

    const clearElPointsBtn = document.getElementById('clearElevationPointsBtn');
    if (clearElPointsBtn) {
      clearElPointsBtn.addEventListener('click', () => this.clearCalibrationPoints('elevation'));
    }

    // Manual calibration point buttons - Azimuth
    const addAzPointBtn = document.getElementById('addAzimuthPointBtn');
    if (addAzPointBtn) {
      addAzPointBtn.addEventListener('click', () => this.addManualCalibrationPoint('azimuth'));
    }

    const useAzCurrentBtn = document.getElementById('useAzimuthCurrentBtn');
    if (useAzCurrentBtn) {
      useAzCurrentBtn.addEventListener('click', () => this.useCurrentPosition('azimuth'));
    }

    // Manual calibration point buttons - Elevation
    const addElPointBtn = document.getElementById('addElevationPointBtn');
    if (addElPointBtn) {
      addElPointBtn.addEventListener('click', () => this.addManualCalibrationPoint('elevation'));
    }

    const useElCurrentBtn = document.getElementById('useElevationCurrentBtn');
    if (useElCurrentBtn) {
      useElCurrentBtn.addEventListener('click', () => this.useCurrentPosition('elevation'));
    }

    // Keyboard handling
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
        this.close();
      }
    });
    
    // Setup WebSocket listener for client list updates
    this.setupWebSocketListeners();

    console.log('[SettingsModal] Initialized successfully');
  }
  
  setupWebSocketListeners() {
    // Listen for client list updates from WebSocket
    if (typeof window.wsService !== 'undefined') {
      const unsubscribe = window.wsService.on('client_list_updated', (data) => {
        if (this.modal && !this.modal.classList.contains('hidden')) {
          this.updateClientsTable(data.clients || []);
        }
      });
      this.wsUnsubscribers.push(unsubscribe);
      
      // Listen for settings updates from other clients
      const unsubscribeSettings = window.wsService.on('settings_updated', (settings) => {
        if (settings && typeof settings === 'object') {
          // Update current config
          this.currentConfig = { ...settings };
          
          // If modal is open, update the form with new settings
          if (this.modal && !this.modal.classList.contains('hidden')) {
            this.loadConfigIntoForm(settings);
            this.syncLocationPicker(settings);
            // Optional: Show a subtle notification that settings were updated
            console.log('[SettingsModal] Settings updated by another client');
          }
        }
      });
      this.wsUnsubscribers.push(unsubscribeSettings);
    }
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

  setupPresetToggle() {
    const presetToggle = document.getElementById('settingsParkPositionsEnabled');
    if (!presetToggle) {
      return;
    }

    const updatePresetFields = () => {
      const isEnabled = presetToggle.checked;
      // Nur Auto-Park bei Disconnect hängt von der Aktivierung ab
      // Home/Park-Positionen können immer eingestellt werden
      const autoParkElement = document.getElementById('settingsAutoParkOnDisconnect');
      if (autoParkElement) {
        autoParkElement.disabled = !isEnabled;
      }
    };

    presetToggle.addEventListener('change', updatePresetFields);
    updatePresetFields();
  }

  setupMapSourceTypeSync() {
    const mapSourceSelect = document.getElementById('settingsMapSourceSelect');
    const mapTypeSelect = document.getElementById('settingsMapTypeSelect');
    
    if (!mapSourceSelect || !mapTypeSelect) {
      return;
    }

    const updateMapTypeAvailability = () => {
      const source = mapSourceSelect.value;
      // OpenStreetMap unterstützt nur Standard-Karten
      if (source === 'osm') {
        mapTypeSelect.disabled = true;
        // Setze auf Standard, falls nicht bereits gesetzt
        if (mapTypeSelect.value !== 'standard') {
          mapTypeSelect.value = 'standard';
        }
      } else {
        mapTypeSelect.disabled = false;
      }
    };

    mapSourceSelect.addEventListener('change', updateMapTypeAvailability);
    // Initial update
    updateMapTypeAvailability();
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
    
    // Load clients data when switching to clients tab
    if (tabName === 'clients') {
      this.loadClientsData();
    }

    if (tabName === 'map') {
      this.ensureLocationPicker();
      if (this.locationMap) {
        this.locationMap.invalidateSize();
      }
    }

    // Load calibration points when switching to calibration tab
    if (tabName === 'calibration') {
      this.loadCalibrationPoints();
    }
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
  
  // --- Clients Tab Functions ---
  
  async loadClientsData() {
    try {
      if (typeof window.rotorService === 'undefined') {
        console.warn('[SettingsModal] Rotor service not available');
        return;
      }
      
      const clients = await window.rotorService.getClients();
      this.updateClientsTable(clients);
      this.updateOwnSessionInfo();
    } catch (error) {
      console.error('[SettingsModal] Error loading clients:', error);
    }
  }
  
  updateClientsTable(clients) {
    const tableBody = document.getElementById('clientsTableBody');
    if (!tableBody) return;
    
    const ownSessionId = window.rotorService?.getSessionId();
    
    if (!clients || clients.length === 0) {
      tableBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="6">Keine Clients verbunden</td>
        </tr>
      `;
      return;
    }
    
    tableBody.innerHTML = clients.map(client => {
      const isOwnSession = client.id === ownSessionId;
      const isSuspended = client.status === 'suspended';
      const shortId = client.id.substring(0, 8) + '...';
      const connectedAt = new Date(client.connectedAt).toLocaleString('de-DE');
      
      let rowClass = '';
      if (isOwnSession) rowClass = 'own-session';
      if (isSuspended) rowClass += ' suspended';
      
      return `
        <tr class="${rowClass}" data-client-id="${client.id}">
          <td><code>${shortId}</code></td>
          <td>${client.ip}</td>
          <td>${client.userAgent}</td>
          <td>${connectedAt}</td>
          <td>
            <span class="status-badge ${client.status}">${client.status === 'active' ? 'Aktiv' : 'Suspendiert'}</span>
          </td>
          <td>
            ${this.getActionButton(client, isOwnSession)}
          </td>
        </tr>
      `;
    }).join('');
    
    // Attach event handlers to action buttons
    tableBody.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleClientAction(e));
    });
  }
  
  getActionButton(client, isOwnSession) {
    if (isOwnSession) {
      return `<button class="action-btn" disabled title="Eigene Sitzung">--</button>`;
    }
    
    if (client.status === 'suspended') {
      return `<button class="action-btn resume-btn" data-action="resume" data-client-id="${client.id}">Fortsetzen</button>`;
    }
    
    return `<button class="action-btn suspend-btn" data-action="suspend" data-client-id="${client.id}">Suspendieren</button>`;
  }
  
  async handleClientAction(e) {
    const btn = e.target;
    const action = btn.dataset.action;
    const clientId = btn.dataset.clientId;
    
    if (!action || !clientId) return;
    
    btn.disabled = true;
    btn.textContent = 'Bitte warten...';
    
    try {
      if (action === 'suspend') {
        await window.rotorService.suspendClient(clientId);
      } else if (action === 'resume') {
        await window.rotorService.resumeClient(clientId);
      }
      
      // Refresh clients list
      await this.loadClientsData();
    } catch (error) {
      console.error('[SettingsModal] Error performing client action:', error);
      if (window.alertModal) {
        await window.alertModal.showAlert(`Fehler: ${error.message}`);
      } else {
        alert(`Fehler: ${error.message}`);
      }
      btn.disabled = false;
      btn.textContent = action === 'suspend' ? 'Suspendieren' : 'Fortsetzen';
    }
  }
  
  updateOwnSessionInfo() {
    const sessionIdEl = document.getElementById('ownSessionId');
    const sessionStatusEl = document.getElementById('ownSessionStatus');
    
    if (sessionIdEl && window.rotorService) {
      const sessionId = window.rotorService.getSessionId();
      if (sessionId) {
        sessionIdEl.textContent = sessionId.substring(0, 8) + '...';
      } else {
        sessionIdEl.textContent = '--';
      }
    }
    
    if (sessionStatusEl) {
      // Status is always active if we can see this (suspended users can't access)
      sessionStatusEl.textContent = 'Aktiv';
      sessionStatusEl.className = 'status-badge active';
    }
  }

  async open(config, onSave) {
    this.currentConfig = { ...config };
    this.onSaveCallback = onSave;
    
    // Load config into form fields
    this.loadConfigIntoForm(config);
    this.syncLocationPicker(config);
    
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
    
    // Clear any refresh timers
    if (this.clientsRefreshTimer) {
      clearInterval(this.clientsRefreshTimer);
      this.clientsRefreshTimer = null;
    }
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

    // Ensure preset fields enable/disable state is synced
    const presetToggle = document.getElementById('settingsParkPositionsEnabled');
    if (presetToggle) {
      presetToggle.dispatchEvent(new Event('change'));
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

  setupLocationSearch() {
    const searchInput = document.getElementById('settingsMapSearchInput');
    const searchButton = document.getElementById('settingsMapSearchBtn');

    if (!searchInput || !searchButton) {
      return;
    }

    const handleSearch = () => {
      const query = searchInput.value.trim();
      if (query) {
        void this.performLocationSearch(query);
      }
    };

    searchButton.addEventListener('click', handleSearch);
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSearch();
      }
    });
  }

  setupCoordinateSync() {
    const coordsInput = document.getElementById('settingsMapCoordinatesInput');
    if (!coordsInput) {
      return;
    }

    coordsInput.addEventListener('change', () => {
      const coords = this.parseCoordinates(coordsInput.value);
      if (coords) {
        this.setLocationPickerCoordinates(coords.lat, coords.lon);
      }
    });
  }

  ensureLocationPicker() {
    if (this.locationMap || typeof window.L === 'undefined') {
      return;
    }

    const mapContainer = document.getElementById('settingsMapPicker');
    if (!mapContainer) {
      return;
    }

    const defaultLocation = this.getDefaultLocation();
    this.locationMap = window.L.map(mapContainer, {
      zoomControl: true,
      attributionControl: true
    });

    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap-Mitwirkende'
    }).addTo(this.locationMap);

    this.locationMarker = window.L.marker([defaultLocation.lat, defaultLocation.lon], {
      draggable: false
    }).addTo(this.locationMap);

    // Set location only on click, not on pan/zoom
    this.locationMap.on('click', (e) => {
      const lat = e.latlng.lat;
      const lon = e.latlng.lng;
      this.setLocationPickerCoordinates(lat, lon);
    });

    this.locationMap.setView([defaultLocation.lat, defaultLocation.lon], defaultLocation.zoom);
    this.locationMapReady = true;

    if (this.pendingLocation) {
      this.setLocationPickerCoordinates(this.pendingLocation.lat, this.pendingLocation.lon, this.pendingLocation.zoom);
      this.pendingLocation = null;
    }
  }

  getDefaultLocation() {
    return { lat: 51.0, lon: 10.0, zoom: 6 };
  }

  syncLocationPicker(config) {
    const hasCoords = config.mapLatitude != null && config.mapLongitude != null;
    const zoomLevel = Number.isFinite(config.mapZoomLevel) ? config.mapZoomLevel : undefined;
    if (hasCoords) {
      this.setLocationPickerCoordinates(config.mapLatitude, config.mapLongitude, zoomLevel);
    } else if (zoomLevel) {
      const fallback = this.getDefaultLocation();
      this.setLocationPickerCoordinates(fallback.lat, fallback.lon, zoomLevel);
    }
  }

  setLocationPickerCoordinates(lat, lon, zoom) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }

    if (!this.locationMap || !this.locationMapReady) {
      this.pendingLocation = { lat, lon, zoom };
      return;
    }

    const targetZoom = Number.isFinite(zoom) ? zoom : this.locationMap.getZoom();
    this.locationMap.setView([lat, lon], targetZoom, { animate: false });
    if (this.locationMarker) {
      this.locationMarker.setLatLng([lat, lon]);
    }
    this.updateCoordinatesInput(lat, lon);
  }

  updateCoordinatesInput(lat, lon) {
    const coordsInput = document.getElementById('settingsMapCoordinatesInput');
    if (!coordsInput) {
      return;
    }
    coordsInput.value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  }

  parseCoordinates(value) {
    if (!value) {
      return null;
    }
    const parts = value.split(',').map(part => part.trim());
    if (parts.length !== 2) {
      return null;
    }
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return null;
    }
    return { lat, lon };
  }

  async performLocationSearch(query) {
    const statusEl = document.getElementById('settingsMapSearchStatus');
    const resultsEl = document.getElementById('settingsMapSearchResults');

    if (statusEl) {
      statusEl.textContent = 'Suche läuft...';
      statusEl.classList.remove('hidden', 'error');
    }

    if (resultsEl) {
      resultsEl.innerHTML = '';
      resultsEl.classList.add('hidden');
    }

    if (this.locationSearchAbort) {
      this.locationSearchAbort.abort();
    }
    this.locationSearchAbort = new AbortController();

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`, {
        headers: {
          'Accept-Language': 'de'
        },
        signal: this.locationSearchAbort.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const results = await response.json();
      if (!Array.isArray(results) || results.length === 0) {
        if (statusEl) {
          statusEl.textContent = 'Keine Treffer gefunden.';
        }
        return;
      }

      if (statusEl) {
        statusEl.textContent = `${results.length} Treffer gefunden.`;
      }

      if (resultsEl) {
        resultsEl.classList.remove('hidden');
        results.forEach(result => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = result.display_name;
          button.addEventListener('click', () => {
            const lat = parseFloat(result.lat);
            const lon = parseFloat(result.lon);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              this.setLocationPickerCoordinates(lat, lon, 15);
            }
          });
          resultsEl.appendChild(button);
        });
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      console.error('[SettingsModal] Location search failed:', error);
      if (statusEl) {
        statusEl.textContent = 'Fehler bei der Suche. Bitte später erneut versuchen.';
        statusEl.classList.add('error');
      }
    }
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
    
    // Validate server settings
    if (config.serverHttpPort && config.serverWebSocketPort && config.serverHttpPort === config.serverWebSocketPort) {
      errors.push('HTTP- und WebSocket-Port müssen unterschiedlich sein');
    }

    return errors;
  }
  
  async handleServerRestart() {
    const restartStatus = document.getElementById('restartStatus');
    if (!restartStatus) return;
    
    let confirmed = false;
    if (window.alertModal) {
      confirmed = await window.alertModal.showConfirm('Server wirklich neu starten? Alle Clients werden getrennt.');
    } else {
      confirmed = confirm('Server wirklich neu starten? Alle Clients werden getrennt.');
    }
    
    if (!confirmed) {
      return;
    }
    
    try {
      // Save settings first (user might have changed ports without pressing "Save")
      restartStatus.textContent = 'Einstellungen werden gespeichert...';
      restartStatus.classList.remove('hidden');

      const config = this.getConfigFromForm();
      const errors = this.validate(config);
      if (errors.length > 0) {
        restartStatus.textContent = 'Validierungsfehler:\n' + errors.join('\n');
        return;
      }

      const mergedConfig = { ...(this.currentConfig || {}), ...config };
      if (this.onSaveCallback) {
        // Reuse the existing save pipeline from main.js (includes server-settings split + sanitizing)
        await this.onSaveCallback(mergedConfig);
        // Close modal to avoid UI weirdness while the server restarts
        this.close();
      } else {
        // Fallback: save directly to server if modal was opened without a save callback
        await fetch(`${window.rotorService.apiBase}/api/server/settings`, {
          method: 'POST',
          headers: window.rotorService.getSessionHeaders(),
          body: JSON.stringify({
            serverHttpPort: mergedConfig.serverHttpPort,
            serverWebSocketPort: mergedConfig.serverWebSocketPort,
            serverPollingIntervalMs: mergedConfig.serverPollingIntervalMs,
            serverSessionTimeoutS: mergedConfig.serverSessionTimeoutS,
            serverMaxClients: mergedConfig.serverMaxClients,
            serverLoggingLevel: mergedConfig.serverLoggingLevel
          })
        });
        await fetch(`${window.rotorService.apiBase}/api/settings`, {
          method: 'POST',
          headers: window.rotorService.getSessionHeaders(),
          body: JSON.stringify(mergedConfig)
        });
      }

      // If ports were changed, we need to redirect to the new HTTP port (reload would hit the old origin).
      const httpPortEl = document.getElementById('settingsServerHttpPort');
      const desiredHttpPort = httpPortEl ? Number(httpPortEl.value) : NaN;
      const currentPort = window.location.port ? Number(window.location.port) : NaN;
      const targetPort = Number.isFinite(desiredHttpPort) ? desiredHttpPort : (Number.isFinite(currentPort) ? currentPort : 8081);
      const targetUrl = `${window.location.protocol}//${window.location.hostname}:${targetPort}/`;

      restartStatus.textContent = 'Server wird neu gestartet...';
      restartStatus.classList.remove('hidden');
      
      const response = await fetch(`${window.rotorService.apiBase}/api/server/restart`, {
        method: 'POST',
        headers: window.rotorService.getSessionHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`Server Error: ${response.status}`);
      }
      
      // Wait for server to restart then reload/redirect
      setTimeout(() => {
        const currentPortStr = window.location.port || '';
        const targetPortStr = String(targetPort);
        if (currentPortStr && currentPortStr !== targetPortStr) {
          window.location.href = targetUrl;
        } else if (!currentPortStr && (targetPort === 80 || targetPort === 443)) {
          // Default ports: keep origin without explicit port
          window.location.href = `${window.location.protocol}//${window.location.hostname}/`;
        } else if (!currentPortStr && targetPort !== 80 && targetPort !== 443) {
          window.location.href = targetUrl;
        } else {
          window.location.reload();
        }
      }, 2500);
      
    } catch (error) {
      console.error('[SettingsModal] Error restarting server:', error);
      restartStatus.textContent = 'Fehler beim Neustart: ' + error.message;
    }
  }

  async showError(message) {
    // Simple error display - could be enhanced with a toast system
    if (window.alertModal) {
      await window.alertModal.showAlert(message);
    } else {
      alert(message);
    }
  }

  async handleReset() {
    // Show confirmation dialog
    const confirmed = await window.alertModal.showConfirm(
      'Möchten Sie wirklich alle Einstellungen auf die Standardwerte zurücksetzen?\n\n' +
      'Diese Aktion kann nicht rückgängig gemacht werden.'
    );
    
    if (!confirmed) {
      return;
    }
    
    try {
      // Get the configStore from window
      const configStore = window.configStore || new ConfigStore();
      
      // Reset to defaults
      console.log('[SettingsModal] Resetting settings to defaults...');
      const defaults = await configStore.resetToDefaults();
      
      // Update current config
      this.currentConfig = defaults;
      
      // Reload form with default values
      this.loadConfigIntoForm(defaults);
      this.syncLocationPicker(defaults);
      
      // Show success message
      await window.alertModal.showAlert('Alle Einstellungen wurden auf die Standardwerte zurückgesetzt.');
      
      // Automatically save and close
      if (this.onSaveCallback) {
        this.onSaveCallback(defaults);
      }
      this.close();
      
    } catch (error) {
      console.error('[SettingsModal] Error resetting settings:', error);
      await this.showError('Fehler beim Zurücksetzen: ' + error.message);
    }
  }

  async save() {
    const config = this.getConfigFromForm();
    
    // Validate
    const errors = this.validate(config);
    if (errors.length > 0) {
      await this.showError('Validierungsfehler:\n' + errors.join('\n'));
      return;
    }

    // Merge with current config to preserve any unedited values
    const mergedConfig = { ...this.currentConfig, ...config };

    if (this.onSaveCallback) {
      this.onSaveCallback(mergedConfig);
    }
    this.close();
  }

  // --- Calibration Wizard Methods ---

  async startCalibration(axis) {
    if (!window.calibrationWizard) {
      console.error('[SettingsModal] CalibrationWizard not available');
      await this.showError('Kalibrierungs-Wizard ist nicht verfügbar.');
      return;
    }

    // Check if rotor is connected
    if (!window.rotorService || !window.rotorService.isConnected) {
      await this.showError('Bitte verbinden Sie zuerst den Rotor.');
      return;
    }

    // Close settings modal during calibration
    this.close();

    // Start wizard
    try {
      await window.calibrationWizard.start(axis, async (points) => {
        console.log(`[SettingsModal] Calibration completed for ${axis}:`, points);
        // Reload calibration points display
        await this.loadCalibrationPoints();
        // Show success message
        if (window.alertModal) {
          await window.alertModal.showAlert(
            `Kalibrierung abgeschlossen!\n${points.length} Punkte für ${axis === 'azimuth' ? 'Azimut' : 'Elevation'} wurden gespeichert.`
          );
        }
      });
    } catch (error) {
      console.error('[SettingsModal] Calibration error:', error);
      await this.showError(`Fehler bei der Kalibrierung: ${error.message}`);
    }
  }

  async loadCalibrationPoints() {
    try {
      if (!window.rotorService) {
        console.warn('[SettingsModal] Rotor service not available');
        return;
      }

      const response = await fetch(`${window.rotorService.apiBase}/api/calibration/points`, {
        headers: window.rotorService.getSessionHeaders()
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      // Update azimuth points
      this.displayCalibrationPoints('azimuth', data.azimuthCalibrationPoints || []);
      
      // Update elevation points
      this.displayCalibrationPoints('elevation', data.elevationCalibrationPoints || []);

    } catch (error) {
      console.error('[SettingsModal] Error loading calibration points:', error);
    }
  }

  displayCalibrationPoints(axis, points) {
    const tableBody = document.getElementById(`${axis}PointsTableBody`);
    const countBadge = document.getElementById(`${axis}PointsCount`);

    if (!tableBody || !countBadge) {
      return;
    }

    // Update count badge
    countBadge.textContent = points.length;

    if (points.length === 0) {
      tableBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="3">Keine Kalibrierpunkte vorhanden</td>
        </tr>
      `;
      return;
    }

    // Sort by raw value
    const sortedPoints = [...points].sort((a, b) => a.raw - b.raw);

    tableBody.innerHTML = sortedPoints.map((point, index) => `
      <tr>
        <td>${point.raw.toFixed(1)}°</td>
        <td>${point.actual.toFixed(1)}°</td>
        <td>
          <button class="delete-point-btn" data-axis="${axis}" data-index="${index}">
            Löschen
          </button>
        </td>
      </tr>
    `).join('');

    // Attach event handlers for delete buttons
    tableBody.querySelectorAll('.delete-point-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const btnAxis = e.target.dataset.axis;
        const btnIndex = parseInt(e.target.dataset.index, 10);
        this.deleteCalibrationPoint(btnAxis, btnIndex);
      });
    });
  }

  async deleteCalibrationPoint(axis, index) {
    try {
      if (!window.rotorService) {
        console.warn('[SettingsModal] Rotor service not available');
        return;
      }

      const response = await fetch(`${window.rotorService.apiBase}/api/calibration/remove-point`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...window.rotorService.getSessionHeaders()
        },
        body: JSON.stringify({ axis, index })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Reload points display
      await this.loadCalibrationPoints();

    } catch (error) {
      console.error('[SettingsModal] Error deleting calibration point:', error);
      await this.showError(`Fehler beim Löschen: ${error.message}`);
    }
  }

  async clearCalibrationPoints(axis) {
    // Confirm action
    const confirmed = window.alertModal
      ? await window.alertModal.showConfirm(
          `Alle ${axis === 'azimuth' ? 'Azimut' : 'Elevation'}-Kalibrierpunkte wirklich löschen?`
        )
      : confirm(`Alle ${axis === 'azimuth' ? 'Azimut' : 'Elevation'}-Kalibrierpunkte wirklich löschen?`);

    if (!confirmed) {
      return;
    }

    try {
      if (!window.rotorService) {
        console.warn('[SettingsModal] Rotor service not available');
        return;
      }

      const response = await fetch(`${window.rotorService.apiBase}/api/calibration/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...window.rotorService.getSessionHeaders()
        },
        body: JSON.stringify({ axis })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Reload points display
      await this.loadCalibrationPoints();

      // Show success message
      if (window.alertModal) {
        await window.alertModal.showAlert('Kalibrierpunkte wurden gelöscht.');
      }

    } catch (error) {
      console.error('[SettingsModal] Error clearing calibration points:', error);
      await this.showError(`Fehler beim Löschen: ${error.message}`);
    }
  }

  async addManualCalibrationPoint(axis) {
    const rawInput = document.getElementById(`${axis}ManualRaw`);
    const actualInput = document.getElementById(`${axis}ManualActual`);

    if (!rawInput || !actualInput) {
      console.error('[SettingsModal] Manual calibration form elements not found');
      return;
    }

    const rawValue = parseFloat(rawInput.value);
    const actualValue = parseFloat(actualInput.value);

    // Validate inputs
    if (isNaN(rawValue) || isNaN(actualValue)) {
      await this.showError('Bitte geben Sie gültige Zahlenwerte ein.');
      return;
    }

    // Validate ranges
    if (axis === 'azimuth') {
      const maxLimit = this.currentConfig?.azimuthMaxLimit || 450;
      if (actualValue < 0 || actualValue > maxLimit) {
        await this.showError(`Tatsächliche Position muss zwischen 0° und ${maxLimit}° liegen.`);
        return;
      }
    } else if (axis === 'elevation') {
      const maxLimit = this.currentConfig?.elevationMaxLimit || 90;
      if (actualValue < 0 || actualValue > maxLimit) {
        await this.showError(`Tatsächliche Position muss zwischen 0° und ${maxLimit}° liegen.`);
        return;
      }
    }

    try {
      if (!window.rotorService) {
        console.warn('[SettingsModal] Rotor service not available');
        return;
      }

      const response = await fetch(`${window.rotorService.apiBase}/api/calibration/add-point`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...window.rotorService.getSessionHeaders()
        },
        body: JSON.stringify({
          axis,
          rawValue,
          actualValue
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      // Clear inputs
      rawInput.value = '';
      actualInput.value = '';

      // Reload points display
      await this.loadCalibrationPoints();

      // Show success message
      if (window.alertModal) {
        await window.alertModal.showAlert(
          `Kalibrierpunkt hinzugefügt:\nRaw: ${rawValue.toFixed(1)}° → Tatsächlich: ${actualValue.toFixed(1)}°`
        );
      }

    } catch (error) {
      console.error('[SettingsModal] Error adding calibration point:', error);
      await this.showError(`Fehler beim Hinzufügen: ${error.message}`);
    }
  }

  async useCurrentPosition(axis) {
    try {
      if (!window.rotorService || !window.rotorService.isConnected) {
        await this.showError('Bitte verbinden Sie zuerst den Rotor.');
        return;
      }

      // Get current status from rotorService (it polls automatically)
      const status = window.rotorService.currentStatus;
      
      if (!status || status.azimuthRaw === undefined || status.elevationRaw === undefined) {
        await this.showError('Konnte aktuelle Position nicht abrufen. Bitte stellen Sie sicher, dass der Rotor verbunden ist.');
        return;
      }

      // Get input fields
      const rawInput = document.getElementById(`${axis}ManualRaw`);
      const actualInput = document.getElementById(`${axis}ManualActual`);

      if (!rawInput || !actualInput) {
        return;
      }

      // Fill in raw value from current position
      if (axis === 'azimuth') {
        rawInput.value = status.azimuthRaw.toFixed(1);
        // Pre-fill actual value with raw value as starting point
        actualInput.value = status.azimuthRaw.toFixed(1);
        actualInput.focus();
        actualInput.select();
      } else {
        rawInput.value = status.elevationRaw.toFixed(1);
        // Pre-fill actual value with raw value as starting point
        actualInput.value = status.elevationRaw.toFixed(1);
        actualInput.focus();
        actualInput.select();
      }

      // Show info message
      if (window.alertModal) {
        await window.alertModal.showAlert(
          `Raw-Wert wurde übernommen: ${rawInput.value}°\n\n` +
          `Bitte passen Sie den "Tatsächliche Position"-Wert an, wenn die Position nicht korrekt ist.`
        );
      }

    } catch (error) {
      console.error('[SettingsModal] Error using current position:', error);
      await this.showError(`Fehler: ${error.message}`);
    }
  }
}
