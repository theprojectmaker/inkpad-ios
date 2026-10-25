// Files shared to Quill from other apps (Files, Mail, Safari, Photos...)
// become a new note straight away: a PDF keeps its pages, photos become pages.
// Mounted once for the whole app; renders nothing.
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useLibrary } from '@/lib/library';
import { uid } from '@/lib/model';
import { imagePages, pdfPages } from '@/lib/noteio';
import { useIncomingShare } from '@/lib/share';
import { useToast } from './ui';

export function ShareReceiver() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useIncomingShare();
  const lib = useLibrary();
  const { toast, busy } = useToast();
  const working = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || working.current || !lib.ready) return;
    const files = (shareIntent.files ?? []).filter((f) => /^image\//i.test(f.mimeType) || /pdf/i.test(f.mimeType) || /\.pdf$/i.test(f.fileName ?? f.path));
    resetShareIntent();
    if (!files.length) { toast('Share a PDF or photos to make a note.'); return; }
    working.current = true;
    (async () => {
      let opened: string | null = null;
      try {
        const pdfs = files.filter((f) => /pdf/i.test(f.mimeType) || /\.pdf$/i.test(f.fileName ?? f.path));
        const photos = files.filter((f) => !pdfs.includes(f));
        for (const f of pdfs) {
          busy(`Importing ${f.fileName ?? 'PDF'}…`);
          const id = uid('n');
          const { pages, text } = await pdfPages(id, f.path, (m) => busy(m));
          await lib.createNote({ id, folderId: null, kind: 'pdf', title: (f.fileName ?? 'Shared PDF').replace(/\.pdf$/i, ''), pages, paper: { style: 'blank', color: 'white' } });
          if (text) lib.updateNote(id, { pdfText: text });
          opened = opened ?? id;
        }
        if (photos.length) {
          busy('Importing photos…');
          const id = uid('n');
          const pages = await imagePages(id, photos.map((p) => p.path));
          await lib.createNote({ id, folderId: null, kind: 'image', title: photos[0].fileName?.replace(/\.[a-z0-9]+$/i, '') || 'Shared photos', pages, paper: { style: 'blank', color: 'white' } });
          opened = opened ?? id;
        }
      } catch (e) { toast("Couldn't import that: " + String((e as Error)?.message ?? e)); }
      finally { busy(null); working.current = false; }
      if (opened) router.push(`/note/${opened}`);
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent, lib, toast, busy]);

  return null;
}
