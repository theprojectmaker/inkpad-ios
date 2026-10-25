// Library: search, one row of subject chips, and a grid of notes.
// Long-press a note for rename / favourite / move / duplicate / delete.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Image, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmSheet, Icon, MenuSheet, PromptSheet, useToast } from '@/components/ui';
import { fsx } from '@/lib/fsx';
import { useLibrary } from '@/lib/library';
import { type NoteMeta, type PaperStyle, uid } from '@/lib/model';
import { imagePages, notePath, pdfPages } from '@/lib/noteio';
import { useTheme } from '@/lib/settings';

type Filter = { kind: 'all' } | { kind: 'fav' } | { kind: 'folder'; id: string };

const fmtDate = (t: number) => {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};

const defaultTitle = () => `Note ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

export default function LibraryScreen() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const lib = useLibrary();
  const { toast, busy } = useToast();

  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<null | 'new' | 'note' | 'move' | 'rename' | 'delete' | 'newFolder' | 'folder' | 'renameFolder' | 'deleteFolder'>(null);
  const [target, setTarget] = useState<NoteMeta | null>(null);
  const [folderTarget, setFolderTarget] = useState<string | null>(null);

  const folderOf = (id: string | null) => lib.lib.folders.find((f) => f.id === id);
  const currentFolderId = filter.kind === 'folder' ? filter.id : null;

  const notes = useMemo(() => {
    let list = lib.lib.notes.slice();
    if (filter.kind === 'fav') list = list.filter((n) => n.fav);
    else if (filter.kind === 'folder') list = list.filter((n) => n.folderId === filter.id);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((n) => n.title.toLowerCase().includes(needle) || (n.pdfText ?? '').toLowerCase().includes(needle));
    return list.sort((a, b) => b.updated - a.updated);
  }, [lib.lib, filter, q]);

  const open = (id: string) => router.push(`/note/${id}`);

  const newNote = async (style: PaperStyle) => {
    const id = await lib.createNote({ folderId: currentFolderId, kind: 'paper', paper: { style, color: 'white', size: 'letter' }, title: defaultTitle() });
    open(id);
  };

  const importPdfUri = async (uri: string, name: string) => {
    const id = uid('n');
    busy('Importing PDF…');
    try {
      const { pages, text } = await pdfPages(id, uri, (m) => busy(m));
      await lib.createNote({ id, folderId: currentFolderId, kind: 'pdf', title: name.replace(/\.pdf$/i, ''), pages, paper: { style: 'blank', color: 'white' } });
      if (text) lib.updateNote(id, { pdfText: text });
      busy(null);
      open(id);
    } catch (e) {
      busy(null);
      await fsx.remove(`inkpad/n/${id}`);
      toast(String((e as Error)?.message ?? e));
    }
  };
  if (__DEV__ && Platform.OS === 'web') (globalThis as any).__importPdf = importPdfUri;

  const importPdf = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    await importPdfUri(r.assets[0].uri, r.assets[0].name ?? 'PDF');
  };

  const importPhotos = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1, selectionLimit: 30 });
    if (r.canceled || !r.assets?.length) return;
    const id = uid('n');
    busy('Importing photos…');
    try {
      const pages = await imagePages(id, r.assets.map((x) => x.uri));
      await lib.createNote({ id, folderId: currentFolderId, kind: 'image', title: defaultTitle(), pages, paper: { style: 'blank', color: 'white' } });
      busy(null);
      open(id);
    } catch { busy(null); toast("Couldn't import those photos."); }
  };

  // ----- layout -----
  const pad = width >= 700 ? 32 : 16;
  const gapX = 20;
  const cols = Math.max(2, Math.floor((width - pad * 2 + gapX) / (190 + gapX)));
  const cardW = (width - pad * 2 - (cols - 1) * gapX) / cols;

  const chip = (label: string, on: boolean, onPress: () => void, color?: string, onLongPress?: () => void) => (
    <Pressable key={label + (color ?? '')} onPress={onPress} onLongPress={onLongPress} delayLongPress={350}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: on ? t.text : t.chip }}>
      {color ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} /> : null}
      <Text style={{ color: on ? t.bg : t.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );

  // A sheet of paper (used until the note has a real thumbnail).
  const paperMock = (h: number) => (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      {Array.from({ length: Math.floor(h / 13) - 3 }, (_, i) => (
        <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: 30 + i * 13, height: 1, backgroundColor: '#E3E9F3' }} />
      ))}
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: cardW * 0.14, width: 1, backgroundColor: '#F6C9C9' }} />
    </View>
  );

  const card = ({ item: n }: { item: NoteMeta }) => {
    const thumb = n.thumb ? fsx.uri(notePath(n.id, n.thumb)) : '';
    const f = folderOf(n.folderId);
    const h = cardW * 1.29;
    return (
      <Pressable onPress={() => open(n.id)} onLongPress={() => { setTarget(n); setSheet('note'); }} delayLongPress={350}
        style={({ pressed }) => ({ width: cardW, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
        <View style={{ width: cardW, height: h, borderRadius: 12, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: t.dark ? 0.4 : 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 }}>
          <View style={{ flex: 1, borderRadius: 12, overflow: 'hidden', borderWidth: t.dark ? 0 : 1, borderColor: '#ECEDEF' }}>
            {thumb ? <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              : n.kind === 'pdf' ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFB' }}>
                  <Icon name="doc.richtext" size={30} color="#B8BCC4" />
                  <Text style={{ color: '#9A9EA6', fontSize: 12, marginTop: 6, fontWeight: '600' }}>PDF</Text>
                </View>
              ) : paperMock(h)}
          </View>
          {n.pages > 1 ? (
            <View style={{ position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(20,22,28,0.72)', borderRadius: 9, paddingHorizontal: 7, height: 18, justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{n.pages} pages</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 }}>
          {n.fav ? <Icon name="star.fill" size={12} color="#F5A524" /> : null}
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15, fontWeight: '600' }}>{n.title}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
          {f ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: f.color }} /> : null}
          <Text numberOfLines={1} style={{ color: t.faint, fontSize: 12 }}>{f ? f.name + ' · ' : ''}{fmtDate(n.updated)}</Text>
        </View>
      </Pressable>
    );
  };

  const target2 = target ? lib.lib.notes.find((n) => n.id === target.id) ?? null : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ paddingHorizontal: pad, paddingTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.8 }}>Notes</Text>
        <Pressable onPress={() => setSheet('new')} accessibilityLabel="New"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 })}>
          <Icon name="plus" size={17} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>New</Text>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: pad, marginTop: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: t.chip }}>
          <Icon name="magnifyingglass" size={16} color={t.faint} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={t.faint} style={{ flex: 1, color: t.text, fontSize: 16, height: 40 }} />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 42, marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: pad, gap: 8, alignItems: 'center' }}>
        {chip('All', filter.kind === 'all', () => setFilter({ kind: 'all' }))}
        {chip('Favorites', filter.kind === 'fav', () => setFilter({ kind: 'fav' }))}
        {lib.lib.folders.map((f) => chip(f.name, filter.kind === 'folder' && filter.id === f.id, () => setFilter({ kind: 'folder', id: f.id }), f.color, () => { setFolderTarget(f.id); setSheet('folder'); }))}
        {chip('+ Subject', false, () => setSheet('newFolder'))}
      </ScrollView>

      {notes.length ? (
        <FlatList key={cols} data={notes} keyExtractor={(n) => n.id} numColumns={cols} renderItem={card}
          columnWrapperStyle={{ gap: gapX }} contentContainerStyle={{ padding: pad, paddingBottom: 60, gap: 24 }} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 40 }}>
          <Text style={{ color: t.sub, fontSize: 17 }}>{q ? 'No notes match.' : 'No notes yet.'}</Text>
          {!q ? (
            <Pressable onPress={() => newNote('lined')} style={{ height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: t.accent, justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Start a note</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <MenuSheet visible={sheet === 'new'} onClose={() => setSheet(null)} title="New" items={[
        { label: 'Lined note', icon: 'line.3.horizontal', onPress: () => newNote('lined') },
        { label: 'Blank note', icon: 'square', onPress: () => newNote('blank') },
        { label: 'Grid note', icon: 'grid', onPress: () => newNote('grid') },
        { label: 'Import a PDF', icon: 'doc.richtext', onPress: importPdf },
        { label: 'Import photos', icon: 'photo', onPress: importPhotos },
      ]} />
      <MenuSheet visible={sheet === 'note'} onClose={() => setSheet(null)} title={target2?.title} items={target2 ? [
        { label: 'Rename', icon: 'pencil', onPress: () => setSheet('rename') },
        { label: target2.fav ? 'Remove from Favorites' : 'Add to Favorites', icon: target2.fav ? 'star.fill' : 'star', onPress: () => lib.updateNote(target2.id, { fav: !target2.fav }) },
        { label: 'Move to subject…', icon: 'folder', onPress: () => setSheet('move') },
        { label: 'Duplicate', icon: 'doc.on.doc', onPress: async () => { await lib.duplicateNote(target2.id); toast('Duplicated'); } },
        { label: 'Delete', icon: 'trash', danger: true, onPress: () => setSheet('delete') },
      ] : []} />
      <PromptSheet visible={sheet === 'rename'} title="Rename note" initial={target2?.title ?? ''} onCancel={() => setSheet(null)}
        onSubmit={(v) => { if (target2 && v.trim()) lib.updateNote(target2.id, { title: v.trim() }); setSheet(null); }} />
      <MenuSheet visible={sheet === 'move'} onClose={() => setSheet(null)} title="Move to" items={[
        { label: 'No subject', icon: 'doc', checked: !target2?.folderId, onPress: () => target2 && lib.updateNote(target2.id, { folderId: null }) },
        ...lib.lib.folders.map((f) => ({ label: f.name, icon: 'folder', checked: target2?.folderId === f.id, onPress: () => target2 && lib.updateNote(target2.id, { folderId: f.id }) })),
      ]} />
      <ConfirmSheet visible={sheet === 'delete'} title={`Delete "${target2?.title ?? ''}"?`} message="The note and everything written in it will be removed from this iPad." onCancel={() => setSheet(null)}
        onConfirm={async () => { setSheet(null); if (target2) await lib.removeNote(target2.id); }} />

      <PromptSheet visible={sheet === 'newFolder'} title="New subject" placeholder="e.g. Biology" confirm="Add" onCancel={() => setSheet(null)}
        onSubmit={(v) => { if (v.trim()) lib.addFolder(v.trim()); setSheet(null); }} />
      <MenuSheet visible={sheet === 'folder'} onClose={() => setSheet(null)} title={folderOf(folderTarget)?.name} items={[
        { label: 'Rename subject', icon: 'pencil', onPress: () => setSheet('renameFolder') },
        { label: 'Delete subject', icon: 'trash', danger: true, onPress: () => setSheet('deleteFolder') },
      ]} />
      <PromptSheet visible={sheet === 'renameFolder'} title="Rename subject" initial={folderOf(folderTarget)?.name ?? ''} onCancel={() => setSheet(null)}
        onSubmit={(v) => { if (folderTarget && v.trim()) lib.updateFolder(folderTarget, { name: v.trim() }); setSheet(null); }} />
      <ConfirmSheet visible={sheet === 'deleteFolder'} title={`Delete subject "${folderOf(folderTarget)?.name ?? ''}"?`} message="Its notes are kept." onCancel={() => setSheet(null)}
        onConfirm={() => { if (folderTarget) { lib.removeFolder(folderTarget); if (filter.kind === 'folder' && filter.id === folderTarget) setFilter({ kind: 'all' }); } setSheet(null); }} />
    </View>
  );
}
