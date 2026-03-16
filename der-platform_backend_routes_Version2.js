  // ─── FLEET MANAGEMENT (runtime) ──────────────

  /**
   * POST /api/fleet/spawn
   * Body: { type: "evse", count: 10, network: "grid-alpha", idPrefix: "evse" }
   * → tworzy 10 nowych EVSE (symulator je podniesie dynamicznie)
   */
  app.post('/api/fleet/spawn', async (req, reply) => {
    const { type, count, network, idPrefix, startIndex } = req.body || {};
    if (!type || !count) {
      return reply.code(400).send({ error: 'Fields "type" and "count" are required' });
    }

    const cmd = {
      action: 'spawn',
      type,
      count: parseInt(count, 10),
      network: network || 'default',
      idPrefix: idPrefix || type,
      startIndex: startIndex || null,  // null = auto
    };

    // Zapisz jako "fleet command" — symulator ją odbierze
    if (!store._fleetCommands) store._fleetCommands = [];
    store._fleetCommands.push(cmd);

    return reply.code(202).send({
      status: 'accepted',
      message: `Spawn request: ${count} × ${type}`,
      command: cmd,
    });
  });

  /**
   * POST /api/fleet/kill
   * Body: { deviceIds: ["evse-051", "evse-052"] }
   * → wyłącza te urządzenia w symulatorze
   */
  app.post('/api/fleet/kill', async (req, reply) => {
    const { deviceIds } = req.body || {};
    if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
      return reply.code(400).send({ error: 'Field "deviceIds" (array) is required' });
    }

    const cmd = { action: 'kill', deviceIds };
    if (!store._fleetCommands) store._fleetCommands = [];
    store._fleetCommands.push(cmd);

    return reply.code(202).send({
      status: 'accepted',
      message: `Kill request: ${deviceIds.length} devices`,
      command: cmd,
    });
  });

  /**
   * POST /api/fleet/scale
   * Body: { type: "evse", targetCount: 80, network: "grid-alpha", idPrefix: "evse" }
   * → skaluje do 80 EVSE — dodaje brakujące lub usuwa nadmiarowe
   */
  app.post('/api/fleet/scale', async (req, reply) => {
    const { type, targetCount, network, idPrefix } = req.body || {};
    if (!type || targetCount == null) {
      return reply.code(400).send({ error: 'Fields "type" and "targetCount" are required' });
    }

    const cmd = {
      action: 'scale',
      type,
      targetCount: parseInt(targetCount, 10),
      network: network || 'default',
      idPrefix: idPrefix || type,
    };

    if (!store._fleetCommands) store._fleetCommands = [];
    store._fleetCommands.push(cmd);

    return reply.code(202).send({
      status: 'accepted',
      message: `Scale request: ${type} → ${targetCount}`,
      command: cmd,
    });
  });

  /** GET /api/fleet/pending — symulator polluje ten endpoint */
  app.get('/api/fleet/pending', async () => {
    const commands = store._fleetCommands || [];
    store._fleetCommands = [];
    return commands;
  });