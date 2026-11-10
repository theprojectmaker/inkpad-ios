// Quill is an iPad app: every target (the app and the share extension, which expo-share-intent sets
// to iPhone + iPad) is built for iPad only. Runs after every other iOS mod, on the finished project.
const fs = require('fs');
const path = require('path');
const { withFinalizedMod } = require('expo/config-plugins');

module.exports = function withIpadOnly(config) {
  return withFinalizedMod(config, ['ios', async cfg => {
    const root = cfg.modRequest.platformProjectRoot;
    for (const dir of fs.readdirSync(root).filter(d => d.endsWith('.xcodeproj'))) {
      const file = path.join(root, dir, 'project.pbxproj');
      if (!fs.existsSync(file)) continue;
      const before = fs.readFileSync(file, 'utf8');
      const after = before.replace(/TARGETED_DEVICE_FAMILY = [^;]*;/g, 'TARGETED_DEVICE_FAMILY = 2;');
      if (after !== before) fs.writeFileSync(file, after);
    }
    return cfg;
  }]);
};
