// Classroom, the simple version: To do (due / missing / done) and your classes.
// Tap an assignment for its page: the teacher's instructions and worksheets,
// "Write on the worksheet" (opens it as pages in Quill), and "Hand in".
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmSheet, Icon, IconButton, useToast } from '@/components/ui';
import {
  type Assignment, cached, courseColor, dueLabel, type ClassroomData, connect, connectedEmail, type Course, disconnect, downloadMaterial, fetchAssignments,
  homeworkOf, isConfigured, keyOf, type Material, openLink, openWebsite, type Status,
} from '@/lib/classroom';
import { useLibrary } from '@/lib/library';
import { uid } from '@/lib/model';
import { imagePages, pdfPages } from '@/lib/noteio';
import { useTheme } from '@/lib/settings';

const FILTERS: { id: Status; label: string }[] = [
  { id: 'todo', label: 'Due' },
  { id: 'missing', label: 'Missing' },
  { id: 'done', label: 'Done' },
];

const MAT_ICON: Record<Material['kind'], string> = { drive: 'doc.richtext', link: 'link', video: 'play.rectangle', form: 'list.bullet.rectangle' };

export default function ClassroomScreen() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const lib = useLibrary();
  const { toast, busy } = useToast();
  const params = useLocalSearchParams<{ a?: string }>();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [ready, setReady] = useState<boolean | null>(null);
  const [data, setData] = useState<ClassroomData | null>(null);
  const [view, setView] = useState<'todo' | 'classes'>('todo');
  const [filter, setFilter] = useState<Status>('todo');
  const [course, setCourse] = useState<Course | null>(null);
  const [open, setOpen] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [signOut, setSignOut] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setData(await fetchAssignments()); }
    catch (e: any) {
      if (e?.relogin) setEmail(null);
      setErr(String(e?.message ?? e));
    } finally { setLoading(false); }
  }, []);

  // Saved assignments show at once; the fresh list loads behind them.
  useEffect(() => {
    (async () => {
      const [em, c] = await Promise.all([connectedEmail(), cached()]);
      setEmail(em); if (c) setData(c);
      const ok = await isConfigured();
      setReady(ok);
      if (em && ok) load();
    })();
  }, [load]);

  // Opened from the library's "Due soon" strip: show that assignment.
  useEffect(() => {
    if (params.a && data && !open) { const a = data.items.find((x) => keyOf(x) === params.a); if (a) setOpen(a); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.a, data]);

  const doConnect = async () => {
    try { const em = await connect(); setEmail(em); load(); }
    catch (e: any) { if (String(e?.message) !== 'cancelled') toast(String(e?.message ?? e)); }
  };

  const lists = useMemo(() => {
    const items = data?.items ?? [];
    const by = (s: Status) => items.filter((a) => a.status === s);
    return {
      todo: by('todo').sort((a, b) => (a.due ?? 9e15) - (b.due ?? 9e15)),
      missing: by('missing').sort((a, b) => (b.due ?? 0) - (a.due ?? 0)),
      done: by('done').sort((a, b) => (b.due ?? 0) - (a.due ?? 0)),
    };
  }, [data]);

  const noteFor = (a: Assignment) => lib.lib.notes.find((n) => n.hw?.key === keyOf(a));

  const folderFor = (name: string) => lib.lib.folders.find((f) => f.name === name)?.id ?? lib.addFolder(name);

  /** A blank lined note for the assignment, filed under its class. */
  const startBlank = async (a: Assignment) => {
    const id = await lib.createNote({ folderId: folderFor(a.course), kind: 'paper', title: a.title, paper: { style: 'lined', color: 'white', size: 'letter' } });
    lib.updateNote(id, { hw: homeworkOf(a) });
    setOpen(null);
    router.push(`/note/${id}`);
  };

  /** The teacher's worksheet as pages to write on (linked to the assignment if it has no note yet). */
  const openInQuill = async (a: Assignment, m: Material) => {
    try {
      busy(`Opening ${m.title}…`);
      const f = await downloadMaterial(m);
      const id = uid('n');
      let text = '';
      let pages;
      if (f.kind === 'pdf') ({ pages, text } = await pdfPages(id, f.uri, (s) => busy(s)));
      else pages = await imagePages(id, [f.uri]);
      const linked = !noteFor(a);
      await lib.createNote({ id, folderId: folderFor(a.course), kind: f.kind, title: linked ? a.title : f.title, pages, paper: { style: 'blank', color: 'white' } });
      lib.updateNote(id, { ...(text ? { pdfText: text } : {}), ...(linked ? { hw: homeworkOf(a) } : {}) });
      busy(null);
      setOpen(null);
      router.push(`/note/${id}`);
    } catch (e: any) {
      busy(null);
      if (e?.relogin) { setOpen(null); setEmail(null); }
      toast(String(e?.message ?? e));
    }
  };

  const back = () => {
    if (course) { setCourse(null); return; }
    if (router.canGoBack()) router.back(); else router.replace('/');
  };

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, height: 52, gap: 4 }}>
      <IconButton name="chevron.left" label={course ? 'Back to classes' : 'Back to notes'} onPress={back} />
      <Icon name="graduationcap" size={20} color={t.accent} />
      <Text numberOfLines={1} style={{ flex: 1, marginLeft: 6, color: t.text, fontSize: 22, fontWeight: '800' }}>{course ? course.name : 'Classroom'}</Text>
      {email ? (
        <Pressable onPress={() => setSignOut(true)} style={{ paddingHorizontal: 10, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: t.chip, marginRight: 6 }}>
          <Text numberOfLines={1} style={{ color: t.sub, fontSize: 12.5, fontWeight: '600', maxWidth: 220 }}>{email}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (email === undefined) {
    return <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>{header}<ActivityIndicator style={{ marginTop: 60 }} color={t.accent} /></View>;
  }

  if (!email) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 14 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: t.accent + '1A', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="graduationcap" size={32} color={t.accent} />
          </View>
          <Text style={{ color: t.text, fontSize: 22, fontWeight: '800' }}>Your Classroom, in Quill</Text>
          <Text style={{ color: t.sub, fontSize: 15, textAlign: 'center', maxWidth: 440, lineHeight: 21 }}>
            See what's due, open worksheets as pages to write on, and hand in your notes. Quill can read your classes, assignments and worksheets. It can't change or delete anything.
          </Text>
          {ready !== false ? (
            <Pressable onPress={doConnect} style={({ pressed }) => ({ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 22, borderRadius: 23, backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 })}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Connect Google Classroom</Text>
            </Pressable>
          ) : (
            <Text style={{ color: t.danger, fontSize: 14, textAlign: 'center', maxWidth: 420 }}>Classroom isn't switched on yet: the Google sign-in for Quill still needs its one-time setup.</Text>
          )}
          {err ? <Text style={{ color: t.danger, fontSize: 14, textAlign: 'center', maxWidth: 420 }}>{err}</Text> : null}
          <View style={{ height: 1, width: 260, backgroundColor: t.line, marginTop: 14 }} />
          <Text style={{ color: t.sub, fontSize: 14, textAlign: 'center', maxWidth: 420, lineHeight: 20 }}>
            Google says "Access blocked"? The school's Google admin has to allow Quill first. Until then this works with any account:
          </Text>
          <Pressable onPress={() => openWebsite('todo')} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: t.chip, opacity: pressed ? 0.8 : 1 })}>
            <Icon name="safari" size={16} color={t.accent} />
            <Text style={{ color: t.accent, fontSize: 15, fontWeight: '700' }}>Open my assignments on Classroom</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const row = (a: Assignment, showCourse = true) => {
    const note = noteFor(a);
    const c = courseColor(a.courseId);
    return (
      <Pressable onPress={() => setOpen(a)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, backgroundColor: pressed ? t.chip : t.card, borderWidth: 1, borderColor: t.line })}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c + '22' }}>
          <Icon name={a.status === 'done' ? 'checkmark' : a.type === 'ASSIGNMENT' ? 'doc.text' : 'questionmark.circle'} size={18} color={c} />
        </View>
        <View style={{ flex: 1 }}>
          {showCourse ? <Text numberOfLines={1} style={{ color: t.faint, fontSize: 12, fontWeight: '700' }}>{a.course.toUpperCase()}</Text> : null}
          <Text numberOfLines={2} style={{ color: t.text, fontSize: 16, fontWeight: '600', marginTop: showCourse ? 2 : 0 }}>{a.title}</Text>
          <Text style={{ color: a.status === 'missing' ? t.danger : t.sub, fontSize: 13, marginTop: 3 }}>
            {a.status === 'done' ? (a.grade != null && a.points ? `Graded ${a.grade}/${a.points}` : 'Turned in') : dueLabel(a.due)}
            {a.status !== 'done' && a.points ? ` · ${a.points} pts` : ''}
          </Text>
        </View>
        {note ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: t.accent + '1A' }}>
            <Icon name="pencil" size={11} color={t.accent} />
            <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>Note</Text>
          </View>
        ) : null}
        <Icon name="chevron.right" size={14} color={t.faint} />
      </Pressable>
    );
  };

  const empty = (s: string) => !loading ? <Text style={{ color: t.sub, fontSize: 15, textAlign: 'center', marginTop: 60 }}>{s}</Text> : null;
  const refresh = <RefreshControl refreshing={loading} onRefresh={load} />;

  let body;
  if (course) {
    const items = (data?.items ?? []).filter((a) => a.courseId === course.id).sort((a, b) => (b.due ?? 0) - (a.due ?? 0));
    body = (
      <FlatList data={items} keyExtractor={keyOf} refreshControl={refresh}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10 }}
        ListHeaderComponent={
          <View style={{ height: 110, borderRadius: 16, backgroundColor: courseColor(course.id), padding: 18, justifyContent: 'flex-end', marginBottom: 6 }}>
            <Text numberOfLines={1} style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>{course.name}</Text>
            {course.section ? <Text numberOfLines={1} style={{ color: '#ffffffd9', fontSize: 15, marginTop: 2 }}>{course.section}</Text> : null}
          </View>
        }
        ListEmptyComponent={empty('No assignments in this class yet.')}
        renderItem={({ item }) => row(item, false)} />
    );
  } else if (view === 'classes') {
    const cols = width >= 1000 ? 3 : width >= 640 ? 2 : 1;
    const cardW = (Math.min(width, 1200) - 40 - (cols - 1) * 14) / cols;
    body = (
      <ScrollView refreshControl={refresh} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {(data?.courses ?? []).map((c) => {
          const due = (data?.items ?? []).filter((a) => a.courseId === c.id && a.status === 'todo').length;
          const missing = (data?.items ?? []).filter((a) => a.courseId === c.id && a.status === 'missing').length;
          return (
            <Pressable key={c.id} onPress={() => setCourse(c)} style={({ pressed }) => ({ width: cardW, borderRadius: 16, overflow: 'hidden', backgroundColor: t.card, borderWidth: 1, borderColor: t.line, opacity: pressed ? 0.85 : 1 })}>
              <View style={{ height: 92, backgroundColor: courseColor(c.id), padding: 14, justifyContent: 'flex-end' }}>
                <Text numberOfLines={1} style={{ color: '#fff', fontSize: 19, fontWeight: '800' }}>{c.name}</Text>
                {c.section ? <Text numberOfLines={1} style={{ color: '#ffffffd9', fontSize: 13, marginTop: 1 }}>{c.section}</Text> : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 14, height: 44, alignItems: 'center' }}>
                <Text style={{ color: t.sub, fontSize: 13.5, fontWeight: '600' }}>{due ? `${due} due` : 'Nothing due'}</Text>
                {missing ? <Text style={{ color: t.danger, fontSize: 13.5, fontWeight: '600' }}>{missing} missing</Text> : null}
              </View>
            </Pressable>
          );
        })}
        {!data?.courses.length ? <View style={{ width: '100%' }}>{empty(loading ? '' : 'No classes found.')}</View> : null}
      </ScrollView>
    );
  } else {
    body = (
      <>
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 10 }}>
          {FILTERS.map((x) => {
            const on = filter === x.id, n = lists[x.id].length;
            return (
              <Pressable key={x.id} onPress={() => setFilter(x.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 13, borderRadius: 16, backgroundColor: on ? t.text : t.chip }}>
                <Text style={{ color: on ? t.bg : t.text, fontSize: 14, fontWeight: '700' }}>{x.label}</Text>
                <Text style={{ color: on ? t.bg : x.id === 'missing' && n ? t.danger : t.faint, fontSize: 13, fontWeight: '700', opacity: on ? 0.75 : 1 }}>{n}</Text>
              </Pressable>
            );
          })}
        </View>
        <FlatList data={lists[filter]} keyExtractor={keyOf} refreshControl={refresh}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10 }}
          ListEmptyComponent={empty(filter === 'todo' ? 'Nothing due. Nice.' : filter === 'missing' ? 'No missing work.' : 'Nothing turned in yet.')}
          renderItem={({ item }) => row(item)} />
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      {header}
      {!course ? (
        <View style={{ flexDirection: 'row', alignSelf: 'flex-start', marginLeft: 20, marginBottom: 12, backgroundColor: t.chip, borderRadius: 10, padding: 3 }}>
          {(['todo', 'classes'] as const).map((v) => (
            <Pressable key={v} onPress={() => setView(v)} style={{ paddingHorizontal: 18, height: 32, borderRadius: 8, justifyContent: 'center', backgroundColor: view === v ? t.elev : 'transparent' }}>
              <Text style={{ color: view === v ? t.text : t.sub, fontSize: 14.5, fontWeight: '700' }}>{v === 'todo' ? 'To do' : 'Classes'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {err ? <Text style={{ color: t.danger, fontSize: 14, paddingHorizontal: 20, paddingBottom: 8 }}>{err}</Text> : null}
      {body}

      <AssignmentSheet a={open} onClose={() => setOpen(null)} note={open ? noteFor(open) : undefined}
        onBlank={startBlank} onMaterial={openInQuill} />
      <ConfirmSheet visible={signOut} title="Disconnect Google Classroom?" message="Quill forgets your Google sign-in. Your notes stay." confirm="Disconnect" onCancel={() => setSignOut(false)}
        onConfirm={async () => { setSignOut(false); await disconnect(); setEmail(null); setData(null); }} />
    </View>
  );
}

/** The assignment's page: what to do, the worksheets, and your work. */
function AssignmentSheet({ a, note, onClose, onBlank, onMaterial }: {
  a: Assignment | null; note?: { id: string; title: string }; onClose: () => void;
  onBlank: (a: Assignment) => void; onMaterial: (a: Assignment, m: Material) => void;
}) {
  const t = useTheme();
  if (!a) return null;
  const c = courseColor(a.courseId);
  const sheets = (a.materials ?? []).filter((m) => m.kind === 'drive');
  const big = (label: string, icon: string, onPress: () => void, primary = false) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: 14, backgroundColor: primary ? t.accent : t.chip, opacity: pressed ? 0.8 : 1 })}>
      <Icon name={icon} size={17} color={primary ? '#fff' : t.accent} />
      <Text style={{ color: primary ? '#fff' : t.accent, fontSize: 16, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ backgroundColor: c, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text numberOfLines={1} style={{ flex: 1, color: '#ffffffe0', fontSize: 14, fontWeight: '700' }}>{a.course.toUpperCase()}</Text>
            <Pressable onPress={onClose} accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff33' }}>
              <Icon name="xmark" size={13} color="#fff" />
            </Pressable>
          </View>
          <Text style={{ color: '#fff', fontSize: 25, fontWeight: '800', marginTop: 8 }}>{a.title}</Text>
          <Text style={{ color: '#ffffffe0', fontSize: 15, marginTop: 6 }}>
            {a.status === 'done' ? (a.grade != null && a.points ? `Graded ${a.grade}/${a.points}` : 'Turned in') : dueLabel(a.due)}
            {a.status !== 'done' && a.points ? ` · ${a.points} points` : ''}
            {a.status === 'missing' ? ' · Missing' : ''}
          </Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 22, gap: 22, paddingBottom: 50 }}>
          <View style={{ gap: 10 }}>
            <Text style={{ color: t.faint, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.6 }}>YOUR WORK</Text>
            {note ? (
              <>
                <Pressable onPress={() => { onClose(); router.push(`/note/${note.id}`); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: pressed ? t.chip : t.card, borderWidth: 1, borderColor: t.line })}>
                  <Icon name="doc.text" size={20} color={t.accent} />
                  <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16, fontWeight: '600' }}>{note.title}</Text>
                  <Text style={{ color: t.accent, fontSize: 14, fontWeight: '700' }}>Open</Text>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {a.status !== 'done' ? big('Hand in', 'paperplane.fill', () => { onClose(); router.push(`/note/${note.id}?handin=1`); }, true) : null}
                </View>
                {a.status !== 'done' ? (
                  <Text style={{ color: t.sub, fontSize: 13.5, lineHeight: 19 }}>
                    Hand in sends your note as a PDF. In the share menu pick Classroom, choose this assignment, then tap Turn in.
                  </Text>
                ) : null}
              </>
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {sheets.length ? big('Write on the worksheet', 'pencil.and.outline', () => onMaterial(a, sheets[0]), true) : null}
                {big(sheets.length ? 'Blank note' : 'Start a note', 'square.and.pencil', () => onBlank(a), !sheets.length)}
              </View>
            )}
          </View>

          {a.description ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: t.faint, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.6 }}>INSTRUCTIONS</Text>
              <Text selectable style={{ color: t.text, fontSize: 16, lineHeight: 23 }}>{a.description}</Text>
            </View>
          ) : null}

          {a.materials?.length ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: t.faint, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.6 }}>FROM YOUR TEACHER</Text>
              {a.materials.map((m, i) => (
                <Pressable key={i} onPress={() => openLink(m.url)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: pressed ? t.chip : t.card, borderWidth: 1, borderColor: t.line })}>
                  <View style={{ width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}>
                    <Icon name={MAT_ICON[m.kind]} size={17} color={t.sub} />
                  </View>
                  <Text numberOfLines={2} style={{ flex: 1, color: t.text, fontSize: 15, fontWeight: '600' }}>{m.title}</Text>
                  {m.kind === 'drive' ? (
                    <Pressable onPress={() => onMaterial(a, m)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: t.accent + '1A' }}>
                      <Icon name="square.and.arrow.down" size={13} color={t.accent} />
                      <Text style={{ color: t.accent, fontSize: 13, fontWeight: '700' }}>Open in Quill</Text>
                    </Pressable>
                  ) : <Icon name="arrow.up.right" size={13} color={t.faint} />}
                </Pressable>
              ))}
            </View>
          ) : null}

          <Pressable onPress={() => openLink(a.link)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: 14, height: 40 }}>
            <Text style={{ color: t.sub, fontSize: 14.5, fontWeight: '600' }}>Open in Google Classroom</Text>
            <Icon name="arrow.up.right" size={12} color={t.sub} />
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
