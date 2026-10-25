// Skia on the web needs CanvasKit (WebAssembly) loaded before any Skia code runs.
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(() => {
  require('expo-router/entry');
});
