/**
 * WebSocket Service for real-time communication with the server.
 * 
 * Handles:
 * - Connection state synchronization across clients
 * - Client list updates
 * - Session management and suspension notifications
 */
class WebSocketService {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.port = null; // configurable via setWebSocketPort()
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
    this.maxReconnectDelay = 30000; // Max 30 seconds
    this.isConnecting = false;
    this.isSuspended = false;
    
    // Event listeners
    this.listeners = {
      connection_state_changed: new Set(),
      client_list_updated: new Set(),
      client_suspended: new Set(),
      connected: new Set(),
      disconnected: new Set()
    };
    
    // Load session ID from localStorage
    this.sessionId = localStorage.getItem('rotor_session_id');
  }

  /**
   * Override the WebSocket port (useful when server port is configurable).
   * @param {number} port
   */
  setWebSocketPort(port) {
    const p = Number(port);
    this.port = Number.isFinite(p) && p > 0 ? p : null;
  }
  
  /**
   * Get WebSocket URL based on current page location.
   * @returns {string} WebSocket URL
   */
  getWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    // WebSocket runs on port 8082 by default, but can be configured
    const port = this.port || 8082;
    return `${protocol}//${host}:${port}`;
  }
  
  /**
   * Connect to the WebSocket server.
   */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      console.log('[WebSocket] Already connected or connecting');
      return;
    }
    
    if (this.isConnecting) {
      return;
    }
    
    this.isConnecting = true;
    
    try {
      const url = this.getWebSocketUrl();
      console.log(`[WebSocket] Connecting to ${url}...`);
      
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log('[WebSocket] Connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        // Register session with server
        if (this.sessionId) {
          this.send({
            type: 'register_session',
            sessionId: this.sessionId
          });
        }
        
        this.emit('connected');
      };
      
      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
      
      this.ws.onclose = (event) => {
        console.log(`[WebSocket] Disconnected: code=${event.code}, reason=${event.reason}`);
        this.isConnecting = false;
        this.emit('disconnected');
        
        // Don't reconnect if suspended
        if (!this.isSuspended) {
          this.scheduleReconnect();
        }
      };
      
      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        this.isConnecting = false;
      };
      
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }
  
  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WebSocket] Max reconnect attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), this.maxReconnectDelay);
    
    console.log(`[WebSocket] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      if (!this.isSuspended) {
        this.connect();
      }
    }, delay);
  }
  
  /**
   * Disconnect from the WebSocket server.
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  
  /**
   * Send a message to the server.
   * @param {object} message - Message to send
   */
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
  
  /**
   * Handle incoming WebSocket message.
   * @param {string} data - Raw message data
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      const { type, data: payload } = message;
      
      console.log(`[WebSocket] Received: ${type}`, payload);
      
      switch (type) {
        case 'connection_state_changed':
          this.emit('connection_state_changed', payload);
          break;
          
        case 'client_list_updated':
          this.emit('client_list_updated', payload);
          break;
          
        case 'client_suspended':
          // Check if we're the suspended client
          if (payload.clientId === this.sessionId) {
            console.warn('[WebSocket] This session has been suspended');
            this.isSuspended = true;
            this.disconnect();
          }
          this.emit('client_suspended', payload);
          break;
          
        case 'pong':
          // Heartbeat response, ignore
          break;
          
        default:
          console.log(`[WebSocket] Unknown message type: ${type}`);
      }
      
    } catch (error) {
      console.error('[WebSocket] Error parsing message:', error);
    }
  }
  
  /**
   * Set the session ID and persist to localStorage.
   * @param {string} id - Session ID
   */
  setSessionId(id) {
    this.sessionId = id;
    localStorage.setItem('rotor_session_id', id);
    
    // Register with server if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: 'register_session',
        sessionId: id
      });
    }
  }
  
  /**
   * Get the current session ID.
   * @returns {string|null} Session ID
   */
  getSessionId() {
    return this.sessionId;
  }
  
  /**
   * Check if this session is suspended.
   * @returns {boolean} True if suspended
   */
  isSuspendedSession() {
    return this.isSuspended;
  }
  
  /**
   * Add an event listener.
   * @param {string} event - Event name
   * @param {function} callback - Callback function
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].add(callback);
    }
    return () => this.off(event, callback);
  }
  
  /**
   * Remove an event listener.
   * @param {string} event - Event name
   * @param {function} callback - Callback function
   */
  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].delete(callback);
    }
  }
  
  /**
   * Emit an event to all listeners.
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[WebSocket] Error in ${event} listener:`, error);
        }
      });
    }
  }
  
  /**
   * Check if connected to WebSocket server.
   * @returns {boolean} True if connected
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// Factory function to create WebSocket service
function createWebSocketService() {
  return new WebSocketService();
}
