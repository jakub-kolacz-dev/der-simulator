      case 'set_profile': {
        const inst = this.devices.get(cmd.deviceId);
        if (inst) {
          inst.setProfile(cmd.profile);
          console.log(`  🎛️  [${cmd.deviceId}] Profile set: ${typeof cmd.profile === 'string' ? cmd.profile : cmd.profile.name}`);
        }
        break;
      }

      case 'clear_profile': {
        const inst = this.devices.get(cmd.deviceId);
        if (inst) {
          inst.clearProfile();
          console.log(`  🎛️  [${cmd.deviceId}] Profile cleared`);
        }
        break;
      }

      case 'set_field_override': {
        const inst = this.devices.get(cmd.deviceId);
        if (inst) {
          inst.setFieldOverride(cmd.fieldName, cmd.override);
          console.log(`  🔧 [${cmd.deviceId}] Override ${cmd.fieldName}:`, cmd.override);
        }
        break;
      }

      case 'clear_field_override': {
        const inst = this.devices.get(cmd.deviceId);
        if (inst) {
          inst.clearFieldOverride(cmd.fieldName);
          console.log(`  🔧 [${cmd.deviceId}] Override cleared: ${cmd.fieldName}`);
        }
        break;
      }

      case 'clear_all_overrides': {
        const inst = this.devices.get(cmd.deviceId);
        if (inst) {
          inst.clearAllOverrides();
          console.log(`  🔧 [${cmd.deviceId}] All overrides cleared`);
        }
        break;
      }