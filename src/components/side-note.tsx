// A second note open beside the first: read one while writing in the other (and
// write in either, with the same pen).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { type CanvasHandle, type CanvasPage, type CanvasTool, QuillCanvas } from '@/components/quill-canvas';
import { Icon, IconButton, Sheet } from '@/components/ui';
import { fsx } from '@/lib/fsx';
import { useLibrary } from '@/lib/library';
import type { NoteDoc, NoteMeta } from '@/lib/model';
import { loadDoc, notePath } from '@/lib/noteio';
import { paperMarks, paperOf } from '@/lib/paper';
import { useTheme } from '@/lib/settings';

const absPath = (path: string) => decodeURIComponent(fsx.uri(path).replace(/^file:\/\//, ''));

function pagesOf(id: string, doc: NoteDoc): CanvasPage[] {
  return doc.pages.map((p) => {
    if (p.bg.kind === 'paper') {
      const marks = paperMarks(p.bg.style, p.bg.color, p.w, p.h).map((m) => ('cx' in m
        ? { x: m.cx, y: m.cy, w: 0, h: 0, r: m.r, color: m.color }
        : { x: m.x, y: m.y, w: m.w, h: m.h, r: 0, color: m.color }));
      return { id: p.id, w: p.w, h: p.h, bg: paperOf(p.bg.color).bg, kind: 'paper', file: '', index: 0, marks };
    }
    return { id: p.id, w: p.w, h: p.h, bg: '#FFFFFF', kind: p.bg.kind, file: absPath(notePath(id, p.bg.file)), index: p.bg.kind === 'pdf' ? p.bg.index : 0, marks: [] };
  });
}

export function SideNote({ noteId, tool, fingerDraws, onClose, onSwap }: { noteId: string; tool: CanvasTool; fingerDraws: boolean; onClose: () => void; onSwap: () => void }) {
  const t = useTheme();
  const lib = useLibrary();
  const canvas = useRef<CanvasHandle>(null);
  const [doc, setDoc] = useState<NoteDoc | null>(null);
  const title = lib.lib.notes.find((n) => n.id === noteId)?.title ?? 'Note';
  useEffect(() => {
    let live = true;
    setDoc(null);
    loadDoc(noteId).then((d) => { if (live) setDoc(d); });
    return () => { live = false; canvas.current?.save().catch(() => {}); };
  }, [noteId]);
  const pages = useMemo(() => (doc ? pagesOf(noteId, doc) : []), [doc, noteId]);
  return (
    <View style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: t.line }}>
      <View style={{ height: 40, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 4, backgroundColor: t.bar, borderBottomWidth: 1, borderBottomColor: t.line }}>
        <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 14, fontWeight: '600' }}>{title}</Text>
        <IconButton name="arrow.left.arrow.right" label="Open another note here" onPress={onSwap} />
        <IconButton name="xmark" label="Close second note" onPress={onClose} />
      </View>
      {doc ? (
        <QuillCanvas key={noteId} ref={canvas} style={{ flex: 1 }} pages={pages} tool={tool} fingerDraws={fingerDraws}
          drawingPath={absPath(notePath(noteId, 'drawing.pkd'))} textsPath={absPath(notePath(noteId, 'texts.json'))} />
      ) : <View style={{ flex: 1, backgroundColor: '#ECECEE' }} />}
    </View>
  );
}

export function NotePicker({ visible, exclude, onPick, onClose }: { visible: boolean; exclude: string; onPick: (n: NoteMeta) => void; onClose: () => void }) {
  const t = useTheme();
  const lib = useLibrary();
  const notes = lib.lib.notes.filter((n) => n.id !== exclude && !n.trashed).sort((a, b) => (b.opened ?? b.updated) - (a.opened ?? a.updated)).slice(0, 40);
  return (
    <Sheet visible={visible} onClose={onClose} title="Open beside this note" width={420}>
      {notes.length ? notes.map((n) => (
        <Pressable key={n.id} accessibilityLabel={n.title} onPress={() => onPick(n)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 8, borderRadius: 10, backgroundColor: pressed ? t.chip : 'transparent' })}>
          <Icon name="doc" size={18} color={t.sub} />
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16 }}>{n.title}</Text>
        </Pressable>
      )) : <Text style={{ color: t.sub, fontSize: 15 }}>You don't have another note yet.</Text>}
    </Sheet>
  );
}
