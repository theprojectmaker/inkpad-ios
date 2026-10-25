// The share extension needs its own target name (InkpadShare): when it was
// also called "Inkpad", EAS matched both targets by that name and signed the
// main app with the extension's provisioning profile (build 4 failed). This
// runs after every other iOS mod and puts the name people see in the share
// sheet back to "Inkpad".
const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist').default;
const { withFinalizedMod } = require('expo/config-plugins');

module.exports = function withShareDisplayName(config, { target = 'InkpadShare', displayName = 'Inkpad' } = {}) {
  return withFinalizedMod(config, ['ios', async cfg => {
    const file = path.join(cfg.modRequest.platformProjectRoot, target, 'ShareExtension-Info.plist');
    if (fs.existsSync(file)) {
      const info = plist.parse(fs.readFileSync(file, 'utf8'));
      info.CFBundleDisplayName = displayName;
      fs.writeFileSync(file, plist.build(info));
    }
    return cfg;
  }]);
};
