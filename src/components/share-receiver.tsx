// Files shared to Quill from other apps (Files, Mail, Safari, Photos...). A PDF keeps its pages and
// photos become pages. Before anything is made Quill asks where it should go: a name, a subject, or
// onto the end of a note that's already there. Afterwards it asks whether to open it.
// Mounted once for the whole app.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useLibrary } from '@/lib/library';
import { type Page, uid } from '@/lib/model';
import { imagePages, loadDoc, pdfPages, saveDoc } from '@/lib/noteio';
import { useTheme } from '@/lib/settings';
import { useIncomingShare } from '@/lib/share';
import { importZip } from '@/lib/zipimport';
import { Icon, Sheet, useToast } from './ui';

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
  const pill = (label: string, on: boolean, onPress: () => void, color?: string) => (
    <Pressable key={label} accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 13, borderRadius: 17, backgroundColor: on ? t.accent : t.chip }}>
      {color ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} /> : null}
      <Text numberOfLines={1} style={{ color: on ? '#fff' : t.text, fontSize: 14, fontWeight: '600', maxWidth: 180 }}>{label}</Text>
    </Pressable>
  );
  const label = { color: t.sub, fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 8 } as const;

  return (
    <>
      <Sheet visible={!!files} onClose={() => setFiles(null)} title="Import to Quill" width={460}>
        <Text style={{ color: t.sub, fontSize: 14 }}>{count === 1 ? (files?.[0].fileName ?? '1 file') : `${count} files`}</Text>
        <Text style={label}>Add to</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {pill('A new note', !existing, () => setExisting(false))}
          {pill('A note I already have', existing, () => { setExisting(true); setInto((v) => v ?? recent[0]?.id ?? null); })}
        </View>
        {existing ? (
          <>
            <Text style={label}>Which note</Text>
            {recent.length ? (
              <ScrollView style={{ maxHeight: 220 }}>
                {recent.map((n) => (
                  <Pressable key={n.id} accessibilityLabel={n.title} accessibilityState={{ selected: into === n.id }} onPress={() => setInto(n.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 42, paddingHorizontal: 10, borderRadius: 10, backgroundColor: into === n.id ? t.accent + '22' : 'transparent' }}>
                    <Icon name={into === n.id ? 'checkmark.circle.fill' : 'circle'} size={18} color={into === n.id ? t.accent : t.faint} />
                    <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15 }}>{n.title}</Text>
                    <Text style={{ color: t.faint, fontSize: 13 }}>{n.pages} {n.pages === 1 ? 'page' : 'pages'}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : <Text style={{ color: t.sub, fontSize: 15 }}>There are no notes yet.</Text>}
            <Text style={{ color: t.faint, fontSize: 13, marginTop: 8 }}>The pages go on the end of that note.</Text>
          </>
        ) : (
          <>
            <Text style={label}>Name</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Name of the note" placeholderTextColor={t.faint} selectTextOnFocus
              style={{ height: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: t.chip, color: t.text, fontSize: 16 }} />
            <Text style={label}>Subject</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {pill('No subject', folder === null, () => setFolder(null))}
              {lib.lib.folders.map((f) => pill(f.name, folder === f.id, () => setFolder(f.id), f.color))}
            </View>
          </>
        )}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
          <Pressable accessibilityLabel="Cancel the import" onPress={() => setFiles(null)} style={{ height: 46, paddingHorizontal: 22, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityLabel="Import" disabled={existing && !into} onPress={run} style={{ flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, opacity: existing && !into ? 0.4 : 1 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Import</Text>
          </Pressable>
        </View>
      </Sheet>
      <Sheet visible={!!done} onClose={() => setDone(null)} title="Imported" width={400}>
        <Text style={{ color: t.text, fontSize: 16 }}>{done ? `${done.added} ${done.added === 1 ? 'page is' : 'pages are'} in “${done.title}”.` : ''}</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
          <Pressable accessibilityLabel="Close without opening the note" onPress={() => setDone(null)} style={{ height: 46, paddingHorizontal: 22, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>Close</Text>
          </Pressable>
          <Pressable accessibilityLabel="Open the note" onPress={() => { const id = done?.id; setDone(null); if (id) router.push(`/note/${id}`); }} style={{ flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Open in Quill</Text>
          </Pressable>
        </View>
      </Sheet>
    </>
  );
}
