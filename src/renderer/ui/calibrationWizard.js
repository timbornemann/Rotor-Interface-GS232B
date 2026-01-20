/**
 * Calibration Wizard Controller
 * Guides user through multi-point calibration process.
 */
class CalibrationWizard {
  constructor() {
    this.modal = null;
    this.currentStep = 0;
    this.axis = 'azimuth'; // 'azimuth' or 'elevation'
    this.testPositions = [];
    this.calibrationPoints = [];
    this.isRunning = false;
    this.onCompleteCallback = null;
    
    // UI elements (will be set when modal is created)
    this.progressBar = null;
    this.statusText = null;
    this.instructionText = null;
    this.rawValueDisplay = null;
    this.actualValueDisplay = null;
    this.confirmBtn = null;
    this.adjustBtn = null;
    this.skipBtn = null;
    this.cancelBtn = null;
    this.adjustmentPanel = null;
    this.adjustmentValue = null;
    this.adjustMinusBtn = null;
    this.adjustPlusBtn = null;
    this.saveAdjustmentBtn = null;
  }

  /**
   * Start the calibration wizard
   * @param {string} axis - 'azimuth' or 'elevation'
   * @param {Function} onComplete - Callback when calibration is complete
   */
  async start(axis, onComplete) {
    if (this.isRunning) {
      console.warn('[CalibrationWizard] Wizard already running');
      return;
    }

    this.axis = axis;
    this.onCompleteCallback = onComplete;
    this.isRunning = true;
    this.currentStep = 0;
    this.calibrationPoints = [];

    // Define test positions based on axis
    if (axis === 'azimuth') {
      // For azimuth: test common positions
      const azMode = window.configStore?.get('azimuthMode') || 360;
      this.testPositions = azMode === 450 
        ? [0, 45, 90, 180, 270, 360, 450]
        : [0, 45, 90, 180, 270, 360];
    } else {
      // For elevation: test from 0 to max
      const elMax = window.configStore?.get('elevationMaxLimit') || 90;
      this.testPositions = [0, 30, 60, elMax];
    }

    // Create and show modal
    this.createModal();
    this.showModal();

    // First, move to reference position (0°) to ensure we start from a known position
    await this.moveToReferencePosition();

    // Start with first position
    await this.processNextPosition();
  }

