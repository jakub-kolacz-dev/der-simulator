  // ═══════════════════════════════════════════════
  // DEFINITIONS & PROFILES REGISTRY
  // ═══════════════════════════════════════════════

  _ensureRegistries() {
    if (!this._definitions) this._definitions = new Map();
    if (!this._profiles) this._profiles = new Map();
  }

  // ─── Definitions ──────────────────────────────

  upsertDefinition(type, def) {
    this._ensureRegistries();
    const existing = this._definitions.get(type) || {};
    // Deep merge
    this._definitions.set(type, this._deepMerge(existing, def));
  }

  getDefinition(type) {
    this._ensureRegistries();
    return this._definitions.get(type) || null;
  }

  listDefinitions() {
    this._ensureRegistries();
    const result = {};
    for (const [type, def] of this._definitions) {
      result[type] = {
        deviceType: def.metadata?.deviceType || type,
        description: def.metadata?.description || '',
        protocol: def.metadata?.protocol || '',
        telemetryFields: Object.keys(def.telemetry || {}),
        states: Object.keys(def.states?.transitions || {}),
        commands: Object.keys(def.commands || {}),
      };
    }
    return result;
  }

  // ─── Profiles ─────────────────────────────────

  upsertProfile(name, profile) {
    this._ensureRegistries();
    const existing = this._profiles.get(name) || {};
    const merged = this._deepMerge(existing, profile);
    merged.name = name;
    this._profiles.set(name, merged);
  }

  getProfile(name) {
    this._ensureRegistries();
    return this._profiles.get(name) || null;
  }

  deleteProfile(name) {
    this._ensureRegistries();
    this._profiles.delete(name);
  }

  listProfiles() {
    this._ensureRegistries();
    const result = {};
    for (const [name, p] of this._profiles) {
      result[name] = {
        name,
        description: p.description || '',
        appliesTo: p.appliesTo || {},
        curveFields: Object.keys(p.curves || {}),
        noiseFields: Object.keys(p.noise || {}),
      };
    }
    return result;
  }

  // ─── Deep merge helper ────────────────────────

  _deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (
        source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
      ) {
        result[key] = this._deepMerge(result[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }