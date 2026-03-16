  // Auto-load definitions and profiles from YAML files into store
  const yamlLib = require('js-yaml');
  const fsLib = require('fs');
  const pathLib = require('path');

  const defsDir = pathLib.resolve(process.cwd(), 'definitions');
  if (fsLib.existsSync(defsDir)) {
    for (const file of fsLib.readdirSync(defsDir).filter(f => f.endsWith('.yaml'))) {
      try {
        const def = yamlLib.load(fsLib.readFileSync(pathLib.join(defsDir, file), 'utf8'));
        const type = file.replace('.yaml', '');
        store.upsertDefinition(type, def);
        console.log(`  📄 Definition loaded: ${type}`);
      } catch (e) { console.warn(`  ⚠️  Failed to load ${file}:`, e.message); }
    }
  }

  const profilesDir = pathLib.resolve(process.cwd(), 'profiles');
  if (fsLib.existsSync(profilesDir)) {
    for (const file of fsLib.readdirSync(profilesDir).filter(f => f.endsWith('.yaml'))) {
      try {
        const profile = yamlLib.load(fsLib.readFileSync(pathLib.join(profilesDir, file), 'utf8'));
        const name = file.replace('.yaml', '');
        store.upsertProfile(name, profile);
        console.log(`  📈 Profile loaded: ${name}`);
      } catch (e) { console.warn(`  ⚠️  Failed to load ${file}:`, e.message); }
    }
  }