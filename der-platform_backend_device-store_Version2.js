  // ═══════════════════════════════════════════════
  // TELEMETRY CONFIG STORE
  // ═══════════════════════════════════════════════

  /** deviceId → { profile, overrides: { fieldName → override } } */

  _ensureTelConfig(deviceId) {
    if (!this._telConfigs) this._telConfigs = new Map();
    if (!this._telConfigs.has(deviceId)) {
      this._telConfigs.set(deviceId, { profile: null, overrides: {} });
    }
    return this._telConfigs.get(deviceId);
  }

  setDeviceProfile(deviceId, profile) {
    const cfg = this._ensureTelConfig(deviceId);
    cfg.profile = profile;
    // Wyślij do symulatora jako fleet command
    if (!this._fleetCommands) this._fleetCommands = [];
    this._fleetCommands.push({
      action: 'set_profile',
      deviceId,
      profile,
    });
  }

  clearDeviceProfile(deviceId) {
    const cfg = this._ensureTelConfig(deviceId);
    cfg.profile = null;
    if (!this._fleetCommands) this._fleetCommands = [];
    this._fleetCommands.push({
      action: 'clear_profile',
      deviceId,
    });
  }

  setDeviceFieldOverride(deviceId, fieldName, override) {
    const cfg = this._ensureTelConfig(deviceId);
    cfg.overrides[fieldName] = { ...cfg.overrides[fieldName], ...override };
    if (!this._fleetCommands) this._fleetCommands = [];
    this._fleetCommands.push({
      action: 'set_field_override',
      deviceId,
      fieldName,
      override,
    });
  }

  clearDeviceFieldOverride(deviceId, fieldName) {
    const cfg = this._ensureTelConfig(deviceId);
    delete cfg.overrides[fieldName];
    if (!this._fleetCommands) this._fleetCommands = [];
    this._fleetCommands.push({
      action: 'clear_field_override',
      deviceId,
      fieldName,
    });
  }

  clearAllDeviceFieldOverrides(deviceId) {
    const cfg = this._ensureTelConfig(deviceId);
    cfg.overrides = {};
    if (!this._fleetCommands) this._fleetCommands = [];
    this._fleetCommands.push({
      action: 'clear_all_overrides',
      deviceId,
    });
  }

  getDeviceTelemetryConfig(deviceId) {
    return this._ensureTelConfig(deviceId);
  }