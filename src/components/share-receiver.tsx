// Files shared to Quill from other apps (Files, Mail, Safari, Photos...). A PDF keeps its pages and
// photos become pages. Before anything is made Quill asks where it should go: a name, a subject, or
// onto the end of a note that's already there. Afterwards it asks whether to open it.
// Mounted once for the whole app.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Reanimated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';

import { useLibrary } from '@/lib/library';
import { type Page, uid } from '@/lib/model';
import { imagePages, loadDoc, pdfPages, saveDoc } from '@/lib/noteio';
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
    setFiles(usable);
  }, [hasShareIntent, shareIntent, resetShareIntent, lib, toast, busy]);

  const run = async () => {
    const list = files;
    if (!list || working.current) return;
    setFiles(null);
    working.current = true;
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
    finally { busy(null); working.current = false; }
    if (result) setDone(result);
  };

  const recent = lib.lib.notes.filter((n) => !n.trashed).slice().sort((a, b) => (b.opened ?? b.updated) - (a.opened ?? a.updated)).slice(0, 12);
  const count = files?.length ?? 0;
  const pdfCount = files?.filter(isPdf).length ?? 0;
  const kindLine = !files ? '' : pdfCount === count ? (count === 1 ? 'PDF' : `${count} PDFs`) : pdfCount === 0 ? (count === 1 ? 'Photo' : `${count} photos`) : `${count} files`;
  const folderOf = (id: string | null) => lib.lib.folders.find((x) => x.id === id);
  const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const group = { borderRadius: 14, borderCurve: 'continuous', backgroundColor: t.dark ? t.elev : '#F2F2F7', overflow: 'hidden' } as const;
  const caption = { color: t.sub, fontSize: 12.5, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 20, marginBottom: 8, marginLeft: 4 } as const;
  const hair = { height: 1, marginLeft: 52, backgroundColor: t.dark ? '#3A3A3C' : '#E1E1E6' } as const;
  const card = { width: '100%', maxWidth: 480, borderRadius: 28, borderCurve: 'continuous', backgroundColor: t.dark ? t.card : '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 40, shadowOffset: { width: 0, height: 18 } } as const;
  const tile = (icon: string, tint: string, size = 34) => (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: tint + '22' }}>
      <Icon name={icon} size={size * 0.5} color={tint} />
    </View>
  );
  const seg = (label: string, on: boolean, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={onPress} style={{ flex: 1, height: 34, borderRadius: 9, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: on ? (t.dark ? '#636366' : '#FFFFFF') : 'transparent', shadowColor: '#000', shadowOpacity: on ? 0.12 : 0, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }}>
      <Text style={{ color: t.text, fontSize: 14.5, fontWeight: on ? '600' : '500' }}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <Modal visible={!!files} transparent animationType="fade" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={() => setFiles(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.38)' }}>
          <Pressable accessibilityLabel="Cancel the import" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} onPress={() => setFiles(null)} />
          <Reanimated.View entering={FadeInDown.duration(260)} style={card}>
            {/* What is coming in. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, paddingBottom: 6 }}>
              {tile(pdfCount ? 'doc.richtext.fill' : 'photo.fill', pdfCount ? '#E5484D' : '#30A46C', 52)}
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.sub, fontSize: 13, fontWeight: '600' }}>Import to Quill</Text>
                <Text numberOfLines={1} style={{ color: t.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.3, marginTop: 1 }}>{files?.[0]?.fileName ?? (pdfCount ? 'Shared PDF' : 'Shared photos')}</Text>
                <Text style={{ color: t.faint, fontSize: 13, marginTop: 1 }}>{kindLine}{count > 1 ? ' in all' : ''}</Text>
              </View>
              <Pressable accessibilityLabel="Close" hitSlop={10} onPress={() => setFiles(null)} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: t.dark ? t.elev : '#EEEEF2', alignSelf: 'flex-start' }}>
                <Icon name="xmark" size={12} color={t.sub} />
              </Pressable>
            </View>
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 6 }}>
              <View style={{ flexDirection: 'row', padding: 2, borderRadius: 11, borderCurve: 'continuous', backgroundColor: t.dark ? t.elev : '#E9E9EE', marginTop: 14 }}>
                {seg('New note', !existing, () => setExisting(false))}
                {seg('Add to a note', existing, () => { setExisting(true); setInto((v) => v ?? recent[0]?.id ?? null); })}
              </View>
              {existing ? (
                <>
                  <Text style={caption}>Add the pages to the end of</Text>
                  {recent.length ? (
                    <View style={group}>
                      {recent.map((n, i) => {
                        const on = into === n.id, fo = folderOf(n.folderId);
                        return (
                          <View key={n.id}>
                            {i ? <View style={hair} /> : null}
                            <Pressable accessibilityLabel={n.title} accessibilityState={{ selected: on }} onPress={() => setInto(n.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: pressed ? (t.dark ? '#3A3A3C' : '#E5E5EA') : 'transparent' })}>
                              {tile(n.kind === 'pdf' ? 'doc.richtext' : 'doc.text', fo?.color ?? t.accent, 30)}
                              <View style={{ flex: 1 }}>
                                <Text numberOfLines={1} style={{ color: t.text, fontSize: 15.5, fontWeight: '500' }}>{n.title}</Text>
                                <Text numberOfLines={1} style={{ color: t.faint, fontSize: 12.5 }}>{[`${n.pages} ${n.pages === 1 ? 'page' : 'pages'}`, fo?.name, ago(n.opened ?? n.updated)].filter(Boolean).join(' · ')}</Text>
                              </View>
                              <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={21} color={on ? t.accent : t.faint} />
                            </Pressable>
                          </View>
                        );
                      })}
                    </View>
                  ) : <Text style={{ color: t.sub, fontSize: 15, marginLeft: 4 }}>There are no notes yet. Choose New note instead.</Text>}
                </>
              ) : (
                <>
                  <Text style={caption}>Name</Text>
                  <View style={[group, { flexDirection: 'row', alignItems: 'center', paddingLeft: 12 }]}>
                    <Icon name="pencil" size={15} color={t.faint} />
                    <TextInput accessibilityLabel="Name of the note" value={name} onChangeText={setName} placeholder="Name of the note" placeholderTextColor={t.faint} selectTextOnFocus clearButtonMode="while-editing" returnKeyType="done"
                      style={{ flex: 1, height: 46, paddingHorizontal: 10, color: t.text, fontSize: 16 }} />
                  </View>
                  <Text style={caption}>Subject</Text>
                  <View style={group}>
                    {[{ id: null as string | null, name: 'No subject', color: t.faint }, ...lib.lib.folders].map((fo, i) => {
                      const on = folder === fo.id;
                      return (
                        <View key={fo.id ?? 'none'}>
                          {i ? <View style={hair} /> : null}
                          <Pressable accessibilityLabel={fo.name} accessibilityState={{ selected: on }} onPress={() => setFolder(fo.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 46, paddingHorizontal: 12, backgroundColor: pressed ? (t.dark ? '#3A3A3C' : '#E5E5EA') : 'transparent' })}>
                            {tile(fo.id ? 'folder.fill' : 'tray', fo.color, 30)}
                            <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15.5 }}>{fo.name}</Text>
                            {on ? <Icon name="checkmark" size={15} color={t.accent} /> : null}
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </ScrollView>
            <View style={{ padding: 20, paddingTop: 16 }}>
              <Pressable accessibilityLabel="Import" disabled={existing && !into} onPress={run} style={({ pressed }) => ({ height: 52, borderRadius: 16, borderCurve: 'continuous', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, opacity: existing && !into ? 0.4 : pressed ? 0.85 : 1 })}>
                <Icon name="square.and.arrow.down" size={17} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>{existing ? 'Add to this note' : 'Import'}</Text>
              </Pressable>
            </View>
          </Reanimated.View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!done} transparent animationType="fade" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={() => setDone(null)}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.38)' }}>
          <Reanimated.View entering={FadeIn.duration(200)} style={[card, { maxWidth: 380, alignItems: 'center', padding: 26 }]}>
            <Reanimated.View entering={ZoomIn.springify().damping(12)} style={{ width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', backgroundColor: '#30A46C' }}>
              <Icon name="checkmark" size={30} color="#fff" />
            </Reanimated.View>
            <Text style={{ color: t.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4, marginTop: 16 }}>It's in Quill</Text>
            <Text style={{ color: t.sub, fontSize: 15.5, textAlign: 'center', marginTop: 6 }}>{done ? `${done.added} ${done.added === 1 ? 'page' : 'pages'} added to “${done.title}”.` : ''}</Text>
            <Pressable accessibilityLabel="Open the note" onPress={() => { const id = done?.id; setDone(null); if (id) router.push(`/note/${id}`); }} style={({ pressed }) => ({ alignSelf: 'stretch', height: 52, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, marginTop: 22, opacity: pressed ? 0.85 : 1 })}>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Open the note</Text>
            </Pressable>
            <Pressable accessibilityLabel="Close without opening the note" onPress={() => setDone(null)} style={({ pressed }) => ({ alignSelf: 'stretch', height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 6, opacity: pressed ? 0.5 : 1 })}>
              <Text style={{ color: t.accent, fontSize: 17, fontWeight: '600' }}>Done</Text>
            </Pressable>
          </Reanimated.View>
        </View>
      </Modal>
    </>
  );
}
