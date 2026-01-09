/**
 * Rotor Service - Handles communication with the backend API.
 * 
 * Provides methods for:
 * - Connection management
 * - Rotor control
 * - Status polling
 * - Configuration management
 */
class RotorService {
  constructor() {
    this.apiBase = window.location.origin; // Always relative to where file is served
    this.isConnected = false;
    this.statusPollTimer = null;
    this.statusListeners = new Set();
    this.errorListeners = new Set();
    this.connectionStateListeners = new Set();
    this.currentStatus = null;
    this.sessionId = null;
    
    // Default config cache for UI sync
    this.config = {
         // Default values will be overwritten by server config
    };
  }
  
  // --- Events ---
  onStatus(listener) { 
    this.statusListeners.add(listener); 
    return () => this.statusListeners.delete(listener);
  }
  
  onError(listener) { 
    this.errorListeners.add(listener); 
    return () => this.errorListeners.delete(listener); 
  }
  
  onConnectionStateChange(listener) {
    this.connectionStateListeners.add(listener);
    return () => this.connectionStateListeners.delete(listener);
  }
  
  emitError(error) {
    console.error('[RotorService]', error);
    this.errorListeners.forEach(l => l(error));
  }
  
  emitStatus(status) {
    this.statusListeners.forEach(l => l(status));
  }
  
  emitConnectionStateChange(state) {
    this.connectionStateListeners.forEach(l => l(state));
  }

  // --- Session Management ---
  
  /**
   * Initialize session with server.
   * Gets or creates a session ID.
   */
  async initSession() {
    try {
      // Try to get existing session from localStorage
      this.sessionId = localStorage.getItem('rotor_session_id');
      
      const headers = {};
      if (this.sessionId) {
        headers['X-Session-ID'] = this.sessionId;
      }
      
      const resp = await fetch(`${this.apiBase}/api/session`, { headers });
      if (resp.ok) {
        const data = await resp.json();
        this.sessionId = data.sessionId;
        localStorage.setItem('rotor_session_id', this.sessionId);
        console.log('[RotorService] Session initialized:', this.sessionId.substring(0, 8) + '...');
        return data;
      }
    } catch (e) {
      console.error('[RotorService] Failed to initialize session', e);
    }
    return null;
  }
  
  /**
   * Get the current session ID.
   * @returns {string|null} Session ID
   */
  getSessionId() {
    return this.sessionId;
  }
  
