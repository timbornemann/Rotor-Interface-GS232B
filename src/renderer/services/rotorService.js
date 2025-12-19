


class RotorService {
  constructor() {
    this.apiBase = window.location.origin; // Always relative to where file is served
    this.isConnected = false;
    this.statusPollTimer = null;
    this.statusListeners = new Set();
    this.errorListeners = new Set();
    this.currentStatus = null;
    
    // Default config cache for UI sync
    this.config = {
         // Default values will be overwritten by server config
    };
  }
  
  // --- Events ---
  onStatus(listener) { this.statusListeners.add(listener); }
  onError(listener) { this.errorListeners.add(listener); return () => this.errorListeners.delete(listener); }
  
  emitError(error) {
    console.error('[RotorService]', error);
    this.errorListeners.forEach(l => l(error));
  }
  
  emitStatus(status) {
    this.statusListeners.forEach(l => l(status));
  }

  // --- API Wrappers ---
  
  async listPorts() {
    try {
      const resp = await fetch(`${this.apiBase}/api/rotor/ports`);
      if (!resp.ok) throw new Error(`Server Error: ${resp.status}`);
      const data = await resp.json();
      return data.ports.map(p => ({
          path: p.path,
          friendlyName: p.friendlyName
      }));
    } catch (e) {
      console.error("Failed to list ports", e);
      return [];
    }
  }

  async connect(config) {
    try {
        const resp = await fetch(`${this.apiBase}/api/rotor/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: config.path, baudRate: config.baudRate || 9600 })
        });
        
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.error || resp.statusText);
        }
        
        this.isConnected = true;
        this.startPolling();
        console.log("Connected");
        
    } catch (e) {
        this.emitError(e);
        throw e;
    }
  }
  
  async disconnect() {
    this.stopPolling();
    try {
        await fetch(`${this.apiBase}/api/rotor/disconnect`, { method: 'POST' });
    } catch(e) { console.warn(e); }
    this.isConnected = false;
  }
  
  // --- Control ---
  // Protocol-neutral control methods.
  // The frontend uses abstract directions, the server handles protocol translation.

  /**
   * Set target position (azimuth and/or elevation)
   * @param {number|null} az - Target azimuth in degrees
   * @param {number|null} el - Target elevation in degrees
   */
  async setAzEl({ az, el }) {
      await fetch(`${this.apiBase}/api/rotor/set_target`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ az, el })
      });
  }
  
  /**
   * Set target azimuth only
   * @param {number} az - Target azimuth in degrees
   */
  async setAzimuth(az) {
      return this.setAzEl({ az, el: null });
  }
  
  /**
   * Start manual movement in a direction
   * @param {string} direction - One of: 'left', 'right', 'up', 'down'
   */
  async manualMove(direction) {
      await fetch(`${this.apiBase}/api/rotor/manual`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ direction })
      });
  }
  
  /**
   * Stop all rotor motion
   */
  async stopMotion() {
      await fetch(`${this.apiBase}/api/rotor/stop`, { method: 'POST' });
  }

  // --- Configuration ---
  
  async getSettings() {
      try {
          const resp = await fetch(`${this.apiBase}/api/settings`);
          if (resp.ok) return await resp.json();
      } catch(e) { console.error(e); }
      return {};
  }
  
  async saveSettings(settings) {
      try {
          const resp = await fetch(`${this.apiBase}/api/settings`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify(settings)
          });
          if (!resp.ok) throw new Error("Failed to save settings");
          return await resp.json();
      } catch(e) {
          this.emitError(e);
          throw e;
      }
  }
  
  // Backwards compatibility wrappers called by main.js
  setSoftLimits(limits) { 
      // Handled via saveSettings in main 
  } 
  setCalibrationOffsets(offsets) { 
      // Handled via saveSettings 
  }
  setScaleFactors(factors) {
      // Handled via saveSettings
  }
  setRampSettings(settings) {
      // Handled via saveSettings
  }
  async setSpeed(settings) {
      // Handled via saveSettings
  }
  async setMode(mode) {
      // Handled via saveSettings
  }

  async planAzimuthTarget(az) { 
      // Mock return to satisfy UI calls if any left
      return { commandValue: az, distance: 0 }; 
  }

  // --- Polling ---
  
  startPolling() {
      if (this.statusPollTimer) clearInterval(this.statusPollTimer);
      // Poll every 200ms for smooth UI updates
      // Server updates its cache every 1s, but we can query more frequently
      this.statusPollTimer = setInterval(() => this.poll(), 200);
      this.poll();
  }
  
  stopPolling() {
      if (this.statusPollTimer) clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
  }
  
  async poll() {
      try {
          const resp = await fetch(`${this.apiBase}/api/rotor/status`);
          if (resp.ok) {
              const data = await resp.json();
              
              if (data.status) {
                  const s = data.status;
                  
                  const newStatus = {
                      azimuth: s.calibrated.azimuth, 
                      elevation: s.calibrated.elevation,
                      azimuthRaw: s.rph.azimuth,
                      elevationRaw: s.rph.elevation,
                      rawLine: s.rawLine,
                      timestamp: s.timestamp
                  };
                  
                  this.currentStatus = newStatus;
                  this.emitStatus(newStatus); 
              }
          }
      } catch (e) {
          // Silent fail
      }
  }

  // --- Events ---
  
  emitError(error) {
    if (this.onErrorCallback) this.onErrorCallback(error);
  }

  emitStatus(status) {
    if (this.onStatusCallback) this.onStatusCallback(status);
  }

  onError(callback) {
    this.onErrorCallback = callback;
  }

  onStatus(callback) {
    this.onStatusCallback = callback;
  }
    
  // --- Legacy helpers ---

}

// Create instance
// const rotorService = new RotorService(); // Created in main.js or index.html??
// It seems main.js expects global `rotor`
// Check index.html -> loading order. main.js loaded LAST.
// So we should instantiate here or let main.js do it?
// "rotor" is used in main.js. Let's look at main.js again.
// Based on previous reads, main.js expects 'rotor' to be available.


// window.rotor = rotor; // Make it globally available if not module



// Export factory function as used in main.js
function createRotorService() {
  return new RotorService();
}
