// Library: subjects on the left, search and New at the top, a grid of notes.
// Long-press a note and let go for rename / favourite / move / duplicate / delete;
// long-press and drag it onto a subject to move it there.
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, type GestureResponderEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Reanimated, { cancelAnimation, Easing, FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PaperSheet } from '@/components/paper-sheet';
import { TodayStrip } from '@/components/today-strip';
import { ConfirmSheet, Icon, IconButton, MenuSheet, PromptSheet, useToast } from '@/components/ui';
import { fsx } from '@/lib/fsx';
import { useLibrary } from '@/lib/library';
import { type NoteMeta, type PageSizeId, type PaperColor, type PaperStyle, uid } from '@/lib/model';
import { imagePages, notePath, pdfPages, scanPages } from '@/lib/noteio';
import { canScan, scanEnhanced, scanToCleanCopy } from '@/lib/scan';
import { importZip } from '@/lib/zipimport';
import { type Sort, useSettings, useTheme } from '@/lib/settings';

type Filter = { kind: 'home' } | { kind: 'all' } | { kind: 'fav' } | { kind: 'trash' } | { kind: 'folder'; id: string };

const fmtDate = (t: number) => {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};

const defaultTitle = () => `Note ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

const zipDone = (r: { made: number; folders: number; skipped: string[]; failed: string[] }) =>
  `Added ${r.made} ${r.made === 1 ? 'note' : 'notes'} in ${r.folders} ${r.folders === 1 ? 'subject' : 'subjects'}.` +
  (r.skipped.length ? ` Skipped ${r.skipped.length} Quill can't open (${r.skipped.slice(0, 3).join(', ')}${r.skipped.length > 3 ? '…' : ''}).` : '') +
  (r.failed.length ? ` ${r.failed.length} couldn't be read.` : '');

const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);
const tap = (f: () => Promise<void>) => { if (Platform.OS !== 'web') f().catch(() => {}); };

/** A thin bar that glides while an import is working. */
function WorkingBar({ on, color, track, still }: { on: boolean; color: string; track: string; still: boolean }) {
  const p = useSharedValue(0);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!on || still) { cancelAnimation(p); p.value = 0; return; }
    p.value = 0;
    p.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => cancelAnimation(p);
  }, [on, still, p]);
  const look = useAnimatedStyle(() => ({ transform: [{ translateX: -w * 0.35 + p.value * w * 1.35 }] }));
  if (!on) return null;
  return (
    <Reanimated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(220)} onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: track }}>
      <Reanimated.View style={[{ width: still ? '100%' : '35%', height: 3, borderRadius: 2, backgroundColor: color, opacity: still ? 0.6 : 1 }, still ? null : look]} />
    </Reanimated.View>
  );
}

type Drag = { n: NoteMeta; ox: number; oy: number; sx: number; sy: number; list: boolean };
type Rect = { x: number; y: number; w: number; h: number };
const NONE = '__none';

