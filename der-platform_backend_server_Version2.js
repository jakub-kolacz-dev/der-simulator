            case 'poll_fleet_commands': {
              const fleetCmds = store._fleetCommands || [];
              if (fleetCmds.length > 0) {
                store._fleetCommands = [];
                socket.send(JSON.stringify({
                  type: 'fleet_commands',
                  commands: fleetCmds,
                }));
              }
              break;
            }