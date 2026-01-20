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
              <p class="adjustment-instruction">Feinabstimmung: Passen Sie den Wert an, bis die Position auf der Karte stimmt.</p>
              <div class="adjustment-controls">
                <button class="adjust-btn" id="wizardAdjustMinus">-1°</button>
                <input type="number" id="wizardAdjustmentValue" class="adjustment-input" step="0.5" />
                <button class="adjust-btn" id="wizardAdjustPlus">+1°</button>
              </div>
              <button class="wizard-btn primary" id="wizardSaveAdjustment">Wert übernehmen</button>
            </div>

            <div class="wizard-actions" id="wizardActions">
              <button class="wizard-btn secondary" id="wizardSkipBtn">Überspringen</button>
              <button class="wizard-btn secondary" id="wizardAdjustBtn">Anpassen</button>
              <button class="wizard-btn primary" id="wizardConfirmBtn">Position bestätigen</button>
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
      // Move rotor to target position (using raw position to get accurate COM port reading)
      if (window.rotorService) {
        await window.rotorService.setAzElRaw({
          az: this.axis === 'azimuth' ? targetPosition : null,
          el: this.axis === 'elevation' ? targetPosition : null
        });
      }

      // Wait for movement to complete
      await this.waitForPosition(targetPosition);

      // Get current raw position from COM port
      const status = await this.getCurrentStatus();
      const rawValue = this.axis === 'azimuth' ? status.azimuthRaw : status.elevationRaw;

      // Display values
      this.rawValueDisplay.textContent = `${rawValue.toFixed(1)}°`;
      this.statusText.textContent = 'Position erreicht';
      this.instructionText.textContent = `Stimmt die Position auf der Karte mit ${targetPosition}° überein?`;

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
          const currentPos = this.axis === 'azimuth' ? status.azimuthRaw : status.elevationRaw;

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
    // Save calibration point with current values
    this.calibrationPoints.push({
      raw: this.currentRawValue,
      actual: this.currentTargetValue
    });

    console.log('[CalibrationWizard] Point confirmed:', {
      raw: this.currentRawValue,
      actual: this.currentTargetValue
    });

    // Move to next position
    this.currentStep++;
    await this.processNextPosition();
  }

  /**
   * Show adjustment panel
   */
  showAdjustment() {
    this.adjustmentPanel.classList.remove('hidden');
    this.adjustmentValue.value = this.currentTargetValue;
    this.confirmBtn.disabled = true;
    this.adjustBtn.disabled = true;
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

    // Save calibration point with adjusted value
    this.calibrationPoints.push({
      raw: this.currentRawValue,
      actual: adjustedValue
    });

    console.log('[CalibrationWizard] Adjusted point saved:', {
      raw: this.currentRawValue,
      actual: adjustedValue
    });

    // Hide adjustment panel
    this.adjustmentPanel.classList.add('hidden');

    // Move to next position
    this.currentStep++;
    await this.processNextPosition();
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
    if (confirm('Kalibrierung wirklich abbrechen? Alle bisherigen Messwerte gehen verloren.')) {
      this.isRunning = false;
      this.hideModal();
      
      // Stop any ongoing movement
      if (window.rotorService) {
        await window.rotorService.stop();
      }
    }
  }

  /**
   * Finish calibration and save points
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

    // Update status
    this.statusText.textContent = 'Speichere Kalibrierdaten...';
    this.instructionText.textContent = 'Bitte warten...';
    this.confirmBtn.disabled = true;
    this.adjustBtn.disabled = true;
    this.skipBtn.disabled = true;

    try {
      // Clear existing calibration points for this axis
      await fetch(`${window.rotorService.apiBase}/api/calibration/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...window.rotorService.getSessionHeaders()
        },
        body: JSON.stringify({ axis: this.axis })
      });

      // Add all new calibration points
      for (const point of this.calibrationPoints) {
        await fetch(`${window.rotorService.apiBase}/api/calibration/add-point`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...window.rotorService.getSessionHeaders()
          },
          body: JSON.stringify({
            axis: this.axis,
            rawValue: point.raw,
            actualValue: point.actual
          })
        });
      }

      // Success
      this.statusText.textContent = 'Kalibrierung abgeschlossen!';
      this.instructionText.textContent = `${this.calibrationPoints.length} Kalibrierpunkte wurden gespeichert.`;

      // Call completion callback
      if (this.onCompleteCallback) {
        this.onCompleteCallback(this.calibrationPoints);
      }

      // Close modal after delay
      setTimeout(() => {
        this.isRunning = false;
        this.hideModal();
      }, 2000);

    } catch (error) {
      console.error('[CalibrationWizard] Error saving calibration:', error);
      this.statusText.textContent = 'Fehler beim Speichern';
      this.instructionText.textContent = `Fehler: ${error.message}`;
      
      setTimeout(() => {
        this.isRunning = false;
        this.hideModal();
      }, 3000);
    }
  }
}

// Create global instance
window.calibrationWizard = new CalibrationWizard();
