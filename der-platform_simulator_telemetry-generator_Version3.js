const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class TelemetryGenerator {

  constructor(telemetryDefs) {
    this.defs = telemetryDefs;
    this.accumulators = {};
    this.overrides = {};
    this.activeProfile = null;
    this.stateEnteredAt = Date.now();
    this._profileCache = new Map();

    for (const [key, def] of Object.entries(this.defs)) {
      if (def.type === 'accumulator') this.accumulators[key] = 0;
    }
  }

  // ─── PUBLIC ───────────────────────────────────

  generate(currentState, deltaMs) {
    const values = {};
    const deltaSec = deltaMs / 1000;
    const timeInStateS = (Date.now() - this.stateEnteredAt) / 1000;

    for (const [key, def] of Object.entries(this.defs)) {
      if (def.type === 'computed') continue;
      const pv = this._resolveProfileValue(key, currentState, timeInStateS, values);
      if (pv !== null) {
        const noisy = this._applyNoise(key, pv, timeInStateS);
        values[key] = this._clampAndRound(key, def, noisy);
      } else {
        values[key] = this._generateFallback(key, def, currentState, deltaSec);
      }
      if (this.overrides[key]?.fixedValue !== undefined) {
        values[key] = this.overrides[key].fixedValue;
      }
    }

    for (const [key, def] of Object.entries(this.defs)) {
      if (def.type !== 'computed') continue;
      const pv = this._resolveProfileValue(key, currentState, timeInStateS, values);
      if (pv !== null) {
        values[key] = this._round(this._applyNoise(key, pv, timeInStateS), def.precision);
      } else {
        values[key] = this._evalFormula(def.formula, values, def.precision);
      }
      if (this.overrides[key]?.fixedValue !== undefined) {
        values[key] = this.overrides[key].fixedValue;
      }
    }

    return values;
  }

  onStateChange() { this.stateEnteredAt = Date.now(); }

  loadProfile(p) {
    this.activeProfile = typeof p === 'string' ? this._loadProfileFile(p) : p;
  }

  clearProfile() { this.activeProfile = null; }

  setOverride(field, ov) {
    this.overrides[field] = { ...this.overrides[field], ...ov };
  }

  clearOverride(field) { delete this.overrides[field]; }
  clearAllOverrides() { this.overrides = {}; }

  getFieldConfig(field) {
    return {
      definition: this.defs[field] || null,
      profileCurve: this.activeProfile?.curves?.[field] || null,
      profileNoise: this.activeProfile?.noise?.[field] || null,
      override: this.overrides[field] || null,
    };
  }

  // ─── SHAPE RESOLVER ───────────────────────────

  _resolveProfileValue(field, state, timeInStateS, currentValues) {
    if (!this.activeProfile) return null;
    const applies = this.activeProfile.appliesTo;
    if (applies?.states && !applies.states.includes(state)) return null;

    const curve = this.activeProfile.curves?.[field];
    if (!curve) return null;

    let driverValue;
    if (curve.driver === 'time_in_state_s') {
      driverValue = timeInStateS;
    } else if (currentValues[curve.driver] !== undefined) {
      driverValue = currentValues[curve.driver];
    } else {
      return null;
    }

    const shape = curve.shape || 'points';
    const params = curve.params || {};

    switch (shape) {
      case 'points':
        return this._shapePoints(curve.points, driverValue, curve.loop, curve.loopPeriodS);
      case 'constant':
        return params.value ?? 0;
      case 'linear':
        return this._shapeLinear(params, driverValue);
      case 'taper':
        return this._shapeTaper(params, driverValue);
      case 'bell':
        return this._shapeBell(params, driverValue);
      case 'ramp':
        return this._shapeRamp(params, driverValue);
      case 'sine':
        return this._shapeSine(params, driverValue);
      case 'step':
        return this._shapeStep(params, driverValue);
      default:
        return null;
    }
  }

  // ─── SHAPES ───────────────────────────────────

  _shapePoints(points, driver, loop, loopPeriodS) {
    if (!points?.length) return null;
    let d = driver;
    if (loop && loopPeriodS) d = d % loopPeriodS;
    const sorted = [...points].sort((a, b) => a.at - b.at);
    if (d <= sorted[0].at) return sorted[0].value;
    if (d >= sorted[sorted.length - 1].at) return sorted[sorted.length - 1].value;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (d >= sorted[i].at && d <= sorted[i + 1].at) {
        const t = (d - sorted[i].at) / (sorted[i + 1].at - sorted[i].at);
        return sorted[i].value + t * (sorted[i + 1].value - sorted[i].value);
      }
    }
    return sorted[sorted.length - 1].value;
  }

  /**
   * linear: from→to over startAt→endAt
   */
  _shapeLinear(p, d) {
    const startAt = p.startAt ?? 0;
    const endAt = p.endAt ?? 100;
    const from = p.from ?? 0;
    const to = p.to ?? 100;
    if (d <= startAt) return from;
    if (d >= endAt) return to;
    const t = (d - startAt) / (endAt - startAt);
    return from + t * (to - from);
  }

  /**
   * taper: fullValue hold → exponential decay to taperTo
   *        ┌────────┐
   *        │ hold   │╲
   *        │        │  ╲  exponent
   *        │        │    ╲___
   *  ──────┘        └────────
   *        holdUntil  taperEnd
   */
  _shapeTaper(p, d) {
    const full = p.fullValue ?? 100;
    const holdUntil = p.holdUntil ?? 0;
    const taperStart = p.taperStart ?? holdUntil;
    const taperEnd = p.taperEnd ?? 100;
    const taperTo = p.taperTo ?? 0;
    const exp = p.exponent ?? 1;
    const invert = p.invert ?? false;

    if (d <= holdUntil) return full;
    if (d <= taperStart) return full;
    if (d >= taperEnd) return taperTo;

    let t = (d - taperStart) / (taperEnd - taperStart);  // 0→1
    t = Math.pow(t, exp);

    if (invert) {
      // taper "w górę" — od taperTo do fullValue
      return taperTo + t * (full - taperTo);
    }
    return full - t * (full - taperTo);
  }

  /**
   * bell: Gaussian bell curve
   */
  _shapeBell(p, d) {
    const peak = p.peakValue ?? 10;
    const peakAt = p.peakAtS ?? p.peakAt ?? 0;
    const duration = p.durationS ?? p.duration ?? 100;
    const base = p.baseValue ?? 0;

    // sigma tak żeby 99.7% mieściło się w duration
    const sigma = duration / 6;
    const exponent = -0.5 * Math.pow((d - peakAt) / sigma, 2);
    return base + (peak - base) * Math.exp(exponent);
  }

  /**
   * ramp: ramp up → plateau → ramp down → cooldown
   *        ╱‾‾‾‾‾‾‾‾╲
   *       ╱  plateau  ╲
   *  ────╱              ╲────
   *  base  rampUp  rampDown  cooldownTo
   */
  _shapeRamp(p, d) {
    const base = p.baseValue ?? 0;
    const rampUpS = p.rampUpS ?? 60;
    const plateau = p.plateauValue ?? 100;
    const plateauS = p.plateauS ?? 600;
    const rampDownS = p.rampDownS ?? 60;
    const cooldown = p.cooldownTo ?? base;

    if (d < 0) return base;
    if (d <= rampUpS) {
      return base + (d / rampUpS) * (plateau - base);
    }
    if (d <= rampUpS + plateauS) {
      return plateau;
    }
    const downStart = rampUpS + plateauS;
    if (d <= downStart + rampDownS) {
      const t = (d - downStart) / rampDownS;
      return plateau - t * (plateau - cooldown);
    }
    return cooldown;
  }

  /**
   * sine: oscillation around offset
   */
  _shapeSine(p, d) {
    const amp = p.amplitude ?? 10;
    const offset = p.offset ?? 0;
    const period = p.periodS ?? 60;
    const phase = p.phaseS ?? 0;
    return offset + amp * Math.sin(((d - phase) / period) * Math.PI * 2);
  }

  /**
   * step: discrete steps
   */
  _shapeStep(p, d) {
    const steps = p.steps || [];
    if (!steps.length) return 0;
    const sorted = [...steps].sort((a, b) => a.at - b.at);
    let val = sorted[0].value;
    for (const s of sorted) {
      if (d >= s.at) val = s.value;
      else break;
    }
    return val;
  }

  // ─── NOISE ────────────────────────────────────

  _applyNoise(field, value, timeInStateS) {
    const nc = this._getNoiseConfig(field);
    if (!nc) return value;
    let noise = 0;
    if (nc.amplitude) noise += (Math.random() * 2 - 1) * nc.amplitude;
    if (nc.drift && nc.driftPeriodS) {
      noise += Math.sin((timeInStateS / nc.driftPeriodS) * Math.PI * 2) * nc.drift;
    }
    if (nc.spikeProbability && Math.random() < nc.spikeProbability) {
      noise += (Math.random() > 0.5 ? 1 : -1) * (nc.spikeAmplitude || nc.amplitude * 3);
    }
    return value + noise;
  }

  _getNoiseConfig(field) {
    const ov = this.overrides[field];
    if (ov?.noiseAmplitude !== undefined) {
      return {
        amplitude: ov.noiseAmplitude ?? 0,
        drift: ov.noiseDrift ?? 0,
        driftPeriodS: ov.noiseDriftPeriodS ?? 60,
        spikeProbability: ov.noiseSpikeProbability ?? 0,
        spikeAmplitude: ov.noiseSpikeAmplitude ?? 0,
      };
    }
    return this.activeProfile?.noise?.[field] || null;
  }

  // ─── FALLBACK GENERATOR ───────────────────────

  _generateFallback(key, def, state, deltaSec) {
    switch (def.type) {
      case 'constant': return def.value;
      case 'int': case 'float': return this._genNumeric(key, def, state);
      case 'accumulator': return this._genAccum(key, def, state, deltaSec);
      default: return 0;
    }
  }

  _genNumeric(key, def, state) {
    if (def.zeroWhenStates?.includes(state)) return 0;
    const max = this.overrides[key]?.max ?? def.max;
    const min = this.overrides[key]?.min ?? def.min;
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

  _genAccum(key, def, state, deltaSec) {
    if (def.resetOnStates?.includes(state)) { this.accumulators[key] = 0; return 0; }
    if (def.onlyWhenStates && !def.onlyWhenStates.includes(state)) {
      return this._round(this.accumulators[key], def.precision);
    }
    const rate = this.overrides[key]?.ratePerSecond ?? def.ratePerSecond ?? 0;
    this.accumulators[key] += rate * deltaSec;
    return this._round(this.accumulators[key], def.precision);
  }

  _evalFormula(formula, values, precision) {
    try {
      let expr = formula;
      for (const k of Object.keys(values).sort((a, b) => b.length - a.length)) {
        expr = expr.replaceAll(k, String(values[k]));
      }
      const r = Function(`"use strict"; return (${expr})`)();
      return this._round(isFinite(r) ? r : 0, precision ?? 2);
    } catch { return 0; }
  }

  // ─── HELPERS ──────────────────────────────────

  _clampAndRound(key, def, value) {
    const min = this.overrides[key]?.min ?? def.min;
    const max = this.overrides[key]?.max ?? def.max;
    let v = value;
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    return def.type === 'int' ? Math.round(v) : this._round(v, def.precision);
  }

  _loadProfileFile(name) {
    if (this._profileCache.has(name)) return this._profileCache.get(name);
    const fp = path.resolve(process.cwd(), 'profiles', `${name}.yaml`);
    if (!fs.existsSync(fp)) throw new Error(`Profile not found: ${fp}`);
    const p = yaml.load(fs.readFileSync(fp, 'utf8'));
    this._profileCache.set(name, p);
    return p;
  }

  _rand(a, b) { return a + Math.random() * (b - a); }
  _round(v, p) {
    if (p == null) return v;
    const f = 10 ** p;
    return Math.round(v * f) / f;
  }
}

module.exports = TelemetryGenerator;