export default function LibraryScreen() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const lib = useLibrary();
  const { toast, busy: showBusy } = useToast();
  const { s, set } = useSettings();
  const still = useReducedMotion();
  // The busy overlay plus a gliding bar on Home while an import runs.
  const [working, setWorking] = useState(false);
  const busy = useCallback((m: string | null) => { setWorking(!!m); showBusy(m); }, [showBusy]);

  const [filter, setFilter] = useState<Filter>({ kind: 'home' });
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<null | 'home' | 'new' | 'scan' | 'note' | 'move' | 'rename' | 'delete' | 'newFolder' | 'folder' | 'renameFolder' | 'deleteFolder' | 'paper' | 'sort' | 'trashNote' | 'purge' | 'purgeAll'>(null);
  const [target, setTarget] = useState<NoteMeta | null>(null);
  const [folderTarget, setFolderTarget] = useState<string | null>(null);

  const folderOf = (id: string | null) => lib.lib.folders.find((f) => f.id === id);
  const currentFolderId = filter.kind === 'folder' ? filter.id : null;

  // Search text per note, lowercased once (not on every keystroke); includes typed text.
  const hays = useMemo(() => new Map(lib.lib.notes.map((n) => [n.id, `${n.title}
${n.text ?? ''}
${n.pdfText ?? ''}
${n.hand ?? ''}
${n.said ?? ''}`.toLowerCase()])), [lib.lib.notes]);
  const hay = (n: NoteMeta) => hays.get(n.id) ?? '';
  const notes = useMemo(() => {
    let list = filter.kind === 'trash' ? lib.lib.notes.filter((n) => n.trashed) : lib.lib.notes.filter((n) => !n.trashed);
    if (filter.kind === 'fav') list = list.filter((n) => n.fav);
    else if (filter.kind === 'folder') list = list.filter((n) => n.folderId === filter.id);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((n) => hay(n).includes(needle));
    const by: Record<Sort, (a: NoteMeta, b: NoteMeta) => number> = {
      updated: (a, b) => b.updated - a.updated,
      created: (a, b) => b.created - a.created,
      title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }),
    };
    return list.sort(by[s.sort] ?? by.updated);
  }, [lib.lib, filter, q, s.sort]);
  const needle = q.trim().toLowerCase();
  // Where the words were found, when it isn't the title.
  const snippet = (n: NoteMeta) => {
    if (!needle || n.title.toLowerCase().includes(needle)) return '';
    const h = hay(n);
    const at = h.indexOf(needle);
    return at < 0 ? '' : h.slice(Math.max(0, at - 16), at + needle.length + 28).replace(/\s+/g, ' ').trim();
  };

  const open = (id: string, record?: boolean) => router.push(record ? `/note/${id}?record=1` : `/note/${id}`);

  const newNote = async (style: PaperStyle = 'blank', color: PaperColor = 'white', size: PageSizeId = 'letter', record = false) => {
    try {
      const id = await lib.createNote({ folderId: currentFolderId, kind: 'paper', paper: { style, color, size }, title: defaultTitle() });
      open(id, record);
    } catch (e) { toast("Couldn't make the note: " + String((e as Error)?.message ?? e)); }
  };

  const importPdfUri = async (uri: string, name: string, stay = false) => {
    const id = uid('n');
    busy('Importing PDF…');
    try {
      const { pages, text } = await pdfPages(id, uri, (m) => busy(m));
      await lib.createNote({ id, folderId: currentFolderId, kind: 'pdf', title: name.replace(/\.pdf$/i, ''), pages, paper: { style: 'blank', color: 'white' } });
      if (text) lib.updateNote(id, { pdfText: text });
      busy(null);
      if (!stay) open(id);
    } catch (e) {
      busy(null);
      await fsx.remove(`inkpad/n/${id}`);
      if (stay) throw e;
      toast(String((e as Error)?.message ?? e));
    }
  };
  // Automated tests only: PDFs the simulator test put in this folder, compared with the old way in.
  useEffect(() => {
    if (!lib.ready || Platform.OS !== 'ios') return;
    const dir = 'quill-test-import';
    (async () => {
      let log = '';
      const note = async (line: string) => { log += `${line}\n`; await fsx.writeText('quill-test-import.log', log); };
      const files = fsx.list(dir).sort((a, b) => Number(b.endsWith('.jpg')) - Number(a.endsWith('.jpg')));
      await note('files: ' + files.join(', '));
      for (const f of files) {
        const path = `${dir}/${f}`;
        const start = Date.now();
        try {
        if (f.endsWith('.zip')) {
          await note(`${f}: unzipping`);
          const r = await importZip(fsx.uri(path), f, lib, () => {});
          await fsx.remove(path);
          await note(`${f}: ${zipDone(r)} in ${Date.now() - start} ms`);
          continue;
        }
        if (f.endsWith('.jpg')) {
          const id = uid('n');
          await note(`${f}: reading`);
          const pages = await imagePages(id, [fsx.uri(path)]);
          await note(`${f}: saving`);
          await lib.createNote({ id, folderId: null, kind: 'image', title: f.replace(/.jpg$/, ''), pages, paper: { style: 'blank', color: 'white' } });
          await fsx.remove(path);
          await note(`${f}: ok in ${Date.now() - start} ms`);
          continue;
        }
        await importPdfUri(fsx.uri(path), f, true);
        await fsx.remove(path);
        await note(`${f}: ok in ${Date.now() - start} ms`);
        } catch (e) { await note(`${f}: FAILED after ${Date.now() - start} ms: ${String((e as Error)?.message ?? e)}`); }
      }
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.ready]);
  if (__DEV__ && Platform.OS === 'web') (globalThis as any).__importPdf = importPdfUri;

  const importPdf = async () => {
    let r;
    try { r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/zip', 'public.zip-archive'], copyToCacheDirectory: true }); }
    catch (e) { toast("Couldn't open Files: " + String((e as Error)?.message ?? e)); return; }
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    if (/\.zip$/i.test(a.name ?? '') || /zip/i.test(a.mimeType ?? '')) {
      try { toast(zipDone(await importZip(a.uri, a.name ?? 'Imported.zip', lib, busy))); }
      catch (e) { toast(String((e as Error)?.message ?? e)); }
      return;
    }
    await importPdfUri(a.uri, a.name ?? 'PDF');
  };

  // Paper notes or a worksheet -> a clean typed copy you can write on.
  // Paper -> the same pages, cleaned up (whiter paper, crisper ink), ready to write on.
  const scanPaper = async () => {
    const id = uid('n');
    try {
      const scans = await scanEnhanced((m) => busy(m || null));
      if (!scans.length) return;
      busy('Adding your pages…');
      const pages = await scanPages(id, scans);
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
  const sideW = wide ? 250 : 0;
  const mainW = width - sideW;
  const pad = mainW >= 700 ? 32 : 18;
  const gapX = 24;
  const cols = Math.max(2, Math.floor((mainW - pad * 2 + gapX) / (160 + gapX)));
  const cardW = (mainW - pad * 2 - (cols - 1) * gapX) / cols;
  const title = filter.kind === 'all' || filter.kind === 'home' ? 'Notes' : filter.kind === 'fav' ? 'Favorites' : filter.kind === 'trash' ? 'Recently Deleted' : folderOf(filter.id)?.name ?? 'Subject';
  const live = lib.lib.notes.filter((n) => !n.trashed);
  const trashed = lib.lib.notes.filter((n) => n.trashed).length;
  const list = s.view === 'list';
  const showHome = filter.kind === 'home' && !q.trim();
  const recent = useMemo(() => live.slice().sort((a, b) => (b.opened ?? b.updated) - (a.opened ?? a.updated)).slice(0, 6), [lib.lib.notes]);
  const rowW = mainW - (pad - 10) * 2;

  // ----- drag a note onto a subject -----
  // Long-press lifts a copy of the note; moving the finger hands the touch to the
  // screen (which follows it), letting go without moving opens the note's menu.
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const dragRef = useRef<{ d: Drag; moving: boolean; x0: number; y0: number } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const targets = useRef(new Map<string, View | null>());
  const rects = useRef(new Map<string, Rect>());
  const rootRef = useRef<View>(null);
  const rootAt = useRef({ x: 0, y: 0 });
  const ghostSize = useRef({ w: 0, h: 0 });
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gx = useSharedValue(0), gy = useSharedValue(0), gk = useSharedValue(1), go = useSharedValue(0);
  const ghostLook = useAnimatedStyle(() => ({ opacity: go.value, transform: [{ translateX: gx.value }, { translateY: gy.value }, { scale: gk.value }] }));
  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);

  const spring = { damping: 22, stiffness: 260, mass: 0.8 };
  const ease = (ms: number) => ({ duration: still ? 0 : ms, easing: EASE });
  const dropRef = (key: string) => (v: View | null) => { targets.current.set(key, v); };
  const measureTargets = () => {
    rootRef.current?.measureInWindow((x, y) => { rootAt.current = { x, y }; });
    rects.current.clear();
    targets.current.forEach((v, key) => v?.measureInWindow((x, y, w, h) => { if (w && h) rects.current.set(key, { x, y, w, h }); }));
  };
  const hitTest = (px: number, py: number) => {
    let hit: string | null = null;
    rects.current.forEach((r, key) => { if (px >= r.x && px <= r.x + r.w && py >= r.y - 3 && py <= r.y + r.h + 3) hit = key; });
    return hit;
  };
  const finish = (ms: number) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => { setDrag(null); clearTimer.current = null; }, still ? 0 : ms);
  };
  const lift = (n: NoteMeta, e: GestureResponderEvent, isList: boolean) => {
    if (n.trashed) { setTarget(n); setSheet('trashNote'); return; }
    const { pageX, pageY, locationX, locationY } = e.nativeEvent;
    const d: Drag = { n, ox: locationX, oy: locationY, sx: pageX - locationX - rootAt.current.x, sy: pageY - locationY - rootAt.current.y, list: isList };
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    dragRef.current = { d, moving: false, x0: pageX, y0: pageY };
    gx.value = d.sx; gy.value = d.sy; gk.value = 1; go.value = 0;
    gk.value = still ? 1.05 : withSpring(1.05, spring);
    go.value = withTiming(1, ease(140));
    setDrag(d);
    measureTargets();
    tap(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  };
  // Let go without moving: the usual note menu.
  const released = (n: NoteMeta) => {
    const r = dragRef.current;
    if (!r || r.moving || r.d.n.id !== n.id) return;
    dragRef.current = null;
    gk.value = withTiming(1, ease(160)); go.value = withTiming(0, ease(160));
    finish(170);
    setTarget(n); setSheet('note');
  };
  const follow = (px: number, py: number) => {
    const r = dragRef.current;
    if (!r) return;
    gx.value = px - r.d.ox - rootAt.current.x;
    gy.value = py - r.d.oy - rootAt.current.y;
    const hit = hitTest(px, py);
    if (hit !== hoverRef.current) {
      hoverRef.current = hit; setHover(hit);
      if (hit) tap(() => Haptics.selectionAsync());
    }
  };
  const drop = (px: number | null, py: number | null) => {
    const r = dragRef.current;
    dragRef.current = null;
    if (!r) return;
    const key = px != null && py != null ? hitTest(px, py) : null;
    hoverRef.current = null; setHover(null);
    const fid = key === NONE ? null : key;
    if (key && (r.d.n.folderId ?? null) !== fid) {
      // Into the subject: shrink toward it and fade.
      const rc = rects.current.get(key)!;
      const { w, h } = ghostSize.current;
      gx.value = withTiming(rc.x + rc.w / 2 - rootAt.current.x - w / 2, ease(220));
      gy.value = withTiming(rc.y + rc.h / 2 - rootAt.current.y - h / 2, ease(220));
      gk.value = withTiming(0.25, ease(220));
      go.value = withTiming(0, ease(220));
      finish(240);
      const from = folderOf(r.d.n.folderId)?.name;
      lib.updateNote(r.d.n.id, { folderId: fid });
      toast(fid ? `Moved to ${folderOf(fid)?.name ?? 'subject'}` : from ? `Removed from ${from}` : 'Moved');
      tap(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
      return;
    }
    // Anywhere else: back where it came from.
    gx.value = still ? r.d.sx : withSpring(r.d.sx, spring);
    gy.value = still ? r.d.sy : withSpring(r.d.sy, spring);
    gk.value = still ? 1 : withSpring(1, spring);
    go.value = still ? 0 : withDelay(150, withTiming(0, { duration: 150, easing: EASE }));
    finish(310);
  };
  const dragging = !!drag;
  const hoverLook = (key: string) => (hover === key ? { backgroundColor: t.accent + (t.dark ? '40' : '24'), borderColor: t.accent } : null);

  const chip = (label: string, on: boolean, onPress: () => void, color?: string, onLongPress?: () => void, dropKey?: string) => (
    <Pressable key={label + (color ?? '')} ref={dropKey ? dropRef(dropKey) : undefined} onPress={onPress} onLongPress={onLongPress} delayLongPress={350}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: on ? t.text : t.chip }, dropKey ? hoverLook(dropKey) : null]}>
      {color ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} /> : null}
      <Text style={{ color: on && hover !== dropKey ? t.bg : t.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );

  const sideRow = (label: string, on: boolean, onPress: () => void, opts: { icon?: string; color?: string; count?: number; onLongPress?: () => void; drop?: string }) => (
    <Pressable key={label + (opts.color ?? '')} ref={opts.drop ? dropRef(opts.drop) : undefined} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onLongPress={opts.onLongPress} delayLongPress={350}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 42, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: on ? (t.dark ? t.card : '#E6E8ED') : pressed ? t.chip : 'transparent',
      }, opts.drop ? hoverLook(opts.drop) : null]}>
      {opts.color ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: opts.color, marginHorizontal: 4 }} />
        : <Icon name={opts.icon ?? 'doc'} size={18} color={t.text} />}
      <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15.5, fontWeight: on ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );

  // A sheet of lined paper, to scale (until the note has a real thumbnail).
  const paperMock = () => {
    const k = cardW / 612;
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        {Array.from({ length: Math.floor((792 - 84 - 24) / 28) }, (_, i) => (
          <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: (84 + i * 28) * k, height: StyleSheet.hairlineWidth, backgroundColor: '#D5DEEC' }} />
        ))}
      </View>
    );
  };

  const pressNote = (n: NoteMeta) => { if (n.trashed) { setTarget(n); setSheet('trashNote'); } else open(n.id); };
  const row = (n: NoteMeta, ghost = false) => {
    const thumb = n.thumb ? fsx.uri(notePath(n.id, n.thumb)) : '';
    const f = folderOf(n.folderId);
    const found = snippet(n);
    return (
      <Pressable disabled={ghost} onPress={() => pressNote(n)} onLongPress={(e) => lift(n, e, true)} onPressOut={() => released(n)} delayLongPress={350} accessibilityLabel={n.title}
        accessibilityHint={n.trashed ? undefined : 'Touch and hold to drag it onto a subject'}
        style={({ pressed }) => ({ width: ghost ? rowW : undefined, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12,
          backgroundColor: ghost ? t.elev : pressed ? t.chip : 'transparent', opacity: !ghost && drag?.n.id === n.id ? 0.35 : 1 })}>
        <View style={{ width: 46, height: 60, borderRadius: 5, overflow: 'hidden', backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }}>
          {thumb ? <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Icon name="doc" size={18} color="#B8BCC4" />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{n.title}</Text>
          <Text numberOfLines={1} style={{ color: t.faint, fontSize: 13, marginTop: 2 }}>{found ? `…${found}…` : [fmtDate(n.updated), `${n.pages} page${n.pages === 1 ? '' : 's'}`, f?.name].filter(Boolean).join(' · ')}</Text>
        </View>
        {n.audio ? <Icon name="waveform" size={15} color={t.faint} /> : null}
        {n.fav ? <Icon name="star.fill" size={14} color="#F5B400" /> : null}
      </Pressable>
    );
  };

  const card = (n: NoteMeta, ghost = false) => {
    const found = snippet(n);
    const thumb = n.thumb ? fsx.uri(notePath(n.id, n.thumb)) : '';
    const f = folderOf(n.folderId);
    const h = cardW * (792 / 612);
    return (
      <Pressable disabled={ghost} onPress={() => pressNote(n)} onLongPress={(e) => lift(n, e, false)} onPressOut={() => released(n)} delayLongPress={350}
        accessibilityLabel={n.title} accessibilityHint={n.trashed ? undefined : 'Touch and hold to drag it onto a subject'}
        style={({ pressed }) => ({ width: cardW, opacity: !ghost && drag?.n.id === n.id ? 0.35 : pressed && !dragging ? 0.85 : 1 })}>
        <View style={{ width: cardW, borderRadius: 14, backgroundColor: t.card, shadowColor: '#000', shadowOpacity: ghost ? (t.dark ? 0.55 : 0.22) : t.dark ? 0.4 : 0.08, shadowRadius: ghost ? 24 : 12, shadowOffset: { width: 0, height: ghost ? 12 : 3 } }}>
          <View style={{ height: cardW * 0.96, borderTopLeftRadius: 14, borderTopRightRadius: 14, overflow: 'hidden', backgroundColor: '#fff' }}>
            {thumb ? <Image source={{ uri: thumb }} style={{ width: '100%', height: h }} resizeMode="cover" />
              : n.kind === 'pdf' ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFB' }}>
                  <Icon name="doc.richtext" size={28} color="#B8BCC4" />
                </View>
              ) : paperMock()}
          </View>
          {n.fav ? <View style={{ position: 'absolute', top: 8, right: 8 }}><Icon name="star.fill" size={14} color="#F5B400" /></View> : null}
          <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }}>
            <Text numberOfLines={1} style={{ color: t.text, fontSize: 15, fontWeight: '500' }}>{n.title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {f ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: f.color }} /> : null}
              <Text numberOfLines={1} style={{ flex: 1, color: t.sub, fontSize: 13 }}>{found ? `…${found}…` : fmtDate(n.updated)}</Text>
              {n.audio ? <Icon name="waveform" size={13} color={t.faint} /> : null}
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  // Notes come and go (and shift over) gently.
  const cell = (child: ReactNode) => (
    <Reanimated.View entering={still ? undefined : FadeIn.duration(200).easing(EASE)} exiting={still ? undefined : FadeOut.duration(160).easing(EASE)} layout={still ? undefined : LinearTransition.duration(220).easing(EASE)}>{child}</Reanimated.View>
  );

  const target2 = target ? lib.lib.notes.find((n) => n.id === target.id) ?? null : null;
  const count = (fid: string) => live.filter((n) => n.folderId === fid).length;

  return (
    <View ref={rootRef} collapsable={false} style={{ flex: 1, flexDirection: 'row', backgroundColor: t.bg }}
      onLayout={() => rootRef.current?.measureInWindow((x, y) => { rootAt.current = { x, y }; })}
      onMoveShouldSetResponderCapture={(e) => {
        const r = dragRef.current;
        if (!r) return false;
        if (r.moving) return true;
        if (Math.hypot(e.nativeEvent.pageX - r.x0, e.nativeEvent.pageY - r.y0) < 6) return false;
        r.moving = true;
        return true;
      }}
      onResponderTerminationRequest={() => false}
      onResponderMove={(e) => follow(e.nativeEvent.pageX, e.nativeEvent.pageY)}
      onResponderRelease={(e) => drop(e.nativeEvent.pageX, e.nativeEvent.pageY)}
      onResponderTerminate={() => drop(null, null)}>
      {wide ? (
        <View style={{ width: sideW, backgroundColor: t.side, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: t.line, paddingTop: ins.top + 18, paddingBottom: ins.bottom + 10 }}>
          <View style={{ paddingHorizontal: 12, marginBottom: 12 }}>
            <IconButton name="gearshape" label="Settings" onPress={() => router.push('/settings')} style={{ alignSelf: 'flex-start' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, marginTop: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: t.card, borderWidth: 1, borderColor: t.line }}>
              <Icon name="magnifyingglass" size={15} color={t.faint} />
              <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={t.faint} style={{ flex: 1, color: t.text, fontSize: 16, height: 40 }} />
            </View>
          </View>
          <ScrollView style={{ flex: 1 }} scrollEnabled={!dragging} contentContainerStyle={{ paddingHorizontal: 12, gap: 2, paddingBottom: 20 }}>
            {sideRow('Home', filter.kind === 'home', () => setFilter({ kind: 'home' }), { icon: 'house' })}
            {sideRow('Notes', filter.kind === 'all', () => setFilter({ kind: 'all' }), { icon: 'square.and.pencil', count: live.length, drop: NONE })}
            {sideRow('Gallery', false, () => setSheet('paper'), { icon: 'photo.artframe' })}
            {sideRow('Favorites', filter.kind === 'fav', () => setFilter({ kind: 'fav' }), { icon: 'star', count: live.filter((n) => n.fav).length })}
            {sideRow('Study', false, () => router.push('/study'), { icon: 'book' })}
            {sideRow('Classroom', false, () => router.push('/classroom'), { icon: 'graduationcap' })}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 4, paddingLeft: 12 }}>
              <Text style={{ flex: 1, color: t.sub, fontSize: 14, fontWeight: '500' }}>Folders</Text>
              <IconButton name="plus" label="New folder" onPress={() => setSheet('newFolder')} />
            </View>
            {lib.lib.folders.map((f) => sideRow(f.name, filter.kind === 'folder' && filter.id === f.id, () => setFilter({ kind: 'folder', id: f.id }),
              { color: f.color, count: count(f.id), drop: f.id, onLongPress: () => { setFolderTarget(f.id); setSheet('folder'); } }))}
          </ScrollView>
          <View style={{ paddingHorizontal: 12 }}>
            {sideRow('Recently Deleted', filter.kind === 'trash', () => setFilter({ kind: 'trash' }), { icon: 'trash', count: trashed })}
          </View>
        </View>
      ) : null}

      <View style={{ flex: 1, paddingTop: ins.top }}>
        <View style={{ paddingHorizontal: pad, paddingTop: 18, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 }}>{showHome ? '' : wide ? title : 'Quill'}</Text>
          {!wide ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, width: 180, paddingHorizontal: 12, borderRadius: 10, backgroundColor: t.chip }}>
              <Icon name="magnifyingglass" size={14} color={t.faint} />
              <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={t.faint} style={{ flex: 1, color: t.text, fontSize: 15, height: 38 }} />
            </View>
          ) : null}
          {!showHome ? <IconButton name="arrow.up.arrow.down" label="Sort" onPress={() => setSheet('sort')} /> : null}
          {!showHome ? <IconButton name={list ? 'square.grid.2x2' : 'list.bullet'} label={list ? 'Show as grid' : 'Show as list'} onPress={() => set({ view: list ? 'grid' : 'list' })} /> : null}
          {!wide ? <IconButton name="gearshape" label="Settings" onPress={() => router.push('/settings')} /> : null}
          {wide ? <IconButton name="ellipsis.circle" label="More" onPress={() => setSheet('home')} /> : null}
          <Pressable onPress={() => setSheet('new')} accessibilityLabel="New"
            style={({ pressed }) => ({ flexDirection: 'row', gap: 8, height: 40, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3F6AF2', opacity: pressed ? 0.8 : 1 })}>
            <Icon name="plus" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>New</Text>
          </Pressable>
        </View>
        {!wide ? (
          <ScrollView horizontal scrollEnabled={!dragging} showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 48, marginTop: 6 }} contentContainerStyle={{ paddingHorizontal: pad, gap: 8, alignItems: 'center' }}>
            {chip('Home', filter.kind === 'home', () => setFilter({ kind: 'home' }))}
            {chip('Notes', filter.kind === 'all', () => setFilter({ kind: 'all' }), undefined, undefined, NONE)}
            {chip('Favorites', filter.kind === 'fav', () => setFilter({ kind: 'fav' }))}
            {lib.lib.folders.map((f) => chip(f.name, filter.kind === 'folder' && filter.id === f.id, () => setFilter({ kind: 'folder', id: f.id }), f.color, () => { setFolderTarget(f.id); setSheet('folder'); }, f.id))}
            {chip('+ Subject', false, () => setSheet('newFolder'))}
            {chip('Recently Deleted', filter.kind === 'trash', () => setFilter({ kind: 'trash' }))}
          </ScrollView>
        ) : null}
        <View style={{ height: 3, marginHorizontal: pad }}>
          <WorkingBar on={working} color={t.accent} track={t.accent + '22'} still={still} />
        </View>

        <View style={{ flex: 1 }}>
        <Reanimated.View key={JSON.stringify(filter)} entering={still ? undefined : FadeIn.duration(220).easing(EASE)} exiting={still ? undefined : FadeOut.duration(160).easing(EASE)} style={StyleSheet.absoluteFill}>
        {showHome ? (
          <ScrollView scrollEnabled={!dragging} contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: 60 }}>
            <View style={{ alignItems: 'center', marginTop: 8 }}>
              <Icon name="pencil.and.scribble" size={54} color="#3F6AF2" />
              <Text style={{ color: t.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.6, marginTop: 14 }}>{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
            </View>
            <TodayStrip />
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 32 }}>
              {[
                { label: 'Import Flashcards', icon: 'rectangle.on.rectangle', bg: t.card, line: '#C3D3F7', go: () => router.push('/flashcards') },
                { label: 'Record a lecture', icon: 'mic', bg: t.dark ? t.card : '#FFF6E9', line: '#F3D9AE', go: () => newNote('blank', 'white', 'letter', true) },
                { label: 'Import a file', icon: 'square.and.arrow.down', bg: t.dark ? t.card : '#EDF2FE', line: '#C3D3F7', go: importPdf },
                { label: 'Find a template', icon: 'doc.plaintext', bg: t.dark ? t.card : '#F4F5F8', line: t.line, go: () => setSheet('paper') },
              ].map((c) => (
                <Pressable key={c.label} accessibilityLabel={c.label} onPress={c.go} style={({ pressed }) => ({ flex: 1, height: 112, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 8, opacity: pressed ? 0.8 : 1, shadowColor: '#000', shadowOpacity: t.dark ? 0 : 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } })}>
                  <Icon name={c.icon} size={22} color={t.text} />
                  <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ color: t.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4, marginTop: 36, marginBottom: 16 }}>Recent notes</Text>
            {recent.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: gapX, rowGap: 28 }}>{recent.map((n, i) => <Reanimated.View key={n.id} entering={still ? undefined : FadeIn.delay(i * 25).duration(200).easing(EASE)} exiting={still ? undefined : FadeOut.duration(160)} layout={still ? undefined : LinearTransition.duration(220).easing(EASE)}>{card(n)}</Reanimated.View>)}</View>
            ) : <Text style={{ color: t.sub, fontSize: 16 }}>Your notes will show up here.</Text>}
          </ScrollView>
        ) : null}
        {filter.kind === 'trash' && notes.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: pad, marginTop: 4 }}>
            <Text style={{ flex: 1, color: t.sub, fontSize: 14 }}>Notes stay here for 30 days. Tap one to restore it.</Text>
            <Pressable accessibilityLabel="Delete all" onPress={() => setSheet('purgeAll')} hitSlop={8}><Text style={{ color: t.danger, fontSize: 14, fontWeight: '600' }}>Delete all</Text></Pressable>
          </View>
        ) : null}
        {showHome ? null : notes.length ? (
          list ? (
            <FlatList key="list" data={notes} keyExtractor={(n) => n.id} renderItem={({ item }) => cell(row(item))} scrollEnabled={!dragging} contentContainerStyle={{ paddingHorizontal: pad - 10, paddingTop: 10, paddingBottom: 80 }} />
          ) : (
          <FlatList key={`grid${cols}`} data={notes} keyExtractor={(n) => n.id} numColumns={cols} renderItem={({ item }) => cell(card(item))} scrollEnabled={!dragging}
            columnWrapperStyle={{ gap: gapX }} contentContainerStyle={{ padding: pad, paddingTop: 20, paddingBottom: 80, gap: 30 }} />
          )
        ) : !lib.ready ? <View style={{ flex: 1 }} /> : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40, marginTop: -60 }}>
            <Icon name="square.and.pencil" size={40} color={t.faint} />
            <Text style={{ color: t.sub, fontSize: 17 }}>{q ? 'No notes match.' : filter.kind === 'trash' ? 'Nothing here' : 'No notes yet'}</Text>
            {!q && filter.kind !== 'trash' ? (
              <Pressable onPress={() => newNote('lined')} style={({ pressed }) => ({ height: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: t.accent, justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>New note</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        </Reanimated.View>
        </View>
      </View>

      {drag ? (
        <Reanimated.View pointerEvents="none" onLayout={(e) => { ghostSize.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}
          style={[{ position: 'absolute', left: 0, top: 0, zIndex: 50 }, drag.list ? { borderRadius: 12, shadowColor: '#000', shadowOpacity: t.dark ? 0.5 : 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } } : null, ghostLook]}>
          {drag.list ? row(drag.n, true) : card(drag.n, true)}
        </Reanimated.View>
      ) : null}

      <MenuSheet topRight visible={sheet === 'home'} onClose={() => setSheet(null)} items={[
        { group: 1, label: 'Import a PDF or zip', icon: 'square.and.arrow.down', onPress: importPdf },
        { group: 1, label: 'Import photos', icon: 'photo', onPress: importPhotos },
        { group: 1, label: 'Import Flashcards', icon: 'rectangle.on.rectangle', onPress: () => router.push('/flashcards') },
        { group: 2, label: list ? 'Show as grid' : 'Show as list', icon: list ? 'square.grid.2x2' : 'list.bullet', onPress: () => { set({ view: list ? 'grid' : 'list' }); setFilter({ kind: 'all' }); } },
        { group: 2, label: 'Sort notes', icon: 'arrow.up.arrow.down', onPress: () => setSheet('sort') },
        { group: 3, label: 'Settings', icon: 'gearshape', onPress: () => router.push('/settings') },
      ]} />
      <MenuSheet topRight visible={sheet === 'new'} onClose={() => setSheet(null)} items={[
        { label: 'Note', icon: 'square.and.pencil', onPress: () => newNote(s.defaultPaper?.style ?? 'blank', s.defaultPaper?.color ?? 'white', s.defaultPaper?.size ?? 'letter') },
        { label: 'From a template…', icon: 'doc.plaintext', onPress: () => setSheet('paper') },
        ...(canScan() ? [
          { label: 'Scan paper', icon: 'doc.viewfinder', onPress: scanPaper },
          { label: 'Retype a scan with AI (can make mistakes)', icon: 'text.viewfinder', onPress: scanClean },
        ] : []),
        { label: 'Import a PDF or zip', icon: 'doc.richtext', onPress: importPdf },
        { label: 'Import photos', icon: 'photo', onPress: importPhotos },
      ]} />
      <MenuSheet visible={sheet === 'note'} onClose={() => setSheet(null)} title={target2?.title} items={target2 ? [
        { label: 'Rename', icon: 'pencil', onPress: () => setSheet('rename') },
        { label: target2.fav ? 'Remove from Favorites' : 'Add to Favorites', icon: target2.fav ? 'star.fill' : 'star', onPress: () => lib.updateNote(target2.id, { fav: !target2.fav }) },
        { label: 'Move to subject…', icon: 'folder', onPress: () => setSheet('move') },
        { label: 'Duplicate', icon: 'doc.on.doc', onPress: async () => { try { toast((await lib.duplicateNote(target2.id)) ? 'Duplicated' : "Couldn't duplicate that note."); } catch { toast("Couldn't duplicate that note."); } } },
        { label: 'Delete', icon: 'trash', danger: true, onPress: () => setSheet('delete') },
      ] : []} />
      <PaperSheet visible={sheet === 'paper'} title="Templates" confirm="Apply" withSize
        style={s.defaultPaper?.style} color={s.defaultPaper?.color} size={s.defaultPaper?.size} onClose={() => setSheet(null)}
        onDone={(style, color, size) => { setSheet(null); set({ defaultPaper: { style, color, size } }); newNote(style, color, size ?? 'letter'); }} />
      <MenuSheet visible={sheet === 'sort'} onClose={() => setSheet(null)} title="Sort by" items={[
        { label: 'Date edited', icon: 'clock', checked: s.sort === 'updated', onPress: () => set({ sort: 'updated' }) },
        { label: 'Date created', icon: 'calendar', checked: s.sort === 'created', onPress: () => set({ sort: 'created' }) },
        { label: 'Title', icon: 'textformat', checked: s.sort === 'title', onPress: () => set({ sort: 'title' }) },
      ]} />
      <MenuSheet visible={sheet === 'trashNote'} onClose={() => setSheet(null)} title={target2?.title} items={target2 ? [
        { label: 'Restore', icon: 'arrow.uturn.backward', onPress: () => { lib.restoreNote(target2.id); toast('Restored'); } },
        { label: 'Delete now', icon: 'trash', danger: true, onPress: () => setSheet('purge') },
      ] : []} />
      <ConfirmSheet visible={sheet === 'purge'} title={`Delete "${target2?.title ?? ''}" for good?`} message="This can't be undone." onCancel={() => setSheet(null)}
        onConfirm={async () => { setSheet(null); if (target2) await lib.removeNote(target2.id); }} />
      <ConfirmSheet visible={sheet === 'purgeAll'} title="Delete everything here for good?" message="This can't be undone." onCancel={() => setSheet(null)}
        onConfirm={async () => { setSheet(null); for (const n of lib.lib.notes.filter((x) => x.trashed)) await lib.removeNote(n.id); }} />
      <PromptSheet visible={sheet === 'rename'} title="Rename note" initial={target2?.title ?? ''} onCancel={() => setSheet(null)}
        onSubmit={(v) => { if (target2 && v.trim()) lib.updateNote(target2.id, { title: v.trim() }); setSheet(null); }} />
      <MenuSheet visible={sheet === 'move'} onClose={() => setSheet(null)} title="Move to" items={[
        { label: 'No subject', icon: 'doc', checked: !target2?.folderId, onPress: () => target2 && lib.updateNote(target2.id, { folderId: null }) },
        ...lib.lib.folders.map((f) => ({ label: f.name, icon: 'folder', checked: target2?.folderId === f.id, onPress: () => target2 && lib.updateNote(target2.id, { folderId: f.id }) })),
      ]} />
      <ConfirmSheet visible={sheet === 'delete'} title={`Delete "${target2?.title ?? ''}"?`} message="It moves to Recently Deleted for 30 days." onCancel={() => setSheet(null)}
        onConfirm={() => { setSheet(null); if (target2) lib.trashNote(target2.id); }} />

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
