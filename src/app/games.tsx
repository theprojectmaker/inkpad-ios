// Games (unlocked with a code): the Arcade list - search, categories, most
// popular - and each game opens full screen. Games load from Pizza Edition's
// own servers, like the Arcade website, so they need internet.
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Image, Modal, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { Icon, IconButton } from '@/components/ui';
import { type Game, GAMES } from '@/lib/games-data';
import { useSettings, useTheme } from '@/lib/settings';

const ICON = 'https://pizzaedition.com/apnggames/';
const CATS = ['all', 'action', 'racing', 'sports', 'puzzle', 'platformer', 'shooter', '2player', 'clicker', 'horror', 'casual'];

export default function GamesScreen() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { s } = useSettings();
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [playing, setPlaying] = useState<Game | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return GAMES.filter((g) => (cat === 'all' || g[5].includes(cat)) && (!n || g[1].toLowerCase().includes(n)));
  }, [cat, q]);

  if (!s.gamesUnlocked) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Text style={{ color: t.sub, fontSize: 16 }}>Redeem a code in Settings to unlock this.</Text>
        <Pressable onPress={() => router.replace('/redeem')}><Text style={{ color: t.accent, fontSize: 16, fontWeight: '700' }}>Redeem a code</Text></Pressable>
      </View>
    );
  }

  const cols = Math.max(3, Math.floor((Math.min(width, 1400) - 40) / 150));
  const size = (Math.min(width, 1400) - 40 - (cols - 1) * 14) / cols;
  const card = ({ item: g }: { item: Game }) => {
    const pct = g[3] + g[4] ? Math.round((g[3] / (g[3] + g[4])) * 100) : 0;
    return (
      <Pressable onPress={() => setPlaying(g)} style={({ pressed }) => ({ width: size, opacity: pressed ? 0.8 : 1 })} accessibilityLabel={g[1]}>
        <View style={{ width: size, height: size, borderRadius: 18, overflow: 'hidden', backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ position: 'absolute', color: t.faint, fontSize: size * 0.4, fontWeight: '800' }}>{g[1].charAt(0).toUpperCase()}</Text>
          <Image source={{ uri: ICON + g[0] + '.png' }} style={{ width: '100%', height: '100%' }} />
        </View>
        <Text numberOfLines={1} style={{ color: t.text, fontSize: 14, fontWeight: '600', marginTop: 6 }}>{g[1]}</Text>
        <Text style={{ color: t.faint, fontSize: 12 }}>{pct}% liked</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, height: 52, gap: 4 }}>
        <IconButton name="chevron.left" label="Back to notes" onPress={back} />
        <Icon name="gamecontroller" size={20} color={t.accent} />
        <Text style={{ color: t.text, fontSize: 22, fontWeight: '800', marginLeft: 6, marginRight: 14 }}>Games</Text>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 12, borderRadius: 10, backgroundColor: t.chip, marginRight: 10, maxWidth: 420 }}>
          <Icon name="magnifyingglass" size={14} color={t.faint} />
          <TextInput value={q} onChangeText={setQ} placeholder={`Search ${GAMES.length} games`} placeholderTextColor={t.faint} style={{ flex: 1, color: t.text, fontSize: 15, height: 38 }} />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 46 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, alignItems: 'center' }}>
        {CATS.map((c) => (
          <Pressable key={c} onPress={() => setCat(c)} style={{ paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: cat === c ? t.text : t.chip }}>
            <Text style={{ color: cat === c ? t.bg : t.text, fontSize: 14, fontWeight: '600', textTransform: 'capitalize' }}>{c === '2player' ? '2 players' : c}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList key={cols} data={list} keyExtractor={(g) => g[0]} numColumns={cols} renderItem={card}
        columnWrapperStyle={{ gap: 14 }} contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 60 }}
        ListEmptyComponent={<Text style={{ color: t.sub, textAlign: 'center', marginTop: 60 }}>No games match that.</Text>} />

      <Modal visible={!!playing} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setPlaying(null)}>
        <View style={{ flex: 1, backgroundColor: '#000', paddingTop: ins.top }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 48, backgroundColor: '#111' }}>
            <Pressable onPress={() => setPlaying(null)} accessibilityLabel="Close game" style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2a2a2a' }}>
              <Icon name="xmark" size={14} color="#fff" />
            </Pressable>
            <Text numberOfLines={1} style={{ flex: 1, color: '#fff', fontSize: 16, fontWeight: '700' }}>{playing?.[1]}</Text>
          </View>
          {playing ? (
            <WebView source={{ uri: playing[2] }} style={{ flex: 1, backgroundColor: '#000' }} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
              setSupportMultipleWindows={false} allowsBackForwardNavigationGestures={false} />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