  /**
   * Add session header to fetch requests.
   * @returns {object} Headers object with session ID
   */
  getSessionHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.sessionId) {
      headers['X-Session-ID'] = this.sessionId;
    }
    return headers;
  }

  // --- API Wrappers ---
  
  async listPorts() {
    try {
      const resp = await fetch(`${this.apiBase}/api/rotor/ports`, {
        headers: this.getSessionHeaders()
      });
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
            headers: this.getSessionHeaders(),
            body: JSON.stringify({ port: config.path, baudRate: config.baudRate || 9600 })
        });
        
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.error || resp.statusText);
        }
        
        // Connection state will be updated via WebSocket broadcast
        // But set local state optimistically
        this.isConnected = true;
        this.startPolling();
        console.log("[RotorService] Connected");
        
    } catch (e) {
        this.emitError(e);
        throw e;
    }
  }
  
  async disconnect() {
    this.stopPolling();
    try {
        await fetch(`${this.apiBase}/api/rotor/disconnect`, { 
          method: 'POST',
          headers: this.getSessionHeaders()
        });
    } catch(e) { console.warn(e); }
    // Connection state will be updated via WebSocket broadcast
    this.isConnected = false;
  }
  
  /**
   * Handle connection state update from WebSocket.
   * @param {object} state - Connection state from server
   */
  handleConnectionStateUpdate(state) {
    const wasConnected = this.isConnected;
    this.isConnected = state.connected;
    
    console.log('[RotorService] Connection state updated:', state);
    
    // Emit to listeners
    this.emitConnectionStateChange(state);
    
    // Start/stop polling based on connection state
    if (state.connected && !wasConnected) {
      this.startPolling();
    } else if (!state.connected && wasConnected) {
      this.stopPolling();
    }
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
          headers: this.getSessionHeaders(),
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
   * Set target position using raw hardware values (no calibration)
   * @param {number|null} az - Target azimuth in raw degrees (hardware position)
   * @param {number|null} el - Target elevation in raw degrees (hardware position)
   */
  async setAzElRaw({ az, el }) {
      await fetch(`${this.apiBase}/api/rotor/set_target_raw`, {
          method: 'POST',
          headers: this.getSessionHeaders(),
          body: JSON.stringify({ az, el })
      });
  }
  
  /**
   * Set target azimuth only using raw hardware value
   * @param {number} az - Target azimuth in raw degrees (hardware position)
   */
  async setAzimuthRaw(az) {
      return this.setAzElRaw({ az, el: null });
  }
  
  /**
   * Start manual movement in a direction
   * @param {string} direction - One of: 'left', 'right', 'up', 'down'
   */
  async manualMove(direction) {
      await fetch(`${this.apiBase}/api/rotor/manual`, {
          method: 'POST',
          headers: this.getSessionHeaders(),
          body: JSON.stringify({ direction })
      });
  }
  
  /**
   * Stop all rotor motion
   */
  async stopMotion() {
      await fetch(`${this.apiBase}/api/rotor/stop`, { 
        method: 'POST',
        headers: this.getSessionHeaders()
      });
  }

  // --- Configuration ---
  
  async getSettings() {
      try {
          const resp = await fetch(`${this.apiBase}/api/settings`, {
            headers: this.getSessionHeaders()
          });
          if (resp.ok) return await resp.json();
      } catch(e) { console.error(e); }
      return {};
  }
  
  async saveSettings(settings) {
      try {
          const resp = await fetch(`${this.apiBase}/api/settings`, {
              method: 'POST',
              headers: this.getSessionHeaders(),
              body: JSON.stringify(settings)
          });
          if (!resp.ok) throw new Error("Failed to save settings");
          return await resp.json();
      } catch(e) {
          this.emitError(e);
          throw e;
      }
  }
  
  // --- Client Management ---
  
  /**
   * Get list of all connected clients.
   * @returns {Promise<Array>} List of client sessions
   */
  async getClients() {
    try {
      const resp = await fetch(`${this.apiBase}/api/clients`, {
        headers: this.getSessionHeaders()
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.clients || [];
      }
    } catch (e) {
      console.error('[RotorService] Failed to get clients', e);
    }
    return [];
  }
  
  /**
   * Suspend a client session.
   * @param {string} clientId - Client session ID to suspend
   */
  async suspendClient(clientId) {
    try {
      const resp = await fetch(`${this.apiBase}/api/clients/${clientId}/suspend`, {
        method: 'POST',
        headers: this.getSessionHeaders()
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Failed to suspend client');
      }
      return await resp.json();
    } catch (e) {
      this.emitError(e);
      throw e;
    }
  }
  
  /**
   * Resume a suspended client session.
   * @param {string} clientId - Client session ID to resume
   */
  async resumeClient(clientId) {
    try {
      const resp = await fetch(`${this.apiBase}/api/clients/${clientId}/resume`, {
        method: 'POST',
        headers: this.getSessionHeaders()
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Failed to resume client');
      }
      return await resp.json();
    } catch (e) {
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
          const resp = await fetch(`${this.apiBase}/api/rotor/status`, {
            headers: this.getSessionHeaders()
          });
          if (resp.ok) {
              const data = await resp.json();
              
              // Update connection state from status response
              if (data.connected !== undefined && data.connected !== this.isConnected) {
                this.handleConnectionStateUpdate({
                  connected: data.connected,
                  port: data.port,
                  baudRate: data.baudRate
                });
              }
              
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
}

// Factory function to create rotor service
function createRotorService() {
  return new RotorService();
}
