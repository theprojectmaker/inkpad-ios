// Full-screen Desmos (graphing, scientific, basic, geometry).
import { router } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Desmos } from '@/components/desmos';
import { useTheme } from '@/lib/settings';

export default function CalculatorScreen() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <Desmos onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </View>
  );
}
