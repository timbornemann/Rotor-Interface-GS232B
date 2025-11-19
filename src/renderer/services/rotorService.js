const SIMULATED_PORT_ID = 'SIMULATED-ROTOR';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const portIds = new WeakMap();
let portCounter = 0;

function supportsWebSerial() {
  return typeof navigator !== 'undefined' && Boolean(navigator.serial);
}

function formatPortLabel(port, id) {
  if (!port?.getInfo) {
    return `WebSerial ${id}`;
  }
  const info = port.getInfo();
  const vendor =
    info?.usbVendorId != null ? `0x${info.usbVendorId.toString(16).padStart(4, '0').toUpperCase()}` : 'USB';
  const product =
    info?.usbProductId != null ? `0x${info.usbProductId.toString(16).padStart(4, '0').toUpperCase()}` : '';
  if (product) {
    return `Port ${vendor}:${product}`;
  }
  return `Port ${vendor}`;
}

class SerialConnection {
  constructor() {
    this.dataListeners = new Set();
    this.errorListeners = new Set();
  }

  onData(listener) {
    this.dataListeners.add(listener);
  }

  onError(listener) {
    this.errorListeners.add(listener);
  }

  emitData(data) {
    this.dataListeners.forEach((listener) => listener(data));
  }

  emitError(error) {
    this.errorListeners.forEach((listener) => listener(error));
  }
}

class SimulationSerialConnection extends SerialConnection {
  constructor() {
    super();
    this.isConnected = false;
    this.azimuth = 0;
    this.elevation = 0;
    this.azDirection = 0;
    this.elDirection = 0;
    this.modeMaxAz = 360;
    this.ticker = null;
  }

  async open() {
    if (this.isConnected) {
      return;
    }
    this.isConnected = true;
    this.startTicker();
    this.emitStatus();
  }

  async close() {
    if (this.ticker) {
      clearInterval(this.ticker);
    }
    this.ticker = null;
    this.isConnected = false;
    this.azDirection = 0;
    this.elDirection = 0;
  }

  isOpen() {
    return this.isConnected;
  }

  async writeCommand(command) {
    const normalized = command.trim().toUpperCase();

    if (normalized.startsWith('M')) {
      const value = Number(normalized.slice(1));
      if (!Number.isNaN(value)) {
        this.azimuth = this.normalizeAzimuth(value);
        this.emitStatus();
      }
      return;
    }

    if (normalized.startsWith('W')) {
      const parts = normalized.slice(1).trim().split(/\s+/);
      const az = Number(parts[0]);
      const el = Number(parts[1]);
      if (!Number.isNaN(az)) {
        this.azimuth = this.normalizeAzimuth(az);
      }
      if (!Number.isNaN(el)) {
        this.elevation = this.normalizeElevation(el);
      }
      this.emitStatus();
      return;
    }

    switch (normalized) {
      case 'R':
        this.azDirection = 1;
        break;
      case 'L':
        this.azDirection = -1;
        break;
      case 'A':
        this.azDirection = 0;
        break;
      case 'U':
        this.elDirection = 1;
        break;
      case 'D':
        this.elDirection = -1;
        break;
      case 'E':
        this.elDirection = 0;
        break;
      case 'S':
        this.azDirection = 0;
        this.elDirection = 0;
        break;
      case 'C':
      case 'B':
      case 'C2':
        this.emitStatus();
        break;
      case 'P36':
        this.modeMaxAz = 360;
        this.azimuth = this.normalizeAzimuth(this.azimuth);
        break;
      case 'P45':
        this.modeMaxAz = 450;
        this.azimuth = this.normalizeAzimuth(this.azimuth);
        break;
      default:
        break;
    }
  }

  startTicker() {
    if (this.ticker) {
      clearInterval(this.ticker);
    }
    this.ticker = setInterval(() => {
      if (this.azDirection !== 0) {
        this.azimuth = this.normalizeAzimuth(this.azimuth + this.azDirection * 2);
      }
      if (this.elDirection !== 0) {
        this.elevation = this.normalizeElevation(this.elevation + this.elDirection);
      }
      if (this.azDirection !== 0 || this.elDirection !== 0) {
        this.emitStatus();
      }
    }, 500);
  }