  /**
   * Create the wizard modal HTML
   */
  createModal() {
    // Remove existing modal if any
    if (this.modal) {
      this.modal.remove();
    }

    // Create modal HTML
    const modalHTML = `
      <div class="calibration-wizard-modal" id="calibrationWizardModal">
        <div class="calibration-wizard-content">
          <div class="wizard-header">
            <h2>Kalibrierungs-Wizard: ${this.axis === 'azimuth' ? 'Azimut' : 'Elevation'}</h2>
            <button class="wizard-close-btn" id="wizardCancelBtn" title="Abbrechen">×</button>
          </div>

          <div class="wizard-progress">
            <div class="progress-bar">
              <div class="progress-fill" id="wizardProgressBar" style="width: 0%"></div>
            </div>
            <p class="progress-text" id="wizardProgressText">Position 0 von ${this.testPositions.length}</p>
          </div>

          <div class="wizard-body">
            <div class="wizard-status" id="wizardStatus">
              <p class="status-text" id="wizardStatusText">Initialisiere...</p>
            </div>

            <div class="wizard-instruction" id="wizardInstruction">
              <p id="wizardInstructionText">Bitte warten...</p>
            </div>

            <div class="wizard-values">
              <div class="value-display">
                <label>Rohdaten (COM-Port):</label>
                <strong id="wizardRawValue">--</strong>
              </div>
              <div class="value-display">
                <label>Soll-Position:</label>
                <strong id="wizardActualValue">--</strong>
              </div>
            </div>

            <div class="wizard-adjustment hidden" id="wizardAdjustmentPanel">
              <div class="adjustment-header">
                <img src="./assets/icons/ruler-dimension-line.png" alt="" class="adjustment-icon">
                <span>Tatsächliche Position eingeben</span>
              </div>
              <div class="adjustment-controls">
                <button class="adjust-btn" id="wizardAdjustMinus" title="Um 1° verringern">
                  <img src="./assets/icons/minus.png" alt="-" class="icon-small">
                </button>
                <input type="number" id="wizardAdjustmentValue" class="adjustment-input" step="0.5" placeholder="Aktuelle Position in °" />
                <button class="adjust-btn" id="wizardAdjustPlus" title="Um 1° erhöhen">
                  <img src="./assets/icons/plus.png" alt="+" class="icon-small">
                </button>
              </div>
              <button class="wizard-btn primary" id="wizardSaveAdjustment">
                <img src="./assets/icons/play.png" alt="" class="btn-icon">
                Speichern und weiter
              </button>
            </div>

            <div class="wizard-actions" id="wizardActions">
              <button class="wizard-btn secondary small" id="wizardSkipBtn">
                <img src="./assets/icons/play.png" alt="" class="btn-icon">
                Überspringen
              </button>
              <button class="wizard-btn warning" id="wizardAdjustBtn">
                <img src="./assets/icons/ruler-dimension-line.png" alt="" class="btn-icon">
                Korrigieren
              </button>
              <button class="wizard-btn primary" id="wizardConfirmBtn">
                <img src="./assets/icons/play.png" alt="" class="btn-icon">
                Bestätigen
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Insert modal into DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Get references to UI elements
    this.modal = document.getElementById('calibrationWizardModal');
    this.progressBar = document.getElementById('wizardProgressBar');
    this.progressText = document.getElementById('wizardProgressText');
    this.statusText = document.getElementById('wizardStatusText');
    this.instructionText = document.getElementById('wizardInstructionText');
    this.rawValueDisplay = document.getElementById('wizardRawValue');
    this.actualValueDisplay = document.getElementById('wizardActualValue');
    this.confirmBtn = document.getElementById('wizardConfirmBtn');
    this.adjustBtn = document.getElementById('wizardAdjustBtn');
    this.skipBtn = document.getElementById('wizardSkipBtn');
    this.cancelBtn = document.getElementById('wizardCancelBtn');
    this.adjustmentPanel = document.getElementById('wizardAdjustmentPanel');
    this.adjustmentValue = document.getElementById('wizardAdjustmentValue');
    this.adjustMinusBtn = document.getElementById('wizardAdjustMinus');
    this.adjustPlusBtn = document.getElementById('wizardAdjustPlus');
    this.saveAdjustmentBtn = document.getElementById('wizardSaveAdjustment');

    // Attach event listeners
    this.confirmBtn.addEventListener('click', () => this.handleConfirm());
    this.adjustBtn.addEventListener('click', () => this.showAdjustment());
    this.skipBtn.addEventListener('click', () => this.handleSkip());
    this.cancelBtn.addEventListener('click', () => this.handleCancel());
    this.adjustMinusBtn.addEventListener('click', () => this.adjustValue(-1));
    this.adjustPlusBtn.addEventListener('click', () => this.adjustValue(1));
    this.saveAdjustmentBtn.addEventListener('click', () => this.saveAdjustment());
  }

  showModal() {
    if (this.modal) {
      this.modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  }

  hideModal() {
    if (this.modal) {
      this.modal.classList.add('hidden');
      document.body.style.overflow = '';
      // Remove modal from DOM after animation
      setTimeout(() => {
        if (this.modal) {
          this.modal.remove();
          this.modal = null;
        }
      }, 300);
    }
  }

  /**
   * Move to reference position (0°) before starting calibration
   */
  async moveToReferencePosition() {
    this.statusText.textContent = 'Referenzfahrt...';
    this.instructionText.innerHTML = `
      Der Motor fährt jetzt zur Startposition (0°).<br>
      Dies stellt sicher, dass die Kalibrierung von einer bekannten Position startet.
    `;
    this.rawValueDisplay.textContent = '--';
    this.actualValueDisplay.textContent = '0°';

    // Disable all buttons during reference move
    this.confirmBtn.disabled = true;
    this.adjustBtn.disabled = true;
    this.skipBtn.disabled = true;

    try {
      // Move to 0° position (using calibrated method)
      if (window.rotorService) {
        // Get current position for the other axis
        const currentStatus = await this.getCurrentStatus();
        const currentAz = currentStatus?.azimuth || 0;
        const currentEl = currentStatus?.elevation || 0;
        
        await window.rotorService.setAzEl({
          az: this.axis === 'azimuth' ? 0 : currentAz,
          el: this.axis === 'elevation' ? 0 : currentEl
        });
      }

      // Wait for position to be reached
      await this.waitForPosition(0, 45000); // Longer timeout for initial move

      this.statusText.textContent = 'Referenzposition erreicht';
      this.instructionText.textContent = 'Kalibrierung startet...';
      
      // Wait a moment before starting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error('[CalibrationWizard] Error during reference move:', error);
      
      // Ask user if they want to continue anyway
      const continueAnyway = confirm(
        'Fehler bei der Referenzfahrt zu 0°.\n\n' +
        'Möchten Sie trotzdem fortfahren?\n' +
        'Warnung: Die Kalibrierung könnte ungenau sein, wenn der Motor nicht bei 0° steht.'
      );
      
      if (!continueAnyway) {
        this.isRunning = false;
        this.hideModal();
        throw error;
      }
    }
  }

  /**
   * Process next test position
   */
  async processNextPosition() {
    if (this.currentStep >= this.testPositions.length) {
      // All positions processed
      await this.finishCalibration();
      return;
    }

    const targetPosition = this.testPositions[this.currentStep];
    
    // Update progress
    const progress = ((this.currentStep + 1) / this.testPositions.length) * 100;
    this.progressBar.style.width = `${progress}%`;
    this.progressText.textContent = `Position ${this.currentStep + 1} von ${this.testPositions.length}`;

    // Update status
    this.statusText.textContent = `Fahre zu ${targetPosition}°...`;
    this.instructionText.textContent = `Der Rotor wird jetzt zu ${targetPosition}° bewegt. Bitte warten...`;
    this.rawValueDisplay.textContent = '--';
    this.actualValueDisplay.textContent = `${targetPosition}°`;

    // Hide adjustment panel
    this.adjustmentPanel.classList.add('hidden');

    // Disable buttons during movement
    this.confirmBtn.disabled = true;
    this.adjustBtn.disabled = true;
    this.skipBtn.disabled = false;

    try {
      // Move rotor to target position (using calibrated method to apply existing calibration)
      if (window.rotorService) {
        // Get current position for the other axis
        const currentStatus = await this.getCurrentStatus();
        const currentAz = currentStatus?.azimuth || 0;
        const currentEl = currentStatus?.elevation || 0;
        
        await window.rotorService.setAzEl({
          az: this.axis === 'azimuth' ? targetPosition : currentAz,
          el: this.axis === 'elevation' ? targetPosition : currentEl
        });
      }

      // Wait for movement to complete
      await this.waitForPosition(targetPosition);

      // Get current position from status (both raw and calibrated)
      const status = await this.getCurrentStatus();
      const rawValue = this.axis === 'azimuth' ? status.azimuthRaw : status.elevationRaw;
      const calibratedValue = this.axis === 'azimuth' ? status.azimuth : status.elevation;

      // Display values
      this.rawValueDisplay.textContent = `${rawValue.toFixed(1)}°`;
      this.actualValueDisplay.textContent = `${targetPosition}°`; // Always show target position
      this.statusText.textContent = 'Position erreicht';
      
      // Show calibrated value only if it differs significantly from target
      const calibrationDiff = Math.abs((calibratedValue || targetPosition) - targetPosition);
      const calibrationInfo = calibrationDiff > 0.5 
        ? `<br>Aktuell kalibriert: <strong>${calibratedValue.toFixed(1)}°</strong>`
        : '';
      
      this.instructionText.innerHTML = `
        Ziel-Position: <strong>${targetPosition}°</strong>${calibrationInfo}<br>
        Prüfen Sie am Rotor: Stimmt die Position?
      `;

      // Enable buttons
      this.confirmBtn.disabled = false;
      this.adjustBtn.disabled = false;

      // Store for later use
      this.currentRawValue = rawValue;
      this.currentTargetValue = targetPosition;

    } catch (error) {
      console.error('[CalibrationWizard] Error moving to position:', error);
      this.statusText.textContent = 'Fehler beim Bewegen';
      this.instructionText.textContent = `Fehler: ${error.message}. Sie können diese Position überspringen.`;
      this.confirmBtn.disabled = true;
      this.adjustBtn.disabled = true;
    }
  }

  /**
   * Wait for rotor to reach target position
   */
  async waitForPosition(targetPosition, timeout = 30000) {
    const startTime = Date.now();
    const tolerance = 2; // degrees

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(async () => {
        try {
          const status = await this.getCurrentStatus();
          // Use calibrated position instead of raw to check if target is reached
          const currentPos = this.axis === 'azimuth' ? status.azimuth : status.elevation;

          // Check if position reached
          if (Math.abs(currentPos - targetPosition) <= tolerance) {
            clearInterval(checkInterval);
            // Wait a bit more to ensure position is stable
            setTimeout(() => resolve(), 500);
          }

          // Check timeout
          if (Date.now() - startTime > timeout) {
            clearInterval(checkInterval);
            reject(new Error('Timeout waiting for position'));
          }
        } catch (error) {
          clearInterval(checkInterval);
          reject(error);
        }
      }, 500);
    });
  }

  /**
   * Get current rotor status
   */
  async getCurrentStatus() {
    if (!window.rotorService) {
      throw new Error('Rotor service not available');
    }
    
    // rotorService polls status automatically and stores it in currentStatus
    const status = window.rotorService.currentStatus;
    
    if (!status) {
      throw new Error('Status not available - please ensure rotor is connected');
    }
    
    return status;
  }

  /**
   * Handle confirm button click
   */
  async handleConfirm() {
    // Save point immediately to backend
    await this.savePointImmediately(this.currentRawValue, this.currentTargetValue);
    
    // Move to next position
    this.currentStep++;
    await this.processNextPosition();
  }

  /**
   * Show adjustment panel
   */
  showAdjustment() {
    this.adjustmentPanel.classList.remove('hidden');
    // Pre-fill with target value as starting point
    this.adjustmentValue.value = this.currentTargetValue;
    this.adjustmentValue.focus();
    this.adjustmentValue.select();
    this.confirmBtn.disabled = true;
    this.adjustBtn.disabled = true;
    
    // Update instruction text
    this.instructionText.innerHTML = `Position korrigieren`;
  }

  /**
   * Adjust value by delta
   */
  adjustValue(delta) {
    const currentValue = parseFloat(this.adjustmentValue.value) || this.currentTargetValue;
    this.adjustmentValue.value = currentValue + delta;
  }

  /**
   * Save adjusted value
   */
  async saveAdjustment() {
    const adjustedValue = parseFloat(this.adjustmentValue.value);
    
    if (isNaN(adjustedValue)) {
      alert('Ungültiger Wert');
      return;
    }

    // Save adjusted point immediately to backend
    await this.savePointImmediately(this.currentRawValue, adjustedValue);

    // Hide adjustment panel and continue
    this.adjustmentPanel.classList.add('hidden');
    this.currentStep++;
    await this.processNextPosition();
  }

  /**
   * Save a calibration point immediately to the backend
   * @param {number} rawValue - Raw COM port value
   * @param {number} actualValue - Actual position value
   */
  async savePointImmediately(rawValue, actualValue) {
    try {
      const response = await fetch(`${window.rotorService.apiBase}/api/calibration/add-point`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...window.rotorService.getSessionHeaders()
        },
        body: JSON.stringify({
          axis: this.axis,
          rawValue: rawValue,
          actualValue: actualValue
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log('[CalibrationWizard] Point saved:', { 
        raw: rawValue, 
        actual: actualValue,
        replaced: result.replaced 
      });
      
      // Keep local copy for summary at the end
      this.calibrationPoints.push({ raw: rawValue, actual: actualValue });
      
    } catch (error) {
      console.error('[CalibrationWizard] Error saving point:', error);
      // Show error but continue wizard
      alert(`Fehler beim Speichern: ${error.message}\nPunkt wird lokal gespeichert und am Ende nochmal versucht.`);
      // Still keep locally for retry at the end
      this.calibrationPoints.push({ raw: rawValue, actual: actualValue });
    }
  }

  /**
   * Handle skip button click
   */
  async handleSkip() {
    console.log('[CalibrationWizard] Position skipped');
    
    // Move to next position without saving
    this.currentStep++;
    await this.processNextPosition();
  }

  /**
   * Handle cancel button click
   */
  async handleCancel() {
    const message = this.calibrationPoints.length > 0
      ? `Kalibrierung wirklich abbrechen?\n\n${this.calibrationPoints.length} Punkte wurden bereits gespeichert und bleiben erhalten.`
      : 'Kalibrierung wirklich abbrechen?';
      
    if (confirm(message)) {
      this.isRunning = false;
      this.hideModal();
      
      // Stop any ongoing movement
      if (window.rotorService) {
        await window.rotorService.stop();
      }
    }
  }

  /**
   * Finish calibration
   */
  async finishCalibration() {
    if (this.calibrationPoints.length < 2) {
      this.statusText.textContent = 'Kalibrierung unvollständig';
      this.instructionText.textContent = 'Mindestens 2 Kalibrierpunkte werden benötigt. Bitte wiederholen Sie die Kalibrierung.';
      
      setTimeout(() => {
        this.isRunning = false;
        this.hideModal();
      }, 3000);
      return;
    }

    // Points already saved during wizard
    // Just show summary and close
    this.statusText.textContent = 'Kalibrierung abgeschlossen!';
    this.instructionText.textContent = `${this.calibrationPoints.length} Kalibrierpunkte wurden gespeichert.`;
    this.confirmBtn.disabled = true;
    this.adjustBtn.disabled = true;
    this.skipBtn.disabled = true;

    // Call completion callback
    if (this.onCompleteCallback) {
      this.onCompleteCallback(this.calibrationPoints);
    }

    // Close modal after delay
    setTimeout(() => {
      this.isRunning = false;
      this.hideModal();
    }, 2000);
  }
}

// Create global instance
window.calibrationWizard = new CalibrationWizard();
