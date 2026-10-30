// Library: search, one row of subject chips, and a grid of notes.
// Long-press a note for rename / favourite / move / duplicate / delete.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmSheet, Icon, IconButton, MenuSheet, PromptSheet, useToast } from '@/components/ui';
import { type Assignment, cached, courseColor, dueLabel, keyOf } from '@/lib/classroom';
import { fsx } from '@/lib/fsx';
import { useLibrary } from '@/lib/library';
import { type NoteMeta, type PaperStyle, uid } from '@/lib/model';
import { imagePages, notePath, pdfPages } from '@/lib/noteio';
import { canScan, scanEnhanced, scanToCleanCopy } from '@/lib/scan';
import { useSettings, useTheme } from '@/lib/settings';

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
  const { s } = useSettings();
  const { toast, busy } = useToast();

  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<null | 'new' | 'scan' | 'note' | 'move' | 'rename' | 'delete' | 'newFolder' | 'folder' | 'renameFolder' | 'deleteFolder'>(null);
  const [target, setTarget] = useState<NoteMeta | null>(null);
  const [folderTarget, setFolderTarget] = useState<string | null>(null);

  // What's due next, from the last Classroom refresh (shown above the notes).
  const [due, setDue] = useState<Assignment[]>([]);
  useFocusEffect(useCallback(() => {
    cached().then((d) => setDue((d?.items ?? []).filter((a) => a.status !== 'done' && a.due != null && a.due > Date.now() - 7 * 864e5)
      .sort((a, b) => (a.due ?? 0) - (b.due ?? 0)).slice(0, 6))).catch(() => {});
  }, []));

  const folderOf = (id: string | null) => lib.lib.folders.find((f) => f.id === id);
  const currentFolderId = filter.kind === 'folder' ? filter.id : null;

  // Search text per note, lowercased once (not on every keystroke); includes typed text.
  const hays = useMemo(() => new Map(lib.lib.notes.map((n) => [n.id, `${n.title}
${n.text ?? ''}
${n.pdfText ?? ''}`.toLowerCase()])), [lib.lib.notes]);
  const hay = (n: NoteMeta) => hays.get(n.id) ?? '';
  const notes = useMemo(() => {
    let list = lib.lib.notes.slice();
    if (filter.kind === 'fav') list = list.filter((n) => n.fav);
    else if (filter.kind === 'folder') list = list.filter((n) => n.folderId === filter.id);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((n) => hay(n).includes(needle));
    return list.sort((a, b) => b.updated - a.updated);
  }, [lib.lib, filter, q]);

  const open = (id: string) => router.push(`/note/${id}`);

  const newNote = async (style: PaperStyle) => {
    try {
      const id = await lib.createNote({ folderId: currentFolderId, kind: 'paper', paper: { style, color: 'white', size: 'letter' }, title: defaultTitle() });
      open(id);
    } catch (e) { toast("Couldn't make the note: " + String((e as Error)?.message ?? e)); }
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
    let r;
    try { r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true }); }
    catch (e) { toast("Couldn't open Files: " + String((e as Error)?.message ?? e)); return; }
    if (r.canceled || !r.assets?.[0]) return;
    await importPdfUri(r.assets[0].uri, r.assets[0].name ?? 'PDF');
  };

  // Paper notes or a worksheet -> a clean typed copy you can write on.
  // Paper -> the same pages, cleaned up (whiter paper, crisper ink), ready to write on.
  const scanPaper = async () => {
    const id = uid('n');
    try {
      const uris = await scanEnhanced();
      if (!uris.length) return;
      busy('Adding your pages…');
      const pages = await imagePages(id, uris);
      await lib.createNote({ id, folderId: currentFolderId, kind: 'image', title: `Scan ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`, pages, paper: { style: 'blank', color: 'white' } });
      busy(null);
      open(id);
    } catch (e) { busy(null); await fsx.remove(`inkpad/n/${id}`); toast(String((e as Error)?.message ?? e)); }
  };

  const scanClean = async () => {
    try {
      const r = await scanToCleanCopy((m) => busy(m));
      if (!r) return;
      await importPdfUri(r.pdfUri, r.title);
    } catch (e) {
      busy(null);
      toast(String((e as Error)?.message ?? e));
    }
  };

  const importPhotos = async () => {
    let r;
    try { r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1, selectionLimit: 30 }); }
    catch (e) { toast("Couldn't open Photos: " + String((e as Error)?.message ?? e)); return; }
    if (r.canceled || !r.assets?.length) return;
    const id = uid('n');
    busy('Importing photos…');
    try {
      const pages = await imagePages(id, r.assets.map((x) => x.uri));
      await lib.createNote({ id, folderId: currentFolderId, kind: 'image', title: defaultTitle(), pages, paper: { style: 'blank', color: 'white' } });
      busy(null);
      open(id);
    } catch { busy(null); await fsx.remove(`inkpad/n/${id}`); toast("Couldn't import those photos."); }
  };

  // ----- layout -----
  const wide = width >= 900;
  const sideW = wide ? 240 : 0;
  const mainW = width - sideW;
  const pad = mainW >= 700 ? 28 : 16;
  const gapX = 22;
  const cols = Math.max(2, Math.floor((mainW - pad * 2 + gapX) / (150 + gapX)));
  const cardW = (mainW - pad * 2 - (cols - 1) * gapX) / cols;
  const title = filter.kind === 'all' ? 'All Notes' : filter.kind === 'fav' ? 'Favorites' : folderOf(filter.id)?.name ?? 'Subject';

  const chip = (label: string, on: boolean, onPress: () => void, color?: string, onLongPress?: () => void) => (
    <Pressable key={label + (color ?? '')} onPress={onPress} onLongPress={onLongPress} delayLongPress={350}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 32, paddingHorizontal: 13, borderRadius: 16, backgroundColor: on ? t.accent : t.chip }}>
      {color ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on ? '#fff' : color }} /> : null}
      <Text style={{ color: on ? '#fff' : t.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );

  const sideRow = (label: string, on: boolean, onPress: () => void, opts: { icon?: string; color?: string; count: number; onLongPress?: () => void }) => (
    <Pressable key={label + (opts.color ?? '')} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onLongPress={opts.onLongPress} delayLongPress={350}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 11, height: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: on ? t.accent : pressed ? t.chip : 'transparent' })}>
      {opts.color ? <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: on ? '#fff' : opts.color, marginHorizontal: 3 }} />
        : <Icon name={opts.icon ?? 'doc'} size={18} color={on ? '#fff' : t.sub} />}
      <Text numberOfLines={1} style={{ flex: 1, color: on ? '#fff' : t.text, fontSize: 15, fontWeight: on ? '700' : '500' }}>{label}</Text>
      {opts.count ? <Text style={{ color: on ? '#ffffffcc' : t.faint, fontSize: 13 }}>{opts.count}</Text> : null}
    </Pressable>
  );

  // A sheet of lined paper, to scale (until the note has a real thumbnail).
  const paperMock = () => {
    const k = cardW / 612;
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        {Array.from({ length: Math.floor((792 - 84 - 24) / 28) }, (_, i) => (
          <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: (84 + i * 28) * k, height: StyleSheet.hairlineWidth, backgroundColor: '#C7D3E6' }} />
        ))}
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 72 * k, width: StyleSheet.hairlineWidth, backgroundColor: '#F1A9A9' }} />
      </View>
    );
  };

  const card = ({ item: n }: { item: NoteMeta }) => {
    const thumb = n.thumb ? fsx.uri(notePath(n.id, n.thumb)) : '';
    const f = folderOf(n.folderId);
    const h = cardW * (792 / 612);
    return (
      <Pressable onPress={() => open(n.id)} onLongPress={() => { setTarget(n); setSheet('note'); }} delayLongPress={350}
        style={({ pressed }) => ({ width: cardW, opacity: pressed ? 0.75 : 1 })}>
        <View style={{ width: cardW, height: h, borderRadius: 8, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: t.dark ? 0.35 : 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          <View style={{ flex: 1, borderRadius: 8, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: '#D9DCE1' }}>
            {thumb ? <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              : n.kind === 'pdf' ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFB' }}>
                  <Icon name="doc.richtext" size={28} color="#B8BCC4" />
                </View>
              ) : paperMock()}
          </View>
        </View>
        <Text numberOfLines={1} style={{ marginTop: 9, color: t.text, fontSize: 14, fontWeight: '600', textAlign: 'center' }}>{n.fav ? '★ ' : ''}{n.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 2 }}>
          {f ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: f.color }} /> : null}
          <Text numberOfLines={1} style={{ color: t.faint, fontSize: 12 }}>{fmtDate(n.updated)}{n.pages > 1 ? ` · ${n.pages} pages` : ''}</Text>
        </View>
      </Pressable>
    );
  };

  const target2 = target ? lib.lib.notes.find((n) => n.id === target.id) ?? null : null;
  const count = (fid: string) => lib.lib.notes.filter((n) => n.folderId === fid).length;

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.bg }}>
      {wide ? (
        <View style={{ width: sideW, backgroundColor: t.side, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: t.line, paddingTop: ins.top + 14 }}>
          <Text style={{ color: t.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.6, paddingHorizontal: 20, marginBottom: 12 }}>Quill</Text>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 10, gap: 2, paddingBottom: 30 }}>
            {sideRow('All Notes', filter.kind === 'all', () => setFilter({ kind: 'all' }), { icon: 'tray.full', count: lib.lib.notes.length })}
            {sideRow('Favorites', filter.kind === 'fav', () => setFilter({ kind: 'fav' }), { icon: 'star', count: lib.lib.notes.filter((n) => n.fav).length })}
            {sideRow('Classroom', false, () => router.push('/classroom'), { icon: 'graduationcap', count: due.length })}
            {sideRow('Calculator', false, () => router.push('/calculator'), { icon: 'function', count: 0 })}
            {sideRow('Clock', false, () => router.push('/clock'), { icon: 'clock', count: 0 })}
            {s.gamesUnlocked ? sideRow('Games', false, () => router.push('/games'), { icon: 'gamecontroller', count: 0 }) : null}
            {sideRow('Settings', false, () => router.push('/settings'), { icon: 'gearshape', count: 0 })}
            <Text style={{ color: t.faint, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginTop: 22, marginBottom: 6, paddingHorizontal: 12 }}>SUBJECTS</Text>
            {lib.lib.folders.map((f) => sideRow(f.name, filter.kind === 'folder' && filter.id === f.id, () => setFilter({ kind: 'folder', id: f.id }),
              { color: f.color, count: count(f.id), onLongPress: () => { setFolderTarget(f.id); setSheet('folder'); } }))}
            <Pressable onPress={() => setSheet('newFolder')} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, height: 40, paddingHorizontal: 12 }}>
              <Icon name="plus" size={16} color={t.accent} />
              <Text style={{ color: t.accent, fontSize: 15, fontWeight: '600' }}>New subject</Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : null}

      <View style={{ flex: 1, paddingTop: ins.top }}>
        <View style={{ paddingHorizontal: pad, paddingTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.6 }}>{wide ? title : 'Quill'}</Text>
          {!wide ? <IconButton name="graduationcap" label="Classroom" onPress={() => router.push('/classroom')} /> : null}
          {!wide ? <IconButton name="function" label="Calculator" onPress={() => router.push('/calculator')} /> : null}
          {!wide ? <IconButton name="clock" label="Clock" onPress={() => router.push('/clock')} /> : null}
          {!wide ? <IconButton name="gearshape" label="Settings" onPress={() => router.push('/settings')} /> : null}
          {canScan() ? (
            <Pressable onPress={() => setSheet('scan')} accessibilityLabel="Scan"
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 15, borderRadius: 19, backgroundColor: t.accent + '1A', opacity: pressed ? 0.8 : 1 })}>
              <Icon name="doc.viewfinder" size={16} color={t.accent} />
              <Text style={{ color: t.accent, fontSize: 15, fontWeight: '700' }}>Scan</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setSheet('new')} accessibilityLabel="New"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 15, borderRadius: 19, backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 })}>
            <Icon name="plus" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>New</Text>
          </Pressable>
        </View>
        <View style={{ paddingHorizontal: pad, marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 12, borderRadius: 10, backgroundColor: t.chip }}>
            <Icon name="magnifyingglass" size={15} color={t.faint} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search notes" placeholderTextColor={t.faint} style={{ flex: 1, color: t.text, fontSize: 15, height: 38 }} />
          </View>
        </View>
        {!wide ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 44, marginTop: 8 }} contentContainerStyle={{ paddingHorizontal: pad, gap: 8, alignItems: 'center' }}>
            {chip('All', filter.kind === 'all', () => setFilter({ kind: 'all' }))}
            {chip('Favorites', filter.kind === 'fav', () => setFilter({ kind: 'fav' }))}
            {lib.lib.folders.map((f) => chip(f.name, filter.kind === 'folder' && filter.id === f.id, () => setFilter({ kind: 'folder', id: f.id }), f.color, () => { setFolderTarget(f.id); setSheet('folder'); }))}
            {chip('+ Subject', false, () => setSheet('newFolder'))}
          </ScrollView>
        ) : null}

        {due.length && filter.kind === 'all' && !q ? (
          <View style={{ marginTop: 14 }}>
            <Text style={{ color: t.faint, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, paddingHorizontal: pad, marginBottom: 8 }}>DUE SOON</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: pad, gap: 10 }}>
              {due.map((a) => (
                <Pressable key={keyOf(a)} onPress={() => router.push(`/classroom?a=${encodeURIComponent(keyOf(a))}`)}
                  style={({ pressed }) => ({ width: 220, flexDirection: 'row', borderRadius: 12, overflow: 'hidden', backgroundColor: pressed ? t.chip : t.card, borderWidth: 1, borderColor: t.line })}>
                  <View style={{ width: 5, backgroundColor: courseColor(a.courseId) }} />
                  <View style={{ flex: 1, paddingHorizontal: 11, paddingVertical: 9 }}>
                    <Text numberOfLines={1} style={{ color: t.faint, fontSize: 11, fontWeight: '700' }}>{a.course.toUpperCase()}</Text>
                    <Text numberOfLines={1} style={{ color: t.text, fontSize: 14.5, fontWeight: '600', marginTop: 1 }}>{a.title}</Text>
                    <Text numberOfLines={1} style={{ color: a.status === 'missing' ? t.danger : t.sub, fontSize: 12.5, marginTop: 2 }}>{a.status === 'missing' ? 'Missing' : dueLabel(a.due)}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {notes.length ? (
          <FlatList key={`grid${cols}`} data={notes} keyExtractor={(n) => n.id} numColumns={cols} renderItem={card}
            columnWrapperStyle={{ gap: gapX }} contentContainerStyle={{ padding: pad, paddingTop: 18, paddingBottom: 60, gap: 26 }} />
        ) : !lib.ready ? <View style={{ flex: 1 }} /> : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 40 }}>
            <Text style={{ color: t.sub, fontSize: 17 }}>{q ? 'No notes match.' : 'No notes here yet.'}</Text>
            {!q ? (
              <Pressable onPress={() => newNote('lined')} style={{ height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: t.accent, justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Start a note</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      <MenuSheet visible={sheet === 'scan'} onClose={() => setSheet(null)} title="Scan paper" items={[
        { label: 'Scan and clean it up (AI, works offline)', icon: 'doc.viewfinder', onPress: scanPaper },
        { label: 'Scan and turn it into typed notes (AI)', icon: 'text.viewfinder', onPress: scanClean },
      ]} />
      <MenuSheet visible={sheet === 'new'} onClose={() => setSheet(null)} title="New" items={[
        { label: 'Lined note', icon: 'line.3.horizontal', onPress: () => newNote('lined') },
        { label: 'Blank note', icon: 'square', onPress: () => newNote('blank') },
        { label: 'Grid note', icon: 'grid', onPress: () => newNote('grid') },
        ...(canScan() ? [
          { label: 'Scan paper (AI clean-up)', icon: 'doc.viewfinder', onPress: scanPaper },
          { label: 'Scan & turn into typed notes (AI)', icon: 'text.viewfinder', onPress: scanClean },
        ] : []),
        { label: 'Import a PDF', icon: 'doc.richtext', onPress: importPdf },
        { label: 'Import photos', icon: 'photo', onPress: importPhotos },
      ]} />
      <MenuSheet visible={sheet === 'note'} onClose={() => setSheet(null)} title={target2?.title} items={target2 ? [
        { label: 'Rename', icon: 'pencil', onPress: () => setSheet('rename') },
        { label: target2.fav ? 'Remove from Favorites' : 'Add to Favorites', icon: target2.fav ? 'star.fill' : 'star', onPress: () => lib.updateNote(target2.id, { fav: !target2.fav }) },
        { label: 'Move to subject…', icon: 'folder', onPress: () => setSheet('move') },
        { label: 'Duplicate', icon: 'doc.on.doc', onPress: async () => { try { toast((await lib.duplicateNote(target2.id)) ? 'Duplicated' : "Couldn't duplicate that note."); } catch { toast("Couldn't duplicate that note."); } } },
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
