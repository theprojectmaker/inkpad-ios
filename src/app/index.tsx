// Library: subjects on the left (chips on narrow screens), notes as a grid or
// list, with search, sort, favourites, and import of PDFs / photos.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Image, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PaperPicker } from '@/components/paper-picker';
import { Button, ConfirmSheet, Icon, IconButton, MenuSheet, PromptSheet, Sheet, useToast } from '@/components/ui';
import { exportNotePdf, sharePdf } from '@/lib/export';
import { fsx } from '@/lib/fsx';
import { useLibrary } from '@/lib/library';
import { FOLDER_COLORS, type NoteMeta, type PaperColor, type PaperStyle, uid } from '@/lib/model';
import { imagePages, loadDoc, notePath, pdfPages } from '@/lib/noteio';
import { paperOf } from '@/lib/paper';
import { type Sort, useSettings, useTheme } from '@/lib/settings';

const NEW_CARD = { id: '__new__', title: '', folderId: null, created: 0, updated: 0, pages: 0, kind: 'paper' } as NoteMeta;

type Filter = { kind: 'all' } | { kind: 'fav' } | { kind: 'recent' } | { kind: 'unfiled' } | { kind: 'folder'; id: string };

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
  const { s, set } = useSettings();
  const lib = useLibrary();
  const { toast, busy } = useToast();

  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<null | 'new' | 'paper' | 'sort' | 'note' | 'move' | 'rename' | 'delete' | 'folder' | 'newFolder' | 'renameFolder' | 'deleteFolder' | 'settings'>(null);
  const [target, setTarget] = useState<NoteMeta | null>(null);
  const [folderTarget, setFolderTarget] = useState<string | null>(null);
  const [paper, setPaper] = useState<{ style: PaperStyle; color: PaperColor }>({ style: 'lined', color: 'white' });

  const wide = width >= 760;
  const sideW = wide ? 250 : 0;
  const folderOf = (id: string | null) => lib.lib.folders.find((f) => f.id === id);
  const currentFolderId = filter.kind === 'folder' ? filter.id : null;

  const notes = useMemo(() => {
    let list = lib.lib.notes.slice();
    if (filter.kind === 'fav') list = list.filter((n) => n.fav);
    else if (filter.kind === 'unfiled') list = list.filter((n) => !n.folderId || !folderOf(n.folderId));
    else if (filter.kind === 'folder') list = list.filter((n) => n.folderId === filter.id);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((n) => n.title.toLowerCase().includes(needle) || (n.text ?? '').toLowerCase().includes(needle) || (n.pdfText ?? '').toLowerCase().includes(needle) || (folderOf(n.folderId)?.name ?? '').toLowerCase().includes(needle));
    if (filter.kind === 'recent') list = list.sort((a, b) => (b.opened ?? b.updated) - (a.opened ?? a.updated)).slice(0, 30);
    else if (s.sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    else if (s.sort === 'created') list.sort((a, b) => b.created - a.created);
    else list.sort((a, b) => b.updated - a.updated);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.lib, filter, q, s.sort]);

  const title = filter.kind === 'all' ? 'All Notes' : filter.kind === 'fav' ? 'Favorites' : filter.kind === 'recent' ? 'Recents' : filter.kind === 'unfiled' ? 'Unfiled' : folderOf(filter.id)?.name ?? 'Subject';

  const open = (id: string) => router.push(`/note/${id}`);

  // ----- create / import -----
  const newBlank = async () => {
    setSheet(null);
    const id = await lib.createNote({ folderId: currentFolderId, kind: 'paper', paper, title: defaultTitle() });
    open(id);
  };

  const importPdf = async () => {
    setSheet(null);
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    await importPdfUri(r.assets[0].uri, r.assets[0].name ?? 'PDF');
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

  // Browser-preview test hook (dev only): import a PDF from a URL without the file dialog.
  if (__DEV__ && Platform.OS === 'web') (globalThis as any).__importPdf = importPdfUri;

  const importPhotos = async () => {
    setSheet(null);
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1, selectionLimit: 30 });
    if (r.canceled || !r.assets?.length) return;
    const id = uid('n');
    busy('Importing photos…');
    try {
      const pages = await imagePages(id, r.assets.map((x) => x.uri));
      await lib.createNote({ id, folderId: currentFolderId, kind: 'image', title: defaultTitle(), pages, paper: { style: 'blank', color: 'white' } });
      busy(null);
      open(id);
    } catch (e) { busy(null); toast("Couldn't import those photos."); }
  };

  const exportNote = async (n: NoteMeta) => {
    const doc = await loadDoc(n.id);
    if (!doc) { toast("Couldn't open that note."); return; }
    busy('Making PDF…');
    try {
      const out = await exportNotePdf(doc, n.title, (k, total) => busy(`Making PDF… page ${k} of ${total}`));
      busy(null);
      await sharePdf(out, n.title);
    } catch (e) { busy(null); toast("Couldn't export: " + String((e as Error)?.message ?? e)); }
  };

  // ----- layout -----
  const contentW = width - sideW;
  const cols = Math.max(2, Math.floor((contentW - 24 + 18) / (165 + 18)));
  const cardW = (contentW - 24 - (cols - 1) * 18) / cols;

  const sideRow = ({ f, label, icon, color, count, onLong }: { f: Filter; label: string; icon?: string; color?: string; count: number; onLong?: () => void }) => {
    const on = JSON.stringify(f) === JSON.stringify(filter);
    return (
      <Pressable key={label + JSON.stringify(f)} onPress={() => setFilter(f)} onLongPress={onLong} delayLongPress={350}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: on ? t.accent + (t.dark ? '33' : '1A') : pressed ? t.chip : 'transparent' })}>
        {color ? <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: color, marginHorizontal: 3 }} /> : <Icon name={icon ?? 'doc'} size={18} color={on ? t.accent : t.sub} />}
        <Text numberOfLines={1} style={{ flex: 1, color: on ? t.accent : t.text, fontSize: 15, fontWeight: on ? '700' : '500' }}>{label}</Text>
        <Text style={{ color: t.faint, fontSize: 13 }}>{count}</Text>
      </Pressable>
    );
  };

  const counts = {
    all: lib.lib.notes.length,
    fav: lib.lib.notes.filter((n) => n.fav).length,
    unfiled: lib.lib.notes.filter((n) => !n.folderId || !folderOf(n.folderId)).length,
  };

  const Side = (
    <View style={{ width: sideW, backgroundColor: t.side, borderRightWidth: 1, borderRightColor: t.line, paddingTop: ins.top + 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 44 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 }}>Inkpad</Text>
        <IconButton name="gearshape" label="Settings" onPress={() => setSheet('settings')} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 10, gap: 2 }}>
        {sideRow({ f: { kind: 'all' }, label: 'All Notes', icon: 'tray', count: counts.all })}
        {sideRow({ f: { kind: 'recent' }, label: 'Recents', icon: 'clock', count: Math.min(30, counts.all) })}
        {sideRow({ f: { kind: 'fav' }, label: 'Favorites', icon: 'star', count: counts.fav })}
        {sideRow({ f: { kind: 'unfiled' }, label: 'Unfiled', icon: 'doc', count: counts.unfiled })}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 4, paddingHorizontal: 10 }}>
          <Text style={{ flex: 1, color: t.faint, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 }}>SUBJECTS</Text>
          <IconButton name="plus" label="New subject" size={16} onPress={() => setSheet('newFolder')} />
        </View>
        {lib.lib.folders.map((f) => (
          sideRow({ f: { kind: 'folder', id: f.id }, label: f.name, color: f.color, count: lib.lib.notes.filter((n) => n.folderId === f.id).length,
            onLong: () => { setFolderTarget(f.id); setSheet('folder'); } })
        ))}
        {!lib.lib.folders.length ? <Text style={{ color: t.faint, fontSize: 13, paddingHorizontal: 10 }}>Tap + to add a subject.</Text> : null}
      </ScrollView>
    </View>
  );

  const card = (n: NoteMeta) => {
    if (n.id === NEW_CARD.id) {
      return (
        <Pressable onPress={newBlank} accessibilityLabel="Quick new note" style={({ pressed }) => ({ width: cardW, opacity: pressed ? 0.7 : 1 })}>
          <View style={{ width: cardW, height: cardW * 1.29, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.faint, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={22} color="#fff" /></View>
            <Text style={{ color: t.sub, fontSize: 14, fontWeight: '600' }}>New note</Text>
          </View>
        </Pressable>
      );
    }
    const f = folderOf(n.folderId);
    const thumb = n.thumb ? fsx.uri(notePath(n.id, n.thumb)) : '';
    const longPress = () => { setTarget(n); setSheet('note'); };
    if (s.view === 'list') {
      return (
        <Pressable onPress={() => open(n.id)} onLongPress={longPress} delayLongPress={350}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: pressed ? t.chip : t.card, marginBottom: 8, borderWidth: 1, borderColor: t.line })}>
          <View style={{ width: 44, height: 56, borderRadius: 5, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: t.line }}>
            {thumb ? <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{n.title}</Text>
            <Text numberOfLines={1} style={{ color: t.faint, fontSize: 13, marginTop: 2 }}>{fmtDate(n.updated)} · {n.pages} page{n.pages === 1 ? '' : 's'}{f ? ` · ${f.name}` : ''}</Text>
          </View>
          {f ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: f.color }} /> : null}
          <IconButton name={n.fav ? 'star.fill' : 'star'} color={n.fav ? '#F5B301' : t.faint} size={18} label="Favorite" onPress={() => lib.updateNote(n.id, { fav: !n.fav })} />
        </Pressable>
      );
    }
    return (
      <Pressable onPress={() => open(n.id)} onLongPress={longPress} delayLongPress={350} style={({ pressed }) => ({ width: cardW, opacity: pressed ? 0.75 : 1 })}>
        <View style={{ width: cardW, height: cardW * 1.29, borderRadius: 10, overflow: 'hidden', backgroundColor: n.kind === 'paper' ? '#fff' : '#fff', borderWidth: 1, borderColor: t.line, shadowColor: '#000', shadowOpacity: t.dark ? 0 : 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}>
          {thumb ? <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: paperOf('white').bg }}><Icon name="doc" size={30} color="#B9BDC6" /></View>
          )}
          {f ? <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: f.color }} /> : null}
          {n.fav ? <View style={{ position: 'absolute', right: 8, top: 8 }}><Icon name="star.fill" size={16} color="#F5B301" /></View> : null}
          {n.audio ? <View style={{ position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: 4 }}><Icon name="mic.fill" size={13} color="#fff" /></View> : null}
        </View>
        <Text numberOfLines={2} style={{ color: t.text, fontSize: 15, fontWeight: '600', marginTop: 8 }}>{n.title}</Text>
        <Text numberOfLines={1} style={{ color: t.faint, fontSize: 12, marginTop: 2 }}>{fmtDate(n.updated)} · {n.pages} pg</Text>
      </Pressable>
    );
  };

  const target2 = target;

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.bg }}>
      {wide ? Side : null}
      <View style={{ flex: 1, paddingTop: ins.top + 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8, height: 50 }}>
          {!wide ? <Text style={{ color: t.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginRight: 4 }}>Inkpad</Text> : null}
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: wide ? 28 : 18, fontWeight: '800', letterSpacing: -0.5 }}>{wide ? title : ''}</Text>
          <IconButton name="arrow.up.arrow.down" label="Sort" onPress={() => setSheet('sort')} />
          <IconButton name={s.view === 'grid' ? 'list.bullet' : 'square.grid.2x2'} label={s.view === 'grid' ? 'List view' : 'Grid view'} onPress={() => set({ view: s.view === 'grid' ? 'list' : 'grid' })} />
          {!wide ? <IconButton name="gearshape" label="Settings" onPress={() => setSheet('settings')} /> : null}
          <Button title="New" icon="plus" kind="primary" onPress={() => setSheet('paper')} />
        </View>

        {!wide ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 6 }}>
            {([{ kind: 'all' }, { kind: 'recent' }, { kind: 'fav' }] as Filter[]).map((f) => {
              const on = JSON.stringify(f) === JSON.stringify(filter);
              const label = f.kind === 'all' ? 'All' : f.kind === 'recent' ? 'Recents' : 'Favorites';
              return <Chip key={f.kind} label={label} on={on} onPress={() => setFilter(f)} />;
            })}
            {lib.lib.folders.map((f) => <Chip key={f.id} label={f.name} color={f.color} on={filter.kind === 'folder' && filter.id === f.id} onPress={() => setFilter({ kind: 'folder', id: f.id })} onLongPress={() => { setFolderTarget(f.id); setSheet('folder'); }} />)}
            <Chip label="+ Subject" on={false} onPress={() => setSheet('newFolder')} />
          </ScrollView>
        ) : null}

        <View style={{ marginHorizontal: 16, marginVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.chip, borderRadius: 11, paddingHorizontal: 10, height: 40 }}>
          <Icon name="magnifyingglass" size={16} color={t.faint} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search titles, typed text, PDF text, subjects" placeholderTextColor={t.faint} style={{ flex: 1, color: t.text, fontSize: 16, height: 40 }} clearButtonMode="while-editing" autoCorrect={false} />
        </View>

        {notes.length ? (
          <FlatList
            key={s.view + cols}
            data={s.view === 'grid' && !q && filter.kind !== 'recent' && filter.kind !== 'fav' ? [NEW_CARD, ...notes] : notes}
            keyExtractor={(n) => n.id}
            numColumns={s.view === 'grid' ? cols : 1}
            columnWrapperStyle={s.view === 'grid' ? { gap: 18 } : undefined}
            contentContainerStyle={{ padding: 12, paddingBottom: 60, gap: s.view === 'grid' ? 22 : 0 }}
            renderItem={({ item }) => card(item)}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 14 }}>
            <Icon name="square.and.pencil" size={44} color={t.faint} />
            <Text style={{ color: t.text, fontSize: 20, fontWeight: '700' }}>{q ? 'No matches' : lib.ready ? 'No notes here yet' : 'Loading…'}</Text>
            {!q ? <Text style={{ color: t.sub, fontSize: 15, textAlign: 'center', maxWidth: 380 }}>Start a blank note, or import a PDF to write on it with Apple Pencil.</Text> : null}
            {!q ? <View style={{ flexDirection: 'row', gap: 10 }}><Button title="Blank note" kind="primary" onPress={() => setSheet('paper')} /><Button title="Import PDF" onPress={importPdf} /></View> : null}
          </View>
        )}
      </View>

      {/* New */}
      <MenuSheet visible={sheet === 'new'} onClose={() => setSheet(null)} title="New" items={[
        { label: 'Blank note…', icon: 'square.and.pencil', onPress: () => setSheet('paper') },
        { label: 'Import PDF from Files', icon: 'doc', onPress: importPdf },
        { label: 'Import photos', icon: 'photo', onPress: importPhotos },
        { label: 'New subject', icon: 'folder.badge.plus', onPress: () => setSheet('newFolder') },
      ]} />
      <Sheet visible={sheet === 'paper'} onClose={() => setSheet(null)} title="New note" width={460}>
        <PaperPicker style={paper.style} color={paper.color} onChange={(style, color) => setPaper({ style, color })} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 }}>
          <Button title="PDF" icon="doc" onPress={importPdf} />
          <Button title="Photos" icon="photo" onPress={importPhotos} />
          <View style={{ flex: 1 }} />
          <Button title="Create" kind="primary" onPress={newBlank} />
        </View>
      </Sheet>

      {/* Sort */}
      <MenuSheet visible={sheet === 'sort'} onClose={() => setSheet(null)} title="Sort by" items={([['updated', 'Date modified'], ['created', 'Date created'], ['title', 'Title']] as [Sort, string][]).map(([k, label]) => ({ label, checked: s.sort === k, onPress: () => set({ sort: k }) }))} />

      {/* Note actions */}
      <MenuSheet visible={sheet === 'note'} onClose={() => setSheet(null)} title={target2?.title} items={target2 ? [
        { label: 'Open', icon: 'doc', onPress: () => open(target2.id) },
        { label: 'Open in split view', icon: 'rectangle.split.2x1', onPress: () => { const other = lib.lib.notes.find((n) => n.id !== target2.id); if (other) router.push({ pathname: '/note/[id]', params: { id: other.id, split: target2.id } }); else open(target2.id); } },
        { label: 'Rename', icon: 'pencil', onPress: () => setSheet('rename') },
        { label: 'Move to subject…', icon: 'folder', onPress: () => setSheet('move') },
        { label: target2.fav ? 'Remove from Favorites' : 'Add to Favorites', icon: target2.fav ? 'star.fill' : 'star', onPress: () => lib.updateNote(target2.id, { fav: !target2.fav }) },
        { label: 'Duplicate', icon: 'doc.on.doc', onPress: async () => { await lib.duplicateNote(target2.id); toast('Duplicated'); } },
        { label: 'Export as PDF', icon: 'square.and.arrow.up', onPress: () => exportNote(target2) },
        { label: 'Delete', icon: 'trash', danger: true, onPress: () => setSheet('delete') },
      ] : []} />
      <PromptSheet visible={sheet === 'rename'} title="Rename note" initial={target2?.title ?? ''} onCancel={() => setSheet(null)}
        onSubmit={(v) => { if (target2 && v.trim()) lib.updateNote(target2.id, { title: v.trim() }); setSheet(null); }} />
      <MenuSheet visible={sheet === 'move'} onClose={() => setSheet(null)} title="Move to" items={[
        { label: 'Unfiled', icon: 'doc', checked: !target2?.folderId, onPress: () => target2 && lib.updateNote(target2.id, { folderId: null }) },
        ...lib.lib.folders.map((f) => ({ label: f.name, icon: 'folder', checked: target2?.folderId === f.id, onPress: () => target2 && lib.updateNote(target2.id, { folderId: f.id }) })),
      ]} />
      <ConfirmSheet visible={sheet === 'delete'} title={`Delete "${target2?.title ?? ''}"?`} message="The note and everything written in it will be removed from this iPad." onCancel={() => setSheet(null)}
        onConfirm={async () => {
          setSheet(null);
          if (!target2) return;
          set({ tabs: s.tabs.filter((x) => x !== target2.id) });
          await lib.removeNote(target2.id);
        }} />

      {/* Subjects */}
      <PromptSheet visible={sheet === 'newFolder'} title="New subject" placeholder="e.g. Biology" confirm="Add" onCancel={() => setSheet(null)}
        onSubmit={(v) => { if (v.trim()) { const id = lib.addFolder(v); setFilter({ kind: 'folder', id }); } setSheet(null); }} />
      <Sheet visible={sheet === 'folder'} onClose={() => setSheet(null)} title={folderOf(folderTarget)?.name} width={380}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          {FOLDER_COLORS.map((c) => (
            <Pressable key={c} onPress={() => folderTarget && lib.updateFolder(folderTarget, { color: c })}
              style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: c, borderWidth: folderOf(folderTarget)?.color === c ? 3 : 0, borderColor: t.text }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Rename" onPress={() => setSheet('renameFolder')} />
          <Button title="Delete" kind="danger" onPress={() => setSheet('deleteFolder')} />
        </View>
      </Sheet>
      <PromptSheet visible={sheet === 'renameFolder'} title="Rename subject" initial={folderOf(folderTarget)?.name ?? ''} onCancel={() => setSheet(null)}
        onSubmit={(v) => { if (folderTarget && v.trim()) lib.updateFolder(folderTarget, { name: v.trim() }); setSheet(null); }} />
      <ConfirmSheet visible={sheet === 'deleteFolder'} title={`Delete subject "${folderOf(folderTarget)?.name ?? ''}"?`} message="Its notes are kept and move to Unfiled." onCancel={() => setSheet(null)}
        onConfirm={() => { if (folderTarget) { lib.removeFolder(folderTarget); if (filter.kind === 'folder' && filter.id === folderTarget) setFilter({ kind: 'all' }); } setSheet(null); }} />

      {/* Settings */}
      <MenuSheet visible={sheet === 'settings'} onClose={() => setSheet(null)} title="Settings" items={[
        { label: 'Appearance: System', checked: s.theme === 'system', onPress: () => set({ theme: 'system' }) },
        { label: 'Appearance: Light', checked: s.theme === 'light', onPress: () => set({ theme: 'light' }) },
        { label: 'Appearance: Dark', checked: s.theme === 'dark', onPress: () => set({ theme: 'dark' }) },
        { label: 'Apple Pencil only (fingers scroll)', icon: 'pencil.tip', checked: s.pencilOnly, onPress: () => set({ pencilOnly: !s.pencilOnly, pencilSeen: true }) },
        { label: 'Pressure sensitivity', icon: 'scribble', checked: s.pressure, onPress: () => set({ pressure: !s.pressure }) },
        { label: 'Hold to snap shapes', icon: 'square.on.square', checked: s.holdToShape, onPress: () => set({ holdToShape: !s.holdToShape }) },
      ]} />
    </View>
  );
}

function Chip({ label, on, onPress, color, onLongPress }: { label: string; on: boolean; onPress: () => void; color?: string; onLongPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: on ? t.accent : t.chip }}>
      {color ? <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: color }} /> : null}
      <Text style={{ color: on ? '#fff' : t.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
