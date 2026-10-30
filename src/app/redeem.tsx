// Redeem a code. A valid code unlocks an extra (for now: the Games tab).
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconButton } from '@/components/ui';
import { useSettings, useTheme } from '@/lib/settings';

const CODES: Record<string, 'games'> = { soly2027: 'games' };

export default function RedeemScreen() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { set } = useSettings();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const redeem = () => {
    const what = CODES[code.trim().toLowerCase()];
    if (!what) { setErr("That code isn't valid. Check it and try again."); return; }
    set({ gamesUnlocked: true });
    router.replace('/games');
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, height: 52 }}>
        <IconButton name="chevron.left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 80, paddingHorizontal: 30, gap: 14 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.accent + '1A', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="ticket" size={28} color={t.accent} />
        </View>
        <Text style={{ color: t.text, fontSize: 24, fontWeight: '800' }}>Redeem a code</Text>
        <TextInput value={code} onChangeText={(v) => { setCode(v); setErr(''); }} onSubmitEditing={redeem} placeholder="Enter code" placeholderTextColor={t.faint}
          autoCapitalize="none" autoCorrect={false} returnKeyType="done" accessibilityLabel="Code"
          style={{ width: '100%', maxWidth: 360, height: 50, borderRadius: 14, borderWidth: 1, borderColor: err ? t.danger : t.line, backgroundColor: t.card, color: t.text, fontSize: 18, textAlign: 'center', letterSpacing: 1 }} />
        {err ? <Text style={{ color: t.danger, fontSize: 14 }}>{err}</Text> : null}
        <Pressable onPress={redeem} disabled={!code.trim()} style={({ pressed }) => ({ height: 46, paddingHorizontal: 28, borderRadius: 23, justifyContent: 'center', backgroundColor: code.trim() ? t.accent : t.chip, opacity: pressed ? 0.8 : 1 })}>
          <Text style={{ color: code.trim() ? '#fff' : t.faint, fontSize: 16, fontWeight: '700' }}>Redeem</Text>
        </Pressable>
      </View>
    </View>
  );
}
