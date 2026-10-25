// Expo Go previews (EAS Update links opened in Expo Go) must use Expo Go's
// runtime; real App Store / TestFlight builds use the app version instead.
// Publish an Expo Go preview with:  INKPAD_EXPO_GO=1 npx eas-cli update ...
module.exports = ({ config }) => ({
  ...config,
  runtimeVersion: process.env.INKPAD_EXPO_GO === '1' ? 'exposdk:57.0.0' : { policy: 'appVersion' },
});