  emitStatus() {
    const az = Math.round(this.azimuth).toString().padStart(3, '0');
    const el = Math.round(this.elevation).toString().padStart(3, '0');
    this.emitData(`AZ=${az} EL=${el}`);
  }

  normalizeAzimuth(value) {
    if (this.modeMaxAz === 360) {
      return ((value % 360) + 360) % 360;
    }
    let normalized = value;
    while (normalized < 0) {
      normalized += this.modeMaxAz;
    }
    while (normalized >= this.modeMaxAz) {
      normalized -= this.modeMaxAz;
    }
    return normalized;
  }

  normalizeElevation(value) {
    return Math.min(90, Math.max(0, value));
  }
}

class WebSerialConnection extends SerialConnection {
  constructor(port) {
    super();
    this.port = port;
    this.reader = null;
    this.readLoopActive = false;
    this.buffer = '';
  }

  async open(options) {
    await this.port.open({ baudRate: options?.baudRate ?? 9600 });
    this.readLoopActive = true;
    this.startReadLoop();
  }

  async close() {
    this.readLoopActive = false;
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (error) {
        this.emitError(error);
      }
      try {
        this.reader.releaseLock();
      } catch (error) {
        this.emitError(error);
      }
      this.reader = null;
    }
    if (this.port?.readable) {
      try {
        await this.port.close();
      } catch (error) {
        this.emitError(error);
      }
    }
  }

  isOpen() {
    return Boolean(this.port) && this.readLoopActive;
  }

  async writeCommand(command) {
    if (!this.port?.writable) {
      throw new Error('Serial-Port ist nicht geoeffnet.');
    }
    const writer = this.port.writable.getWriter();
    const payload = encoder.encode(command.endsWith('\r') ? command : `${command}\r`);
    try {
      await writer.write(payload);
    } finally {
      writer.releaseLock();
    }
  }

  async startReadLoop() {
    while (this.readLoopActive && this.port?.readable) {
      this.reader = this.port.readable.getReader();
      try {
        while (this.readLoopActive) {
          const { value, done } = await this.reader.read();
          if (done) {
            break;
          }
          if (value) {
            this.pushChunk(value);
          }
        }
      } catch (error) {
        this.emitError(error);
      } finally {
        if (this.reader) {
          try {
            this.reader.releaseLock();
          } catch (error) {
            this.emitError(error);
          }
          this.reader = null;
        }
      }
    }
  }

  pushChunk(value) {
    this.buffer += decoder.decode(value, { stream: true });
    let delimiterIndex = this.buffer.search(/[\r\n]/);
    while (delimiterIndex >= 0) {
      const line = this.buffer.slice(0, delimiterIndex).trim();
      this.buffer = this.buffer.slice(delimiterIndex + 1);
      if (line) {
        this.emitData(line);
      }
      delimiterIndex = this.buffer.search(/[\r\n]/);
    }
  }
}

class RotorService {
  constructor() {
    this.serial = null;
    this.simulationMode = true;
    this.maxAzimuthRange = 360;
    this.pollingTimer = null;
    this.currentStatus = null;
    this.statusListeners = new Set();
    this.errorListeners = new Set();
    this.portRegistry = new Map();
  }

  supportsWebSerial() {
    return supportsWebSerial();
  }

  async listPorts() {
    const ports = [];
    if (supportsWebSerial()) {
      const grantedPorts = await navigator.serial.getPorts();
      grantedPorts.forEach((port) => {
        const id = this.ensurePortId(port);
        this.portRegistry.set(id, port);
        ports.push({
          path: id,
          friendlyName: formatPortLabel(port, id),
          simulated: false
        });
      });
    }
    ports.push({
      path: SIMULATED_PORT_ID,
      friendlyName: 'Simulierter Rotor',
      simulated: true
    });
    return ports;
  }

