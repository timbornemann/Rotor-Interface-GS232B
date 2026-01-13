/**
 * Alert Modal Controller
 * Provides custom alert and confirm dialogs to replace browser alerts.
 */
class AlertModal {
  constructor() {
    this.modal = null;
    this.messageEl = null;
    this.okBtn = null;
    this.cancelBtn = null;
    this.resolvePromise = null;
    this.currentMode = null; // 'alert' or 'confirm'
    
    this.init();
  }

  init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupElements());
    } else {
      this.setupElements();
    }
  }

  setupElements() {
    this.modal = document.getElementById('alertModal');
    this.messageEl = document.getElementById('alertMessage');
    this.okBtn = document.getElementById('alertOkBtn');
    this.cancelBtn = document.getElementById('alertCancelBtn');

    if (!this.modal || !this.messageEl || !this.okBtn || !this.cancelBtn) {
      console.error('[AlertModal] Cannot initialize - required elements missing');
      return;
    }

    // Setup event listeners
    this.okBtn.addEventListener('click', () => this.handleOk());
    this.cancelBtn.addEventListener('click', () => this.handleCancel());
    
    // Close on backdrop click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.handleCancel();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
        if (this.currentMode === 'alert') {
          this.handleOk();
        } else {
          this.handleCancel();
        }
      }
    });

    console.log('[AlertModal] Initialized successfully');
  }

  handleOk() {
    this.close();
    if (this.resolvePromise) {
      this.resolvePromise(true);
      this.resolvePromise = null;
    }
  }

  handleCancel() {
    this.close();
    if (this.resolvePromise) {
      this.resolvePromise(false);
      this.resolvePromise = null;
    }
  }

  close() {
    if (this.modal) {
      this.modal.classList.add('hidden');
    }
    this.currentMode = null;
  }

  show(message, mode = 'alert') {
    return new Promise((resolve) => {
      if (!this.modal || !this.messageEl) {
        // Fallback to browser alert if modal not ready
        if (mode === 'alert') {
          window.alert(message);
          resolve(true);
        } else {
          const result = window.confirm(message);
          resolve(result);
        }
        return;
      }

      this.currentMode = mode;
      this.messageEl.textContent = message;
      this.resolvePromise = resolve;

      // Show/hide cancel button based on mode
      if (mode === 'confirm') {
        this.cancelBtn.style.display = 'flex';
        // Focus cancel button for confirm dialogs
        setTimeout(() => this.cancelBtn.focus(), 100);
      } else {
        this.cancelBtn.style.display = 'none';
        // Focus OK button for alert dialogs
        setTimeout(() => this.okBtn.focus(), 100);
      }

      this.modal.classList.remove('hidden');
    });
  }

  /**
   * Show an alert dialog with OK button
   * @param {string} message - The message to display
   * @returns {Promise<boolean>} Always resolves to true
   */
  showAlert(message) {
    return this.show(message, 'alert');
  }

  /**
   * Show a confirm dialog with OK and Cancel buttons
   * @param {string} message - The message to display
   * @returns {Promise<boolean>} Resolves to true if OK clicked, false if Cancel clicked
   */
  showConfirm(message) {
    return this.show(message, 'confirm');
  }
}

// Factory function for consistency with other UI components
function createAlertModal() {
  return new AlertModal();
}
