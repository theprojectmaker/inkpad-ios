// Pieces of the Classroom screens: file cards with previews, the full-screen
// file preview, and the assignment / class-material page (laid out like
// Google Classroom's: the work on the left, "Your work" on the right).
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { type Assignment, type ClassMaterial, courseColor, downloadMaterial, driveThumb, dueLabel, type Material, openLink } from '@/lib/classroom';
import { useTheme } from '@/lib/settings';
import { Icon } from './ui';

const KIND: Record<Material['kind'], { icon: string; label: string }> = {
  drive: { icon: 'doc.richtext', label: 'File' },
  link: { icon: 'link', label: 'Link' },
  video: { icon: 'play.rectangle.fill', label: 'YouTube' },
  form: { icon: 'list.bullet.rectangle', label: 'Google Form' },
};

/** A file the teacher attached, with Google's preview picture when there is one. */
export function FileCard({ m, onPress, width = 220 }: { m: Material; onPress: () => void; width?: number }) {
  const t = useTheme();
  const [img, setImg] = useState<{ uri: string; headers?: Record<string, string> } | null>(m.kind !== 'drive' && m.thumb ? { uri: m.thumb } : null);
  useEffect(() => {
    let live = true;
    if (m.kind === 'drive' && m.fileId) driveThumb(m.fileId).then((r) => { if (live && r) setImg(r); });
    return () => { live = false; };
  }, [m.kind, m.fileId]);
  const k = KIND[m.kind];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ width, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: t.line, backgroundColor: t.card, opacity: pressed ? 0.85 : 1 })}>
      <View style={{ height: width * 0.58, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
        {img ? <Image source={img} resizeMode="cover" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} /> : <Icon name={k.icon} size={28} color={t.faint} />}
        {m.kind === 'video' ? (
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="play.fill" size={16} color="#fff" />
          </View>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: 11, paddingVertical: 9, borderTopWidth: 1, borderTopColor: t.line }}>
        <Text numberOfLines={1} style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{m.title}</Text>
        <Text style={{ color: t.faint, fontSize: 12, marginTop: 1 }}>{k.label}</Text>
      </View>
    </Pressable>
  );
}

/** A teacher's file opened right in Quill (PDFs, Docs, photos), with "Write on it". */
export function PreviewSheet({ m, onClose, onWrite }: { m: Material | null; onClose: () => void; onWrite?: (m: Material) => void }) {
  const t = useTheme();
  const [file, setFile] = useState<{ uri: string; kind: 'pdf' | 'image' } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setFile(null); setErr('');
    if (!m) return;
    let live = true;
    downloadMaterial(m).then((f) => { if (live) setFile(f); }).catch((e) => { if (live) setErr(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [m]);
  if (!m) return null;
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: Platform.OS === 'ios' ? 50 : 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, height: 52, borderBottomWidth: 1, borderBottomColor: t.line }}>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}>
            <Icon name="xmark" size={13} color={t.sub} />
          </Pressable>
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 17, fontWeight: '700' }}>{m.title}</Text>
          <Pressable onPress={() => openLink(m.url)} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center', backgroundColor: t.chip }}>
            <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>Open in Google</Text>
          </Pressable>
          {onWrite && file ? (
            <Pressable onPress={() => onWrite(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: t.accent }}>
              <Icon name="pencil.and.outline" size={14} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Write on it</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ flex: 1, backgroundColor: '#E8E8EC' }}>
          {file ? (file.kind === 'image'
            ? <Image source={{ uri: file.uri }} resizeMode="contain" style={{ flex: 1 }} />
            : Platform.OS === 'web'
              ? <Text style={{ margin: 30, color: t.sub }}>PDF previews show on the iPad.</Text>
              : <WebView source={{ uri: file.uri }} originWhitelist={['*']} allowingReadAccessToURL={file.uri} allowFileAccess style={{ flex: 1, backgroundColor: '#E8E8EC' }} />)
            : err ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 14 }}>
                <Text style={{ color: t.sub, fontSize: 15, textAlign: 'center' }}>{err}</Text>
                <Pressable onPress={() => openLink(m.url)} style={{ height: 42, paddingHorizontal: 18, borderRadius: 21, justifyContent: 'center', backgroundColor: t.accent }}>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Open in Google</Text>
                </Pressable>
              </View>
            ) : <ActivityIndicator style={{ marginTop: 80 }} color={t.accent} />}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Handing in, step by step. Google only lets its own Classroom press Turn in,
 * so: 1) the PDF goes to Files (or straight to the Classroom app), 2) the
 * assignment opens on Google's own page right here to attach it and Turn in.
 */
