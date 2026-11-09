// Expo Go previews (EAS Update links opened in Expo Go) must use Expo Go's
// runtime; real App Store / TestFlight builds use the app version instead.
// Publish an Expo Go preview with:  INKPAD_EXPO_GO=1 npx eas-cli update ...
module.exports = ({ config }) => ({
  ...config,
  runtimeVersion: process.env.INKPAD_EXPO_GO === '1' ? 'exposdk:57.0.0' : { policy: 'appVersion' },
  // iCloud sync: needs the iCloud capability (container iCloud.com.solyapps.notes) on the App ID and
  // in the provisioning profile. Builds only ask for it once QUILL_ICLOUD=1 (repo variable), so they
  // keep signing until that's set up.
  ios: process.env.QUILL_ICLOUD === '1' ? {
    ...config.ios,
    entitlements: {
      ...(config.ios?.entitlements ?? {}),
      'com.apple.developer.icloud-container-identifiers': ['iCloud.com.solyapps.notes'],
      'com.apple.developer.ubiquity-container-identifiers': ['iCloud.com.solyapps.notes'],
      'com.apple.developer.icloud-services': ['CloudDocuments'],
    },
  } : config.ios,
});
