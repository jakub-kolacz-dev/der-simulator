const TelemetryGenerator = require('./telemetry-generator');

class DeviceInstance {

  constructor(deviceId, definition, instanceIndex, network) {
    this.deviceId = deviceId;
    this.definition = definition;
    this.meta = definition.metadata;
    this.network = network;
    this.instanceIndex = instanceIndex;

    this.state = definition.states.initial;
    this.previousState = this.state;

    this.telemetryGen = new TelemetryGenerator(definition.telemetry);
    this.commandDefs = definition.commands || {};

    this.lastTickAt = Date.now();

    // Auto-load profili pasujących do tego typu urządzenia
    this._autoLoadProfiles();
  }

  getRegistrationMeta() {
    return {
      deviceType: this.meta.deviceType,
      description: this.meta.description,
      protocol: this.meta.protocol,
      manufacturer: this.meta.manufacturer,
      network: this.network,
      instanceIndex: this.instanceIndex,
      availableCommands: Object.keys(this.commandDefs),
      telemetryFields: Object.keys(this.definition.telemetry),
      activeProfile: this.telemetryGen.activeProfile?.name || null,
    };
  }

  tick() {
    const now = Date.now();
    const deltaMs = now - this.lastTickAt;
    this.lastTickAt = now;

    this._transitionState();

    const telemetry = this.telemetryGen.generate(this.state, deltaMs);
    telemetry._state = this.state;
    telemetry._deviceType = this.meta.deviceType;
    telemetry._protocol = this.meta.protocol;
    telemetry._network = this.network;
    telemetry._activeProfile = this.telemetryGen.activeProfile?.name || null;
    telemetry._timestamp = new Date(now).toISOString();

    return telemetry;
  }

  handleCommand(commandName, params) {
    const cmdDef = this.commandDefs[commandName];
    if (!cmdDef) {
      return { status: 'error', result: `Unknown command: ${commandName}` };
    }

    if (cmdDef.validFromStates && !cmdDef.validFromStates.includes(this.state)) {
      return {
        status: 'rejected',
        result: `"${commandName}" invalid in state "${this.state}"`,
      };
    }

    if (cmdDef.transitionTo) {
      this.previousState = this.state;
      this.state = cmdDef.transitionTo;
      this.telemetryGen.onStateChange(this.state);
      this._autoLoadProfiles();
    }

    if (cmdDef.effect && params) {
      if (cmdDef.effect.setMax && params.value !== undefined) {
        this.telemetryGen.setOverride(cmdDef.effect.param, { max: params.value });
      }
    }

    return { status: 'ok', result: `${commandName}: ${this.previousState} → ${this.state}` };
  }

  // ─── TELEMETRY CONFIG API ─────────────────────

  setProfile(profileNameOrObj) {
    this.telemetryGen.loadProfile(profileNameOrObj);
  }

  clearProfile() {
    this.telemetryGen.clearProfile();
  }

  setFieldOverride(fieldName, override) {
    this.telemetryGen.setOverride(fieldName, override);
  }

  clearFieldOverride(fieldName) {
    this.telemetryGen.clearOverride(fieldName);
  }

  clearAllOverrides() {
    this.telemetryGen.clearAllOverrides();
  }

  getFieldConfig(fieldName) {
    return this.telemetryGen.getFieldConfig(fieldName);
  }

  getAllFieldConfigs() {
    const configs = {};
    for (const key of Object.keys(this.definition.telemetry)) {
      configs[key] = this.telemetryGen.getFieldConfig(key);
    }
    return configs;
  }

  // ─── PRIVATE ──────────────────────────────────

  _autoLoadProfiles() {
    // Próbuj załadować profil pasujący do deviceType + state
    const fs = require('fs');
    const path = require('path');
    const profilesDir = path.resolve(process.cwd(), 'profiles');

    if (!fs.existsSync(profilesDir)) return;

    const files = fs.readdirSync(profilesDir).filter((f) => f.endsWith('.yaml'));
    const yaml = require('js-yaml');

    for (const file of files) {
      try {
        const profile = yaml.load(fs.readFileSync(path.join(profilesDir, file), 'utf8'));
        const applies = profile.appliesTo;
        if (
          applies &&
          applies.deviceType === this.meta.deviceType &&
          applies.states?.includes(this.state)
        ) {
          this.telemetryGen.loadProfile(profile);
          return;
        }
      } catch { /* skip invalid profiles */ }
    }

    // Brak profilu dla tego stanu — fallback na bazowy generator
    this.telemetryGen.clearProfile();
  }

  _transitionState() {
    const statesDef = this.definition.states;

    if (
      statesDef.faultProbability &&
      statesDef.faultFromStates?.includes(this.state) &&
      Math.random() < statesDef.faultProbability
    ) {
      this.previousState = this.state;
      this.state = 'Faulted';
      this.telemetryGen.onStateChange(this.state);
      this._autoLoadProfiles();
      return;
    }

    const transitions = statesDef.transitions[this.state];
    if (!transitions) return;

    for (const t of transitions) {
      if (Math.random() < t.probability) {
        this.previousState = this.state;
        this.state = t.to;
        this.telemetryGen.onStateChange(this.state);
        this._autoLoadProfiles();
        return;
      }
    }
  }
}

module.exports = DeviceInstance;