export function HandInSheet({ pdf, onClose, onSave, onDrive, onOpen }: {
  pdf: { path: string; title: string } | null; onClose: () => void; onSave: () => void;
  onDrive?: () => Promise<boolean>; onOpen: () => void;
}) {
  const t = useTheme();
  const [step, setStep] = useState(1);
  const [via, setVia] = useState<'drive' | 'files'>('drive');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (pdf) { setStep(1); setVia('drive'); } }, [pdf]);
  if (!pdf) return null;
  const btn = (label: string, onPress: () => void, primary: boolean, icon?: string) => (
    <Pressable onPress={onPress} disabled={saving} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 7, height: 42, paddingHorizontal: 18, borderRadius: 21, backgroundColor: primary ? '#1967D2' : t.chip, opacity: pressed || saving ? 0.7 : 1 })}>
      {icon ? <Icon name={icon} size={14} color={primary ? '#fff' : t.text} /> : null}
      <Text style={{ color: primary ? '#fff' : t.text, fontSize: 15, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  const card = (n: number, title: string, text: string, buttons: React.ReactNode) => {
    const on = step === n, done = step > n;
    return (
      <View style={{ flexDirection: 'row', gap: 14, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: on ? '#1967D2' : t.line, backgroundColor: t.card, opacity: on || done ? 1 : 0.55 }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? '#137333' : on ? '#1967D2' : t.chip }}>
          {done ? <Icon name="checkmark" size={14} color="#fff" /> : <Text style={{ color: on ? '#fff' : t.sub, fontWeight: '800' }}>{n}</Text>}
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
          <Text style={{ color: t.sub, fontSize: 14.5, lineHeight: 20 }}>{text}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>{buttons}</View>
        </View>
      </View>
    );
  };
  const toDrive = async () => {
    if (!onDrive) return;
    setSaving(true);
    const ok = await onDrive();
    setSaving(false);
    if (ok) { setVia('drive'); setStep(2); }
  };
  return (
    <Modal visible animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 24, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 22, fontWeight: '800' }}>Hand in</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}>
            <Icon name="xmark" size={13} color={t.sub} />
          </Pressable>
        </View>
        <Text style={{ color: t.sub, fontSize: 15 }}>Your note is ready as “{pdf.title}.pdf”.</Text>
        {card(1, 'Save your work',
          step > 1 && via === 'drive' ? 'Saved in Google Drive › Quill.' : 'Save it to your Google Drive (best), or to Files. Have the Classroom app? “Other” → Classroom turns it in straight away.',
          <>
            {onDrive ? btn(saving ? 'Saving…' : 'Save to Google Drive', toDrive, step === 1, 'icloud.and.arrow.up') : null}
            {btn(onDrive ? 'Other' : 'Save PDF', () => { onSave(); setVia('files'); setStep(2); }, !onDrive && step === 1)}
          </>)}
        {card(2, 'Turn it in',
          via === 'drive' ? 'On the assignment, tap “Add or create” → Google Drive → Quill, pick the note, then tap Turn in.' : 'On the assignment, tap “Add or create” → File, choose the PDF, then tap Turn in.',
          btn('Open the assignment', () => { onOpen(); setStep(3); }, step === 2))}
        {step > 2 ? (
          <Pressable onPress={onClose} style={{ alignSelf: 'center', height: 44, paddingHorizontal: 26, borderRadius: 22, justifyContent: 'center', backgroundColor: '#137333', marginTop: 4 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Done</Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const statusOf = (a: Assignment) => {
  if (a.status === 'done') return a.grade != null && a.points ? { text: `${a.grade}/${a.points}`, color: '#137333' } : { text: 'Turned in', color: '#137333' };
  if (a.status === 'missing') return { text: 'Missing', color: '#D93025' };
  return { text: 'Assigned', color: '#5F6368' };
};

/**
 * An assignment's page (or a class material's, without "Your work"):
 * title and due date, instructions, the teacher's files as previews; on the
 * right your status, your Quill note and Hand in.
 */
export function ItemSheet({ a, mat, note, onClose, onBlank, onWrite, onPreview }: {
  a?: Assignment | null; mat?: ClassMaterial | null; note?: { id: string; title: string };
  onClose: () => void; onBlank: (a: Assignment) => void; onWrite: (a: Assignment | null, m: Material) => void; onPreview: (m: Material) => void;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const item = a ?? mat;
  if (!item) return null;
  const c = courseColor(item.courseId);
  const wide = width >= 820;
  const files = item.materials ?? [];
  const sheets = files.filter((m) => m.kind === 'drive');
  const sub = a ? [a.points ? `${a.points} points` : '', dueLabel(a.due)].filter(Boolean).join(' · ') : `Posted ${new Date(mat!.posted).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  const tap = (m: Material) => (m.kind === 'drive' ? onPreview(m) : openLink(m.url));

  const main = (
    <View style={{ flex: 1, gap: 18 }}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={a ? 'doc.text' : 'book.closed'} size={19} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c, fontSize: 26, fontWeight: '700', lineHeight: 32 }}>{item.title}</Text>
          <Text style={{ color: t.sub, fontSize: 14.5, marginTop: 4 }}>{sub}</Text>
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: c, opacity: 0.5 }} />
      {item.description ? <Text selectable style={{ color: t.text, fontSize: 16, lineHeight: 24 }}>{item.description}</Text> : null}
      {files.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {files.map((m, i) => <FileCard key={i} m={m} onPress={() => tap(m)} width={wide ? 200 : Math.min(240, (width - 56) / 2)} />)}
        </View>
      ) : null}
    </View>
  );

  const st = a ? statusOf(a) : null;
  const yours = a ? (
    <View style={{ width: wide ? 300 : undefined, alignSelf: 'flex-start', borderRadius: 16, borderWidth: 1, borderColor: t.line, backgroundColor: t.card, padding: 18, gap: 12, ...(wide ? {} : { alignSelf: 'stretch' }) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 19, fontWeight: '600' }}>Your work</Text>
        <Text style={{ color: st!.color, fontSize: 14, fontWeight: '700' }}>{st!.text}</Text>
      </View>
      {a.yours?.map((m, i) => (
        <Pressable key={i} onPress={() => tap(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: t.line }}>
          <Icon name={KIND[m.kind].icon} size={15} color={t.sub} />
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 14 }}>{m.title}</Text>
        </Pressable>
      ))}
      {note ? (
        <Pressable onPress={() => { onClose(); router.push(`/note/${note.id}`); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: t.line }}>
          <Icon name="pencil.and.outline" size={15} color={t.accent} />
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 14, fontWeight: '600' }}>{note.title}</Text>
          <Text style={{ color: t.accent, fontSize: 13, fontWeight: '700' }}>Open</Text>
        </Pressable>
      ) : a.status !== 'done' ? (
        <>
          {sheets.length ? (
            <Pressable onPress={() => onWrite(a, sheets[0])} style={({ pressed }) => ({ height: 44, borderRadius: 10, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: pressed ? t.chip : 'transparent' })}>
              <Icon name="pencil.and.outline" size={15} color={t.accent} />
              <Text style={{ color: t.accent, fontSize: 15, fontWeight: '600' }}>Write on the worksheet</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => onBlank(a)} style={({ pressed }) => ({ height: 44, borderRadius: 10, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: pressed ? t.chip : 'transparent' })}>
            <Icon name="plus" size={15} color={t.accent} />
            <Text style={{ color: t.accent, fontSize: 15, fontWeight: '600' }}>{sheets.length ? 'New blank note' : 'Start a Quill note'}</Text>
          </Pressable>
        </>
      ) : null}
      {a.status !== 'done' ? (
        <Pressable onPress={() => { if (note) { onClose(); router.push(`/note/${note.id}?handin=1`); } else openLink(a.link); }}
          style={({ pressed }) => ({ height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1967D2', opacity: pressed ? 0.85 : 1 })}>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{note ? 'Hand in' : 'Turn in on Classroom'}</Text>
        </Pressable>
      ) : (
        <Pressable onPress={() => openLink(a.link)} style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: t.sub, fontSize: 14, fontWeight: '600' }}>See it on Classroom</Text>
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 54 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: t.faint, fontSize: 13, fontWeight: '700' }}>{(a?.course ?? '').toUpperCase()}</Text>
          <Pressable onPress={() => openLink(item.link)} style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', marginRight: 8 }}>
            <Text style={{ color: t.sub, fontSize: 13.5, fontWeight: '600' }}>Open in Classroom</Text>
          </Pressable>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}>
            <Icon name="xmark" size={13} color={t.sub} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 6, paddingBottom: 60, gap: 24, flexDirection: wide ? 'row' : 'column' }}>
          {main}
          {yours}
        </ScrollView>
      </View>
    </Modal>
  );
}
