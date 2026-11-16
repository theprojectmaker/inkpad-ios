// Files shared to Quill from other apps (Files, Mail, Safari, Photos...). A PDF keeps its pages and
// photos become pages. Before anything is made Quill asks where it should go: a name, a subject, or
// onto the end of a note that's already there. Afterwards it asks whether to open it.
// Mounted once for the whole app.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Reanimated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';

import { fsx } from '@/lib/fsx';
import { useLibrary } from '@/lib/library';
import { type Page, uid } from '@/lib/model';
import { imagePages, loadDoc, pdfPages, saveDoc } from '@/lib/noteio';
import { pdfCover, setShareLibrary, takePendingImports } from '@/lib/ondevice';
import { useTheme } from '@/lib/settings';
import { useIncomingShare } from '@/lib/share';
import { importZip } from '@/lib/zipimport';
import { Icon, useToast } from './ui';

type Shared = { path: string; fileName?: string | null; mimeType: string };
const isPdf = (f: Shared) => /pdf/i.test(f.mimeType) || /\.pdf$/i.test(f.fileName ?? f.path);
const bare = (name: string) => name.replace(/\.[a-z0-9]+$/i, '');

export function ShareReceiver() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useIncomingShare();
  const lib = useLibrary();
  const t = useTheme();
  const { toast, busy } = useToast();
  const working = useRef(false);
  const [files, setFiles] = useState<Shared[] | null>(null);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [into, setInto] = useState<string | null>(null);     // an existing note to add the pages to
  const [existing, setExisting] = useState(false);
  const [pick, setPick] = useState<'last' | 'new' | 'existing'>('new');
  const [folderOpen, setFolderOpen] = useState(false);
  const [cover, setCover] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; title: string; added: number } | null>(null);

  useEffect(() => {
    if (!hasShareIntent || working.current || !lib.ready) return;
    const all = (shareIntent.files ?? []) as Shared[];
    const zips = all.filter((f) => /zip/i.test(f.mimeType) || /\.zip$/i.test(f.fileName ?? f.path));
    const usable = all.filter((f) => !zips.includes(f) && (/^image\//i.test(f.mimeType) || isPdf(f)));
    resetShareIntent();
    if (zips.length) {
      working.current = true;
      (async () => {
        for (const z of zips) {
          try {
            const r = await importZip(z.path, z.fileName ?? 'Shared.zip', lib, busy);
            toast(`Added ${r.made} notes from ${z.fileName ?? 'the zip'}${r.skipped.length ? `, skipped ${r.skipped.length} other files` : ''}.`);
          } catch (e) { toast("Couldn't import that zip: " + String((e as Error)?.message ?? e)); }
        }
        working.current = false;
      })();
      return;
    }
    if (!usable.length) { toast('Share a PDF, photos or a zip to make notes.'); return; }
    const first = usable[0];
    setName(bare(first.fileName ?? (isPdf(first) ? 'Shared PDF' : 'Shared photos')));
    setFolder(null);
    setInto(null);
    setExisting(false);
    setPick('new');
    setFolderOpen(false);
    setCover(null);
    // A small picture of what is coming in: the PDF's first page, or the first photo.
    if (isPdf(first)) {
      const to = fsx.uri('inkpad/out/share-cover.jpg');
      pdfCover(first.path, to, 240).then((ok) => { if (ok) setCover(`${to}?v=${Date.now()}`); }).catch(() => {});
    } else {
      setCover(/^file:|^\//.test(first.path) ? (first.path.startsWith('/') ? 'file://' + first.path : first.path) : first.path);
    }
    setFiles(usable);
  }, [hasShareIntent, shareIntent, resetShareIntent, lib, toast, busy]);

  /** Makes the notes. Used by the pop-up here and for imports asked for from the Share to Quill screen in another app. */
  const importFiles = async (list: Shared[], o: { existing: boolean; into: string | null; name: string; folder: string | null }) => {
    const { existing, into, name, folder } = o;
    let result: { id: string; title: string; added: number } | null = null;
    try {
      const pdfs = list.filter(isPdf);
      const photos = list.filter((f) => !isPdf(f));
      if (existing && into) {
        // Onto the end of a note that's already there.
        const doc = await loadDoc(into);
        if (!doc) throw new Error("That note couldn't be opened.");
        const pages: Page[] = [];
        let text = '';
        for (const f of pdfs) {
          busy(`Importing ${f.fileName ?? 'PDF'}…`);
          const r = await pdfPages(into, f.path, (m) => busy(m));
          pages.push(...r.pages);
          text += r.text ? r.text + '\n' : '';
        }
        if (photos.length) { busy('Importing photos…'); pages.push(...(await imagePages(into, photos.map((p) => p.path)))); }
        const next = { ...doc, pages: [...doc.pages, ...pages] };
        await saveDoc(next);
        const meta = lib.meta(into);
        lib.updateNote(into, { pages: next.pages.length, updated: Date.now(), ...(text ? { pdfText: ((meta?.pdfText ?? '') + '\n' + text).trim() } : {}) });
        result = { id: into, title: meta?.title ?? 'the note', added: pages.length };
      } else {
        const title = name.trim();
        for (const [i, f] of pdfs.entries()) {
          busy(`Importing ${f.fileName ?? 'PDF'}…`);
          const id = uid('n');
          const { pages, text } = await pdfPages(id, f.path, (m) => busy(m));
          const made = (i === 0 && title) || bare(f.fileName ?? 'Shared PDF');
          await lib.createNote({ id, folderId: folder, kind: 'pdf', title: made, pages, paper: { style: 'blank', color: 'white' } });
          if (text) lib.updateNote(id, { pdfText: text });
          result = result ?? { id, title: made, added: pages.length };
        }
        if (photos.length) {
          busy('Importing photos…');
          const id = uid('n');
          const pages = await imagePages(id, photos.map((p) => p.path));
          const made = (!pdfs.length && title) || bare(photos[0].fileName ?? '') || 'Shared photos';
          await lib.createNote({ id, folderId: folder, kind: 'image', title: made, pages, paper: { style: 'blank', color: 'white' } });
          result = result ?? { id, title: made, added: pages.length };
        }
      }
    } catch (e) { toast("Couldn't import that: " + String((e as Error)?.message ?? e)); }
    finally { busy(null); }
    return result;
  };
  const run = async () => {
    const list = files;
    if (!list || working.current) return;
    setFiles(null);
    working.current = true;
    const result = await importFiles(list, { existing, into, name, folder });
    working.current = false;
    if (result) setDone(result);
  };

  // Imports asked for from the Share to Quill screen in another app: done when Quill is next open.
  const checkPending = async () => {
    if (!lib.ready || working.current) return;
    const waiting = takePendingImports();
    if (!waiting.length) return;
    working.current = true;
    let open: string | null = null, made = 0;
    for (const p of waiting) {
      const usable = (p.files ?? []).filter((f) => /^image\//i.test(f.mimeType) || isPdf(f));
      if (!usable.length) continue;
      // The note or folder it named may have gone since: then it becomes a new note with no subject.
      const target = p.mode === 'existing' && p.into && lib.meta(p.into) ? p.into : null;
      const folderOk = p.folderId && lib.lib.folders.some((f) => f.id === p.folderId) ? p.folderId : null;
      const done1 = await importFiles(usable, { existing: !!target, into: target, name: p.title ?? '', folder: folderOk });
      if (done1) { made++; if (p.open) open = done1.id; }
      for (const f of usable) fsx.removeUri(f.path);
    }
    working.current = false;
    if (open) router.push(`/note/${open}`);
    else if (made) toast(made === 1 ? 'The file you shared is now in Quill.' : `${made} things you shared are now in Quill.`);
  };
  const check = useRef(checkPending);
  check.current = checkPending;
  useEffect(() => {
    if (!lib.ready) return;
    check.current();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check.current(); });
    return () => sub.remove();
  }, [lib.ready]);

  // The Share to Quill screen lists folders and recent notes: it reads them from here.
  useEffect(() => {
    if (!lib.ready) return;
    const timer = setTimeout(() => {
      const names = new Map(lib.lib.folders.map((f) => [f.id, f.name]));
      const notes = lib.lib.notes.filter((n) => !n.trashed).slice().sort((a, b) => (b.opened ?? b.updated) - (a.opened ?? a.updated)).slice(0, 40)
        .map((n) => ({ id: n.id, title: n.title, detail: [`${n.pages} ${n.pages === 1 ? 'page' : 'pages'}`, n.folderId ? names.get(n.folderId) : null].filter(Boolean).join(' · ') }));
      setShareLibrary(JSON.stringify({ folders: lib.lib.folders.map((f) => ({ id: f.id, name: f.name, color: f.color })), notes }));
    }, 800);
    return () => clearTimeout(timer);
  }, [lib.ready, lib.lib]);

  const recent = lib.lib.notes.filter((n) => !n.trashed).slice().sort((a, b) => (b.opened ?? b.updated) - (a.opened ?? a.updated)).slice(0, 12);
  const last = recent[0];
  const count = files?.length ?? 0;
  const pdfCount = files?.filter(isPdf).length ?? 0;
  const fileLine = !files ? '' : count === 1 ? (files[0].fileName ?? (pdfCount ? 'Shared PDF' : 'Shared photo')) : `${files[0].fileName ?? 'Shared files'} and ${count - 1} more`;
  const folderOf = (id: string | null) => lib.lib.folders.find((x) => x.id === id);
  const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const choose = (p: 'last' | 'new' | 'existing') => {
    setPick(p);
    setExisting(p !== 'new');
    if (p === 'last') setInto(last?.id ?? null);
    if (p === 'existing') setInto((v) => v ?? last?.id ?? null);
  };

  // The look: a grey sheet with white groups, like a form in Settings.
  const sheetBg = t.dark ? '#1C1C1E' : '#F2F2F7';
  const groupBg = t.dark ? '#2C2C2E' : '#FFFFFF';
  const line = t.dark ? '#3A3A3C' : '#E3E3E8';
  const group = { borderRadius: 14, borderCurve: 'continuous', backgroundColor: groupBg, overflow: 'hidden' } as const;
  const caption = { color: t.text, fontSize: 13.5, fontWeight: '600', marginTop: 20, marginBottom: 8, marginLeft: 8 } as const;
  const footnote = { color: t.sub, fontSize: 12.5, marginTop: 7, marginLeft: 8 } as const;
  const rowStyle = ({ pressed }: { pressed: boolean }) => ({ flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: 54, paddingHorizontal: 16, backgroundColor: pressed ? (t.dark ? '#3A3A3C' : '#ECECF0') : 'transparent' });
  const option = (label: string, on: boolean, onPress: () => void, first = false) => (
    <View key={label}>
      {first ? null : <View style={{ height: 1, marginLeft: 16, backgroundColor: line }} />}
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={onPress} style={rowStyle}>
        <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 17 }}>{label}</Text>
        {on ? <Icon name="checkmark" size={17} color={t.text} /> : null}
      </Pressable>
    </View>
  );
  const fo = folderOf(folder);

  return (
    <>
      <Modal visible={!!files} transparent animationType="fade" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={() => setFiles(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.42)' }}>
          <Pressable accessibilityLabel="Cancel the import" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} onPress={() => setFiles(null)} />
          <Reanimated.View entering={FadeInDown.duration(260)} style={{ width: '100%', maxWidth: 560, maxHeight: '88%', borderRadius: 34, borderCurve: 'continuous', backgroundColor: sheetBg, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 40, shadowOffset: { width: 0, height: 18 } }}>
            {/* The bar: close on the left, the name in the middle, Import on the right. */}
            <View style={{ height: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 }}>
              <Pressable accessibilityLabel="Close" onPress={() => setFiles(null)} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: groupBg, opacity: pressed ? 0.6 : 1, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 1 } })}>
                <Icon name="xmark" size={17} color={t.text} />
              </Pressable>
              <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>Import to Quill</Text>
              <Pressable accessibilityLabel="Import" disabled={existing && !into} onPress={run} style={({ pressed }) => ({ height: 44, paddingHorizontal: 20, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, opacity: existing && !into ? 0.4 : pressed ? 0.8 : 1 })}>
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Import</Text>
              </Pressable>
            </View>
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 22 }}>
              {/* What is coming in. */}
              <View style={[group, { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 }]}>
                <View style={{ width: 58, height: 72, borderRadius: 6, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: line, alignItems: 'center', justifyContent: 'center' }}>
                  {cover ? <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Icon name={pdfCount ? 'doc.richtext' : 'photo'} size={24} color="#9AA2B2" />}
                </View>
                <Text numberOfLines={2} style={{ flex: 1, color: t.text, fontSize: 17 }}>{fileLine}</Text>
              </View>

              <Text style={caption}>Import options</Text>
              <View style={group}>
                {last ? option(`Add to “${last.title}”`, pick === 'last', () => choose('last'), true) : null}
                {option('Create new note', pick === 'new', () => choose('new'), !last)}
                {option('Add to existing note', pick === 'existing', () => choose('existing'))}
              </View>
              {pick !== 'new' ? <Text style={footnote}>The pages go on the end of that note.</Text> : null}

              {pick === 'existing' ? (
                <>
                  <Text style={caption}>Note</Text>
                  <View style={group}>
                    {recent.map((n, i) => (
                      <View key={n.id}>
                        {i ? <View style={{ height: 1, marginLeft: 16, backgroundColor: line }} /> : null}
                        <Pressable accessibilityLabel={n.title} accessibilityState={{ selected: into === n.id }} onPress={() => setInto(n.id)} style={rowStyle}>
                          <View style={{ flex: 1, paddingVertical: 8 }}>
                            <Text numberOfLines={1} style={{ color: t.text, fontSize: 16.5 }}>{n.title}</Text>
                            <Text numberOfLines={1} style={{ color: t.sub, fontSize: 12.5, marginTop: 1 }}>{[`${n.pages} ${n.pages === 1 ? 'page' : 'pages'}`, folderOf(n.folderId)?.name, ago(n.opened ?? n.updated)].filter(Boolean).join(' · ')}</Text>
                          </View>
                          {into === n.id ? <Icon name="checkmark" size={17} color={t.text} /> : null}
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              {pick === 'new' ? (
                <>
                  <Text style={caption}>Note title</Text>
                  <View style={[group, { flexDirection: 'row', alignItems: 'center' }]}>
                    <TextInput accessibilityLabel="Note title" value={name} onChangeText={setName} placeholder="Note title" placeholderTextColor={t.faint} selectTextOnFocus returnKeyType="done"
                      style={{ flex: 1, height: 54, paddingHorizontal: 16, color: t.text, fontSize: 17 }} />
                    {name ? <Pressable accessibilityLabel="Clear the title" hitSlop={10} onPress={() => setName('')} style={{ paddingHorizontal: 14 }}><Icon name="xmark.circle.fill" size={18} color={t.faint} /></Pressable> : null}
                  </View>
                  <Text style={footnote}>Tap the title to rename it.</Text>

                  <Text style={caption}>Folder</Text>
                  <View style={group}>
                    <Pressable accessibilityLabel={`Folder: ${fo?.name ?? 'No subject'}. Tap to change.`} onPress={() => setFolderOpen((v) => !v)} style={rowStyle}>
                      <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: fo?.color ?? t.faint, marginRight: 12 }} />
                      <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 17 }}>{fo?.name ?? 'No subject'}</Text>
                      <Icon name={folderOpen ? 'chevron.down' : 'chevron.right'} size={14} color={t.sub} />
                    </Pressable>
                    {folderOpen ? [{ id: null as string | null, name: 'No subject', color: t.faint }, ...lib.lib.folders].map((x) => (
                      <View key={x.id ?? 'none'}>
                        <View style={{ height: 1, marginLeft: 16, backgroundColor: line }} />
                        <Pressable accessibilityLabel={x.name} accessibilityState={{ selected: folder === x.id }} onPress={() => { setFolder(x.id); setFolderOpen(false); }} style={rowStyle}>
                          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: x.color, marginRight: 12, marginLeft: 14 }} />
                          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16.5 }}>{x.name}</Text>
                          {folder === x.id ? <Icon name="checkmark" size={16} color={t.text} /> : null}
                        </Pressable>
                      </View>
                    )) : null}
                  </View>
                </>
              ) : null}
            </ScrollView>
          </Reanimated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Afterwards: a small menu. */}
      <Modal visible={!!done} transparent animationType="fade" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={() => setDone(null)}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.42)' }}>
          <Reanimated.View entering={FadeIn.duration(180)} style={{ width: '100%', maxWidth: 320, borderRadius: 22, borderCurve: 'continuous', backgroundColor: sheetBg, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 12 } }}>
            <View style={{ alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 }}>
              <Reanimated.View entering={ZoomIn.springify().damping(12)} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#30A46C' }}>
                <Icon name="checkmark" size={20} color="#fff" />
              </Reanimated.View>
              <Text style={{ color: t.text, fontSize: 17, fontWeight: '700', marginTop: 10 }}>Imported</Text>
              <Text numberOfLines={2} style={{ color: t.sub, fontSize: 14, textAlign: 'center', marginTop: 3 }}>{done ? `${done.added} ${done.added === 1 ? 'page' : 'pages'} in “${done.title}”` : ''}</Text>
            </View>
            <View style={{ height: 1, backgroundColor: line }} />
            <Pressable accessibilityLabel="Continue to the Quill note" onPress={() => { const id = done?.id; setDone(null); if (id) router.push(`/note/${id}`); }} style={({ pressed }) => ({ height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? (t.dark ? '#3A3A3C' : '#E5E5EA') : 'transparent' })}>
              <Text style={{ color: t.accent, fontSize: 17, fontWeight: '700' }}>Continue to Quill note</Text>
            </Pressable>
            <View style={{ height: 1, backgroundColor: line }} />
            <Pressable accessibilityLabel="Close" onPress={() => setDone(null)} style={({ pressed }) => ({ height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? (t.dark ? '#3A3A3C' : '#E5E5EA') : 'transparent' })}>
              <Text style={{ color: t.accent, fontSize: 17 }}>Close</Text>
            </Pressable>
          </Reanimated.View>
        </View>
      </Modal>
    </>
  );
}
