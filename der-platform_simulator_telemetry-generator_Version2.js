const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Generator telemetrii z obsługą:
 * 1. Definicji YAML (bazowe min/max)
 * 2. Profili (krzywe CC/CV, dzwon PV, degradacja SoC…)
 * 3. Szumu (amplitude, drift, spike)
 * 4. Runtime override z REST API
 */
class TelemetryGenerator {

  constructor(telemetryDefs) {
    this.defs = telemetryDefs;
    this.accumulators = {};
    this.overrides = {};         // runtime per-field override { min, max, value, … }

    /** @type {object|null} — aktywny profil */
    this.activeProfile = null;

    /** Czas wejścia w bieżący stan (ms epoch) */
    this.stateEnteredAt = Date.now();

    /** Cache profili */
    this._profileCache = new Map();

    // Init akumulatorów
    for (const [key, def] of Object.entries(this.defs)) {
      if (def.type === 'accumulator') {
        this.accumulators[key] = 0;
      }
    }
  }

  // ─── PUBLIC API ───────────────────────────────

  /**
   * Wygeneruj telemetrię.
   * @param {string} currentState
   * @param {number} deltaMs
   * @returns {Object}
   */
  generate(currentState, deltaMs) {
    const values = {};
    const deltaSec = deltaMs / 1000;
    const timeInStateS = (Date.now() - this.stateEnteredAt) / 1000;

    // Pass 1 — prymitywy + krzywe profilu
    for (const [key, def] of Object.entries(this.defs)) {
      if (def.type === 'computed') continue;

      // 1) Próbuj profil
      const profileValue = this._getProfileValue(key, currentState, timeInStateS, values);

      if (profileValue !== null) {
        // Profil dostarczył wartość — dodaj szum
        const noisy = this._applyNoise(key, profileValue, timeInStateS);
        values[key] = this._clampAndRound(key, def, noisy);
      } else {
        // 2) Fallback — generuj jak dotychczas (definicja YAML)
        values[key] = this._generateValue(key, def, currentState, deltaSec);
      }

      // 3) Runtime override (nadpisuje wszystko)
      const ov = this.overrides[key];
      if (ov?.fixedValue !== undefined) {
        values[key] = ov.fixedValue;
      }
    }

    // Pass 2 — computed
    for (const [key, def] of Object.entries(this.defs)) {
      if (def.type !== 'computed') continue;

      const profileValue = this._getProfileValue(key, currentState, timeInStateS, values);
      if (profileValue !== null) {
        const noisy = this._applyNoise(key, profileValue, timeInStateS);
        values[key] = this._round(noisy, def.precision);
      } else {
        values[key] = this._evaluateFormula(def.formula, values, def.precision);
      }

      const ov = this.overrides[key];
      if (ov?.fixedValue !== undefined) {
        values[key] = ov.fixedValue;
      }
    }

    return values;
  }

  /** Wywołaj gdy urządzenie zmienia stan */
  onStateChange(newState) {
    this.stateEnteredAt = Date.now();
    // Profil się automatycznie dopasuje w generate()
  }

  /** Załaduj i ustaw profil */
  loadProfile(profileNameOrObj) {
    if (typeof profileNameOrObj === 'string') {
      this.activeProfile = this._loadProfileFile(profileNameOrObj);
    } else {
      this.activeProfile = profileNameOrObj;
    }
  }

  clearProfile() {
    this.activeProfile = null;
  }

  /** Runtime override jednego pola */
  setOverride(fieldName, override) {
    // override: { min, max, fixedValue, noiseAmplitude, noiseDrift, … }
    this.overrides[fieldName] = { ...this.overrides[fieldName], ...override };
  }

  clearOverride(fieldName) {
    delete this.overrides[fieldName];
  }

  clearAllOverrides() {
    this.overrides = {};
  }

  /** Pobierz aktualną konfigurację pola (definicja + profil + override) */
  getFieldConfig(fieldName) {
    const def = this.defs[fieldName] || null;
    const profileCurve = this.activeProfile?.curves?.[fieldName] || null;
    const profileNoise = this.activeProfile?.noise?.[fieldName] || null;
    const override = this.overrides[fieldName] || null;
    return { definition: def, profileCurve, profileNoise, override };
  }

  // ─── PROFILE CURVES ──────────────────────────

  _getProfileValue(fieldName, state, timeInStateS, currentValues) {
    if (!this.activeProfile) return null;

    // Sprawdź czy profil pasuje do tego stanu
    const applies = this.activeProfile.appliesTo;
    if (applies?.states && !applies.states.includes(state)) {
      return null;
    }

    const curve = this.activeProfile.curves?.[fieldName];
    if (!curve) return null;

    // Oblicz driver value
    let driverValue;
    const driver = curve.driver;

    if (driver === 'time_in_state_s') {
      driverValue = timeInStateS;

      // Loop support
      if (curve.loop && curve.loopPeriodS) {
        driverValue = driverValue % curve.loopPeriodS;
      }
    } else if (currentValues[driver] !== undefined) {
      driverValue = currentValues[driver];
    } else {
      // Driver jeszcze nie obliczony — skip
      return null;
    }

    return this._interpolate(curve.points, driverValue);
  }

  _interpolate(points, driverValue) {
    if (!points || points.length === 0) return null;

    // Posortuj po "at"
    const sorted = [...points].sort((a, b) => a.at - b.at);

    // Przed pierwszym punktem
    if (driverValue <= sorted[0].at) return sorted[0].value;

    // Za ostatnim punktem
    if (driverValue >= sorted[sorted.length - 1].at) return sorted[sorted.length - 1].value;

    // Znajdź segment
    for (let i = 0; i < sorted.length - 1; i++) {
      const p0 = sorted[i];
      const p1 = sorted[i + 1];

      if (driverValue >= p0.at && driverValue <= p1.at) {
        // Interpolacja liniowa
        const t = (driverValue - p0.at) / (p1.at - p0.at);
        return p0.value + t * (p1.value - p0.value);
      }
    }

    return sorted[sorted.length - 1].value;
  }