  async requestPortAccess() {
    if (!supportsWebSerial()) {
      throw new Error(
        'Web Serial wird von diesem Browser oder Kontext nicht unterstützt. Verwende eine aktuelle Chromium-Variante über HTTPS oder localhost.'
      );
    }
    const port = await navigator.serial.requestPort();
    const id = this.ensurePortId(port);
    this.portRegistry.set(id, port);
    return { path: id, friendlyName: formatPortLabel(port, id) };
  }

  async connect(config) {
    const useSimulation =
      Boolean(config.simulation) || config.path === SIMULATED_PORT_ID || !supportsWebSerial();

    await this.disconnect();
    this.maxAzimuthRange = 360;
    this.currentStatus = null;

    if (useSimulation) {
      this.simulationMode = true;
      this.serial = new SimulationSerialConnection();
    } else {
      const port = this.portRegistry.get(config.path);
      if (!port) {
        throw new Error('Der ausgewaehlte Port ist nicht mehr verfügbar. Bitte Zugriff erneut erlauben.');
      }
      this.simulationMode = false;
      this.serial = new WebSerialConnection(port);
    }

    this.serial.onData((line) => this.handleSerialLine(line));
    this.serial.onError((error) => this.emitError(error));

    await this.serial.open({ baudRate: config.baudRate });
  }

  async disconnect() {
    this.stopPolling();
    if (this.serial) {
      try {
        await this.serial.close();
      } catch (error) {
        this.emitError(error);
      }
    }
    this.serial = null;
  }

  async control(command) {
    await this.sendRawCommand(command);
  }

  async sendRawCommand(command) {
    if (!this.serial || !this.serial.isOpen()) {
      throw new Error('Rotor ist nicht verbunden.');
    }
    await this.serial.writeCommand(command.trim().toUpperCase());
  }

  async setAzimuth(target) {
    const normalized = this.normalizeAzimuth(target);
    const value = Math.round(normalized).toString().padStart(3, '0');
    await this.sendRawCommand(`M${value}`);
  }

  async setAzEl({ az, el }) {
    const azValue = Math.round(this.normalizeAzimuth(az)).toString().padStart(3, '0');
    const elValue = Math.round(this.normalizeElevation(el)).toString().padStart(3, '0');
    await this.sendRawCommand(`W${azValue} ${elValue}`);
  }

  async setMode(mode) {
    this.maxAzimuthRange = mode === 450 ? 450 : 360;
    await this.sendRawCommand(mode === 450 ? 'P45' : 'P36');
  }

  startPolling(intervalMs = 1000) {
    this.stopPolling();
    if (!this.serial || !this.serial.isOpen()) {
      return;
    }
    this.pollingTimer = setInterval(() => {
      this.sendRawCommand('C2').catch((error) => this.emitError(error));
    }, intervalMs);
    this.sendRawCommand('C2').catch((error) => this.emitError(error));
  }

  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  onStatusUpdate(listener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onError(listener) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  getCurrentStatus() {
    return this.currentStatus;
  }

  handleSerialLine(line) {
    const status = {
      raw: line,
      timestamp: Date.now()
    };
    const azMatch = line.match(/AZ\s*=\s*(\d+)/i);
    if (azMatch) {
      status.azimuth = Number(azMatch[1]);
    }
    const elMatch = line.match(/EL\s*=\s*(\d+)/i);
    if (elMatch) {
      status.elevation = Number(elMatch[1]);
    }
    this.currentStatus = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  emitError(error) {
    if (!error) {
      return;
    }
    this.errorListeners.forEach((listener) => listener(error));
  }

  normalizeAzimuth(value) {
    const range = this.maxAzimuthRange;
    return ((value % range) + range) % range;
  }

  normalizeElevation(value) {
    return Math.min(90, Math.max(0, value));
  }

  ensurePortId(port) {
    let id = portIds.get(port);
    if (!id) {
      portCounter += 1;
      id = `web-${portCounter}`;
      portIds.set(port, id);
    }
    return id;
  }
}

function createRotorService() {
  return new RotorService();
}
