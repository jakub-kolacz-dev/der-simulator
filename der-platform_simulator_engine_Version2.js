const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const DeviceInstance = require('./device-instance');
const WsTransport = require('./ws-transport');

class SimulatorEngine {

  constructor(config) {
    this.config = config;
    /** @type {Map<string, DeviceInstance>} */
    this.devices = new Map();
    /** @type {Map<string, object>} */
    this.definitions = new Map();
    this.transport = new WsTransport(config.backendWsUrl);
    this.intervalHandle = null;
    this.commandPollHandle = null;
    this.fleetPollHandle = null;
    this._tickCount = 0;
  }

  async init() {
    const fleetPath = path.resolve(process.cwd(), this.config.fleetFile);
    if (!fs.existsSync(fleetPath)) {
      throw new Error(`Fleet file not found: ${fleetPath}`);
    }
    const fleet = yaml.load(fs.readFileSync(fleetPath, 'utf8'));

    console.log('═══════════════════════════════════════════');
    console.log('  DER Simulator Engine');
    console.log('═══════════════════════════════════════════');
    console.log(`  Backend WS: ${this.config.backendWsUrl}`);
    console.log(`  Interval:   ${this.config.intervalMs}ms`);
    console.log('');

    await this.transport.connect();

    // Obsługa komend do urządzeń
    this.transport.onCommands = (commands) => {
      for (const cmd of commands) {
        const instance = this.devices.get(cmd.deviceId);
        if (!instance) {
          this.transport.sendCommandResult(cmd.id, 'error', `Device ${cmd.deviceId} not found`);
          continue;
        }
        const result = instance.handleCommand(cmd.command, cmd.params);
        this.transport.sendCommandResult(cmd.id, result.status, result.result);
        console.log(`  📨 [${cmd.deviceId}] ${cmd.command} → ${result.status}`);
      }
    };

    // Obsługa fleet commands (spawn/kill/scale)
    this.transport.onFleetCommands = (commands) => {
      for (const cmd of commands) {
        this._handleFleetCommand(cmd);
      }
    };

    // Początkowa flota z YAML
    for (const entry of fleet.fleet) {
      this._spawnDevices(entry.type, entry.count, entry.network, entry.idPrefix);
    }

    console.log('');
    console.log(`🔌 Total devices: ${this.devices.size}`);
    console.log('═══════════════════════════════════════════');
  }

  start() {
    console.log(`\n▶️  Simulation running\n`);

    // Telemetria
    this.intervalHandle = setInterval(() => this._tick(), this.config.intervalMs);
    this._tick();

    // Polling komend urządzeń co 2s
    this.commandPollHandle = setInterval(() => {
      const ids = Array.from(this.devices.keys());
      for (let i = 0; i < ids.length; i += 50) {
        this.transport.pollCommandsBatch(ids.slice(i, i + 50));
      }
    }, 2000);

    // Polling fleet commands co 3s
    this.fleetPollHandle = setInterval(() => {
      this.transport.send({ type: 'poll_fleet_commands' });
    }, 3000);
  }

  stop() {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    if (this.commandPollHandle) clearInterval(this.commandPollHandle);
    if (this.fleetPollHandle) clearInterval(this.fleetPollHandle);
    this.transport.destroy();
    console.log('\n⏹️  Simulation stopped');
  }

  // ─── FLEET MANAGEMENT ─────────────────────────

  _handleFleetCommand(cmd) {
    switch (cmd.action) {
      case 'spawn':
        this._spawnDevices(cmd.type, cmd.count, cmd.network, cmd.idPrefix, cmd.startIndex);
        break;

      case 'kill':
        this._killDevices(cmd.deviceIds);
        break;

      case 'scale':
        this._scaleDevices(cmd.type, cmd.targetCount, cmd.network, cmd.idPrefix);
        break;

      default:
        console.log(`⚠️  Unknown fleet command: ${cmd.action}`);
    }
  }

  _spawnDevices(type, count, network, idPrefix, startIndex) {
    const def = this._loadDefinition(type);

    // Znajdź najwyższy istniejący indeks dla tego prefixu
    let maxIdx = startIndex ? startIndex - 1 : 0;
    if (!startIndex) {
      for (const id of this.devices.keys()) {
        if (id.startsWith(`${idPrefix}-`)) {
          const num = parseInt(id.split('-').pop(), 10);
          if (num > maxIdx) maxIdx = num;
        }
      }
    }

    const spawned = [];
    for (let i = 0; i < count; i++) {
      const idx = maxIdx + i + 1;
      const deviceId = `${idPrefix}-${String(idx).padStart(3, '0')}`;

      if (this.devices.has(deviceId)) {
        console.log(`  ⚠️  ${deviceId} already exists, skipping`);
        continue;
      }

      const instance = new DeviceInstance(deviceId, def, idx - 1, network);
      this.devices.set(deviceId, instance);
      this.transport.registerDevice(deviceId, instance.getRegistrationMeta());
      spawned.push(deviceId);
    }

    console.log(`\n🟢 SPAWNED ${spawned.length} × ${def.metadata.deviceType} (total: ${this.devices.size})`);
    if (this.config.logLevel === 'debug') {
      console.log(`   IDs: ${spawned.join(', ')}`);
    }
  }

  _killDevices(deviceIds) {
    const killed = [];
    for (const id of deviceIds) {
      if (this.devices.delete(id)) {
        killed.push(id);
      }
    }
    console.log(`\n🔴 KILLED ${killed.length} devices (total: ${this.devices.size})`);
  }

  _scaleDevices(type, targetCount, network, idPrefix) {
    // Policz ile tego typu już jest
    const existing = [];
    for (const [id, inst] of this.devices) {
      if (inst.meta.deviceType === type && id.startsWith(`${idPrefix}-`)) {
        existing.push(id);
      }
    }

    const currentCount = existing.length;
    const diff = targetCount - currentCount;

    if (diff > 0) {
      // Trzeba dodać
      console.log(`\n📈 SCALE UP ${type}: ${currentCount} → ${targetCount} (+${diff})`);
      this._spawnDevices(type, diff, network, idPrefix);
    } else if (diff < 0) {
      // Trzeba usunąć (od końca)
      const toKill = existing
        .sort()
        .slice(targetCount);
      console.log(`\n📉 SCALE DOWN ${type}: ${currentCount} → ${targetCount} (-${toKill.length})`);
      this._killDevices(toKill);
    } else {
      console.log(`\n⚖️  SCALE ${type}: already at ${targetCount}`);
    }
  }

  // ─── TICK ─────────────────────────────────────

  _tick() {
    this._tickCount++;
    const items = [];

    for (const [deviceId, instance] of this.devices) {
      const data = instance.tick();
      items.push({ deviceId, data });
    }

    const BATCH = 100;
    for (let i = 0; i < items.length; i += BATCH) {
      this.transport.sendTelemetryBatch(items.slice(i, i + BATCH));
    }

    if (this._tickCount % 10 === 0 || this.config.logLevel === 'debug') {
      const now = new Date().toISOString().slice(11, 19);
      console.log(`[${now}] tick #${this._tickCount} — ${items.length} devices`);
    }
  }

  _loadDefinition(type) {
    if (this.definitions.has(type)) return this.definitions.get(type);
    const defPath = path.resolve(process.cwd(), 'definitions', `${type}.yaml`);
    if (!fs.existsSync(defPath)) {
      throw new Error(`Definition not found: ${defPath}`);
    }
    const def = yaml.load(fs.readFileSync(defPath, 'utf8'));
    this.definitions.set(type, def);
    return def;
  }
}

module.exports = SimulatorEngine;