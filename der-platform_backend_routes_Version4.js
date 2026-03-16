  // ═══════════════════════════════════════════════
  // DEFINITIONS & PROFILES REGISTRY
  // (YAML → store → edytowalne z REST)
  // ═══════════════════════════════════════════════

  /**
   * GET /api/registry/definitions
   * → lista wszystkich załadowanych definicji urządzeń
   */
  app.get('/api/registry/definitions', async () => {
    return store.listDefinitions();
  });

  /**
   * GET /api/registry/definitions/:type
   */
  app.get('/api/registry/definitions/:type', async (req, reply) => {
    const def = store.getDefinition(req.params.type);
    if (!def) return reply.code(404).send({ error: `Definition "${req.params.type}" not found` });
    return def;
  });

  /**
   * PUT /api/registry/definitions/:type
   * Body: cała definicja (lub fragment do merge)
   * → nadpisz/zaktualizuj definicję w store (nie zmienia pliku YAML)
   */
  app.put('/api/registry/definitions/:type', async (req, reply) => {
    const type = req.params.type;
    store.upsertDefinition(type, req.body);
    return { status: 'ok', type, message: 'Definition updated in store (restart loads from YAML again)' };
  });

  /**
   * GET /api/registry/profiles
   */
  app.get('/api/registry/profiles', async () => {
    return store.listProfiles();
  });

  /**
   * GET /api/registry/profiles/:name
   */
  app.get('/api/registry/profiles/:name', async (req, reply) => {
    const profile = store.getProfile(req.params.name);
    if (!profile) return reply.code(404).send({ error: `Profile "${req.params.name}" not found` });
    return profile;
  });

  /**
   * PUT /api/registry/profiles/:name
   * Body: pełny profil lub fragment do merge
   * → utwórz/zaktualizuj profil w store
   */
  app.put('/api/registry/profiles/:name', async (req, reply) => {
    const name = req.params.name;
    store.upsertProfile(name, req.body);
    return { status: 'ok', name };
  });

  /**
   * DELETE /api/registry/profiles/:name
   */
  app.delete('/api/registry/profiles/:name', async (req, reply) => {
    store.deleteProfile(req.params.name);
    return { status: 'ok', deleted: req.params.name };
  });

  /**
   * GET /api/registry/shapes
   * → lista dostępnych kształtów krzywych + dokumentacja parametrów
   */
  app.get('/api/registry/shapes', async () => {
    return {
      shapes: [
        {
          name: 'constant',
          description: 'Fixed value',
          params: { value: 'number — the constant value' },
        },
        {
          name: 'linear',
          description: 'Linear interpolation from→to over startAt→endAt',
          params: { from: 'number', to: 'number', startAt: 'number (driver start)', endAt: 'number (driver end)' },
        },
        {
          name: 'taper',
          description: 'Hold at full value then exponential decay (CC/CV profile)',
          params: {
            fullValue: 'number', holdUntil: 'driver value', taperTo: 'number (end value)',
            taperStart: 'driver value', taperEnd: 'driver value', exponent: 'number (1=linear, 2=steep)',
            invert: 'boolean (taper upward instead of downward)',
          },
        },
        {
          name: 'bell',
          description: 'Gaussian bell curve (PV production, temperature peaks)',
          params: { peakValue: 'number', peakAtS: 'driver value at peak', durationS: 'spread width', baseValue: 'number (floor)' },
        },
        {
          name: 'ramp',
          description: 'Ramp up → plateau → ramp down',
          params: { baseValue: 'number', rampUpS: 'seconds', plateauValue: 'number', plateauS: 'seconds', rampDownS: 'seconds', cooldownTo: 'number' },
        },
        {
          name: 'sine',
          description: 'Sinusoidal oscillation (EV driving, grid fluctuations)',
          params: { amplitude: 'number', offset: 'number (center)', periodS: 'seconds', phaseS: 'seconds (shift)' },
        },
        {
          name: 'step',
          description: 'Discrete step changes',
          params: { steps: '[{ at: driver_value, value: number }]' },
        },
        {
          name: 'points',
          description: 'Manual interpolation points (legacy)',
          params: { points: '[{ at: driver_value, value: number }]', loop: 'boolean', loopPeriodS: 'seconds' },
        },
      ],
    };
  });