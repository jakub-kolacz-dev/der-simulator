/**
 * In-memory store dla urządzeń, telemetrii i komend.
 * W produkcji zamień na Redis / TimescaleDB / InfluxDB.
 */
class DeviceStore {

  constructor(historySize = 100) {
    /** deviceId → { meta, state, lastTelemetry, registeredAt } */
    this.devices = new Map();
    /** deviceId → [ { timestamp, data } ] — ring buffer */
    this.history = new Map();
    /** commandId → { deviceId, command, params, status, result, createdAt } */
    this.commands = new Map();
    /** deviceId → [ commandObj ] — komendy czekające na odebranie przez symulator */
    this.pendingCommands = new Map();

    this.historySize = historySize;
    this.commandIdCounter = 0;

    /** Callbacki na nową telemetrię — WS live broadcast */
    this.onTelemetry = null;
    /** Callbacki na zmianę stanu urządzenia */
    this.onDeviceStateChange = null;
  }

  // ─── DEVICES ──────────────────────────────────

  registerDevice(deviceId, meta) {
    const existing = this.devices.get(deviceId);
    this.devices.set(deviceId, {
      meta,
      state: meta._state || 'Unknown',
      lastTelemetry: null,
      registeredAt: existing?.registeredAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (!this.history.has(deviceId)) {
      this.history.set(deviceId, []);
    }
    if (!this.pendingCommands.has(deviceId)) {
      this.pendingCommands.set(deviceId, []);
    }
  }

  getDevice(deviceId) {
    return this.devices.get(deviceId) || null;
  }

  listDevices(filters = {}) {
    let results = Array.from(this.devices.entries()).map(([id, d]) => ({
      deviceId: id,
      ...d,
    }));

    if (filters.type) {
      results = results.filter((d) => d.meta?.deviceType === filters.type);
    }
    if (filters.state) {
      results = results.filter((d) => d.state === filters.state);
    }
    if (filters.network) {
      results = results.filter((d) => d.meta?.network === filters.network);
    }

    return results;
  }

  // ─── TELEMETRY ────────────────────────────────

  pushTelemetry(deviceId, data) {
    const device = this.devices.get(deviceId);
    if (!device) {
      // Auto-register
      this.registerDevice(deviceId, data);
    }

    const entry = {
      timestamp: data._timestamp || new Date().toISOString(),
      data,
    };

    // Update last
    const dev = this.devices.get(deviceId);
    dev.lastTelemetry = entry;
    dev.state = data._state || dev.state;
    dev.updatedAt = entry.timestamp;

    // Ring buffer history
    const hist = this.history.get(deviceId);
    hist.push(entry);
    if (hist.length > this.historySize) {
      hist.shift();
    }

    // Broadcast
    if (this.onTelemetry) {
      this.onTelemetry(deviceId, entry);
    }
  }

  getHistory(deviceId, limit = 50) {
    const hist = this.history.get(deviceId);
    if (!hist) return [];
    return hist.slice(-limit);
  }

  // ─── COMMANDS ─────────────────────────────────

  createCommand(deviceId, command, params = {}) {
    const id = ++this.commandIdCounter;
    const cmd = {
      id,
      deviceId,
      command,
      params,
      status: 'pending',
      result: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    this.commands.set(id, cmd);

    // Dodaj do pending dla danego urządzenia
    const pending = this.pendingCommands.get(deviceId) || [];
    pending.push(cmd);
    this.pendingCommands.set(deviceId, pending);

    return cmd;
  }

  /** Pobierz i wyczyść pending komendy dla urządzenia */
  drainPendingCommands(deviceId) {
    const pending = this.pendingCommands.get(deviceId) || [];
    this.pendingCommands.set(deviceId, []);
    return pending;
  }

  updateCommandResult(commandId, status, result) {
    const cmd = this.commands.get(commandId);
    if (!cmd) return null;
    cmd.status = status;
    cmd.result = result;
    cmd.updatedAt = new Date().toISOString();
    return cmd;
  }

  getCommand(commandId) {
    return this.commands.get(commandId) || null;
  }

  listCommands(deviceId, limit = 50) {
    const all = Array.from(this.commands.values());
    const filtered = deviceId ? all.filter((c) => c.deviceId === deviceId) : all;
    return filtered.slice(-limit);
  }

  // ─── STATS ────────────────────────────────────

  getStats() {
    const devices = Array.from(this.devices.values());
    const byType = {};
    const byState = {};

    for (const d of devices) {
      const type = d.meta?.deviceType || 'Unknown';
      const state = d.state || 'Unknown';
      byType[type] = (byType[type] || 0) + 1;
      byState[state] = (byState[state] || 0) + 1;
    }

    return {
      totalDevices: this.devices.size,
      totalCommands: this.commands.size,
      byType,
      byState,
    };
  }
}

module.exports = DeviceStore;
