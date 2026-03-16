    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'commands' || msg.type === 'commands_batch') {
          const cmds = msg.commands || [];
          if (this.onCommands && cmds.length > 0) {
            this.onCommands(cmds);
          }
        }

        if (msg.type === 'fleet_commands') {
          if (this.onFleetCommands && msg.commands?.length > 0) {
            this.onFleetCommands(msg.commands);
          }
        }
      } catch { /* ignore */ }
    });