  // ─── NOISE ────────────────────────────────────

  _applyNoise(fieldName, value, timeInStateS) {
    const noiseConfig = this._getNoiseConfig(fieldName);
    if (!noiseConfig) return value;

    let noise = 0;

    // Amplitude — losowy szum
    if (noiseConfig.amplitude) {
      noise += (Math.random() * 2 - 1) * noiseConfig.amplitude;
    }

    // Drift — wolna sinusoida
    if (noiseConfig.drift && noiseConfig.driftPeriodS) {
      const phase = (timeInStateS / noiseConfig.driftPeriodS) * Math.PI * 2;
      noise += Math.sin(phase) * noiseConfig.drift;
    }

    // Spike — rzadki, ostry skok
    if (noiseConfig.spikeProbability && Math.random() < noiseConfig.spikeProbability) {
      const spikeAmp = noiseConfig.spikeAmplitude || noiseConfig.amplitude * 3;
      noise += (Math.random() > 0.5 ? 1 : -1) * spikeAmp;
    }

    return value + noise;
  }

  _getNoiseConfig(fieldName) {
    // Override noise ma priorytet
    const ovNoise = this.overrides[fieldName];
    if (ovNoise?.noiseAmplitude !== undefined) {
      return {
        amplitude: ovNoise.noiseAmplitude ?? 0,
        drift: ovNoise.noiseDrift ?? 0,
        driftPeriodS: ovNoise.noiseDriftPeriodS ?? 60,
        spikeProbability: ovNoise.noiseSpikeProbability ?? 0,
        spikeAmplitude: ovNoise.noiseSpikeAmplitude ?? 0,
      };
    }

    // Profil noise
    return this.activeProfile?.noise?.[fieldName] || null;
  }

  // ─── BAZOWY GENERATOR (fallback bez profilu) ──

  _generateValue(key, def, state, deltaSec) {
    switch (def.type) {
      case 'constant': return def.value;
      case 'int':
      case 'float':   return this._generateNumeric(key, def, state);
      case 'accumulator': return this._generateAccumulator(key, def, state, deltaSec);
      default: return 0;
    }
  }

  _generateNumeric(key, def, state) {
    if (def.zeroWhenStates?.includes(state)) return 0;

    const ov = this.overrides[key];
    const max = ov?.max ?? def.max;
    const min = ov?.min ?? def.min;

    if (def.incrementWhenStates?.includes(state)) {
      const [lo, hi] = def.incrementRange || [1, 1];
      const prev = this.accumulators[`_n_${key}`] ?? min;
      const next = Math.min(max, prev + this._rand(lo, hi));
      this.accumulators[`_n_${key}`] = next;
      return this._round(next, def.precision);
    }

    if (def.decrementWhenStates?.includes(state)) {
      const [lo, hi] = def.decrementRange || [1, 1];
      const prev = this.accumulators[`_n_${key}`] ?? max;
      const next = Math.max(min, prev - this._rand(lo, hi));
      this.accumulators[`_n_${key}`] = next;
      return this._round(next, def.precision);
    }

    const val = this._rand(min, max);
    return def.type === 'int' ? Math.round(val) : this._round(val, def.precision);
  }

  _generateAccumulator(key, def, state, deltaSec) {
    if (def.resetOnStates?.includes(state)) {
      this.accumulators[key] = 0;
      return 0;
    }
    if (def.onlyWhenStates && !def.onlyWhenStates.includes(state)) {
      return this._round(this.accumulators[key], def.precision);
    }
    const rate = this.overrides[key]?.ratePerSecond ?? def.ratePerSecond ?? 0;
    this.accumulators[key] += rate * deltaSec;
    return this._round(this.accumulators[key], def.precision);
  }

  _evaluateFormula(formula, values, precision) {
    try {
      let expr = formula;
      const keys = Object.keys(values).sort((a, b) => b.length - a.length);
      for (const k of keys) {
        expr = expr.replaceAll(k, String(values[k]));
      }
      const result = Function(`"use strict"; return (${expr})`)();
      return this._round(isFinite(result) ? result : 0, precision ?? 2);
    } catch {
      return 0;
    }
  }

  // ─── HELPERS ──────────────────────────────────

  _clampAndRound(key, def, value) {
    const ov = this.overrides[key];
    const min = ov?.min ?? def.min;
    const max = ov?.max ?? def.max;
    let clamped = value;
    if (min !== undefined && clamped < min) clamped = min;
    if (max !== undefined && clamped > max) clamped = max;
    return def.type === 'int' ? Math.round(clamped) : this._round(clamped, def.precision);
  }

  _loadProfileFile(name) {
    if (this._profileCache.has(name)) return this._profileCache.get(name);
    const filePath = path.resolve(process.cwd(), 'profiles', `${name}.yaml`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Profile not found: ${filePath}`);
    }
    const profile = yaml.load(fs.readFileSync(filePath, 'utf8'));
    this._profileCache.set(name, profile);
    return profile;
  }

  _rand(min, max) { return min + Math.random() * (max - min); }

  _round(val, precision) {
    if (precision == null) return val;
    const f = 10 ** precision;
    return Math.round(val * f) / f;
  }
}

module.exports = TelemetryGenerator;