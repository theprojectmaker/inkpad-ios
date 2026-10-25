// Editor: one clean top bar, a slim tab strip when several notes are open,
// the page (or two side by side), and everything else tucked into sheets.
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addRecordingOnDisk, AudioBar, useNoteAudio } from '@/components/audio-bar';
import { ColorSheet } from '@/components/color-sheet';
import { NoteView, type NoteViewHandle, type NoteViewState, type Tool } from '@/components/note-view';
import { PagePanel } from '@/components/page-panel';
import { PaperPicker } from '@/components/paper-picker';
import { ToolOptions, TopBar } from '@/components/toolbar';
import { ActionRow, ChoiceRow, ConfirmSheet, Guard, Icon, MenuSheet, PromptSheet, SectionTitle, Sheet, ToggleRow, useToast } from '@/components/ui';
import { useLibrary } from '@/lib/library';
import { STICKERS } from '@/lib/model';
import { useSettings, useTheme } from '@/lib/settings';

export default function Editor() {
  const { id, split: splitParam } = useLocalSearchParams<{ id: string; split?: string }>();
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { s, set } = useSettings();
  const lib = useLibrary();
  const { toast } = useToast();

  const [tool, setToolState] = useState<Tool>('pen');
  const [optsOpen, setOptsOpen] = useState(true);
  const [split, setSplit] = useState<string | null>(splitParam ?? null);
  const [activePane, setActivePane] = useState<'a' | 'b'>('a');
  const [pagesOpen, setPagesOpen] = useState(false);
  const [stA, setStA] = useState<NoteViewState | null>(null);
  const [stB, setStB] = useState<NoteViewState | null>(null);
  const apiA = useRef<NoteViewHandle>(null);
  const apiB = useRef<NoteViewHandle>(null);
  const [sheet, setSheet] = useState<null | 'settings' | 'insert' | 'stickers' | 'paper' | 'split' | 'rename' | 'colors'>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  const [delRec, setDelRec] = useState<string | null>(null);
  const audio = useNoteAudio(toast);

  const api = activePane === 'b' && split ? apiB : apiA;
  const st = activePane === 'b' && split ? stB : stA;
  const activeId = activePane === 'b' && split ? split : id;
  const meta = lib.lib.notes.find((n) => n.id === activeId);
  const compact = width < 700;

  // Tapping the current tool again shows/hides its options.
  const setTool = (x: Tool) => {
    if (x === tool) setOptsOpen((v) => !v);
    else { setToolState(x); setOptsOpen(true); }
  };

  useEffect(() => {
    if (!id) return;
    if (!s.tabs.includes(id)) set({ tabs: [...s.tabs.filter((x) => lib.lib.notes.some((n) => n.id === x)), id].slice(-8) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const tabs = useMemo(() => s.tabs.map((x) => lib.lib.notes.find((n) => n.id === x)).filter(Boolean) as typeof lib.lib.notes, [s.tabs, lib.lib.notes]);

  const openTab = async (nid: string) => {
    if (nid === id) return;
    await apiA.current?.flush();
    router.setParams({ id: nid });
    setActivePane('a');
  };
  const closeTab = async (nid: string) => {
    const rest = s.tabs.filter((x) => x !== nid);
    set({ tabs: rest });
    if (nid === id) {
      await apiA.current?.flush();
      const next = rest[rest.length - 1];
      if (next) router.setParams({ id: next }); else goLibrary();
    }
    if (nid === split) setSplit(null);
  };

  const startRec = async () => {
    if (await audio.start(activeId)) { setAudioOpen(true); toast('Recording. Your ink is linked to the audio.'); }
  };
  const stopRec = async () => {
    const r = await audio.stop();
    if (!r) return;
    const pane = r.noteId === id ? apiA : r.noteId === split ? apiB : null;
    if (pane?.current) pane.current.addRecording(r.rec);
    else { const n = await addRecordingOnDisk(r.noteId, r.rec); lib.updateNote(r.noteId, { audio: n }); }
    if (r.noteId === activeId) audio.load(r.noteId, r.rec);
    toast('Recording saved');
  };
  const stopRecRef = useRef(stopRec); stopRecRef.current = stopRec;
  useEffect(() => () => { stopRecRef.current(); }, []);

  const goLibrary = async () => {
    if (audio.rec) await stopRec();
    await apiA.current?.flush();
    await apiB.current?.flush();
    if (router.canGoBack()) router.back(); else router.replace('/');
  };

  const insertPdf = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    await api.current?.insertPdf(r.assets[0].uri);
  };

  const others = lib.lib.notes.filter((n) => n.id !== id).sort((a, b) => b.updated - a.updated);
  const paneW = split ? (width - (pagesOpen ? 144 : 0)) / 2 : undefined;
  const drawing = !!(stA?.drawing || stB?.drawing);
  const seek = (_: string, ms: number) => { audio.seek(ms); if (!audio.status.playing) audio.toggle(); };

  return (
    <View style={{ flex: 1, backgroundColor: t.bar, paddingTop: ins.top }}>
      <TopBar title={meta?.title ?? 'Note'} onBack={goLibrary} onTitle={() => setSheet('rename')} tool={tool} setTool={setTool}
        canUndo={!!st?.canUndo} canRedo={!!st?.canRedo} onUndo={() => api.current?.undo()} onRedo={() => api.current?.redo()}
        onInsert={() => setSheet('insert')} onAudio={() => setAudioOpen((v) => !v)} recording={!!audio.rec} audioOpen={audioOpen}
        onShare={() => api.current?.exportPdf()} onSettings={() => setSheet('settings')} compact={compact} />

      {tabs.length > 1 ? (
        <View style={{ height: 38, borderBottomWidth: 1, borderBottomColor: t.line, backgroundColor: t.bar }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 4, paddingHorizontal: 8 }}>
            {tabs.map((n) => {
              const on = n.id === id;
              return (
                <Pressable key={n.id} onPress={() => openTab(n.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingLeft: 12, paddingRight: 4, borderRadius: 8, maxWidth: 200, backgroundColor: on ? t.chip : 'transparent' }}>
                  <Text numberOfLines={1} style={{ color: on ? t.text : t.sub, fontSize: 13, fontWeight: on ? '700' : '500', flexShrink: 1 }}>{n.title}</Text>
                  <Pressable onPress={() => closeTab(n.id)} hitSlop={8} accessibilityLabel={`Close ${n.title}`} style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="xmark" size={10} color={t.faint} />
                  </Pressable>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <View style={{ flex: 1, flexDirection: 'row' }}>
        {pagesOpen && st?.doc ? <Guard label="The page list"><PagePanel doc={st.doc} current={st.page} api={api} /></Guard> : null}
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: split ? undefined : 1, width: paneW }}>
            <Guard key={'g' + id} label="This note"><NoteView key={id} noteId={id} tool={tool} active={activePane === 'a'} onActivate={() => setActivePane('a')} onState={setStA} onRequestTool={setToolState} handleRef={apiA}
              stamp={audio.stampFor(id)} replay={audioOpen ? audio.replayFor(id) : null} onSeek={seek} onPageBadge={() => setPagesOpen((v) => !v)} /></Guard>
          </View>
          {split ? (
            <>
              <View style={{ width: 1, backgroundColor: t.line }} />
              <View style={{ flex: 1 }}>
                <Guard key={'g' + split} label="This note"><NoteView key={split} noteId={split} tool={tool} active={activePane === 'b'} onActivate={() => setActivePane('b')} onState={setStB} onRequestTool={setToolState} handleRef={apiB}
                  stamp={audio.stampFor(split)} replay={audioOpen ? audio.replayFor(split) : null} onSeek={seek} onPageBadge={() => setPagesOpen((v) => !v)} /></Guard>
                <Pressable onPress={() => setSplit(null)} style={{ position: 'absolute', top: 8, right: 8, backgroundColor: t.elev, borderRadius: 14, paddingHorizontal: 12, height: 28, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: t.line }}>
                  <Text style={{ color: t.sub, fontSize: 12, fontWeight: '600', maxWidth: 160 }} numberOfLines={1}>{lib.meta(split)?.title ?? 'Note'}</Text>
                  <Icon name="xmark" size={10} color={t.faint} />
                </Pressable>
              </View>
            </>
          ) : null}
          {optsOpen && !drawing ? <ToolOptions tool={tool} onColors={() => setSheet('colors')} onPaste={() => api.current?.paste()} /> : null}
          {audioOpen ? <Guard label="Audio"><AudioBar audio={audio} noteId={activeId} doc={st?.doc ?? null} onStartRec={startRec} onStopRec={stopRec} onDelete={(rid) => setDelRec(rid)} /></Guard> : null}
        </View>
      </View>

      <MenuSheet visible={sheet === 'insert'} onClose={() => setSheet(null)} title="Insert" items={[
        { label: 'Photo', icon: 'photo', onPress: () => api.current?.insertImage() },
        { label: 'Sticker', icon: 'face.smiling', onPress: () => setSheet('stickers') },
        { label: 'Blank page', icon: 'doc.badge.plus', onPress: () => api.current?.addPage() },
        { label: 'Pages from a PDF', icon: 'doc', onPress: insertPdf },
        { label: 'Photos as pages', icon: 'photo', onPress: () => api.current?.insertPhotosAsPages() },
      ]} />

      <Sheet visible={sheet === 'settings'} onClose={() => setSheet(null)} width={440}>
        <SectionTitle title="This note" />
        <ActionRow label="Rename" icon="pencil" onPress={() => setSheet('rename')} />
        <ActionRow label="Pages" icon="sidebar.left" onPress={() => { setSheet(null); setPagesOpen((v) => !v); }} />
        <ActionRow label="Paper style" icon="doc" onPress={() => setSheet('paper')} />
        {!compact ? <ActionRow label={split ? 'Close split view' : 'Open another note beside this one'} icon="rectangle.split.2x1" onPress={() => (split ? (setSplit(null), setSheet(null)) : setSheet('split'))} /> : null}
        <ActionRow label={meta?.fav ? 'Remove from Favorites' : 'Add to Favorites'} icon={meta?.fav ? 'star.fill' : 'star'} onPress={() => { if (meta) lib.updateNote(meta.id, { fav: !meta.fav }); setSheet(null); }} />
        <ActionRow label="Export as PDF" icon="square.and.arrow.up" onPress={() => { setSheet(null); api.current?.exportPdf(); }} />
        <SectionTitle title="Writing" />
        <ToggleRow label="Draw with finger" hint="Off: only Apple Pencil writes, fingers scroll and zoom" value={!s.pencilOnly} onChange={(v) => set({ pencilOnly: !v, pencilSeen: true })} />
        <ToggleRow label="Pressure" hint="Lines get thicker the harder you press" value={s.pressure} onChange={(v) => set({ pressure: v })} />
        <ChoiceRow label="Smoothing" value={s.smoothing < 0.25 ? 0.1 : s.smoothing < 0.6 ? 0.4 : 0.75} options={[[0.1, 'Low'], [0.4, 'Medium'], [0.75, 'High']]} onChange={(v) => set({ smoothing: v })} />
        <ToggleRow label="Hold to snap shapes" hint="Pause at the end of a line, circle or box" value={s.holdToShape} onChange={(v) => set({ holdToShape: v })} />
        <ToggleRow label="Straight highlighter" value={s.hlStraight} onChange={(v) => set({ hlStraight: v })} />
        <SectionTitle title="Look" />
        <ChoiceRow label="Appearance" value={s.theme} options={[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => set({ theme: v })} />
        <Text style={{ color: t.faint, fontSize: 12, marginTop: 14 }}>Two-finger tap to undo · three-finger tap to redo</Text>
      </Sheet>

      <Sheet visible={sheet === 'stickers'} onClose={() => setSheet(null)} title="Stickers" width={400}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {STICKERS.map((e) => (
            <Pressable key={e} onPress={() => { setSheet(null); api.current?.insertSticker(e); }} style={({ pressed }) => ({ width: 54, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.chip : t.card })}>
              <Text style={{ fontSize: 30 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet visible={sheet === 'paper'} onClose={() => setSheet(null)} title="Paper" width={480}>
        {st?.doc ? <PaperPicker style={st.doc.paper.style} color={st.doc.paper.color} onChange={(style, color) => api.current?.setPaper({ kind: 'paper', style, color })}
          size={st.doc.paper.size} onSize={(size) => api.current?.setPageSize(size)} /> : null}
        <Text style={{ color: t.faint, fontSize: 13, marginTop: 12 }}>Style and colour change every paper page in this note. The size is used for new pages.</Text>
      </Sheet>

      <Sheet visible={sheet === 'split'} onClose={() => setSheet(null)} title="Open beside this note" width={440}>
        {others.length ? (
          <FlatList data={others} keyExtractor={(n) => n.id} style={{ maxHeight: 420 }} renderItem={({ item }) => (
            <Pressable onPress={() => { setSheet(null); setSplit(item.id); setActivePane('b'); }} style={({ pressed }) => ({ paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, backgroundColor: pressed ? t.chip : 'transparent' })}>
              <Text style={{ color: t.text, fontSize: 16 }} numberOfLines={1}>{item.title}</Text>
              <Text style={{ color: t.faint, fontSize: 12 }}>{item.pages} page{item.pages === 1 ? '' : 's'}</Text>
            </Pressable>
          )} />
        ) : <Text style={{ color: t.sub }}>Make another note first.</Text>}
      </Sheet>

      <ColorSheet visible={sheet === 'colors'} onClose={() => setSheet(null)} target={tool === 'hl' ? 'hl' : 'pen'} />
      <ConfirmSheet visible={!!delRec} title="Delete this recording?" message="The audio is removed. Your ink stays." onCancel={() => setDelRec(null)}
        onConfirm={() => { if (delRec) api.current?.removeRecording(delRec); setDelRec(null); }} />
      <PromptSheet visible={sheet === 'rename'} title="Rename note" initial={meta?.title ?? ''} onCancel={() => setSheet(null)}
        onSubmit={(v) => { if (meta && v.trim()) lib.updateNote(meta.id, { title: v.trim() }); setSheet(null); }} />
    </View>
  );
}
