  // ═══════════════════════════════════════════════
  // TELEMETRY CONFIGURATION (runtime tuning)
  // ═══════════════════════════════════════════════

  /**
   * GET /api/devices/:deviceId/config
   * → zwraca pełną konfigurację telemetrii urządzenia (definicja + profil + overrides)
   */
  app.get('/api/devices/:deviceId/config', async (req, reply) => {
    const { deviceId } = req.params;
    const device = store.getDevice(deviceId);
    if (!device) return reply.code(404).send({ error: 'Device not found' });

    const config = store.getDeviceTelemetryConfig(deviceId);
    return config || { fields: {}, profile: null, overrides: {} };
  });

  /**
   * PUT /api/devices/:deviceId/config/profile
   * Body: { profile: "evse-dc-charging" }  — nazwa pliku YAML (bez rozszerzenia)
   * LUB:  { profile: { name: "custom", curves: {...}, noise: {...} } }  — inline
   */
  app.put('/api/devices/:deviceId/config/profile', async (req, reply) => {
    const { deviceId } = req.params;
    const { profile } = req.body || {};
    if (!profile) return reply.code(400).send({ error: 'Field "profile" is required' });

    store.setDeviceProfile(deviceId, profile);
    return { status: 'ok', deviceId, profile: typeof profile === 'string' ? profile : profile.name };
  });

  /**
   * DELETE /api/devices/:deviceId/config/profile
   * → usuwa aktywny profil, wraca do bazowego generatora YAML
   */
  app.delete('/api/devices/:deviceId/config/profile', async (req, reply) => {
    store.clearDeviceProfile(req.params.deviceId);
    return { status: 'ok', deviceId: req.params.deviceId, profile: null };
  });

  /**
   * PUT /api/devices/:deviceId/config/fields/:fieldName
   * Body: dowolna kombinacja:
   *   { min: 220, max: 235 }                          — zmień zakres
   *   { fixedValue: 230.0 }                            — ustaw sztywną wartość
   *   { noiseAmplitude: 0.5, noiseDrift: 0.2, noiseDriftPeriodS: 30 }  — zmień szum
   *   { ratePerSecond: 0.005 }                         — zmień rate akumulatora
   */
  app.put('/api/devices/:deviceId/config/fields/:fieldName', async (req, reply) => {
    const { deviceId, fieldName } = req.params;
    const override = req.body;
    if (!override || Object.keys(override).length === 0) {
      return reply.code(400).send({ error: 'Body must contain override fields' });
    }

    store.setDeviceFieldOverride(deviceId, fieldName, override);
    return { status: 'ok', deviceId, fieldName, override };
  });

  /**
   * DELETE /api/devices/:deviceId/config/fields/:fieldName
   * → usuwa override, wraca do profilu/definicji
   */
  app.delete('/api/devices/:deviceId/config/fields/:fieldName', async (req, reply) => {
    store.clearDeviceFieldOverride(req.params.deviceId, req.params.fieldName);
    return { status: 'ok', deviceId: req.params.deviceId, fieldName: req.params.fieldName };
  });

  /**
   * DELETE /api/devices/:deviceId/config/fields
   * → usuwa WSZYSTKIE overrides
   */
  app.delete('/api/devices/:deviceId/config/fields', async (req, reply) => {
    store.clearAllDeviceFieldOverrides(req.params.deviceId);
    return { status: 'ok', deviceId: req.params.deviceId };
  });

  /**
   * PUT /api/devices/:deviceId/config/noise
   * Body: { voltage_V: { amplitude: 2, drift: 0.5, ... }, current_A: { ... } }
   * → ustawia noise per-field
   */
  app.put('/api/devices/:deviceId/config/noise', async (req, reply) => {
    const { deviceId } = req.params;
    const noiseConfig = req.body;

    for (const [field, noise] of Object.entries(noiseConfig)) {
      store.setDeviceFieldOverride(deviceId, field, {
        noiseAmplitude: noise.amplitude,
        noiseDrift: noise.drift,
        noiseDriftPeriodS: noise.driftPeriodS,
        noiseSpikeProbability: noise.spikeProbability,
        noiseSpikeAmplitude: noise.spikeAmplitude,
      });
    }

    return { status: 'ok', deviceId, noiseFields: Object.keys(noiseConfig) };
  });

  // ─── BULK TELEMETRY CONFIG ────────────────────

  /**
   * PUT /api/fleet/config/profile
   * Body: { type: "EVSE", profile: "evse-dc-charging" }
   * → ustaw profil dla WSZYSTKICH urządzeń danego typu
   */
  app.put('/api/fleet/config/profile', async (req, reply) => {
    const { type, profile } = req.body || {};
    if (!type || !profile) {
      return reply.code(400).send({ error: 'Fields "type" and "profile" are required' });
    }

    const devices = store.listDevices({ type });
    for (const d of devices) {
      store.setDeviceProfile(d.deviceId, profile);
    }

    return { status: 'ok', type, profile: typeof profile === 'string' ? profile : profile.name, count: devices.length };
  });

  /**
   * PUT /api/fleet/config/fields
   * Body: { type: "EVSE", fieldName: "voltage_V", override: { min: 225, max: 238 } }
   * → override jednego pola dla wszystkich urządzeń danego typu
   */
  app.put('/api/fleet/config/fields', async (req, reply) => {
    const { type, fieldName, override } = req.body || {};
    if (!type || !fieldName || !override) {
      return reply.code(400).send({ error: 'Fields "type", "fieldName", "override" are required' });
    }

    const devices = store.listDevices({ type });
    for (const d of devices) {
      store.setDeviceFieldOverride(d.deviceId, fieldName, override);
    }

    return { status: 'ok', type, fieldName, override, count: devices.length };
  });