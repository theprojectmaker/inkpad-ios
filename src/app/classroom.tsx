// Classroom inside Quill, minimal: To do (due / missing / done) and your classes.
// A class has its Stream (teacher posts) and Classwork (by topic). An assignment's
// page shows the teacher's files as previews, "Write on the worksheet" and Hand in.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
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
  const [filter, setFilter] = useState<Status>('todo');
  const [course, setCourse] = useState<Course | null>(null);
  const [open, setOpen] = useState<Assignment | null>(null);
  const openedLink = useRef(false);   // the "Due soon" link opens its assignment once, not after every refresh
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
    fetchCourse(course.id).then((d) => { if (live) { setDetail(d); setErr(''); } }).catch((e) => {
      if (!live) return;
      if (e?.relogin) setEmail(null);
      setErr(String(e?.message ?? e));
    });
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
      const [em, c] = await Promise.all([connectedEmail(), cached().catch(() => null)]);
      setEmail(em); if (c) setData(c);
      const ok = await isConfigured();
      setReady(ok);
      if (em && ok !== false) load();
    })();
  }, [load]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (st) => { if (st === 'active' && (await connectedEmail())) load(); });
    return () => sub.remove();
  }, [load]);

  // Opened from the library's "Due soon" strip: show that assignment.
  useEffect(() => {
    if (params.a && data && !openedLink.current) { const a = data.items.find((x) => keyOf(x) === params.a); if (a) { openedLink.current = true; setOpen(a); } }
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
  const opening = useRef(false);
  const openInQuill = async (a: Assignment | null, m: Material) => {
    if (opening.current) return;
    opening.current = true;
    // Close the sheets first: progress and errors show on this screen, not hidden behind them.
    setOpen(null); setOpenMat(null); setPreview(null);
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
    } finally { opening.current = false; }
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
            {!detail && !err ? <ActivityIndicator style={{ marginTop: 30 }} color={t.accent} /> : null}
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
  } else {
    // Home: a greeting, three numbers, your classes and one clean To do list.
    const items = data?.items ?? [];
    const wide = width >= 900;
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const endOfWeek = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return d.getTime(); })();
    const thisWeek = lists.todo.filter((a) => a.due != null && a.due <= endOfWeek);
    const stat = (id: Status, n: number, label: string, color: string) => {
      const on = filter === id;
      return (
        <Pressable key={id} onPress={() => setFilter(id)} style={({ pressed }) => ({ flex: 1, minWidth: 150, padding: 18, borderRadius: 18, backgroundColor: on ? color : t.card, borderWidth: 1, borderColor: on ? color : t.line, opacity: pressed ? 0.85 : 1 })}>
          <Text style={{ color: on ? '#fff' : color, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{n}</Text>
          <Text style={{ color: on ? '#ffffffe6' : t.sub, fontSize: 15, fontWeight: '600', marginTop: 2 }}>{label}</Text>
        </Pressable>
      );
    };
    // To do in Classroom's groups: this week, next week, later, no due date.
    const groupsOf = (list: Assignment[]) => {
      if (filter !== 'todo') return [{ name: '', list }];
      const nextWeek = endOfWeek + 7 * 864e5;
      const g = [
        { name: 'This week', list: list.filter((a) => a.due != null && a.due <= endOfWeek) },
        { name: 'Next week', list: list.filter((a) => a.due != null && a.due > endOfWeek && a.due <= nextWeek) },
        { name: 'Later', list: list.filter((a) => a.due != null && a.due > nextWeek) },
        { name: 'No due date', list: list.filter((a) => a.due == null) },
      ];
      return g.filter((x) => x.list.length);
    };
    const todoRow = (a: Assignment) => {
      const note = noteFor(a);
      return (
        <Pressable key={keyOf(a)} onPress={() => setOpen(a)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: pressed ? t.chip : 'transparent' })}>
          <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: courseColor(a.courseId) }} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={2} style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{a.title}</Text>
            <Text numberOfLines={1} style={{ color: a.status === 'missing' ? t.danger : t.sub, fontSize: 13.5, marginTop: 3 }}>
              {a.course} · {a.status === 'done' ? (a.grade != null && a.points ? `${a.grade}/${a.points}` : 'Turned in') : a.status === 'missing' ? `Missing · ${dueLabel(a.due)}` : dueLabel(a.due)}
            </Text>
          </View>
          {note ? <Icon name="pencil.and.outline" size={15} color={t.accent} /> : null}
          <Icon name="chevron.right" size={13} color={t.faint} />
        </Pressable>
      );
    };
    const todoPanel = (
      <View style={{ flex: wide ? 0 : undefined, width: wide ? 420 : undefined, borderRadius: 20, borderWidth: 1, borderColor: t.line, backgroundColor: t.card, paddingVertical: 16, paddingHorizontal: 10, alignSelf: 'flex-start', ...(wide ? {} : { alignSelf: 'stretch' }) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, marginBottom: 6 }}>
          <Text style={{ flex: 1, color: t.text, fontSize: 21, fontWeight: '800' }}>{filter === 'todo' ? 'To do' : filter === 'missing' ? 'Missing' : 'Done'}</Text>
          <Text style={{ color: t.faint, fontSize: 14, fontWeight: '600' }}>{lists[filter].length}</Text>
        </View>
        {groupsOf(lists[filter]).map((g) => (
          <View key={g.name || 'all'}>
            {g.name ? <Text style={{ color: t.faint, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.6, paddingHorizontal: 12, marginTop: 12, marginBottom: 2 }}>{g.name.toUpperCase()}</Text> : null}
            {g.list.map(todoRow)}
          </View>
        ))}
        {!lists[filter].length ? <Text style={{ color: t.sub, fontSize: 15, textAlign: 'center', paddingVertical: 30 }}>{loading ? 'Loading…' : filter === 'todo' ? 'Nothing due. Nice work.' : filter === 'missing' ? 'No missing work.' : 'Nothing turned in yet.'}</Text> : null}
      </View>
    );
    const classCard = (c: Course, w: number) => {
      const mine = items.filter((a) => a.courseId === c.id);
      const next = mine.filter((a) => a.status === 'todo' && a.due != null).sort((x, y) => (x.due ?? 0) - (y.due ?? 0))[0];
      const missing = mine.filter((a) => a.status === 'missing').length;
      const cc = courseColor(c.id);
      return (
        <Pressable key={c.id} onPress={() => setCourse(c)} style={({ pressed }) => ({ width: w, borderRadius: 18, overflow: 'hidden', backgroundColor: t.card, borderWidth: 1, borderColor: t.line, opacity: pressed ? 0.88 : 1 })}>
          <View style={{ height: 112, backgroundColor: cc, padding: 16, justifyContent: 'flex-end', overflow: 'hidden' }}>
            <View style={{ position: 'absolute', right: -30, top: -50, width: 150, height: 150, borderRadius: 75, backgroundColor: '#ffffff1C' }} />
            <View style={{ position: 'absolute', right: 50, bottom: -70, width: 110, height: 110, borderRadius: 55, backgroundColor: '#ffffff12' }} />
            <Text numberOfLines={1} style={{ color: '#fff', fontSize: 21, fontWeight: '700' }}>{c.name}</Text>
            {c.section ? <Text numberOfLines={1} style={{ color: '#ffffffe0', fontSize: 14, marginTop: 1 }}>{c.section}</Text> : null}
          </View>
          <View style={{ paddingHorizontal: 16, paddingVertical: 13, gap: 3, minHeight: 64, justifyContent: 'center' }}>
            {next ? (
              <>
                <Text numberOfLines={1} style={{ color: t.faint, fontSize: 12.5, fontWeight: '700' }}>{dueLabel(next.due).toUpperCase()}</Text>
                <Text numberOfLines={1} style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{next.title}</Text>
              </>
            ) : <Text style={{ color: t.sub, fontSize: 15 }}>All caught up</Text>}
            {missing ? <Text style={{ color: t.danger, fontSize: 13, fontWeight: '700', marginTop: 2 }}>{missing} missing</Text> : null}
          </View>
        </Pressable>
      );
    };
    const leftW = Math.min(width, 1180) - 48 - (wide ? 420 + 24 : 0);
    const cols = wide ? (leftW > 620 ? 2 : 1) : width >= 640 ? 2 : 1;
    const cardW = (leftW - (cols - 1) * 16) / cols;
    body = (
      <ScrollView refreshControl={refresh} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 60, maxWidth: 1180, width: '100%', alignSelf: 'center', gap: 22 }}>
        <View>
          <Text style={{ color: t.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.6 }}>{hello}</Text>
          <Text style={{ color: t.sub, fontSize: 16, marginTop: 4 }}>
            {thisWeek.length ? `${thisWeek.length} due this week` : 'Nothing due this week'}{lists.missing.length ? ` · ${lists.missing.length} missing` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {stat('todo', lists.todo.length, 'To do', '#1967D2')}
          {stat('missing', lists.missing.length, 'Missing', '#D93025')}
          {stat('done', lists.done.length, 'Turned in', '#137333')}
        </View>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 24 }}>
          <View style={{ width: wide ? leftW : undefined, gap: 12 }}>
            <Text style={{ color: t.text, fontSize: 21, fontWeight: '800' }}>Your classes</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
              {(data?.courses ?? []).map((c) => classCard(c, cardW))}
            </View>
            {!data?.courses.length ? <Text style={{ color: t.sub, fontSize: 15 }}>{loading ? 'Loading your classes…' : 'No classes found.'}</Text> : null}
          </View>
          {todoPanel}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      {header}
      {err ? <Text style={{ color: t.danger, fontSize: 14, paddingHorizontal: 20, paddingBottom: 8 }}>{err}</Text> : null}
      {body}

      <ItemSheet a={open} mat={openMat} note={open ? noteFor(open) : undefined}
        onClose={() => { setOpen(null); setOpenMat(null); }} onBlank={startBlank} onWrite={openInQuill}
        onPreview={(m) => setPreview({ m, a: open })}>
        {open || openMat ? <PreviewSheet m={preview?.m ?? null} onClose={() => setPreview(null)} onWrite={(m) => openInQuill(preview?.a ?? null, m)} /> : null}
      </ItemSheet>
      {!open && !openMat ? <PreviewSheet m={preview?.m ?? null} onClose={() => setPreview(null)} onWrite={(m) => openInQuill(preview?.a ?? null, m)} /> : null}
      <ConfirmSheet visible={signOut} title="Disconnect Google Classroom?" message="Quill forgets your Google sign-in. Your notes stay." confirm="Disconnect" onCancel={() => setSignOut(false)}
        onConfirm={async () => { setSignOut(false); await disconnect(); setEmail(null); setData(null); }} />
    </View>
  );
}
