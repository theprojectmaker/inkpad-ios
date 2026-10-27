// Classroom inside Quill, minimal: To do (due / missing / done) and your classes.
// A class has its Stream (teacher posts) and Classwork (by topic). An assignment's
// page shows the teacher's files as previews, "Write on the worksheet" and Hand in.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FileCard, ItemSheet, PreviewSheet } from '@/components/classroom-parts';
import { ConfirmSheet, Icon, IconButton, useToast } from '@/components/ui';
import {
  type Assignment, cached, cachedCourse, type ClassMaterial, courseColor, type CourseDetail, fetchCourse, dueLabel, type ClassroomData, connect, connectedEmail, type Course, disconnect, downloadMaterial, fetchAssignments,
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
  const [openMat, setOpenMat] = useState<ClassMaterial | null>(null);
  const [preview, setPreview] = useState<{ m: Material; a: Assignment | null } | null>(null);
  const [tab, setTab] = useState<'stream' | 'classwork'>('stream');
  const [detail, setDetail] = useState<CourseDetail | null>(null);

  // A class's Stream / topics / materials: saved copy first, then fresh.
  useEffect(() => {
    if (!course) { setDetail(null); return; }
    let live = true;
    setTab('stream');
    cachedCourse(course.id).then((d) => { if (live && d) setDetail(d); });
    fetchCourse(course.id).then((d) => { if (live) setDetail(d); }).catch((e) => { if (live) setErr(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [course]);
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
  const openInQuill = async (a: Assignment | null, m: Material) => {
    try {
      busy(`Opening ${m.title}…`);
      const f = await downloadMaterial(m);
      const id = uid('n');
      let text = '';
      let pages;
      if (f.kind === 'pdf') ({ pages, text } = await pdfPages(id, f.uri, (s) => busy(s)));
      else pages = await imagePages(id, [f.uri]);
      const linked = !!a && !noteFor(a);
      const cls = a?.course ?? course?.name;
      await lib.createNote({ id, folderId: cls ? folderFor(cls) : null, kind: f.kind, title: linked ? a!.title : f.title, pages, paper: { style: 'blank', color: 'white' } });
      lib.updateNote(id, { ...(text ? { pdfText: text } : {}), ...(linked ? { hw: homeworkOf(a!) } : {}) });
      busy(null);
      setOpen(null); setOpenMat(null); setPreview(null);
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
    const cc = courseColor(course.id);
    const items = (data?.items ?? []).filter((a) => a.courseId === course.id);
    const mats = detail?.materials ?? [];
    const when = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const upcoming = items.filter((a) => a.status === 'todo' && a.due != null).sort((x, y) => (x.due ?? 0) - (y.due ?? 0)).slice(0, 3);
    // Classwork grouped by topic, newest first inside each (like Classroom).
    const groups: { name: string; rows: ({ k: 'a'; a: Assignment } | { k: 'm'; m: ClassMaterial })[] }[] = [];
    const topicName = (id?: string) => detail?.topics.find((x) => x.id === id)?.name ?? '';
    const all = [...items.map((a) => ({ k: 'a' as const, a, t: a.posted ?? a.due ?? 0, topic: a.topicId })), ...mats.map((m) => ({ k: 'm' as const, m, t: m.posted, topic: m.topicId }))]
      .sort((x, y) => y.t - x.t);
    for (const r of all) {
      const name = topicName(r.topic);
      let g = groups.find((x) => x.name === name);
      if (!g) { g = { name, rows: [] }; groups.push(g); }
      g.rows.push(r.k === 'a' ? { k: 'a', a: r.a } : { k: 'm', m: r.m });
    }
    groups.sort((x, y) => (x.name ? 1 : 0) - (y.name ? 1 : 0));
    const line = (key: string, icon: string, title: string, right: string, onPress: () => void, color = cc, red = false) => (
      <Pressable key={key} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 10, backgroundColor: pressed ? t.chip : 'transparent' })}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={16} color="#fff" />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15.5, fontWeight: '500' }}>{title}</Text>
        <Text style={{ color: red ? t.danger : t.faint, fontSize: 13 }}>{right}</Text>
      </Pressable>
    );
    body = (
      <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { load(); fetchCourse(course.id).then(setDetail).catch(() => {}); }} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60, maxWidth: 980, width: '100%', alignSelf: 'center' }}>
        <View style={{ height: 150, borderRadius: 16, backgroundColor: cc, padding: 22, justifyContent: 'flex-end', overflow: 'hidden' }}>
          <View style={{ position: 'absolute', right: -40, top: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: '#ffffff1A' }} />
          <View style={{ position: 'absolute', right: 70, bottom: -90, width: 160, height: 160, borderRadius: 80, backgroundColor: '#ffffff12' }} />
          <Text numberOfLines={1} style={{ color: '#fff', fontSize: 30, fontWeight: '700' }}>{course.name}</Text>
          {course.section || course.room ? <Text numberOfLines={1} style={{ color: '#ffffffe0', fontSize: 16, marginTop: 3 }}>{[course.section, course.room].filter(Boolean).join(' · ')}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 26, marginTop: 14, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: t.line }}>
          {(['stream', 'classwork'] as const).map((x) => (
            <Pressable key={x} onPress={() => setTab(x)} style={{ paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: tab === x ? cc : 'transparent', marginBottom: -1 }}>
              <Text style={{ color: tab === x ? cc : t.sub, fontSize: 15.5, fontWeight: '700' }}>{x === 'stream' ? 'Stream' : 'Classwork'}</Text>
            </Pressable>
          ))}
        </View>
        {tab === 'stream' ? (
          <View style={{ gap: 14 }}>
            {upcoming.length ? (
              <View style={{ borderRadius: 14, borderWidth: 1, borderColor: t.line, padding: 16, gap: 6 }}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '700', marginBottom: 2 }}>Upcoming</Text>
                {upcoming.map((a) => (
                  <Pressable key={keyOf(a)} onPress={() => setOpen(a)}>
                    <Text numberOfLines={1} style={{ color: t.sub, fontSize: 14, lineHeight: 22 }}><Text style={{ color: t.text, fontWeight: '600' }}>{dueLabel(a.due)}</Text> — {a.title}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {(detail?.posts ?? []).map((p) => (
              <View key={p.id} style={{ borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.card, padding: 16, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: cc, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="megaphone" size={15} color="#fff" />
                  </View>
                  <Text style={{ flex: 1, color: t.sub, fontSize: 13.5, fontWeight: '600' }}>Your teacher · {when(p.posted)}</Text>
                </View>
                {p.text ? <Text selectable style={{ color: t.text, fontSize: 15.5, lineHeight: 22 }}>{p.text}</Text> : null}
                {p.materials.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {p.materials.map((m, i) => <FileCard key={i} m={m} width={190} onPress={() => (m.kind === 'drive' ? setPreview({ m, a: null }) : openLink(m.url))} />)}
                  </View>
                ) : null}
              </View>
            ))}
            {detail && !detail.posts.length && !upcoming.length ? empty('Nothing posted here yet.') : null}
            {!detail ? <ActivityIndicator style={{ marginTop: 30 }} color={t.accent} /> : null}
          </View>
        ) : (
          <View style={{ gap: 18 }}>
            {groups.map((g) => (
              <View key={g.name || '_'}>
                {g.name ? <Text style={{ color: cc, fontSize: 22, fontWeight: '600', paddingBottom: 8, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: cc + '66' }}>{g.name}</Text> : null}
                {g.rows.map((r) => r.k === 'a'
                  ? line(keyOf(r.a), r.a.status === 'done' ? 'checkmark' : 'doc.text', r.a.title,
                    r.a.status === 'done' ? 'Turned in' : r.a.status === 'missing' ? 'Missing' : r.a.due ? dueLabel(r.a.due) : '',
                    () => setOpen(r.a), r.a.status === 'done' ? '#9AA0A6' : cc, r.a.status === 'missing')
                  : line(r.m.id, 'book.closed', r.m.title, `Posted ${when(r.m.posted)}`, () => setOpenMat(r.m)))}
              </View>
            ))}
            {!groups.length ? empty('No classwork yet.') : null}
          </View>
        )}
      </ScrollView>
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

      <ItemSheet a={open} mat={openMat} note={open ? noteFor(open) : undefined}
        onClose={() => { setOpen(null); setOpenMat(null); }} onBlank={startBlank} onWrite={openInQuill}
        onPreview={(m) => setPreview({ m, a: open })} />
      <PreviewSheet m={preview?.m ?? null} onClose={() => setPreview(null)} onWrite={(m) => openInQuill(preview?.a ?? null, m)} />
      <ConfirmSheet visible={signOut} title="Disconnect Google Classroom?" message="Quill forgets your Google sign-in. Your notes stay." confirm="Disconnect" onCancel={() => setSignOut(false)}
        onConfirm={async () => { setSignOut(false); await disconnect(); setEmail(null); setData(null); }} />
    </View>
  );
}
