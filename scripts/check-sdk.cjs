// Fails the build if any installed expo-* package belongs to a different Expo
// SDK than `expo` itself. A loose peer range once pulled in SDK 58's prebuilt
// ExpoFont, which crashed the app at launch (dyld "Symbol not found").
const fs = require('fs');
const path = require('path');
const sdk = require('expo/package.json').version.split('.')[0];
const bad = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const n of fs.readdirSync(dir)) {
    if (n.startsWith('.')) continue;
    const p = path.join(dir, n);
    if (n.startsWith('@')) { walk(p); continue; }
    const pj = path.join(p, 'package.json');
    if (!fs.existsSync(pj)) continue;
    const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
    // Only Expo's own modules (published from the expo/expo repo) follow the SDK version.
    const repo = JSON.stringify(j.repository ?? '');
    const expoOwn = /^expo(-|$)/.test(j.name || '') && /github\.com\/expo\/expo/.test(repo);
    if (expoOwn && fs.existsSync(path.join(p, 'expo-module.config.json')) && j.version.split('.')[0] !== sdk) bad.push(`${j.name}@${j.version} (${p})`);
    walk(path.join(p, 'node_modules'));
  }
};
walk('node_modules');
if (bad.length) { console.error(`Expo SDK ${sdk} mismatch:\n  ${bad.join('\n  ')}`); process.exit(1); }
console.log(`All Expo modules match SDK ${sdk}.`);
